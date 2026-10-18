-- Qualification guard: durable refresh revocation depends on the pinned Auth schema.
do $$ begin
 if not exists(select 1 from pg_constraint where contype='f' and conrelid='auth.refresh_tokens'::regclass and confrelid='auth.sessions'::regclass and confdeltype='c') or
  not exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='user_id' and data_type='uuid') then
  raise exception 'Auth session schema changed; deletion qualification is required';
 end if;
end $$;
alter table loopmark_private.accounts drop constraint accounts_id_fkey;
alter table loopmark_private.deletion_requests add column ledger_watermark text;
alter table loopmark_private.deletion_requests add column ledger_committed_at timestamptz;
alter table loopmark_private.deletion_requests add column purge_after timestamptz;
alter table loopmark_private.deletion_requests add column removed_at timestamptz;
alter table loopmark_private.deletion_requests add column completed_at timestamptz;
alter table loopmark_private.deletion_requests add column retain_until timestamptz not null default now()+interval '90 days';
create unique index deletion_job_owner on loopmark_private.jobs(owner_id,kind) where kind='delete-account';
create table loopmark_private.recovery_pins (
 point_id text not null, owner_id uuid not null, object_key text not null, expires_at timestamptz not null,
 primary key(point_id,object_key)
);
alter table loopmark_private.recovery_pins enable row level security;
revoke all on loopmark_private.recovery_pins from public,anon,authenticated,service_role;
create function loopmark_private.erasure_intent(request loopmark_private.deletion_requests) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('accountId',request.owner_id,'deletionGeneration',request.deletion_generation::text,'requestId',request.request_id,'receiptTokenHash',request.receipt_token_hash,'requestedAt',loopmark_private.time_text(request.requested_at),'retainUntil',loopmark_private.time_text(request.retain_until))
$$;
create function loopmark_private.deletion_receipt(request loopmark_private.deletion_requests) returns jsonb language sql stable set search_path='' as $$
 select case when request.status='complete' then jsonb_build_object('status','complete','completedAt',loopmark_private.time_text(request.completed_at))
 when request.status='live-data-removed' then jsonb_build_object('status','live-data-removed','removedAt',loopmark_private.time_text(request.removed_at),'backupExpiresAt',loopmark_private.time_text(request.backup_expires_at))
 else jsonb_build_object('status','pending','requestedAt',loopmark_private.time_text(request.requested_at)) end
