create table loopmark_private.billing_discovery(provider text not null,environment text not null,principal_id uuid not null references loopmark_private.billing_principals(id),after_cursor text,next_attempt timestamptz not null default now(),fence bigint not null default 0,lease_until timestamptz,primary key(provider,environment,principal_id));
create table loopmark_private.billing_disputes(environment text not null,id text not null,purchase_id text not null,primary key(environment,id));
create index billing_dispute_purchase on loopmark_private.billing_disputes(environment,purchase_id);
create table loopmark_private.billing_dispute_scan(environment text primary key,offset_value integer not null default 0,through_time bigint not null default extract(epoch from now())::bigint,next_attempt timestamptz not null default now(),fence bigint not null default 0,lease_until timestamptz);
insert into loopmark_private.billing_dispute_scan(environment) values('sandbox'),('production');
do $$ declare t text; begin foreach t in array array['billing_discovery','billing_disputes','billing_dispute_scan'] loop execute format('alter table loopmark_private.%I enable row level security',t);execute format('revoke all on loopmark_private.%I from public,anon,authenticated,service_role',t);end loop;end $$;
create function public.loopmark_billing_discover(p_owner uuid,p_environment text,p_provider text) returns void language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; begin
 perform loopmark_private.service_only();perform loopmark_private.billing_environment(p_environment);a:=loopmark_private.billing_owner(p_owner);
 if p_provider not in ('razorpay','revenuecat') then perform loopmark_private.fail('VALIDATION');end if;
 perform loopmark_private.rate_limit(p_owner,'billing-discover',10,0.166667);
 insert into loopmark_private.billing_discovery(provider,environment,principal_id) values(p_provider,p_environment,a.billing_principal_id)
 on conflict(provider,environment,principal_id) do update set next_attempt=least(loopmark_private.billing_discovery.next_attempt,now());
