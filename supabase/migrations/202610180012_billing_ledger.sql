-- Provider observations are service-only. No SDK, callback, imported flag or client DML grants access.
create table loopmark_private.billing_settings(id boolean primary key default true check(id), environment text not null check(environment in ('sandbox','production')));
insert into loopmark_private.billing_settings values(true,'sandbox');
create table loopmark_private.billing_catalog(
 provider text not null check(provider in ('razorpay','revenuecat')), environment text not null check(environment in ('sandbox','production')),
 product_id text not null check(length(product_id) between 1 and 200), provider_product_id text not null check(length(provider_product_id) between 1 and 200),
 product jsonb not null, enabled boolean not null default false, primary key(provider,environment,product_id)
);
create table loopmark_private.purchase_attempts(
 id uuid primary key, owner_id uuid references loopmark_private.accounts(id), principal_id uuid not null references loopmark_private.billing_principals(id),
 collection_id text, epoch text, request_hash text not null, provider text not null, environment text not null, product_id text not null,
 quoted_product jsonb not null, provider_product_id text not null,
 state text not null default 'preparing' check(state in ('preparing','ready','pending','verified','failed','disputed','refunded','revoked')),
 provider_id text, checkout_url text, expires_at timestamptz, create_fence bigint not null default 0, create_lease_until timestamptz,
 next_attempt timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(provider,environment,product_id) references loopmark_private.billing_catalog(provider,environment,product_id),
 unique(provider,environment,provider_id)
);
create index purchase_attempt_owner on loopmark_private.purchase_attempts(owner_id,created_at);
create index purchase_attempt_due on loopmark_private.purchase_attempts(next_attempt,id);
create table loopmark_private.purchase_leases(
 provider text not null, environment text not null, purchase_id text not null, fence bigint not null default 0,
 expires_at timestamptz, next_attempt timestamptz not null default now(), failures integer not null default 0,
 primary key(provider,environment,purchase_id)
);
create table loopmark_private.billing_promotions(
 account_id uuid primary key references loopmark_private.accounts(id), principal_id uuid not null references loopmark_private.billing_principals(id),
 environment text not null, authorization_id uuid not null unique, enabled boolean not null default true, granted_at timestamptz not null default now()
);
create table loopmark_private.billing_promotion_allowlist(authorization_id uuid primary key, account_id uuid not null, environment text not null, expires_at timestamptz not null);
create table loopmark_private.purchase_recovery_cases(
 id uuid primary key, owner_id uuid references loopmark_private.accounts(id), request_hash text not null, action text not null,
 provider text, environment text, purchase_id text, next_key_hash text not null, old_key_hash text, status text not null default 'pending',
 source_principal uuid, result jsonb, created_at timestamptz not null default now(), verified_support_id uuid
);
create table loopmark_private.billing_support_evidence(
 id uuid primary key, case_id uuid not null unique references loopmark_private.purchase_recovery_cases(id),
 source_principal uuid not null references loopmark_private.billing_principals(id), reason text not null check(reason in ('provider-ownership-verified')),
 operator_id uuid not null, verified_at timestamptz not null default now(), expires_at timestamptz not null
);
alter table loopmark_private.webhook_inbox drop constraint webhook_inbox_pkey;
alter table loopmark_private.webhook_inbox add primary key(provider,environment,event_id);
alter table loopmark_private.webhook_inbox add column payload_hash text;
alter table loopmark_private.webhook_inbox add column fence bigint not null default 0;
alter table loopmark_private.webhook_inbox add column lease_until timestamptz;
alter table loopmark_private.webhook_inbox add column next_attempt timestamptz not null default now();
alter table loopmark_private.webhook_inbox add column failures integer not null default 0;
create index billing_inbox_due on loopmark_private.webhook_inbox(status,next_attempt,received_at);
do $$ declare t text; begin
 foreach t in array array['billing_settings','billing_catalog','purchase_attempts','purchase_leases','billing_promotions','billing_promotion_allowlist','purchase_recovery_cases','billing_support_evidence'] loop
  execute format('alter table loopmark_private.%I enable row level security',t);
  execute format('revoke all on loopmark_private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function loopmark_private.billing_owner(p_owner uuid) returns loopmark_private.accounts language plpgsql set search_path='' as $$
declare a loopmark_private.accounts; begin
 select * into a from loopmark_private.accounts where id=p_owner and state='active';
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if; return a;
end $$;
create function loopmark_private.billing_environment(p_environment text) returns void language plpgsql set search_path='' as $$
begin if p_environment is null or not exists(select 1 from loopmark_private.billing_settings where id and environment=p_environment) then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if; end $$;
create function loopmark_private.billing_derive(p_principal uuid) returns void language plpgsql set search_path='' as $$
declare principal loopmark_private.billing_principals; env text; access boolean; begin
 select * into principal from loopmark_private.billing_principals where id=p_principal for update;
 if principal.account_id is null or principal.deleted_binding or not exists(select 1 from loopmark_private.accounts where id=principal.account_id and state='active') then return; end if;
 select environment into env from loopmark_private.billing_settings where id;
 access:=exists(select 1 from loopmark_private.purchase_grants where principal_id=p_principal and environment=env and state='valid') or exists(select 1 from loopmark_private.billing_promotions where account_id=principal.account_id and principal_id=p_principal and environment=env and enabled);
 insert into loopmark_private.entitlement_projection(account_id,principal_id,upgraded,revision,verified_at) values(principal.account_id,p_principal,access,1,now())
 on conflict(account_id) do update set principal_id=excluded.principal_id,upgraded=excluded.upgraded,revision=loopmark_private.entitlement_projection.revision+1,verified_at=excluded.verified_at;
end $$;
create function public.loopmark_billing_context(p_owner uuid,p_environment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment); a:=loopmark_private.billing_owner(p_owner);
 return jsonb_build_object('principalId',a.billing_principal_id);
end $$;
create function public.loopmark_billing_products(p_owner uuid,p_environment text,p_provider text) returns jsonb language plpgsql security definer set search_path='' as $$
declare products jsonb; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment); perform loopmark_private.billing_owner(p_owner);
 select coalesce(jsonb_agg(product order by product_id),'[]') into products from loopmark_private.billing_catalog where environment=p_environment and provider=p_provider and enabled;
 return jsonb_build_object('products',products);
