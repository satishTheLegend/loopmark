create function public.loopmark_pull(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; row record; entries jsonb:='[]'; last_cursor bigint; result jsonb; candidate jsonb; begin
 if not loopmark_private.exact_keys(request,array['collectionId','epoch','afterCursor','deviceId','deviceGeneration']) or
  not loopmark_private.valid_id(request->>'collectionId') or not loopmark_private.valid_id(request->>'epoch') or not loopmark_private.valid_id(request->>'deviceId') or not loopmark_private.valid_id(request->>'deviceGeneration') or
  jsonb_typeof(request->'afterCursor')<>'string' or request->>'afterCursor'!~'^(0|[1-9][0-9]{0,18})$' then perform loopmark_private.fail('VALIDATION'); end if;
 c:=loopmark_private.lock_scope(request->>'collectionId',request->>'epoch',request->>'deviceId',request->>'deviceGeneration');
 last_cursor:=(request->>'afterCursor')::bigint;
 if last_cursor<c.compacted_cursor or last_cursor>c.next_cursor then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'pull',30,2);
 for row in select f.receipt,f.cursor as row_cursor from loopmark_private.change_feed f where f.owner_id=uid and f.collection_id=c.id and f.epoch=c.epoch and f.cursor>last_cursor order by f.cursor limit 50 loop
  candidate:=entries||jsonb_build_array(row.receipt);
  result:=jsonb_build_object('protocolVersion',2,'collectionId',c.id,'epoch',c.epoch,'afterCursor',request->>'afterCursor','nextCursor',row.row_cursor::text,'hasMore',row.row_cursor<c.next_cursor,'entries',candidate);
  if octet_length(result::text)>524288 then
   if jsonb_array_length(entries)=0 then perform loopmark_private.fail('INVARIANT_VIOLATION'); end if;
   exit;
  end if;
  entries:=candidate; last_cursor:=row.row_cursor;
 end loop;
 return jsonb_build_object('protocolVersion',2,'collectionId',c.id,'epoch',c.epoch,'afterCursor',request->>'afterCursor','nextCursor',last_cursor::text,'hasMore',last_cursor<c.next_cursor,'entries',entries);
exception when numeric_value_out_of_range or invalid_text_representation then perform loopmark_private.fail('VALIDATION'); end $$;

create function public.loopmark_snapshot(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  insert into loopmark_private.snapshot_media(owner_id,snapshot_id,collection_id,media_id)
   select distinct uid,s.id,c.id,refs.ref->>'id' from loopmark_private.checkpoints cp cross join lateral jsonb_each(cp.data) as refs(key,ref)
   where cp.owner_id=uid and cp.collection_id=c.id and cp.deleted_at is null and refs.key in ('photo','voice');
 elsif action in ('page','renew') then
  if not loopmark_private.exact_keys(request,case when action='page' then array['action','snapshotId','after'] else array['action','snapshotId'] end) or not loopmark_private.valid_id(request->>'snapshotId') then perform loopmark_private.fail('VALIDATION'); end if;
  select * into s from loopmark_private.snapshots where id=request->>'snapshotId' and owner_id=uid for update;
  if not found or s.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  select * into c from loopmark_private.collections where id=s.collection_id and owner_id=uid;
  if c.epoch<>s.epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
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

create function public.loopmark_compact(p_limit integer default 20) returns integer language plpgsql security definer set search_path='' as $$
declare a record; c loopmark_private.collections; d record; floor_value bigint; min_snapshot bigint; boundary bigint; processed integer:=0; begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or p_limit is null or p_limit not between 1 and 100 then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 for a in select id from loopmark_private.accounts where state='active' order by compacted_at nulls first,id limit p_limit for update skip locked loop
  select * into c from loopmark_private.collections where owner_id=a.id for update;
  delete from loopmark_private.snapshots where owner_id=a.id and expires_at<=now();
  for d in select * from loopmark_private.devices where owner_id=a.id order by id for update loop
   select max(sequence) into floor_value from loopmark_private.operation_receipts where owner_id=a.id and device_id=d.id and device_generation=d.generation and created_at<now()-interval '90 days';
   if floor_value is not null then
    update loopmark_private.devices set sequence_floor=greatest(sequence_floor,floor_value) where owner_id=a.id and id=d.id;
    delete from loopmark_private.operation_receipts where owner_id=a.id and device_id=d.id and device_generation=d.generation and sequence<=floor_value and created_at<now()-interval '90 days';
   end if;
   if d.last_seen<now()-interval '90 days' then update loopmark_private.devices set retired_at=coalesce(retired_at,now()) where owner_id=a.id and id=d.id; end if;
  end loop;
  select min(cursor) into min_snapshot from loopmark_private.snapshots where owner_id=a.id and collection_id=c.id and expires_at>now();
  select max(cursor) into boundary from loopmark_private.change_feed where owner_id=a.id and collection_id=c.id and created_at<now()-interval '90 days' and (min_snapshot is null or cursor<=min_snapshot);
  if boundary is not null then
   update loopmark_private.collections set compacted_cursor=greatest(compacted_cursor,boundary) where owner_id=a.id and id=c.id;
   delete from loopmark_private.change_feed where owner_id=a.id and collection_id=c.id and cursor<=boundary;
  end if;
  -- Tombstones are deliberately retained longer than 90 days, avoiding resurrection/ID reuse.
  update loopmark_private.accounts set compacted_at=clock_timestamp() where id=a.id;
  processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function public.loopmark_pull(jsonb),public.loopmark_snapshot(jsonb),public.loopmark_compact(integer) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_pull(jsonb),public.loopmark_snapshot(jsonb) to authenticated;
grant execute on function public.loopmark_compact(integer) to service_role;
