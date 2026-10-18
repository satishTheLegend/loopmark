-- Command-owned data. Public clients cannot mutate any invariant-bearing table.
create schema if not exists loopmark_private;
revoke all on schema loopmark_private from public, anon, authenticated, service_role;
grant usage on schema loopmark_private to authenticated;
create extension if not exists pgcrypto with schema extensions;

create table loopmark_private.accounts (
 id uuid primary key references auth.users(id), state text not null default 'active' check(state in ('active','deleting','deleted')),
 deletion_generation bigint not null default 0 check(deletion_generation>=0), billing_principal_id uuid not null default gen_random_uuid() unique,
 created_at timestamptz not null default now()
);
create table loopmark_private.collections (
 id text primary key, owner_id uuid not null unique references loopmark_private.accounts(id), epoch text not null,
 revision bigint not null default 0 check(revision>=0), next_cursor bigint not null default 0 check(next_cursor>=0),
 compacted_cursor bigint not null default 0 check(compacted_cursor>=0), portable_bytes bigint not null default 0,
 project_count integer not null default 0, checkpoint_count integer not null default 0,
 unique(owner_id,id)
);
create table loopmark_private.projects (
 owner_id uuid not null, collection_id text not null, id text not null, code text not null,
 revision bigint not null, data jsonb not null check(jsonb_typeof(data)='object'), deleted_at timestamptz,
 primary key(owner_id,collection_id,id), foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id),
 unique(owner_id,collection_id,code)
);
create table loopmark_private.checkpoints (
 owner_id uuid not null, collection_id text not null, id text not null, project_id text not null,
 revision bigint not null, data jsonb not null check(jsonb_typeof(data)='object'), deleted_at timestamptz,
 primary key(owner_id,collection_id,id), foreign key(owner_id,collection_id,project_id) references loopmark_private.projects(owner_id,collection_id,id)
);
create table loopmark_private.media (
 owner_id uuid not null, collection_id text not null, id text not null, epoch text not null,
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'), bytes bigint not null check(bytes between 1 and 8388608),
 kind text not null check(kind in ('photo','voice')), mime_type text not null, state text not null default 'pending' check(state in ('pending','ready','deleted')),
 object_key text unique, created_at timestamptz not null default now(),
 primary key(owner_id,collection_id,id), foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id)
);
create index media_owner_hash on loopmark_private.media(owner_id,sha256);
create table loopmark_private.devices (
 owner_id uuid not null references loopmark_private.accounts(id), id text not null, generation text not null,
 last_seen timestamptz not null default now(), retired_at timestamptz, sequence_floor bigint not null default 0, max_sequence bigint not null default 0,
 primary key(owner_id,id), unique(owner_id,id,generation)
);
create table loopmark_private.operation_receipts (
 owner_id uuid not null, collection_id text not null, operation_id text not null, device_id text not null, device_generation text not null,
 sequence bigint not null check(sequence>0), sha256 text not null, epoch text not null, receipt jsonb not null, created_at timestamptz not null default now(),
 primary key(owner_id,operation_id), unique(owner_id,device_id,device_generation,sequence),
 foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id)
);
create table loopmark_private.change_feed (
 owner_id uuid not null, collection_id text not null, cursor bigint not null, epoch text not null, receipt jsonb not null,
 created_at timestamptz not null default now(), primary key(owner_id,collection_id,cursor),
 foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id)
);
create table loopmark_private.snapshots (
 id text primary key, owner_id uuid not null, collection_id text not null, epoch text not null, revision bigint not null, cursor bigint not null,
 purpose text not null check(purpose in ('hydrate','export')), manifest jsonb not null, expires_at timestamptz not null, created_at timestamptz not null default now(),
 unique(owner_id,id), foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id)
);
create index snapshot_owner_expiry on loopmark_private.snapshots(owner_id,expires_at);
create table loopmark_private.snapshot_media (
 owner_id uuid not null, snapshot_id text not null, collection_id text not null, media_id text not null,
 primary key(owner_id,snapshot_id,media_id), foreign key(owner_id,snapshot_id) references loopmark_private.snapshots(owner_id,id) on delete cascade,
 foreign key(owner_id,collection_id,media_id) references loopmark_private.media(owner_id,collection_id,id)
);
create table loopmark_private.upload_reservations (
 id text primary key, owner_id uuid not null, collection_id text not null, epoch text not null, deletion_generation bigint not null,
 media jsonb not null, state text not null default 'reserved', expires_at timestamptz not null,
 foreign key(owner_id,collection_id) references loopmark_private.collections(owner_id,id)
);
create table loopmark_private.billing_principals (
 id uuid primary key, account_id uuid unique references loopmark_private.accounts(id), recovery_key_hash text, deleted_binding boolean not null default false
);
create table loopmark_private.purchase_grants (
 provider text not null, environment text not null, canonical_purchase_id text not null, principal_id uuid not null references loopmark_private.billing_principals(id),
 product_id text not null, state text not null check(state in ('valid','pending','failed','disputed','refunded','revoked')), observed_at timestamptz not null,
 observation_id text not null, primary key(provider,environment,canonical_purchase_id)
);
create index grant_principal_state on loopmark_private.purchase_grants(principal_id,state);
create table loopmark_private.entitlement_projection (
 account_id uuid primary key references loopmark_private.accounts(id), principal_id uuid not null references loopmark_private.billing_principals(id),
 upgraded boolean not null default false, revision bigint not null default 0, verified_at timestamptz not null default now()
);
create table loopmark_private.webhook_inbox (
 provider text not null, event_id text not null, environment text not null, payload jsonb not null, status text not null default 'pending',
 received_at timestamptz not null default now(), primary key(provider,event_id)
);
create table loopmark_private.deletion_requests (
 request_id text primary key, owner_id uuid not null unique references loopmark_private.accounts(id), deletion_generation bigint not null,
 receipt_token_hash text not null unique, status text not null default 'pending', requested_at timestamptz not null default now(), backup_expires_at timestamptz
);
create table loopmark_private.jobs (
 id uuid primary key default gen_random_uuid(), kind text not null, owner_id uuid, status text not null default 'pending',
 next_attempt timestamptz not null default now(), payload jsonb not null default '{}', lease_fence bigint not null default 0, lease_expires_at timestamptz
);
create index jobs_status_next on loopmark_private.jobs(status,next_attempt);
create table loopmark_private.audit_events (
 id bigint generated always as identity primary key, owner_id uuid, kind text not null, correlation_id uuid not null default gen_random_uuid(), occurred_at timestamptz not null default now()
);
create table loopmark_private.availability (id boolean primary key default true check(id), cloud_enrollment boolean not null default false);
insert into loopmark_private.availability(id) values(true);
create table loopmark_private.rate_buckets (
 owner_id uuid not null, kind text not null, tokens numeric not null, refilled_at timestamptz not null, primary key(owner_id,kind)
);