end $$;
create function public.loopmark_billing_status(p_owner uuid,p_environment text,p_attempt uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; e loopmark_private.entitlement_projection; attempt loopmark_private.purchase_attempts; current_key text; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment); a:=loopmark_private.billing_owner(p_owner);
 select * into e from loopmark_private.entitlement_projection where account_id=p_owner and principal_id=a.billing_principal_id;
 if not found then perform loopmark_private.fail('SERVICE_UNAVAILABLE'); end if;
 if p_attempt is not null then
  select * into attempt from loopmark_private.purchase_attempts where id=p_attempt and owner_id=p_owner and principal_id=a.billing_principal_id and environment=p_environment;
  if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 end if;
 select recovery_key_hash into current_key from loopmark_private.billing_principals where id=a.billing_principal_id;
 return jsonb_build_object('entitlement',jsonb_build_object('accountId',p_owner,'billingPrincipalId',a.billing_principal_id,'upgraded',e.upgraded,'revision',e.revision::text,'verifiedAt',loopmark_private.time_text(e.verified_at)),
 'attempt',case when p_attempt is null then null else jsonb_build_object('id',attempt.id,'provider',attempt.provider,'state',attempt.state) end,'recoveryKeyConfigured',current_key is not null,'currentRecoveryKeyHash',current_key);
