create function loopmark_private.upload_response(reservation loopmark_private.upload_reservations) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',reservation.id,'collectionId',reservation.collection_id,'epoch',reservation.epoch,'media',reservation.media,'expiresAt',loopmark_private.time_text(reservation.expires_at),'deletionGeneration',reservation.deletion_generation::text)
$$;
create function public.loopmark_media_reserve(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; c loopmark_private.collections; candidate loopmark_private.candidates; reservation loopmark_private.upload_reservations;
 object loopmark_private.media_objects; ref jsonb:=request#>'{upload,media}'; hash text; expiry timestamptz:=now()+interval '15 minutes'; selected_candidate_id text:=request->>'candidateId'; dummy jsonb; begin
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'reserve',10,0.2);
 if not loopmark_private.exact_keys(request,array['action','requestId','upload'],array['candidateId']) or request->>'action'<>'reserve' or not loopmark_private.valid_id(request->>'requestId') or not loopmark_private.exact_keys(request->'upload',array['collectionId','epoch','media']) then perform loopmark_private.fail('VALIDATION'); end if;
 dummy:=jsonb_build_object('protocolVersion',2,'payloadVersion',1,'collectionId',request#>>'{upload,collectionId}','epoch',request#>>'{upload,epoch}','deviceId','validate','deviceGeneration','validate','sequence','1','operationId','validate','base',jsonb_build_object('revision','0'),'kind','media.attach','payload',jsonb_build_object('projectId','validate','checkpointId','validate','reservationId','validate','media',ref));
 dummy:=dummy||jsonb_build_object('sha256',encode(extensions.digest(convert_to(loopmark_private.canonical(dummy),'UTF8'),'sha256'),'hex'));
 perform loopmark_private.validate_command(dummy);
 hash:=encode(extensions.digest(convert_to(loopmark_private.canonical(request),'UTF8'),'sha256'),'hex');
 select * into reservation from loopmark_private.upload_reservations where owner_id=uid and request_id=request->>'requestId';
 if found then
  if reservation.request_hash<>hash then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  if reservation.state in ('cancelled','expired') or reservation.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  return loopmark_private.upload_response(reservation);
 end if;
 select * into c from loopmark_private.collections where owner_id=uid and id=request#>>'{upload,collectionId}' for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if selected_candidate_id is null then
  if c.epoch<>request#>>'{upload,epoch}' then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
  if (select count(*) from loopmark_private.upload_reservations where owner_id=uid and candidate_id is null and state in ('reserved','uploading','verified') and expires_at>now())>=4 or
   (select coalesce(sum((media->>'bytes')::bigint),0) from loopmark_private.upload_reservations where owner_id=uid and candidate_id is null and state in ('reserved','uploading','verified') and expires_at>now())+(ref->>'bytes')::bigint>33554432 then perform loopmark_private.fail('MEDIA_CAPACITY_REACHED'); end if;
 else
  select * into candidate from loopmark_private.candidates where id=selected_candidate_id and owner_id=uid and collection_id=c.id for update;
  if not found or candidate.state<>'prepared' or candidate.expires_at<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
  if candidate.epoch<>c.epoch or candidate.revision<>c.revision or candidate.next_epoch<>request#>>'{upload,epoch}' or candidate.deletion_generation<>a.deletion_generation then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
  if not exists(select 1 from loopmark_private.media m where m.owner_id=uid and m.collection_id=c.id and m.epoch=candidate.next_epoch and loopmark_private.media_ref(m)=ref) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  if exists(select 1 from loopmark_private.upload_reservations where owner_id=uid and candidate_id=candidate.id and media=ref and state in ('reserved','uploading','verified') and expires_at>now()) then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  expiry:=least(expiry,candidate.expires_at);
 end if;
 if exists(select 1 from loopmark_private.media m where m.owner_id=uid and m.collection_id=c.id and m.epoch=request#>>'{upload,epoch}' and m.id=ref->>'id' and loopmark_private.media_ref(m)<>ref) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
 select * into object from loopmark_private.media_objects o where o.owner_id=uid and o.state='ready' and o.sha256=ref->>'sha256' and o.bytes=(ref->>'bytes')::bigint and o.kind=ref->>'kind' and o.mime_type=ref->>'mimeType' order by o.object_key limit 1;
 if object.object_key is null then
  if (select coalesce(sum(bytes),0) from loopmark_private.media_objects where owner_id=uid and state<>'deleted')+(ref->>'bytes')::bigint>83886080 then perform loopmark_private.fail('MEDIA_CAPACITY_REACHED'); end if;
  insert into loopmark_private.media_objects(object_key,owner_id,sha256,bytes,kind,mime_type,state)
   values(uid::text||'/'||gen_random_uuid()::text,uid,ref->>'sha256',(ref->>'bytes')::bigint,ref->>'kind',ref->>'mimeType','staged') returning * into object;
 end if;
 insert into loopmark_private.upload_reservations(id,owner_id,collection_id,epoch,deletion_generation,media,state,expires_at,request_id,request_hash,object_key,candidate_id)
  values(gen_random_uuid()::text,uid,c.id,request#>>'{upload,epoch}',a.deletion_generation,ref,case when object.state='ready' then 'verified' else 'reserved' end,expiry,request->>'requestId',hash,object.object_key,selected_candidate_id) returning * into reservation;
 if selected_candidate_id is not null and object.state='ready' then
  update loopmark_private.media set state='ready',object_key=object.object_key where owner_id=uid and collection_id=c.id and epoch=candidate.next_epoch and id=ref->>'id';
 end if;
 return loopmark_private.upload_response(reservation);
end $$;
create function public.loopmark_media_admit(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; c loopmark_private.collections; reservation loopmark_private.upload_reservations; candidate loopmark_private.candidates; begin
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into reservation from loopmark_private.upload_reservations where id=p_id and owner_id=uid for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into c from loopmark_private.collections where id=reservation.collection_id and owner_id=uid;
 if reservation.deletion_generation<>a.deletion_generation or reservation.expires_at<=now() or reservation.state in ('cancelled','expired') then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 if reservation.candidate_id is null then
  if c.epoch<>reservation.epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 else
  select * into candidate from loopmark_private.candidates where id=reservation.candidate_id and owner_id=uid;
  if candidate.state<>'prepared' or candidate.expires_at<=now() or candidate.epoch<>c.epoch or candidate.revision<>c.revision then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 end if;
 if reservation.inflight_until>now() then perform loopmark_private.fail('RATE_LIMITED'); end if;
 if reservation.state not in ('verified','attached') then
  update loopmark_private.upload_reservations set state='uploading',lease_fence=lease_fence+1,inflight_until=now()+interval '60 seconds' where id=p_id returning * into reservation;
 end if;
 return jsonb_build_object('reservation',loopmark_private.upload_response(reservation),'objectKey',reservation.object_key,'fence',reservation.lease_fence::text,'alreadyVerified',reservation.state in ('verified','attached'));
end $$;
-- Only the verified-byte proxy can attest to a physical upload. Owner RPCs cannot set ready.
create function public.loopmark_media_verified(p_owner uuid,p_id text,p_fence bigint) returns void language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; c loopmark_private.collections; reservation loopmark_private.upload_reservations; candidate loopmark_private.candidates; begin
 perform loopmark_private.service_only();
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into reservation from loopmark_private.upload_reservations where id=p_id and owner_id=p_owner for update;
 if not found or reservation.deletion_generation<>a.deletion_generation or reservation.expires_at<=now() or reservation.state<>'uploading' or reservation.lease_fence<>p_fence or reservation.inflight_until<=now() then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=p_owner and id=reservation.collection_id;
 if reservation.candidate_id is null then
  if c.epoch<>reservation.epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 else
  select * into candidate from loopmark_private.candidates where id=reservation.candidate_id and owner_id=p_owner;
  if candidate.state<>'prepared' or candidate.expires_at<=now() or candidate.epoch<>c.epoch or candidate.revision<>c.revision then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 end if;
 update loopmark_private.media_objects set state='ready' where object_key=reservation.object_key and owner_id=p_owner and state='staged';
 update loopmark_private.upload_reservations set state='verified',inflight_until=null where id=p_id;
 if reservation.candidate_id is not null then
  update loopmark_private.media set state='ready',object_key=reservation.object_key where owner_id=p_owner and collection_id=c.id and epoch=reservation.epoch and id=reservation.media->>'id';
 end if;
end $$;
create function public.loopmark_media_cancel(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); reservation loopmark_private.upload_reservations; begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into reservation from loopmark_private.upload_reservations where id=p_id and owner_id=uid for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if reservation.state='attached' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
 update loopmark_private.upload_reservations set state='cancelled' where id=p_id;
 return jsonb_build_object('cancelled',true);
end $$;
create function public.loopmark_media_download(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; m loopmark_private.media; begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 if not loopmark_private.exact_keys(request,array['collectionId','epoch','mediaId'],array['snapshotId']) then perform loopmark_private.fail('VALIDATION'); end if;
 perform loopmark_private.rate_limit(uid,'download',30,2);
 select * into c from loopmark_private.collections where owner_id=uid and id=request->>'collectionId';
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if request?'snapshotId' then
  if not exists(select 1 from loopmark_private.snapshots s join loopmark_private.snapshot_media sm on sm.owner_id=s.owner_id and sm.snapshot_id=s.id
   where s.id=request->>'snapshotId' and s.owner_id=uid and s.collection_id=c.id and s.epoch=request->>'epoch' and s.expires_at>now() and sm.media_id=request->>'mediaId' and sm.epoch=s.epoch) then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 elsif c.epoch<>request->>'epoch' then perform loopmark_private.fail('SYNC_REBASE_REQUIRED');
 elsif not exists(select 1 from loopmark_private.checkpoints cp cross join lateral jsonb_each(cp.data) r where cp.owner_id=uid and cp.collection_id=c.id and cp.deleted_at is null and r.key in ('photo','voice') and r.value->>'id'=request->>'mediaId') then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into m from loopmark_private.media where owner_id=uid and collection_id=c.id and epoch=request->>'epoch' and id=request->>'mediaId';
 if not found or m.state<>'ready' or m.object_key is null then perform loopmark_private.fail('MEDIA_INVALID'); end if;
 return jsonb_build_object('media',loopmark_private.media_ref(m),'objectKey',m.object_key);
end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
revoke all on function public.loopmark_media_reserve(jsonb),public.loopmark_media_admit(text),public.loopmark_media_verified(uuid,text,bigint),public.loopmark_media_cancel(text),public.loopmark_media_download(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_media_reserve(jsonb),public.loopmark_media_admit(text),public.loopmark_media_cancel(text),public.loopmark_media_download(jsonb) to authenticated;
grant execute on function public.loopmark_media_verified(uuid,text,bigint) to service_role;
-- Called after bounded byte validation, immediately before external Storage I/O.
create function public.loopmark_media_check(p_owner uuid,p_id text,p_fence bigint) returns void language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; r loopmark_private.upload_reservations; c loopmark_private.collections; candidate loopmark_private.candidates; begin
 perform loopmark_private.service_only();
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into r from loopmark_private.upload_reservations where id=p_id and owner_id=p_owner;
 if not found or r.deletion_generation<>a.deletion_generation or r.state<>'uploading' or r.expires_at<=now() or r.inflight_until<=now() or r.lease_fence<>p_fence then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=p_owner and id=r.collection_id;
 if r.candidate_id is null then
  if c.epoch<>r.epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 else
  select * into candidate from loopmark_private.candidates where id=r.candidate_id and owner_id=p_owner;
  if candidate.state<>'prepared' or candidate.expires_at<=now() or candidate.epoch<>c.epoch or candidate.revision<>c.revision then perform loopmark_private.fail('SNAPSHOT_EXPIRED'); end if;
 end if;
end $$;
revoke all on function public.loopmark_media_check(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_media_check(uuid,text,bigint) to service_role;