create function loopmark_private.active_owner() returns uuid language sql stable security definer set search_path='' as $$
 select a.id from loopmark_private.accounts a where a.id=auth.uid() and a.state='active'
$$;
revoke all on function loopmark_private.active_owner() from public,anon,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
do $$ declare name text; begin
 for name in select tablename from pg_tables where schemaname='loopmark_private' loop
  execute format('alter table loopmark_private.%I enable row level security',name);
  execute format('revoke all on loopmark_private.%I from public, anon, authenticated, service_role',name);
 end loop;
end $$;
-- Reads are owner/active-state filtered; direct writes have neither grants nor policies.
create policy own_projects on loopmark_private.projects for select to authenticated using(owner_id=loopmark_private.active_owner() and deleted_at is null);
create policy own_checkpoints on loopmark_private.checkpoints for select to authenticated using(owner_id=loopmark_private.active_owner() and deleted_at is null);
grant select on loopmark_private.projects,loopmark_private.checkpoints to authenticated;
create view public.loopmark_projects with(security_invoker=true) as select collection_id,id,revision,data from loopmark_private.projects;
create view public.loopmark_checkpoints with(security_invoker=true) as select collection_id,id,project_id,revision,data from loopmark_private.checkpoints;
grant select on public.loopmark_projects,public.loopmark_checkpoints to authenticated;
revoke all on public.loopmark_projects,public.loopmark_checkpoints from anon,service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('loopmark-private','loopmark-private',false,8388608) on conflict(id) do nothing;
-- No client Storage read/write policies. I07's authenticated proxy checks active owner.

create function loopmark_private.fail(code text, detail jsonb default null) returns void language plpgsql set search_path='' as $$
begin raise exception using errcode='P0001', message=code, detail=coalesce(detail::text,''); end $$;
create function loopmark_private.valid_id(value text) returns boolean language sql immutable set search_path='' as $$
 select value is not null and value ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
