-- Operator-only recovery catalog; object bytes are copied to separately encrypted storage.
create table loopmark_private.recovery_points (
 id uuid primary key, state text not null check(state in ('copying','complete','incomplete','expired')),
 snapshot_id text, created_at timestamptz not null default now(), completed_at timestamptz,
 expires_at timestamptz not null, database_hash text, manifest_hash text, object_count integer not null default 0,
 bytes bigint not null default 0, removed_at timestamptz
);
create table loopmark_private.recovery_objects (
 point_id uuid not null references loopmark_private.recovery_points(id), owner_id uuid not null,
 object_key text not null, sha256 text not null, bytes bigint not null,
 primary key(point_id,object_key)
);
create table loopmark_private.recovery_accounts (point_id uuid not null references loopmark_private.recovery_points(id),owner_id uuid not null,primary key(point_id,owner_id));
create table loopmark_private.restore_drills (id uuid primary key,point_id uuid not null references loopmark_private.recovery_points(id),created_at timestamptz not null default now(),expires_at timestamptz not null,removed_at timestamptz);
create table loopmark_private.operation_schedules (
 kind text primary key check(kind in ('maintenance','billing','backup')),
 next_attempt timestamptz not null default now(), lease_until timestamptz, fence bigint not null default 0,
 last_success timestamptz, ledger_cursor bigint not null default 0, failures integer not null default 0, quarantined boolean not null default false
);
insert into loopmark_private.operation_schedules(kind) values('maintenance'),('billing'),('backup');
create table loopmark_private.restore_gate (
 singleton boolean primary key default true check(singleton), ready boolean not null default false,
 point_id uuid not null, ledger_watermark text, verified_at timestamptz, database_hash text, manifest_hash text
);
do $$ declare relation text; begin
 foreach relation in array array['recovery_points','recovery_objects','recovery_accounts','restore_drills','operation_schedules','restore_gate'] loop
  execute format('alter table loopmark_private.%I enable row level security',relation);
  execute format('revoke all on loopmark_private.%I from public,anon,authenticated,service_role',relation);
 end loop;
end $$;
create function public.loopmark_ops_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform loopmark_private.service_only();
 select jsonb_build_object(
  'pendingWebhooks',(select count(*) from loopmark_private.webhook_inbox where status in ('pending','running')),
  'oldestWebhookSeconds',(select coalesce(extract(epoch from now()-min(received_at)),0)::bigint from loopmark_private.webhook_inbox where status in ('pending','running')),
  'pendingDeletions',(select count(*) from loopmark_private.deletion_requests where status='pending' and ledger_committed_at is not null),
  'oldestDeletionSeconds',(select coalesce(extract(epoch from now()-min(requested_at)),0)::bigint from loopmark_private.deletion_requests where status='pending' and ledger_committed_at is not null),
  'lastCompleteBackupAt',(select max(completed_at) from loopmark_private.recovery_points where state='complete'),
  'retainedRecoveryBytes',(select coalesce(sum(bytes),0)::bigint from loopmark_private.recovery_points where state='complete'),
  'liveObjectBytes',(select coalesce(sum(bytes),0)::bigint from loopmark_private.media_objects where state<>'deleted'),
  'quarantinedJobs',(select count(*) from loopmark_private.operation_schedules where quarantined),
  'oldestVerificationSeconds',(select coalesce(extract(epoch from now()-min(observed_at)),0)::bigint from loopmark_private.purchase_grants),
  'expiredDeviceCount',(select count(*) from loopmark_private.devices where retired_at is null and last_seen<now()-interval '90 days')
 ) into result;
 return result || jsonb_build_object(
  'receivedSyncPending',(select count(*) from loopmark_private.sync_pending),
  'oldestReceivedSyncSeconds',(select coalesce(extract(epoch from now()-min(first_seen)),0)::bigint from loopmark_private.sync_pending),
  'syncRequests15m',(select coalesce(sum(requests),0) from loopmark_private.operation_metrics where route='sync' and minute>=now()-interval '15 minutes'),
  'syncConflicts15m',(select coalesce(sum(conflicts),0) from loopmark_private.operation_metrics where route='sync' and minute>=now()-interval '15 minutes'),
  'mediaRequests15m',(select coalesce(sum(requests),0) from loopmark_private.operation_metrics where route='media' and minute>=now()-interval '15 minutes'),
  'mediaFailures15m',(select coalesce(sum(failures),0) from loopmark_private.operation_metrics where route='media' and minute>=now()-interval '15 minutes'),
  'maximumPhaseMs15m',(select coalesce(max(maximum_ms),0) from loopmark_private.operation_metrics where minute>=now()-interval '15 minutes'),
  'cloudEnrollment',(select cloud_enrollment from loopmark_private.availability where id),
  'paymentInitiation',(select payment_admission from loopmark_private.availability where id)
 );
