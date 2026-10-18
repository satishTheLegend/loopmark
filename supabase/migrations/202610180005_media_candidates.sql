-- Immutable physical objects are separate from epoch-scoped logical media references.
create table loopmark_private.media_objects (
 object_key text primary key, owner_id uuid not null references loopmark_private.accounts(id),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'), bytes bigint not null check(bytes between 1 and 8388608),
 kind text not null check(kind in ('photo','voice')), mime_type text not null,
 state text not null check(state in ('staged','ready','deleting','deleted')), created_at timestamptz not null default now(),
 unique(owner_id,object_key)
);
create index media_object_content on loopmark_private.media_objects(owner_id,sha256,bytes);
create table loopmark_private.candidates (
 id text primary key, owner_id uuid not null, collection_id text not null, epoch text not null, next_epoch text not null,
 revision bigint not null, deletion_generation bigint not null, request_id text not null, request_hash text not null,
 preparation jsonb not null, state text not null default 'prepared' check(state in ('prepared','cancelled','committed','expired')),
 expires_at timestamptz not null, created_at timestamptz not null default now(), receipt jsonb,
 foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id), unique(owner_id,request_id)
);
alter table loopmark_private.snapshot_media drop constraint snapshot_media_owner_id_collection_id_media_id_fkey;
alter table loopmark_private.snapshot_media add column epoch text;
update loopmark_private.snapshot_media m set epoch=s.epoch from loopmark_private.snapshots s where s.id=m.snapshot_id;
alter table loopmark_private.snapshot_media alter column epoch set not null;
alter table loopmark_private.media drop constraint media_pkey;
alter table loopmark_private.media drop constraint media_object_key_key;
alter table loopmark_private.media add primary key(owner_id,collection_id,epoch,id);
alter table loopmark_private.snapshot_media add foreign key(owner_id,collection_id,epoch,media_id) references loopmark_private.media(owner_id,collection_id,epoch,id);
alter table loopmark_private.media add foreign key(owner_id,object_key) references loopmark_private.media_objects(owner_id,object_key);
alter table loopmark_private.upload_reservations add column request_id text;
alter table loopmark_private.upload_reservations add column request_hash text;
alter table loopmark_private.upload_reservations add column object_key text references loopmark_private.media_objects(object_key);
alter table loopmark_private.upload_reservations add column candidate_id text references loopmark_private.candidates(id);
alter table loopmark_private.upload_reservations add column lease_fence bigint not null default 0;
alter table loopmark_private.upload_reservations add column inflight_until timestamptz;
alter table loopmark_private.upload_reservations add column created_at timestamptz not null default now();
create unique index upload_request_id on loopmark_private.upload_reservations(owner_id,request_id);
alter table loopmark_private.media_objects enable row level security;
alter table loopmark_private.candidates enable row level security;
revoke all on loopmark_private.media_objects,loopmark_private.candidates from public,anon,authenticated,service_role;

create function loopmark_private.service_only() returns void language plpgsql set search_path='' as $$
begin if coalesce(auth.jwt()->>'role','')<>'service_role' then perform loopmark_private.fail('AUTH_REQUIRED'); end if; end $$;
create function loopmark_private.time_text(value timestamptz) returns text language sql immutable set search_path='' as $$
 select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
create function loopmark_private.media_ref(m loopmark_private.media) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',m.id,'kind',m.kind,'mimeType',m.mime_type,'bytes',m.bytes,'sha256',m.sha256)
$$;
create function loopmark_private.candidate_size(candidate jsonb) returns bigint language plpgsql immutable set search_path='' as $$
declare p jsonb; cp jsonb; source jsonb; ref jsonb; checkpoints jsonb; total bigint:=0; extra bigint; begin
 for p in select value from jsonb_array_elements(candidate->'projects') loop
  checkpoints:='[]'; extra:=0;
  for source in select value from jsonb_array_elements(candidate->'checkpoints') where value->>'projectId'=p->>'id' loop
   cp:=source-'projectId'-'photo'-'voice';
   for ref in select value from jsonb_each(source) where key in ('photo','voice') loop
    cp:=cp||jsonb_build_object(ref->>'kind','');
    extra:=extra+4*ceil((ref->>'bytes')::numeric/3)::bigint+octet_length(to_jsonb('data:'||(ref->>'mimeType')||';base64,')::text)-2;
   end loop;
   checkpoints:=checkpoints||jsonb_build_array(cp);
  end loop;
  total:=total+octet_length(loopmark_private.canonical(p||jsonb_build_object('checkpoints',checkpoints)))+extra;
 end loop;
 return total;