end $$;
create function public.loopmark_billing_discovery_claim(p_limit integer default 20,p_principal uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.billing_discovery; result jsonb:='[]';begin
 perform loopmark_private.service_only();if p_limit not between 1 and 100 then perform loopmark_private.fail('VALIDATION');end if;
 for item in select * from loopmark_private.billing_discovery where next_attempt<=now() and (lease_until is null or lease_until<=now()) and (p_principal is null or principal_id=p_principal) order by next_attempt,principal_id limit p_limit for update skip locked loop
 update loopmark_private.billing_discovery set fence=fence+1,lease_until=now()+interval '60 seconds' where provider=item.provider and environment=item.environment and principal_id=item.principal_id returning * into item;
 result:=result||jsonb_build_array(jsonb_build_object('provider',item.provider,'environment',item.environment,'principalId',item.principal_id,'after',item.after_cursor,'fence',item.fence::text));end loop;return result;
end $$;
create function public.loopmark_billing_discovery_finish(p_provider text,p_environment text,p_principal uuid,p_fence bigint,p_after text,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only();if length(p_after)>255 then perform loopmark_private.fail('VALIDATION');end if;
 update loopmark_private.billing_discovery set after_cursor=case when p_success then p_after else after_cursor end,lease_until=null,next_attempt=now()+case when not p_success then interval '30 seconds' when p_after is not null then interval '1 second' else interval '1 hour' end where provider=p_provider and environment=p_environment and principal_id=p_principal and fence=p_fence and lease_until>now();end $$;
create function public.loopmark_billing_attempts(p_principal uuid,p_environment text,p_after uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin perform loopmark_private.service_only();
 select coalesce(jsonb_agg(id order by id),'[]') into result from (select id from loopmark_private.purchase_attempts where principal_id=p_principal and environment=p_environment and provider='razorpay' and (p_after is null or id>p_after) order by id limit 4) selected;return result;end $$;
create function public.loopmark_billing_dispute_ids(p_environment text,p_purchase text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin perform loopmark_private.service_only();if (select count(*) from loopmark_private.billing_disputes where environment=p_environment and purchase_id=p_purchase)>20 then perform loopmark_private.fail('SERVICE_UNAVAILABLE');end if;
 select coalesce(jsonb_agg(id order by id),'[]') into result from loopmark_private.billing_disputes where environment=p_environment and purchase_id=p_purchase;return result;end $$;
create function public.loopmark_billing_dispute_record(p_environment text,p_id text,p_purchase text) returns void language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only();perform loopmark_private.billing_environment(p_environment);
 if p_id!~'^disp_[A-Za-z0-9]{1,100}$' or p_purchase!~'^pay_[A-Za-z0-9]{1,100}$' then perform loopmark_private.fail('VALIDATION');end if;
 if exists(select 1 from loopmark_private.billing_disputes where environment=p_environment and id=p_id and purchase_id<>p_purchase) then perform loopmark_private.fail('NOT_AVAILABLE');end if;
 insert into loopmark_private.billing_disputes values(p_environment,p_id,p_purchase) on conflict do nothing;
 insert into loopmark_private.purchase_leases(provider,environment,purchase_id) values('razorpay',p_environment,p_purchase) on conflict(provider,environment,purchase_id) do update set next_attempt=least(loopmark_private.purchase_leases.next_attempt,now());end $$;
create function public.loopmark_billing_dispute_scan_claim(p_environment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.billing_dispute_scan;begin perform loopmark_private.service_only();perform loopmark_private.billing_environment(p_environment);
 select * into item from loopmark_private.billing_dispute_scan where environment=p_environment for update;
 if item.lease_until>now() or item.next_attempt>now() then return null;end if;
 update loopmark_private.billing_dispute_scan set fence=fence+1,lease_until=now()+interval '60 seconds' where environment=p_environment returning * into item;
 return jsonb_build_object('fence',item.fence::text,'offset',item.offset_value,'through',item.through_time);end $$;
create function public.loopmark_billing_dispute_scan_finish(p_environment text,p_fence bigint,p_count integer) returns void language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only();if p_count not between 0 and 20 then perform loopmark_private.fail('VALIDATION');end if;
 update loopmark_private.billing_dispute_scan set offset_value=case when p_count=20 then offset_value+20 else 0 end,through_time=case when p_count=20 then through_time else extract(epoch from now())::bigint end,next_attempt=now()+case when p_count=20 then interval '1 second' else interval '1 hour' end,lease_until=null where environment=p_environment and fence=p_fence and lease_until>now();end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
do $$ declare fn record;begin for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'loopmark_billing_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);execute format('grant execute on function %s to service_role',fn.signature);end loop;end $$;
-- Authenticated webhook hints may name an existing principal, but never create one.
create function public.loopmark_billing_queue_principal(p_principal uuid,p_environment text) returns boolean language plpgsql security definer set search_path='' as $$
begin perform loopmark_private.service_only();perform loopmark_private.billing_environment(p_environment);
 if not exists(select 1 from loopmark_private.billing_principals where id=p_principal) then return false;end if;
 insert into loopmark_private.billing_discovery(provider,environment,principal_id) values('revenuecat',p_environment,p_principal) on conflict(provider,environment,principal_id) do update set next_attempt=least(loopmark_private.billing_discovery.next_attempt,now());return true;end $$;
revoke all on function public.loopmark_billing_queue_principal(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_billing_queue_principal(uuid,text) to service_role;
-- Recover a verified provider creation response even when the browser never received it.
create function public.loopmark_billing_link_observed(p_id uuid,p_link text,p_url text,p_expires timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare item loopmark_private.purchase_attempts;begin perform loopmark_private.service_only();
 select * into item from loopmark_private.purchase_attempts where id=p_id and provider='razorpay' for update;
 if not found or (item.provider_id is not null and item.provider_id<>p_link) then perform loopmark_private.fail('NOT_AVAILABLE');end if;
 if p_link!~'^plink_[A-Za-z0-9]{1,100}$' or p_url!~'^https://rzp\.io/(i|l)/[A-Za-z0-9_-]{1,100}$' then perform loopmark_private.fail('VALIDATION');end if;
 update loopmark_private.purchase_attempts set provider_id=p_link,checkout_url=case when owner_id is null then null else p_url end,expires_at=p_expires,state=case when state='preparing' then 'ready' else state end,create_lease_until=null where id=p_id;end $$;
revoke all on function public.loopmark_billing_link_observed(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_billing_link_observed(uuid,text,text,timestamptz) to service_role;

create function public.loopmark_billing_cancel_native(p_owner uuid,p_environment text,p_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.purchase_attempts;begin perform loopmark_private.service_only();perform loopmark_private.billing_environment(p_environment);perform loopmark_private.billing_owner(p_owner);
 select * into item from loopmark_private.purchase_attempts where id=p_attempt and owner_id=p_owner and provider='revenuecat' and environment=p_environment for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE');end if;
 update loopmark_private.purchase_attempts set state='failed',expires_at=least(expires_at,now()),updated_at=now() where id=p_attempt and state in ('preparing','pending','ready');
 return public.loopmark_billing_status(p_owner,p_environment,p_attempt);end $$;
revoke all on function public.loopmark_billing_cancel_native(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_billing_cancel_native(uuid,text,uuid) to service_role;