end $$;
create function public.loopmark_ops_claim(p_kind text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job loopmark_private.operation_schedules; begin
 perform loopmark_private.service_only();
 select * into job from loopmark_private.operation_schedules where kind=p_kind and not quarantined and next_attempt<=now() and (lease_until is null or lease_until<=now()) for update skip locked;
 if not found then return null; end if;
 update loopmark_private.operation_schedules set fence=fence+1,lease_until=now()+interval '5 minutes' where kind=job.kind returning * into job;
 return jsonb_build_object('kind',job.kind,'fence',job.fence::text);
end $$;
create function public.loopmark_ops_finish(p_kind text,p_fence bigint,p_success boolean,p_invariant_failure boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 perform loopmark_private.service_only();
 update loopmark_private.operation_schedules set lease_until=null,
  next_attempt=now()+case when p_success and p_kind='backup' then interval '1 day' when p_success then interval '1 minute' else interval '5 minutes' end,
  last_success=case when p_success then now() else last_success end,
  failures=case when p_success then 0 else failures+1 end, quarantined=quarantined or p_invariant_failure
 where kind=p_kind and fence=p_fence and lease_until>now();
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
end $$;
create function public.loopmark_ops_retention(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare changed integer; begin
 perform loopmark_private.service_only();
 if p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION'); end if;
 -- Only a physical-expiry worker marks points expired after removing their independent bytes.
 with eligible as(select request_id from loopmark_private.deletion_requests d where status='live-data-removed' and backup_expires_at<=now()
 and not exists(select 1 from loopmark_private.recovery_accounts o join loopmark_private.recovery_points p on p.id=o.point_id where o.owner_id=d.owner_id and (p.removed_at is null or exists(select 1 from loopmark_private.restore_drills drill where drill.point_id=p.id and drill.removed_at is null)))
 order by backup_expires_at limit p_limit for update skip locked)
 update loopmark_private.deletion_requests set status='complete',completed_at=now() where request_id in(select request_id from eligible);
 get diagnostics changed=row_count;
 delete from loopmark_private.webhook_inbox where ctid in(select ctid from loopmark_private.webhook_inbox where status='done' and received_at<now()-interval '30 days' order by received_at limit p_limit);
 return jsonb_build_object('completedDeletions',changed);
end $$;
revoke all on function public.loopmark_ops_status(),public.loopmark_ops_claim(text),public.loopmark_ops_finish(text,bigint,boolean,boolean),public.loopmark_ops_retention(integer) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_ops_status(),public.loopmark_ops_claim(text),public.loopmark_ops_finish(text,bigint,boolean,boolean),public.loopmark_ops_retention(integer) to service_role;
create function public.loopmark_erasure_replay(p_intent jsonb,p_watermark text) returns jsonb language plpgsql security definer set search_path='' as $$
declare request loopmark_private.deletion_requests; owner uuid; generation bigint; begin
 perform loopmark_private.service_only();
 if not loopmark_private.exact_keys(p_intent,array['accountId','deletionGeneration','requestId','receiptTokenHash','requestedAt','retainUntil']) or
  p_intent->>'receiptTokenHash'!~'^[a-f0-9]{64}$' or not loopmark_private.valid_id(p_intent->>'requestId') or
  p_intent->>'deletionGeneration'!~'^[1-9][0-9]{0,18}$' or p_watermark!~'^[0-9]+:[a-f0-9]{64}$' or
  (p_intent->>'retainUntil')::timestamptz<(p_intent->>'requestedAt')::timestamptz+interval '90 days' then perform loopmark_private.fail('VALIDATION'); end if;
 owner:=(p_intent->>'accountId')::uuid; generation:=(p_intent->>'deletionGeneration')::bigint;
 insert into loopmark_private.accounts(id,deletion_generation) values(owner,generation-1) on conflict do nothing;
 perform 1 from loopmark_private.accounts where id=owner for update;
 select * into request from loopmark_private.deletion_requests where owner_id=owner;
 if found and loopmark_private.erasure_intent(request)<>p_intent then perform loopmark_private.fail('OPERATION_REUSED'); end if;
 if not found then
  insert into loopmark_private.deletion_requests(request_id,owner_id,deletion_generation,receipt_token_hash,requested_at,retain_until)
  values(p_intent->>'requestId',owner,generation,p_intent->>'receiptTokenHash',(p_intent->>'requestedAt')::timestamptz,(p_intent->>'retainUntil')::timestamptz);
 end if;
 return public.loopmark_deletion_barrier(p_intent,p_watermark);
end $$;
revoke all on function public.loopmark_erasure_replay(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_erasure_replay(jsonb,text) to service_role;
-- Local isolated-destination primitive. A live primary has neither this name nor a closed restore gate.
create function public.loopmark_restore_erasure(p_intent jsonb,p_watermark text) returns void language plpgsql security definer set search_path='' as $$
declare erased_owner uuid:=(p_intent->>'accountId')::uuid; claimed jsonb; item jsonb; begin
 perform loopmark_private.service_only();
 if current_database()!~'^lm_restore_[a-f0-9]{32}$' or not exists(select 1 from loopmark_private.restore_gate where not ready) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 perform public.loopmark_erasure_replay(p_intent,p_watermark);
 -- This affects metadata in an unexposed restore only; no live storage object is deleted here.
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='loopmark-private' and starts_with(name,erased_owner::text||'/');
 update loopmark_private.deletion_requests set purge_after=now()-interval '1 second' where owner_id=erased_owner;
 update loopmark_private.jobs set next_attempt=now()-interval '1 second',lease_expires_at=null,status='pending' where owner_id=erased_owner and kind='delete-account';
 claimed:=public.loopmark_deletion_claim(1,erased_owner);
 for item in select value from jsonb_array_elements(claimed) loop
  perform public.loopmark_deletion_step((item->>'id')::uuid,(item->>'fence')::bigint,'purge-metadata');
  delete from auth.users where id=erased_owner;
  perform public.loopmark_deletion_step((item->>'id')::uuid,(item->>'fence')::bigint,'finish');
 end loop;
end $$;
revoke all on function public.loopmark_restore_erasure(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_restore_erasure(jsonb,text) to service_role;

-- Backup inventory/pins and ordinary GC claims share one bounded exclusion lock.
create or replace function public.loopmark_media_sweep_claim(p_limit integer default 20,p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; object loopmark_private.media_objects; result jsonb:='[]'; begin
 perform loopmark_private.service_only();
 if not pg_try_advisory_xact_lock(865119900) then return '[]'::jsonb; end if;
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

-- Admission switches add a negative control; provider configuration remains the positive authority.
alter table loopmark_private.availability add column payment_admission boolean not null default true;
create function public.loopmark_ops_control(p_cloud boolean default null,p_payments boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform loopmark_private.service_only();
 update loopmark_private.availability set cloud_enrollment=coalesce(p_cloud,cloud_enrollment),payment_admission=coalesce(p_payments,payment_admission) where id;
 return (select jsonb_build_object('cloudEnrollment',cloud_enrollment,'paymentInitiation',payment_admission) from loopmark_private.availability where id);
end $$;
revoke all on function public.loopmark_ops_control(boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_ops_control(boolean,boolean) to service_role;
create table loopmark_private.sync_pending (
 owner_id uuid not null references loopmark_private.accounts(id), operation_hash text not null,
 first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), primary key(owner_id,operation_hash)
);
create table loopmark_private.operation_metrics (
 minute timestamptz not null, shard integer not null, route text not null, requests bigint not null default 0,
 failures bigint not null default 0, conflicts bigint not null default 0, elapsed_ms bigint not null default 0,
 maximum_ms integer not null default 0, primary key(minute,shard,route)
);
alter table loopmark_private.sync_pending enable row level security;
alter table loopmark_private.operation_metrics enable row level security;
revoke all on loopmark_private.sync_pending,loopmark_private.operation_metrics from public,anon,authenticated,service_role;
create function loopmark_private.clear_pending_on_deletion() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.state<>'active' then delete from loopmark_private.sync_pending where owner_id=new.id; end if;return new;
end $$;
create trigger clear_pending_after_deletion after update of state on loopmark_private.accounts for each row execute function loopmark_private.clear_pending_on_deletion();
create function public.loopmark_ops_observe(p_owner uuid,p_route text,p_phase text,p_operation text default null,p_elapsed integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',now()); part integer; begin
 perform loopmark_private.service_only();
 if p_route not in ('sync','media','billing') or p_phase not in ('start','success','retry','error','conflict') or p_elapsed not between 0 and 300000 or (p_operation is not null and p_operation!~'^[a-f0-9]{64}$') then perform loopmark_private.fail('VALIDATION'); end if;
 perform 1 from loopmark_private.accounts where id=p_owner and state='active' for share;
 if not found then return; end if;
 if p_route='sync' and p_operation is not null then
  if p_phase='start' then
   if (select count(*) from loopmark_private.sync_pending where owner_id=p_owner)<1000 then
    insert into loopmark_private.sync_pending(owner_id,operation_hash) values(p_owner,p_operation) on conflict(owner_id,operation_hash) do update set last_seen=now();
   end if;
  elsif p_phase<>'retry' then delete from loopmark_private.sync_pending where owner_id=p_owner and operation_hash=p_operation;
  end if;
 end if;
 if p_phase='start' then return; end if;
 part:=get_byte(extensions.digest(p_owner::text,'sha256'),0)%16;
 insert into loopmark_private.operation_metrics(minute,shard,route,requests,failures,conflicts,elapsed_ms,maximum_ms)
 values(bucket,part,p_route,1,case when p_phase in ('error','retry') then 1 else 0 end,case when p_phase='conflict' then 1 else 0 end,p_elapsed,p_elapsed)
 on conflict(minute,shard,route) do update set requests=operation_metrics.requests+1,failures=operation_metrics.failures+excluded.failures,conflicts=operation_metrics.conflicts+excluded.conflicts,elapsed_ms=operation_metrics.elapsed_ms+excluded.elapsed_ms,maximum_ms=greatest(operation_metrics.maximum_ms,excluded.maximum_ms);
 delete from loopmark_private.operation_metrics where minute<now()-interval '1 day';
end $$;
revoke all on function public.loopmark_ops_observe(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_ops_observe(uuid,text,text,text,integer) to service_role;

create or replace function public.loopmark_billing_prepare(p_owner uuid,p_environment text,p_provider text,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; c loopmark_private.collections; attempt loopmark_private.purchase_attempts; product loopmark_private.billing_catalog; fingerprint text; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 if not loopmark_private.exact_keys(p_request,array['action','attemptId','productId','collection']) or p_request->>'action'<>'prepare' then perform loopmark_private.fail('VALIDATION'); end if;
 select * into c from loopmark_private.collections where owner_id=p_owner and id=p_request#>>'{collection,collectionId}' and epoch=p_request#>>'{collection,epoch}';
 if not found or p_request#>>'{collection,namespace}'<>'account_'||p_owner::text then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 fingerprint:=encode(extensions.digest(loopmark_private.canonical(p_request)||p_provider||p_environment,'sha256'),'hex');
 select * into attempt from loopmark_private.purchase_attempts where id=(p_request->>'attemptId')::uuid for update;
 if found then
  if attempt.owner_id<>p_owner or attempt.principal_id<>a.billing_principal_id or attempt.request_hash<>fingerprint then perform loopmark_private.fail('OPERATION_REUSED'); end if;
 else
  if not exists(select 1 from loopmark_private.availability where id and payment_admission) then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if;
  perform loopmark_private.rate_limit(p_owner,'purchase-prepare',5,0.0166667);
  select * into product from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and product_id=p_request->>'productId' and enabled;
  if not found then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if;
  if (select count(*) from loopmark_private.purchase_attempts where owner_id=p_owner and state in ('preparing','ready','pending') and (expires_at is null or expires_at>now()))>=4 then perform loopmark_private.fail('RATE_LIMITED'); end if;
  insert into loopmark_private.purchase_attempts(id,owner_id,principal_id,collection_id,epoch,request_hash,provider,environment,product_id,quoted_product,provider_product_id,state,expires_at)
   values((p_request->>'attemptId')::uuid,p_owner,a.billing_principal_id,c.id,c.epoch,fingerprint,p_provider,p_environment,product.product_id,product.product,product.provider_product_id,case when p_provider='revenuecat' then 'pending' else 'preparing' end,case when p_provider='revenuecat' then now()+interval '15 minutes' else now()+interval '1 hour' end) returning * into attempt;
 end if;
 return jsonb_build_object('id',attempt.id,'state',attempt.state);
end $$;
