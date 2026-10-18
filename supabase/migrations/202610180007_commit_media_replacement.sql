-- Preserve the reviewed I03 implementation for ordinary mutations. This dispatcher
-- adds the two frozen commands and validates receipt retries before an epoch rebase.
alter function loopmark_private.push_effect(jsonb) rename to push_standard_effect;
create function loopmark_private.push_effect(cmd jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; d loopmark_private.devices; a loopmark_private.accounts; old loopmark_private.operation_receipts;
 p loopmark_private.projects; cp loopmark_private.checkpoints; reservation loopmark_private.upload_reservations; candidate loopmark_private.candidates;
 payload jsonb:=cmd->'payload'; kind text:=cmd->>'kind'; changes jsonb; value jsonb; result jsonb; prior jsonb; expected bigint; next_revision bigint; size_bytes bigint; result_id text; next_epoch text;
begin
 perform loopmark_private.validate_command(cmd);
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=uid and id=cmd->>'collectionId' for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into d from loopmark_private.devices where owner_id=uid and id=cmd->>'deviceId' for update;
 if not found or d.generation<>cmd->>'deviceGeneration' or d.retired_at is not null or d.last_seen<now()-interval '90 days' or (cmd->>'sequence')::bigint<=d.sequence_floor then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 select * into old from loopmark_private.operation_receipts where owner_id=uid and operation_id=cmd->>'operationId';
 if found then
  if old.sha256<>cmd->>'sha256' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  return old.receipt;
 end if;
 if kind not in ('collection.replace','media.attach') then
  result:=loopmark_private.push_standard_effect(cmd);
  if kind='checkpoint.create' then
   for reservation in select r.* from loopmark_private.upload_reservations r where r.owner_id=uid and r.collection_id=c.id and r.epoch=c.epoch and r.deletion_generation=a.deletion_generation and r.candidate_id is null and r.state='verified' and r.expires_at>now()
    and exists(select 1 from jsonb_each(payload->'checkpoint') ref where ref.key in ('photo','voice') and ref.value=r.media)
    and exists(select 1 from loopmark_private.media_objects o where o.owner_id=uid and o.object_key=r.object_key and o.state='ready') order by r.id for update loop
    update loopmark_private.media as media_row set state='ready',object_key=reservation.object_key where media_row.owner_id=uid and media_row.collection_id=c.id and media_row.epoch=c.epoch and media_row.id=reservation.media->>'id' and loopmark_private.media_ref(media_row)=reservation.media;
    update loopmark_private.upload_reservations set state='attached' where id=reservation.id;
   end loop;
  end if;
  return result;
 end if;
 c:=loopmark_private.lock_scope(c.id,cmd->>'epoch',d.id,d.generation);
 if exists(select 1 from loopmark_private.operation_receipts where owner_id=uid and device_id=d.id and device_generation=d.generation and sequence=(cmd->>'sequence')::bigint) then perform loopmark_private.fail('OPERATION_REUSED'); end if;
 next_revision:=c.next_cursor+1; next_epoch:=c.epoch;
 if kind='collection.replace' then
  select * into candidate from loopmark_private.candidates where id=payload->>'reservationId' and owner_id=uid and collection_id=c.id for update;
  if not found or candidate.state<>'prepared' or candidate.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  if candidate.deletion_generation<>a.deletion_generation or candidate.epoch<>c.epoch or candidate.next_epoch<>payload->>'nextEpoch' then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
  if candidate.revision<>c.revision or candidate.revision::text<>cmd#>>'{base,revision}' then perform loopmark_private.fail('REVISION_CONFLICT'); end if;
  if candidate.preparation#>>'{replacement,candidateSha256}'<>payload->>'candidateSha256' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  if exists(select 1 from loopmark_private.media m left join loopmark_private.media_objects o on o.object_key=m.object_key and o.owner_id=m.owner_id where m.owner_id=uid and m.collection_id=c.id and m.epoch=candidate.next_epoch and (m.state<>'ready' or o.state is distinct from 'ready')) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  if not exists(select 1 from loopmark_private.entitlement_projection where account_id=uid and upgraded) and
   (select count(*) from jsonb_array_elements(candidate.preparation#>'{candidate,projects}') v where v->>'status'='active')>greatest(3,(select count(*) from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null and data->>'status'='active')) then perform loopmark_private.fail('UPGRADE_REQUIRED'); end if;
  -- The immutable snapshot manifests keep the old records; epoch-scoped media pins remain intact.
  delete from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id;
  delete from loopmark_private.projects where owner_id=uid and collection_id=c.id;
  insert into loopmark_private.projects(owner_id,collection_id,id,code,revision,data)
   select uid,c.id,v->>'id',v->>'code',next_revision,v from jsonb_array_elements(candidate.preparation#>'{candidate,projects}') v;
  insert into loopmark_private.checkpoints(owner_id,collection_id,id,project_id,revision,data)
   select uid,c.id,v->>'id',v->>'projectId',next_revision,v from jsonb_array_elements(candidate.preparation#>'{candidate,checkpoints}') v;
  next_epoch:=candidate.next_epoch; result_id:=candidate.id;
  changes:=jsonb_build_array(jsonb_build_object('kind','collection.replaced','nextEpoch',next_epoch));
  update loopmark_private.upload_reservations set state='attached' where candidate_id=candidate.id and state='verified';
 else
  select * into p from loopmark_private.projects where owner_id=uid and collection_id=c.id and id=payload->>'projectId' and deleted_at is null for update;
  if not found then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',null,'expected',cmd->'base')); end if;
  select * into cp from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and id=payload->>'checkpointId' and project_id=p.id and deleted_at is null for update;
  if not found then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',null,'expected',cmd->'base')); end if;
  if cmd->'base'?'afterOperationId' then
   select receipt into prior from loopmark_private.operation_receipts where owner_id=uid and collection_id=c.id and epoch=c.epoch and device_id=d.id and device_generation=d.generation and operation_id=cmd#>>'{base,afterOperationId}';
   select (change#>>'{value,revision}')::bigint into expected from jsonb_array_elements(prior->'changes') change where change->>'kind'='checkpoint.put' and change#>>'{value,id}'=cp.id;
  else expected:=(cmd#>>'{base,revision}')::bigint; end if;
  if expected is null or expected<>cp.revision then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',cp.data||jsonb_build_object('revision',cp.revision::text),'expected',cmd->'base')); end if;
  select * into reservation from loopmark_private.upload_reservations where id=payload->>'reservationId' and owner_id=uid and collection_id=c.id for update;
  if not found or reservation.state<>'verified' or reservation.expires_at<=now() or reservation.candidate_id is not null then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  if reservation.deletion_generation<>a.deletion_generation or reservation.epoch<>c.epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
  if reservation.media<>payload->'media' or not exists(select 1 from loopmark_private.media_objects o where o.object_key=reservation.object_key and o.owner_id=uid and o.state='ready') then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  if cp.data?(reservation.media->>'kind') and cp.data->(reservation.media->>'kind')<>reservation.media then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  insert into loopmark_private.media(owner_id,collection_id,epoch,id,sha256,bytes,kind,mime_type,state,object_key)
   values(uid,c.id,c.epoch,reservation.media->>'id',reservation.media->>'sha256',(reservation.media->>'bytes')::bigint,reservation.media->>'kind',reservation.media->>'mimeType','ready',reservation.object_key)
   on conflict(owner_id,collection_id,epoch,id) do update set state='ready',object_key=excluded.object_key
   where loopmark_private.media.sha256=excluded.sha256 and loopmark_private.media.bytes=excluded.bytes and loopmark_private.media.kind=excluded.kind and loopmark_private.media.mime_type=excluded.mime_type;
  if not found then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  value:=cp.data||jsonb_build_object(reservation.media->>'kind',reservation.media);
  update loopmark_private.checkpoints set data=value,revision=next_revision where owner_id=uid and collection_id=c.id and id=cp.id;
  update loopmark_private.projects set revision=next_revision where owner_id=uid and collection_id=c.id and id=p.id;
  update loopmark_private.upload_reservations set state='attached' where id=reservation.id;
  changes:=jsonb_build_array(jsonb_build_object('kind','checkpoint.put','value',value||jsonb_build_object('revision',next_revision::text)),jsonb_build_object('kind','project.put','value',p.data||jsonb_build_object('revision',next_revision::text)));
  result_id:=cp.id;
 end if;
 size_bytes:=loopmark_private.portable_size(uid,c.id);
 if size_bytes>50331648 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
 update loopmark_private.collections set epoch=next_epoch,revision=next_revision,next_cursor=next_revision,
  project_count=(select count(*) from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null),
  checkpoint_count=(select count(*) from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and deleted_at is null),portable_bytes=size_bytes where id=c.id and owner_id=uid;
 result:=jsonb_build_object('operationId',cmd->>'operationId','sha256',cmd->>'sha256','epoch',c.epoch,'revision',next_revision::text,'cursor',next_revision::text,'resultId',result_id,'changes',changes);
 insert into loopmark_private.operation_receipts(owner_id,collection_id,operation_id,device_id,device_generation,sequence,sha256,epoch,receipt) values(uid,c.id,cmd->>'operationId',d.id,d.generation,(cmd->>'sequence')::bigint,cmd->>'sha256',c.epoch,result);
 insert into loopmark_private.change_feed(owner_id,collection_id,cursor,epoch,receipt) values(uid,c.id,next_revision,c.epoch,result);
 update loopmark_private.devices set max_sequence=greatest(max_sequence,(cmd->>'sequence')::bigint) where owner_id=uid and id=d.id;
 if kind='collection.replace' then update loopmark_private.candidates set state='committed',receipt=result where id=candidate.id; end if;
 return result;
end $$;
revoke all on function loopmark_private.push_effect(jsonb) from public,anon,authenticated,service_role;
-- SQL function OID binding retained the renamed implementation in the old caller.
create or replace function public.loopmark_push(cmd jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); message text; detail text; begin
 if uid is null then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'command',20,1);
 begin return loopmark_private.push_effect(cmd);
 exception when others then
  get stacked diagnostics message=message_text,detail=pg_exception_detail;
  if sqlstate='P0001' then return jsonb_build_object('failure',jsonb_build_object('code',message,'detail',detail)); end if;
  return jsonb_build_object('failure',jsonb_build_object('code','SERVICE_UNAVAILABLE'));
 end;
end $$;

create or replace function public.loopmark_snapshot(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; c loopmark_private.collections; s loopmark_private.snapshots;
 manifest jsonb; items jsonb; item jsonb; result jsonb; candidate jsonb; ref jsonb;
 p jsonb:='[]'; checkpoints jsonb:='[]'; media jsonb:='[]'; next_p jsonb; next_checkpoints jsonb; next_media jsonb;
 seen_media jsonb:='{}'; next_seen jsonb; offset_value integer:=0; index_value integer:=0; next_page text; action text:=request->>'action'; begin
 if uid is null then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'snapshot',10,0.2);
 if action='create' then
  if not loopmark_private.exact_keys(request,array['action','collectionId','purpose']) or request->>'purpose' not in ('hydrate','export') or not loopmark_private.valid_id(request->>'collectionId') then perform loopmark_private.fail('VALIDATION'); end if;
  select * into c from loopmark_private.collections where id=request->>'collectionId' and owner_id=uid for update;
  if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
  delete from loopmark_private.snapshots where owner_id=uid and expires_at<=now();
  if (select count(*) from loopmark_private.snapshots where owner_id=uid)>=2 then perform loopmark_private.fail('RATE_LIMITED'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind','project','value',data||jsonb_build_object('revision',revision::text)) order by id),'[]') into items from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null;
  select items||coalesce(jsonb_agg(jsonb_build_object('kind','checkpoint','value',data||jsonb_build_object('revision',revision::text)) order by id),'[]') into items from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and deleted_at is null;
  insert into loopmark_private.snapshots(id,owner_id,collection_id,epoch,revision,cursor,purpose,manifest,expires_at)
   values(gen_random_uuid()::text,uid,c.id,c.epoch,c.revision,c.next_cursor,request->>'purpose',items,now()+interval '1 hour') returning * into s;
  insert into loopmark_private.snapshot_media(owner_id,snapshot_id,collection_id,epoch,media_id)
   select distinct uid,s.id,c.id,c.epoch,refs.ref->>'id' from loopmark_private.checkpoints cp cross join lateral jsonb_each(cp.data) as refs(key,ref)
   where cp.owner_id=uid and cp.collection_id=c.id and cp.deleted_at is null and refs.key in ('photo','voice');
 elsif action in ('page','renew') then
  if not loopmark_private.exact_keys(request,case when action='page' then array['action','snapshotId','after'] else array['action','snapshotId'] end) or not loopmark_private.valid_id(request->>'snapshotId') then perform loopmark_private.fail('VALIDATION'); end if;
  select * into s from loopmark_private.snapshots where id=request->>'snapshotId' and owner_id=uid for update;
  if not found or s.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  select * into c from loopmark_private.collections where id=s.collection_id and owner_id=uid;
  -- The lease owns an immutable old-epoch manifest and media inventory. Deletion is checked above.
  if action='renew' then update loopmark_private.snapshots set expires_at=now()+interval '1 hour' where id=s.id returning * into s;
  elsif request->'after'<>'null'::jsonb then
   if jsonb_typeof(request->'after')<>'string' or request->>'after'!~'^(0|[1-9][0-9]{0,5})$' then perform loopmark_private.fail('VALIDATION'); end if;
   offset_value:=(request->>'after')::integer;
  end if;
 else perform loopmark_private.fail('VALIDATION'); end if;
 if offset_value>jsonb_array_length(s.manifest) then perform loopmark_private.fail('VALIDATION'); end if;
 -- A shared immutable media object may appear in several checkpoints or pages.
 -- Declare it once, on the first referencing record in the entire snapshot chain.
 for ref in select refs.value from jsonb_array_elements(s.manifest) with ordinality as entry(value,ord)
  cross join lateral jsonb_each(entry.value->'value') refs where ord<=offset_value and refs.key in ('photo','voice') loop
  seen_media:=seen_media||jsonb_build_object(ref->>'id',true);
 end loop;
 for item in select value from jsonb_array_elements(s.manifest) with ordinality as entry(value,ord) where ord>offset_value order by ord limit 50 loop
  next_p:=p; next_checkpoints:=checkpoints; next_media:=media; next_seen:=seen_media;
  if item->>'kind'='project' then next_p:=p||jsonb_build_array(item->'value'); else
   next_checkpoints:=checkpoints||jsonb_build_array(item->'value');
   for ref in select value from jsonb_each(item->'value') where key in ('photo','voice') loop
    if not(next_seen ? (ref->>'id')) then next_media:=next_media||jsonb_build_array(ref); next_seen:=next_seen||jsonb_build_object(ref->>'id',true); end if;
   end loop;
  end if;
  next_page:=case when offset_value+index_value+1<jsonb_array_length(s.manifest) then (offset_value+index_value+1)::text else null end;
  candidate:=jsonb_build_object('protocolVersion',2,'snapshotId',s.id,'collectionId',s.collection_id,'epoch',s.epoch,'cursor',s.cursor::text,'revision',s.revision::text,
   'after',case when action='page' then request->'after' else 'null'::jsonb end,'expiresAt',to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'projects',next_p,'checkpoints',next_checkpoints,'media',next_media,'nextPage',next_page);
  if octet_length(loopmark_private.canonical(candidate))>524288 then
   if index_value=0 then perform loopmark_private.fail('INVARIANT_VIOLATION'); end if;
   exit;
  end if;
  p:=next_p; checkpoints:=next_checkpoints; media:=next_media; seen_media:=next_seen; result:=candidate;
  index_value:=index_value+1;
 end loop;
 if result is null then result:=jsonb_build_object('protocolVersion',2,'snapshotId',s.id,'collectionId',s.collection_id,'epoch',s.epoch,'cursor',s.cursor::text,'revision',s.revision::text,
  'after',case when action='page' then request->'after' else 'null'::jsonb end,'expiresAt',to_char(s.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'projects','[]'::jsonb,'checkpoints','[]'::jsonb,'media','[]'::jsonb,'nextPage',null); end if;
 return result;
end $$;
create function public.loopmark_snapshot_release(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 if not loopmark_private.valid_id(p_id) then perform loopmark_private.fail('VALIDATION'); end if;
 -- Equal missing/already-released/other-owner responses disclose no ownership.
 delete from loopmark_private.snapshots where owner_id=uid and id=p_id;
 return jsonb_build_object('released',true);
end $$;
revoke all on function public.loopmark_snapshot_release(text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_snapshot_release(text) to authenticated;