$$;
create function loopmark_private.exact_keys(value jsonb, required text[], optional text[] default '{}') returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='object' and value ?& required and not exists(select 1 from jsonb_object_keys(value) k where not(k=any(required||optional)))
$$;
create function loopmark_private.canonical(value jsonb) returns text language plpgsql immutable strict set search_path='' as $$
declare result text; begin
 case jsonb_typeof(value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||loopmark_private.canonical(val),',' order by key collate "C"),'')||'}' into result from jsonb_each(value) as x(key,val);
 when 'array' then select '['||coalesce(string_agg(loopmark_private.canonical(val),',' order by ord),'')||']' into result from jsonb_array_elements(value) with ordinality as x(val,ord);
 when 'number' then result:=trim_scale((value#>>'{}')::numeric)::text; -- Valid command numbers are bounded integers.
 else result:=value::text; end case;
 return result;
end $$;
create function loopmark_private.rate_limit(p_owner uuid,p_kind text,p_capacity numeric,p_per_second numeric) returns void language plpgsql security definer set search_path='' as $$
declare bucket loopmark_private.rate_buckets; t timestamptz:=clock_timestamp(); available numeric; begin
 insert into loopmark_private.rate_buckets values(p_owner,p_kind,p_capacity,t) on conflict do nothing;
 select * into bucket from loopmark_private.rate_buckets where owner_id=p_owner and kind=p_kind for update;
 available:=least(p_capacity,bucket.tokens+extract(epoch from t-bucket.refilled_at)*p_per_second);
 if available<1 then perform loopmark_private.fail('RATE_LIMITED'); end if;
 update loopmark_private.rate_buckets set tokens=available-1,refilled_at=t where owner_id=p_owner and kind=p_kind;
end $$;
create function public.loopmark_session(p_device_id text,p_device_generation text default null,p_reregister boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; c loopmark_private.collections; d loopmark_private.devices; begin
 if uid is null or not loopmark_private.valid_id(p_device_id) then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 if not exists(select 1 from loopmark_private.accounts where id=uid) and not exists(select 1 from loopmark_private.availability where id and cloud_enrollment) then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if;
 insert into loopmark_private.accounts(id) values(uid) on conflict do nothing;
 select * into a from loopmark_private.accounts where id=uid for update;
 if a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 insert into loopmark_private.billing_principals(id,account_id) values(a.billing_principal_id,uid) on conflict do nothing;
 insert into loopmark_private.entitlement_projection(account_id,principal_id) values(uid,a.billing_principal_id) on conflict do nothing;
 insert into loopmark_private.collections(id,owner_id,epoch) values(gen_random_uuid()::text,uid,gen_random_uuid()::text) on conflict(owner_id) do nothing;
 select * into c from loopmark_private.collections where owner_id=uid for update;
 perform loopmark_private.rate_limit(uid,'session',20,0.5);
 select * into d from loopmark_private.devices where owner_id=uid and id=p_device_id for update;
 if found then
  if d.retired_at is not null or d.last_seen<now()-interval '90 days' then
   if not coalesce(p_reregister,false) then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
   if (select count(*) from loopmark_private.devices where owner_id=uid and retired_at is null and last_seen>=now()-interval '90 days')>=10 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
   update loopmark_private.devices set generation=gen_random_uuid()::text,last_seen=now(),retired_at=null,sequence_floor=0,max_sequence=0 where owner_id=uid and id=p_device_id returning * into d;
  elsif p_device_generation is not null and p_device_generation<>d.generation then perform loopmark_private.fail('SYNC_REBASE_REQUIRED');
  else update loopmark_private.devices set last_seen=now() where owner_id=uid and id=p_device_id returning * into d; end if;
 else
  if (select count(*) from loopmark_private.devices where owner_id=uid and retired_at is null and last_seen>=now()-interval '90 days')>=10 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
  insert into loopmark_private.devices(owner_id,id,generation) values(uid,p_device_id,gen_random_uuid()::text) returning * into d;
 end if;
 return jsonb_build_object('accountId',uid,'billingPrincipalId',a.billing_principal_id,'deletionGeneration',a.deletion_generation::text,
 'collection',jsonb_build_object('namespace','account_'||uid,'collectionId',c.id,'epoch',c.epoch),'device',jsonb_build_object('id',d.id,'generation',d.generation),
 'expiresAt',to_char((now()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;
revoke all on all functions in schema loopmark_private from public, anon, authenticated, service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
revoke all on function public.loopmark_session(text,text,boolean) from public,anon,service_role;
grant execute on function public.loopmark_session(text,text,boolean) to authenticated;