$$;
create function public.loopmark_delete_prepare(request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; existing loopmark_private.deletion_requests; begin
 if uid is null or not loopmark_private.exact_keys(request,array['requestId','receiptTokenHash','reauthentication']) or not loopmark_private.valid_id(request->>'requestId') or request->>'receiptTokenHash'!~'^[a-f0-9]{64}$' then perform loopmark_private.fail('VALIDATION'); end if;
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into existing from loopmark_private.deletion_requests where owner_id=uid;
 if found then
  if existing.request_id<>request->>'requestId' or existing.receipt_token_hash<>request->>'receiptTokenHash' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  return loopmark_private.erasure_intent(existing);
 end if;
 if a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'delete',5,0.0166667);
 perform loopmark_private.consume_reauthentication(uid,request#>>'{reauthentication,challengeId}',request#>>'{reauthentication,proof}');
 insert into loopmark_private.deletion_requests(request_id,owner_id,deletion_generation,receipt_token_hash,retain_until)
  values(request->>'requestId',uid,a.deletion_generation+1,request->>'receiptTokenHash',now()+interval '90 days') returning * into existing;
 return loopmark_private.erasure_intent(existing);
end $$;
create function public.loopmark_deletion_barrier(p_intent jsonb,p_watermark text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; request loopmark_private.deletion_requests; wait_until timestamptz; begin
 perform loopmark_private.service_only();
 if p_watermark!~'^[0-9]+:[a-f0-9]{64}$' then perform loopmark_private.fail('VALIDATION'); end if;
 select * into a from loopmark_private.accounts where id=(p_intent->>'accountId')::uuid for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into request from loopmark_private.deletion_requests where owner_id=a.id and request_id=p_intent->>'requestId' for update;
 if not found or loopmark_private.erasure_intent(request)<>p_intent then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if request.ledger_committed_at is not null then return loopmark_private.deletion_receipt(request); end if;
 if a.state<>'active' or request.deletion_generation<>a.deletion_generation+1 then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select greatest(now()+interval '60 seconds',coalesce(max(greatest(expires_at,inflight_until))+interval '60 seconds',now())) into wait_until
  from loopmark_private.upload_reservations where owner_id=a.id and state in ('reserved','uploading');
 update loopmark_private.accounts set state='deleting',deletion_generation=request.deletion_generation where id=a.id;
 -- No credentials are persisted. Refresh sessions are revoked in this durable barrier.
 delete from auth.sessions where user_id=a.id;
 update loopmark_private.devices set retired_at=now() where owner_id=a.id;
 delete from loopmark_private.snapshots where owner_id=a.id;
 update loopmark_private.upload_reservations set state='cancelled' where owner_id=a.id and state<>'attached';
 update loopmark_private.candidates set state='cancelled' where owner_id=a.id and state='prepared';
 update loopmark_private.deletion_requests set ledger_watermark=p_watermark,ledger_committed_at=now(),purge_after=wait_until,backup_expires_at=request.requested_at+interval '7 days' where request_id=request.request_id returning * into request;
 insert into loopmark_private.jobs(kind,owner_id,next_attempt,payload) values('delete-account',a.id,wait_until,jsonb_build_object('requestId',request.request_id)) on conflict(owner_id,kind) where kind='delete-account' do nothing;
 return loopmark_private.deletion_receipt(request);
end $$;
create function public.loopmark_deletion_status(p_id text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare request loopmark_private.deletion_requests; begin
 perform loopmark_private.service_only();
 perform loopmark_private.rate_limit('00000000-0000-0000-0000-000000000000'::uuid,'deletion-status',60,1);
 select * into request from loopmark_private.deletion_requests where request_id=p_id and receipt_token_hash=p_hash and retain_until>now() and ledger_committed_at is not null;
 if not found then return null; end if;
 return loopmark_private.deletion_receipt(request);
end $$;
create function public.loopmark_deletion_claim(p_limit integer default 20,p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare job loopmark_private.jobs; result jsonb:='[]'; begin
 perform loopmark_private.service_only();
 if p_limit is null or p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION'); end if;
 for job in select * from loopmark_private.jobs where kind='delete-account' and status in ('pending','running') and next_attempt<=now() and (lease_expires_at is null or lease_expires_at<=now()) and (p_owner is null or owner_id=p_owner) order by next_attempt,id limit p_limit for update skip locked loop
  update loopmark_private.jobs set status='running',lease_fence=lease_fence+1,lease_expires_at=now()+interval '60 seconds' where id=job.id returning * into job;
  result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'ownerId',job.owner_id,'fence',job.lease_fence::text));
 end loop;
 return result;
end $$;
create function public.loopmark_deletion_step(p_id uuid,p_fence bigint,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job loopmark_private.jobs; a loopmark_private.accounts; request loopmark_private.deletion_requests; keys jsonb; begin
 perform loopmark_private.service_only();
 select * into job from loopmark_private.jobs where id=p_id;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into a from loopmark_private.accounts where id=job.owner_id for update;
 select * into job from loopmark_private.jobs where id=p_id for update;
 if a.state not in ('deleting','deleted') or job.kind<>'delete-account' or job.status<>'running' or job.lease_fence<>p_fence or job.lease_expires_at<=now() then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into request from loopmark_private.deletion_requests where owner_id=a.id for update;
 if request.ledger_committed_at is null or request.purge_after>now() then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if p_action='inventory' then
  select coalesce(jsonb_agg(name),'[]') into keys from (select name from storage.objects where bucket_id='loopmark-private' and starts_with(name,a.id::text||'/') order by name limit 100) objects;
  return jsonb_build_object('keys',keys);
 elsif p_action='reschedule' then
  update loopmark_private.jobs set status='pending',next_attempt=now()+interval '5 seconds',lease_expires_at=null where id=job.id;
  return jsonb_build_object('pending',true);
 elsif p_action='purge-metadata' then
  if exists(select 1 from storage.objects where bucket_id='loopmark-private' and starts_with(name,a.id::text||'/')) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
  delete from loopmark_private.snapshots where owner_id=a.id;
  delete from loopmark_private.upload_reservations where owner_id=a.id;
  delete from loopmark_private.candidates where owner_id=a.id;
  delete from loopmark_private.media where owner_id=a.id;
  delete from loopmark_private.media_objects where owner_id=a.id;
  delete from loopmark_private.checkpoints where owner_id=a.id;
  delete from loopmark_private.projects where owner_id=a.id;
  delete from loopmark_private.change_feed where owner_id=a.id;
  delete from loopmark_private.operation_receipts where owner_id=a.id;
  delete from loopmark_private.devices where owner_id=a.id;
  delete from loopmark_private.reauthentication_challenges where owner_id=a.id;
  delete from loopmark_private.rate_buckets where owner_id=a.id;
  delete from loopmark_private.entitlement_projection where account_id=a.id;
  delete from loopmark_private.collections where owner_id=a.id;
  update loopmark_private.billing_principals set account_id=null,deleted_binding=true where account_id=a.id;
  return jsonb_build_object('purged',true);
 elsif p_action='finish' then
  if exists(select 1 from auth.users where id=a.id) or exists(select 1 from storage.objects where bucket_id='loopmark-private' and starts_with(name,a.id::text||'/')) or exists(select 1 from loopmark_private.collections where owner_id=a.id) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
  update loopmark_private.accounts set state='deleted' where id=a.id;
  update loopmark_private.deletion_requests set status='live-data-removed',removed_at=coalesce(removed_at,now()) where owner_id=a.id returning * into request;
  update loopmark_private.jobs set status='done',lease_expires_at=null where id=job.id;
  return loopmark_private.deletion_receipt(request);
 end if;
 perform loopmark_private.fail('VALIDATION');
end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
revoke all on function public.loopmark_delete_prepare(jsonb),public.loopmark_deletion_barrier(jsonb,text),public.loopmark_deletion_status(text,text),public.loopmark_deletion_claim(integer,uuid),public.loopmark_deletion_step(uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_delete_prepare(jsonb) to authenticated;
grant execute on function public.loopmark_deletion_barrier(jsonb,text),public.loopmark_deletion_status(text,text),public.loopmark_deletion_claim(integer,uuid),public.loopmark_deletion_step(uuid,bigint,text) to service_role;
