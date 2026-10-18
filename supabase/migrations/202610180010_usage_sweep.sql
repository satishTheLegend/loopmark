alter table loopmark_private.media_objects add column lease_fence bigint not null default 0;
alter table loopmark_private.media_objects add column lease_expires_at timestamptz;
create function public.loopmark_account_usage(p_collection text,p_epoch text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; stored_bytes bigint; stored_count bigint; begin
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into c from loopmark_private.collections where owner_id=uid and id=p_collection;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if c.epoch<>p_epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'usage',10,0.2);
 if exists(select 1 from storage.objects where bucket_id='loopmark-private' and starts_with(name,uid::text||'/') and coalesce(metadata->>'size','')!~'^[0-9]+$') then perform loopmark_private.fail('SERVICE_UNAVAILABLE'); end if;
 select coalesce(sum((metadata->>'size')::bigint),0),count(*) into stored_bytes,stored_count from storage.objects where bucket_id='loopmark-private' and starts_with(name,uid::text||'/');
 return jsonb_build_object('collectionId',c.id,'epoch',c.epoch,'revision',c.revision::text,'observedAt',loopmark_private.time_text(now()),'projects',c.project_count,'checkpoints',c.checkpoint_count,'portableBytes',c.portable_bytes,
  'activeProjects',(select count(*) from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null and data->>'status'='active'),
  'storedBytes',stored_bytes,'storedObjects',stored_count,'allocatedBytes',(select coalesce(sum(bytes),0) from loopmark_private.media_objects where owner_id=uid and state<>'deleted'),
  'unfinishedUploads',(select count(*) from loopmark_private.upload_reservations where owner_id=uid and candidate_id is null and state in ('reserved','uploading','verified') and expires_at>now()),
  'ordinaryStagedBytes',(select coalesce(sum((media->>'bytes')::bigint),0) from loopmark_private.upload_reservations where owner_id=uid and candidate_id is null and state in ('reserved','uploading','verified') and expires_at>now()),
  'candidateMediaBytes',(select coalesce(sum((preparation#>>'{replacement,mediaBytes}')::bigint),0) from loopmark_private.candidates where owner_id=uid and state='prepared' and expires_at>now()),
  'limits',jsonb_build_object('projects',200,'checkpoints',1000,'portableBytes',50331648,'uploads',4,'ordinaryStagedBytes',33554432,'candidateMediaBytes',41943040,'allocatedBytes',83886080));
end $$;
create function loopmark_private.object_referenced(object loopmark_private.media_objects) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from loopmark_private.upload_reservations r where r.owner_id=object.owner_id and r.object_key=object.object_key and ((r.state in ('reserved','uploading','verified') and r.expires_at>now()) or r.inflight_until>now())) or
 exists(select 1 from loopmark_private.recovery_pins r where r.owner_id=object.owner_id and r.object_key=object.object_key and r.expires_at>now()) or
 exists(select 1 from loopmark_private.media m where m.owner_id=object.owner_id and m.object_key=object.object_key and (
  exists(select 1 from loopmark_private.collections c join loopmark_private.checkpoints cp on cp.owner_id=c.owner_id and cp.collection_id=c.id cross join lateral jsonb_each(cp.data) ref where c.owner_id=m.owner_id and c.id=m.collection_id and c.epoch=m.epoch and cp.deleted_at is null and ref.key in ('photo','voice') and ref.value->>'id'=m.id) or
  exists(select 1 from loopmark_private.candidates candidate where candidate.owner_id=m.owner_id and candidate.collection_id=m.collection_id and candidate.next_epoch=m.epoch and candidate.state='prepared' and candidate.expires_at>now()) or
  exists(select 1 from loopmark_private.snapshot_media sm join loopmark_private.snapshots s on s.owner_id=sm.owner_id and s.id=sm.snapshot_id where sm.owner_id=m.owner_id and sm.collection_id=m.collection_id and sm.epoch=m.epoch and sm.media_id=m.id and s.expires_at>now())
 ))
$$;
create function public.loopmark_media_sweep_claim(p_limit integer default 20,p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; object loopmark_private.media_objects; result jsonb:='[]'; begin
 perform loopmark_private.service_only();
 if p_limit is null or p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION'); end if;
 for a in select accounts.id from loopmark_private.accounts accounts where accounts.state='active' and (p_owner is null or accounts.id=p_owner)
  and exists(select 1 from loopmark_private.media_objects o where o.owner_id=accounts.id and o.state<>'deleted' and o.created_at<now()-interval '1 hour' and (o.lease_expires_at is null or o.lease_expires_at<=now()) and not loopmark_private.object_referenced(o)) order by accounts.id limit p_limit for update skip locked loop
  for object in select * from loopmark_private.media_objects o where o.owner_id=a.id and o.state<>'deleted' and o.created_at<now()-interval '1 hour' and (o.lease_expires_at is null or o.lease_expires_at<=now()) and not loopmark_private.object_referenced(o) order by o.created_at,o.object_key limit (p_limit-jsonb_array_length(result)) for update skip locked loop
   update loopmark_private.media_objects set state='deleting',lease_fence=lease_fence+1,lease_expires_at=now()+interval '60 seconds' where object_key=object.object_key returning * into object;
   result:=result||jsonb_build_array(jsonb_build_object('objectKey',object.object_key,'ownerId',object.owner_id,'fence',object.lease_fence::text));
  end loop;
  exit when jsonb_array_length(result)>=p_limit;
 end loop;
 return result;
end $$;
create function public.loopmark_media_sweep_finish(p_owner uuid,p_key text,p_fence bigint) returns void language plpgsql security definer set search_path='' as $$
declare object loopmark_private.media_objects; begin
 perform loopmark_private.service_only();
 perform 1 from loopmark_private.accounts where id=p_owner and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into object from loopmark_private.media_objects where owner_id=p_owner and object_key=p_key for update;
 if not found or object.state<>'deleting' or object.lease_fence<>p_fence or object.lease_expires_at<=now() or loopmark_private.object_referenced(object) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if exists(select 1 from storage.objects where bucket_id='loopmark-private' and name=p_key) then perform loopmark_private.fail('SERVICE_UNAVAILABLE'); end if;
 update loopmark_private.media_objects set state='deleted',lease_expires_at=null where object_key=p_key;
end $$;
revoke all on function loopmark_private.object_referenced(loopmark_private.media_objects) from public,anon,authenticated,service_role;
revoke all on function public.loopmark_account_usage(text,text),public.loopmark_media_sweep_claim(integer,uuid),public.loopmark_media_sweep_finish(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_account_usage(text,text) to authenticated;
grant execute on function public.loopmark_media_sweep_claim(integer,uuid),public.loopmark_media_sweep_finish(uuid,text,bigint) to service_role;