end $$;
create function public.loopmark_billing_prepare(p_owner uuid,p_environment text,p_provider text,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  perform loopmark_private.rate_limit(p_owner,'purchase-prepare',5,0.0166667);
  select * into product from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and product_id=p_request->>'productId' and enabled;
  if not found then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if;
  if (select count(*) from loopmark_private.purchase_attempts where owner_id=p_owner and state in ('preparing','ready','pending') and (expires_at is null or expires_at>now()))>=4 then perform loopmark_private.fail('RATE_LIMITED'); end if;
  insert into loopmark_private.purchase_attempts(id,owner_id,principal_id,collection_id,epoch,request_hash,provider,environment,product_id,quoted_product,provider_product_id,state,expires_at)
   values((p_request->>'attemptId')::uuid,p_owner,a.billing_principal_id,c.id,c.epoch,fingerprint,p_provider,p_environment,product.product_id,product.product,product.provider_product_id,case when p_provider='revenuecat' then 'pending' else 'preparing' end,case when p_provider='revenuecat' then now()+interval '15 minutes' else now()+interval '1 hour' end) returning * into attempt;
 end if;
 return jsonb_build_object('id',attempt.id,'state',attempt.state);
end $$;
create function public.loopmark_billing_attempt(p_id uuid,p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt loopmark_private.purchase_attempts; product loopmark_private.billing_catalog; begin
 perform loopmark_private.service_only();
 select * into attempt from loopmark_private.purchase_attempts where id=p_id;
 if not found or (p_owner is not null and (attempt.owner_id is distinct from p_owner or not exists(select 1 from loopmark_private.accounts where id=p_owner and state='active'))) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into product from loopmark_private.billing_catalog where provider=attempt.provider and environment=attempt.environment and product_id=attempt.product_id;
 return jsonb_build_object('attemptId',attempt.id,'principalId',attempt.principal_id,'provider',attempt.provider,'environment',attempt.environment,'product',attempt.quoted_product,'providerProductId',attempt.provider_product_id,'state',attempt.state,'paymentLinkId',attempt.provider_id,'checkoutUrl',attempt.checkout_url,'expiresAt',case when attempt.expires_at is null then null else loopmark_private.time_text(attempt.expires_at) end);
end $$;
create function public.loopmark_billing_create_claim(p_id uuid,p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt loopmark_private.purchase_attempts; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_owner(p_owner);
 select * into attempt from loopmark_private.purchase_attempts where id=p_id and owner_id=p_owner and provider='razorpay' for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if attempt.provider_id is not null or attempt.create_lease_until>now() then return null; end if;
 update loopmark_private.purchase_attempts set create_fence=create_fence+1,create_lease_until=now()+interval '60 seconds' where id=p_id returning * into attempt;
 return jsonb_build_object('fence',attempt.create_fence::text,'attempt',public.loopmark_billing_attempt(p_id,p_owner));
end $$;
create function public.loopmark_billing_created(p_id uuid,p_fence bigint,p_link_id text,p_url text,p_expires timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare attempt loopmark_private.purchase_attempts; begin
 perform loopmark_private.service_only();
 select * into attempt from loopmark_private.purchase_attempts where id=p_id for update;
 if not found or attempt.create_fence<>p_fence or attempt.create_lease_until<=now() or attempt.provider_id is not null then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if p_link_id!~'^plink_[A-Za-z0-9]{1,100}$' or p_url!~'^https://rzp\.io/(i|l)/[A-Za-z0-9_-]{1,100}$' or p_expires is null then perform loopmark_private.fail('VALIDATION'); end if;
 update loopmark_private.purchase_attempts set provider_id=p_link_id,checkout_url=case when owner_id is null then null else p_url end,expires_at=p_expires,state=case when p_expires<=now() then 'failed' else 'ready' end,create_lease_until=null,updated_at=now() where id=p_id;
end $$;
create function public.loopmark_billing_purchase_claim(p_provider text,p_environment text,p_purchase text) returns text language plpgsql security definer set search_path='' as $$
declare lease loopmark_private.purchase_leases; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 if p_provider not in ('razorpay','revenuecat') or p_purchase is null or length(p_purchase) not between 1 and 255 then perform loopmark_private.fail('VALIDATION'); end if;
 insert into loopmark_private.purchase_leases(provider,environment,purchase_id) values(p_provider,p_environment,p_purchase) on conflict do nothing;
 select * into lease from loopmark_private.purchase_leases where provider=p_provider and environment=p_environment and purchase_id=p_purchase for update;
 if lease.expires_at>now() then return null; end if;
 perform pg_advisory_xact_lock(865119305);
 if (select count(*) from loopmark_private.purchase_leases where expires_at>now())>=4 then return null;end if;
 update loopmark_private.purchase_leases set fence=fence+1,expires_at=now()+interval '60 seconds' where provider=p_provider and environment=p_environment and purchase_id=p_purchase returning * into lease;
 return lease.fence::text;
end $$;
create function public.loopmark_billing_observe(p_provider text,p_environment text,p_purchase text,p_fence bigint,p_principal uuid,p_product text,p_state text,p_observation text,p_attempt uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare principal loopmark_private.billing_principals; lease loopmark_private.purchase_leases; previous loopmark_private.purchase_grants; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 -- Every grant for this principal and recovery binding shares this lock, after provider I/O.
 select * into principal from loopmark_private.billing_principals where id=p_principal for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 select * into lease from loopmark_private.purchase_leases where provider=p_provider and environment=p_environment and purchase_id=p_purchase for update;
 if not found or lease.fence<>p_fence or lease.expires_at<=now() then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if p_state not in ('valid','pending','failed','disputed','refunded','revoked') or p_observation is null or length(p_observation) not between 1 and 255 or not exists(select 1 from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and product_id=p_product) then perform loopmark_private.fail('VALIDATION'); end if;
 select * into previous from loopmark_private.purchase_grants where provider=p_provider and environment=p_environment and canonical_purchase_id=p_purchase;
 if found and (previous.principal_id<>p_principal or previous.product_id<>p_product) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if p_attempt is not null and not exists(select 1 from loopmark_private.purchase_attempts where id=p_attempt and principal_id=p_principal and provider=p_provider and environment=p_environment and product_id=p_product) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 insert into loopmark_private.purchase_grants values(p_provider,p_environment,p_purchase,p_principal,p_product,p_state,now(),p_observation)
 on conflict(provider,environment,canonical_purchase_id) do update set state=excluded.state,observed_at=excluded.observed_at,observation_id=excluded.observation_id;
 if p_attempt is not null then update loopmark_private.purchase_attempts set state=case when p_state='valid' then 'verified' else p_state end,updated_at=now(),next_attempt=now()+interval '1 hour' where id=p_attempt; end if;
 if p_provider='revenuecat' then update loopmark_private.purchase_attempts set state=case when p_state='valid' then 'verified' else p_state end,updated_at=now() where principal_id=p_principal and provider=p_provider and environment=p_environment and product_id=p_product;end if;
 perform loopmark_private.billing_derive(p_principal);
 update loopmark_private.purchase_leases set expires_at=null,next_attempt=now()+interval '1 hour',failures=0 where provider=p_provider and environment=p_environment and purchase_id=p_purchase;
end $$;
create function public.loopmark_billing_purchase_failed(p_provider text,p_environment text,p_purchase text,p_fence bigint) returns void language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only(); update loopmark_private.purchase_leases set expires_at=null,failures=least(failures+1,20),next_attempt=now()+make_interval(secs=>least(3600,power(2,least(failures+1,10))::integer)) where provider=p_provider and environment=p_environment and purchase_id=p_purchase and fence=p_fence; end $$;
create function public.loopmark_billing_webhook(p_provider text,p_environment text,p_event text,p_hash text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing loopmark_private.webhook_inbox; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 if p_provider not in ('razorpay','revenuecat') or p_event is null or length(p_event) not between 1 and 200 or p_hash!~'^[a-f0-9]{64}$' or octet_length(p_payload::text)>4096 then perform loopmark_private.fail('VALIDATION'); end if;
 -- Serialize bounded admission, including duplicate delivery during queue pressure.
 perform pg_advisory_xact_lock(865119303);
 select * into existing from loopmark_private.webhook_inbox where provider=p_provider and environment=p_environment and event_id=p_event;
 if found then
  if existing.payload_hash<>p_hash then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  return jsonb_build_object('accepted',true);
 end if;
 if (select count(*) from loopmark_private.webhook_inbox where status<>'done')>=10000 then perform loopmark_private.fail('SERVICE_UNAVAILABLE'); end if;
 insert into loopmark_private.webhook_inbox(provider,environment,event_id,payload,payload_hash) values(p_provider,p_environment,p_event,p_payload,p_hash);
 return jsonb_build_object('accepted',true);
end $$;
create function public.loopmark_billing_inbox_claim(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.webhook_inbox; items jsonb:='[]'; begin
 perform loopmark_private.service_only(); if p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION'); end if;
 for item in select * from loopmark_private.webhook_inbox where status<>'done' and next_attempt<=now() and (lease_until is null or lease_until<=now()) order by next_attempt,received_at limit p_limit for update skip locked loop
  update loopmark_private.webhook_inbox set fence=fence+1,lease_until=now()+interval '60 seconds',status='running' where provider=item.provider and environment=item.environment and event_id=item.event_id returning * into item;
  items:=items||jsonb_build_array(jsonb_build_object('provider',item.provider,'environment',item.environment,'eventId',item.event_id,'payload',item.payload,'fence',item.fence::text));
 end loop; return items;
end $$;
create function public.loopmark_billing_inbox_finish(p_provider text,p_environment text,p_event text,p_fence bigint,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only(); update loopmark_private.webhook_inbox set status=case when p_success then 'done' else 'pending' end,lease_until=null,failures=case when p_success then 0 else least(failures+1,20) end,next_attempt=now()+make_interval(secs=>least(3600,power(2,least(failures+1,10))::integer)) where provider=p_provider and environment=p_environment and event_id=p_event and fence=p_fence and lease_until>now(); end $$;
-- Authoritative inventory permits scheduled reconciliation beyond webhook retry horizons.
create function public.loopmark_billing_due(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform loopmark_private.service_only(); if p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION'); end if;
 with picked as (select provider,environment,purchase_id from loopmark_private.purchase_leases where next_attempt<=now() and (expires_at is null or expires_at<=now()) order by next_attempt,purchase_id limit p_limit for update skip locked), changed as (
 update loopmark_private.purchase_leases l set next_attempt=now()+interval '60 seconds' from picked p where (l.provider,l.environment,l.purchase_id)=(p.provider,p.environment,p.purchase_id) returning l.provider,l.environment,l.purchase_id)
 select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'environment',environment,'purchaseId',purchase_id)),'[]') into result from changed;
 return result;
end $$;
create function public.loopmark_billing_lookup(p_provider text,p_environment text,p_purchase text default null,p_reference uuid default null,p_principal uuid default null,p_provider_product text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare grant_row loopmark_private.purchase_grants; attempt loopmark_private.purchase_attempts; product loopmark_private.billing_catalog; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 if p_purchase is not null then
  select * into grant_row from loopmark_private.purchase_grants where provider=p_provider and environment=p_environment and canonical_purchase_id=p_purchase;
  if found then
   if p_provider='revenuecat' and p_provider_product is not null and not exists(select 1 from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and product_id=grant_row.product_id and provider_product_id=p_provider_product) then perform loopmark_private.fail('NOT_AVAILABLE');end if;
   return jsonb_build_object('principalId',grant_row.principal_id,'productId',grant_row.product_id,'attemptId',null); end if;
 end if;
 if p_reference is not null then
  select * into attempt from loopmark_private.purchase_attempts where id=p_reference and provider=p_provider and environment=p_environment;
  if found then return jsonb_build_object('principalId',attempt.principal_id,'productId',attempt.product_id,'attemptId',attempt.id); end if;
 end if;
 if p_provider='revenuecat' and p_principal is not null and exists(select 1 from loopmark_private.billing_principals where id=p_principal) then
  select * into product from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and provider_product_id=p_provider_product and enabled;
  if found then return jsonb_build_object('principalId',p_principal,'productId',product.product_id,'attemptId',null); end if;
 end if;
 return null;
end $$;
-- Delete craft-associated purchase intent fields when the permanent principal is detached.
create function loopmark_private.billing_detached() returns trigger language plpgsql set search_path='' as $$
begin
 if new.account_id is null and old.account_id is not null then
  update loopmark_private.purchase_attempts set owner_id=null,collection_id=null,epoch=null,request_hash='',checkout_url=null where principal_id=new.id;
  delete from loopmark_private.billing_promotions where account_id=old.account_id;
  delete from loopmark_private.billing_promotion_allowlist where account_id=old.account_id;
  update loopmark_private.purchase_recovery_cases set owner_id=null,request_hash='',old_key_hash=null,result=null where owner_id=old.account_id;
 end if; return new;
end $$;
create trigger billing_detach_cleanup after update on loopmark_private.billing_principals for each row execute function loopmark_private.billing_detached();
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
do $$ declare fn record; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'loopmark_billing_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