end $$;
create function loopmark_private.validate_candidate(candidate jsonb) returns void language plpgsql set search_path='' as $$
declare schema jsonb:=loopmark_private.command_schema()::jsonb; candidate_schema jsonb; ref jsonb; k text; begin
 if not loopmark_private.exact_keys(candidate,array['projects','checkpoints']) or jsonb_typeof(candidate->'projects')<>'array' or jsonb_typeof(candidate->'checkpoints')<>'array' or octet_length(loopmark_private.canonical(candidate))>8388608 then perform loopmark_private.fail('VALIDATION'); end if;
 if jsonb_array_length(candidate->'projects')>200 or jsonb_array_length(candidate->'checkpoints')>1000 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
 -- Compile the frozen item schemas once for the whole bounded collection. Re-validating
 -- 1,000 synthetic command envelopes exhausted PostgREST's statement budget.
 candidate_schema:=jsonb_build_object('type','object','properties',jsonb_build_object(
  'projects',jsonb_build_object('type','array','items',schema#>'{oneOf,0,properties,payload,properties,project}'),
  'checkpoints',jsonb_build_object('type','array','items',schema#>'{oneOf,4,properties,payload,properties,checkpoint}')
 ),'required',jsonb_build_array('projects','checkpoints'),'additionalProperties',false);
 if not extensions.jsonb_matches_schema(candidate_schema::json,candidate) then perform loopmark_private.fail('VALIDATION'); end if;
 perform loopmark_private.validate_strings(candidate);
 for k,ref in select r.key,r.value from jsonb_array_elements(candidate->'checkpoints') cp cross join lateral jsonb_each(cp) r where r.key in ('photo','voice') loop
  if ref->>'mimeType'!~U&'^(image/(jpeg|png|webp)|audio/(webm|mp4|ogg|wav|x-wav))(;[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]*codecs=[A-Za-z0-9_., "-]+)?$' or
   (ref->>'kind'='photo' and ((ref->>'bytes')::bigint>4194304 or ref->>'mimeType' not like 'image/%')) or
   (ref->>'kind'='voice' and ref->>'mimeType' not like 'audio/%') or (k in ('photo','voice') and ref->>'kind'<>k) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
 end loop;
 if exists(select 1 from (select value->>'id' id from jsonb_array_elements(candidate->'projects') union all select value->>'id' from jsonb_array_elements(candidate->'checkpoints')) ids group by id having count(*)>1) or
  exists(select 1 from jsonb_array_elements(candidate->'projects') p group by p->>'code' having count(*)>1) or
  exists(select 1 from jsonb_array_elements(candidate->'checkpoints') c where not exists(select 1 from jsonb_array_elements(candidate->'projects') p where p->>'id'=c->>'projectId')) or
  exists(select 1 from jsonb_array_elements(candidate->'checkpoints') c cross join lateral jsonb_each(c) ref where ref.key in ('photo','voice') group by ref.value->>'id' having count(distinct ref.value)>1)
 then perform loopmark_private.fail('VALIDATION'); end if;
 if loopmark_private.candidate_size(candidate)>50331648 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
end $$;

-- Edge obtains immutable input and repeats its revision at the staging transaction.
create function public.loopmark_candidate_current(p_collection text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; projects jsonb; checkpoints jsonb; begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=uid and id=p_collection for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select coalesce(jsonb_agg(data order by id),'[]') into projects from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null;
 select coalesce(jsonb_agg(data order by id),'[]') into checkpoints from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and deleted_at is null;
 return jsonb_build_object('collectionId',c.id,'epoch',c.epoch,'revision',c.revision::text,'candidate',jsonb_build_object('projects',projects,'checkpoints',checkpoints));
end $$;
create function loopmark_private.candidate_response(candidate loopmark_private.candidates) returns jsonb language plpgsql stable set search_path='' as $$
declare required jsonb; begin
 select coalesce(jsonb_agg(loopmark_private.media_ref(m) order by m.id),'[]') into required from loopmark_private.media m
 where m.owner_id=candidate.owner_id and m.collection_id=candidate.collection_id and m.epoch=candidate.next_epoch and m.state<>'ready';
 return candidate.preparation||jsonb_build_object('requiredMedia',required,'receipt',candidate.receipt);
end $$;
create function public.loopmark_candidate_prepare(p_owner uuid,p_request jsonb,p_preparation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; c loopmark_private.collections; existing loopmark_private.candidates; staged loopmark_private.candidates;
 media_value jsonb; object loopmark_private.media_objects; metadata jsonb:=p_preparation->'candidate'; request_hash text; raw_bytes bigint; missing_bytes bigint; physical_bytes bigint; expiry timestamptz:=now()+interval '1 hour'; next_epoch text:=p_preparation->>'nextEpoch'; begin
 perform loopmark_private.service_only();
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=p_owner and id=p_request#>>'{destination,collectionId}' for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 request_hash:=encode(extensions.digest(convert_to(loopmark_private.canonical(p_request),'UTF8'),'sha256'),'hex');
 select * into existing from loopmark_private.candidates where owner_id=p_owner and request_id=p_request->>'requestId';
 if found then
  if existing.request_hash<>request_hash then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  if existing.state='committed' then return loopmark_private.candidate_response(existing); end if;
  if existing.state<>'prepared' or existing.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  return loopmark_private.candidate_response(existing);
 end if;
 if c.epoch<>p_request#>>'{destination,epoch}' then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 if c.revision::text<>p_request#>>'{destination,revision}' then perform loopmark_private.fail('REVISION_CONFLICT'); end if;
 if not loopmark_private.valid_id(p_request->>'requestId') or not loopmark_private.valid_id(next_epoch) or next_epoch=c.epoch or not loopmark_private.valid_id(p_preparation#>>'{replacement,reservationId}') then perform loopmark_private.fail('VALIDATION'); end if;
 perform loopmark_private.validate_candidate(metadata);
 if encode(extensions.digest(convert_to(loopmark_private.canonical(metadata),'UTF8'),'sha256'),'hex')<>p_preparation#>>'{replacement,candidateSha256}' then perform loopmark_private.fail('VALIDATION'); end if;
 update loopmark_private.candidates set state='expired' where owner_id=p_owner and state='prepared' and expires_at<=now();
 if exists(select 1 from loopmark_private.candidates where owner_id=p_owner and state='prepared') then perform loopmark_private.fail('MEDIA_CAPACITY_REACHED'); end if;
 -- Existing over-cap cloud records remain readable; a transfer cannot increase active use past the free cap.
 if not exists(select 1 from loopmark_private.entitlement_projection where account_id=p_owner and upgraded) and
  (select count(*) from jsonb_array_elements(metadata->'projects') p where p->>'status'='active')>greatest(3,(select count(*) from loopmark_private.projects where owner_id=p_owner and collection_id=c.id and deleted_at is null and data->>'status'='active')) then perform loopmark_private.fail('UPGRADE_REQUIRED'); end if;
 select coalesce(sum((ref->>'bytes')::bigint),0) into raw_bytes from (select distinct r.value ref from jsonb_array_elements(metadata->'checkpoints') cp cross join lateral jsonb_each(cp) r where r.key in ('photo','voice')) refs;
 if raw_bytes>41943040 then perform loopmark_private.fail('MEDIA_CAPACITY_REACHED'); end if;
 select coalesce(sum(bytes),0) into physical_bytes from loopmark_private.media_objects where owner_id=p_owner and state<>'deleted';
 select coalesce(sum((ref->>'bytes')::bigint),0) into missing_bytes from (select distinct r.value-'id' ref from jsonb_array_elements(metadata->'checkpoints') cp cross join lateral jsonb_each(cp) r where r.key in ('photo','voice')) refs
 where not exists(select 1 from loopmark_private.media_objects o where o.owner_id=p_owner and o.state='ready' and o.sha256=ref->>'sha256' and o.bytes=(ref->>'bytes')::bigint and o.kind=ref->>'kind' and o.mime_type=ref->>'mimeType');
 if physical_bytes+missing_bytes>83886080 then perform loopmark_private.fail('MEDIA_CAPACITY_REACHED'); end if;
 -- Server transaction supplies all authoritative counts/timestamps; caller fields never grant quota.
 p_preparation:=jsonb_set(p_preparation,'{replacement}',jsonb_build_object('reservationId',p_preparation#>>'{replacement,reservationId}','collectionId',c.id,'epoch',c.epoch,'revision',c.revision::text,'candidateSha256',p_preparation#>>'{replacement,candidateSha256}',
  'projects',jsonb_array_length(metadata->'projects'),'checkpoints',jsonb_array_length(metadata->'checkpoints'),'mediaBytes',raw_bytes,'portableBytes',loopmark_private.candidate_size(metadata),'expiresAt',loopmark_private.time_text(expiry)));
 if p_preparation->'preview'<>'null'::jsonb then p_preparation:=jsonb_set(p_preparation,'{preview,expiresAt}',to_jsonb(loopmark_private.time_text(expiry))); end if;
 insert into loopmark_private.candidates(id,owner_id,collection_id,epoch,next_epoch,revision,deletion_generation,request_id,request_hash,preparation,expires_at)
 values(p_preparation#>>'{replacement,reservationId}',p_owner,c.id,c.epoch,next_epoch,c.revision,a.deletion_generation,p_request->>'requestId',request_hash,p_preparation,expiry) returning * into staged;
 for media_value in select distinct r.value from jsonb_array_elements(metadata->'checkpoints') cp cross join lateral jsonb_each(cp) r where r.key in ('photo','voice') loop
  select * into object from loopmark_private.media_objects o where o.owner_id=p_owner and o.state='ready' and o.sha256=media_value->>'sha256' and o.bytes=(media_value->>'bytes')::bigint and o.kind=media_value->>'kind' and o.mime_type=media_value->>'mimeType' order by o.object_key limit 1;
  insert into loopmark_private.media(owner_id,collection_id,id,epoch,sha256,bytes,kind,mime_type,state,object_key)
   values(p_owner,c.id,media_value->>'id',next_epoch,media_value->>'sha256',(media_value->>'bytes')::bigint,media_value->>'kind',media_value->>'mimeType',case when object.object_key is null then 'pending' else 'ready' end,object.object_key);
 end loop;
 return loopmark_private.candidate_response(staged);
end $$;
create function public.loopmark_candidate_action(p_id text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); candidate loopmark_private.candidates; begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into candidate from loopmark_private.candidates where id=p_id and owner_id=uid for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if p_action='cancel' then
  if candidate.state='committed' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  update loopmark_private.candidates set state='cancelled' where id=p_id;
  update loopmark_private.upload_reservations set state='cancelled' where candidate_id=p_id and state<>'attached';
  return jsonb_build_object('cancelled',true);
 elsif p_action='status' then
  if candidate.state<>'committed' and (candidate.state<>'prepared' or candidate.expires_at<=now()) then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  return loopmark_private.candidate_response(candidate);
 end if;
 perform loopmark_private.fail('VALIDATION');
end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
revoke all on function public.loopmark_candidate_current(text), public.loopmark_candidate_prepare(uuid,jsonb,jsonb),public.loopmark_candidate_action(text,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_candidate_current(text),public.loopmark_candidate_action(text,text) to authenticated;
grant execute on function public.loopmark_candidate_prepare(uuid,jsonb,jsonb) to service_role;
create function public.loopmark_candidate_lookup(p_owner uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate loopmark_private.candidates; begin
 perform loopmark_private.service_only();
 perform 1 from loopmark_private.accounts where id=p_owner and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into candidate from loopmark_private.candidates where owner_id=p_owner and request_id=p_request->>'requestId';
 if not found then return null; end if;
 if candidate.request_hash<>encode(extensions.digest(convert_to(loopmark_private.canonical(p_request),'UTF8'),'sha256'),'hex') then perform loopmark_private.fail('OPERATION_REUSED'); end if;
 if candidate.state<>'committed' and (candidate.state<>'prepared' or candidate.expires_at<=now()) then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 return loopmark_private.candidate_response(candidate);
end $$;
revoke all on function public.loopmark_candidate_lookup(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_candidate_lookup(uuid,jsonb) to service_role;
