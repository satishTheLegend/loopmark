create unique index billing_provider_product on loopmark_private.billing_catalog(provider,environment,provider_product_id);
create function public.loopmark_billing_catalog_set(p_provider text,p_environment text,p_provider_product text,p_product jsonb,p_enabled boolean,p_authorization uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform loopmark_private.service_only();
 if p_authorization is null or p_provider not in ('razorpay','revenuecat') or p_environment not in ('sandbox','production') or not loopmark_private.exact_keys(p_product,array['id','title','displayPrice','currency','amountMinor','provider']) or p_product->>'provider'<>p_provider or p_product->>'id'!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' or length(p_product->>'title') not between 1 and 100 or length(p_product->>'displayPrice') not between 1 and 100 or p_product->>'currency'!~'^[A-Z]{3}$' or p_product->>'amountMinor'!~'^[1-9][0-9]{0,8}$' or (p_product->>'amountMinor')::bigint>100000000 or length(p_provider_product) not between 1 and 200 then perform loopmark_private.fail('VALIDATION'); end if;
 perform pg_advisory_xact_lock(865119304);
 if exists(select 1 from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and product_id=p_product->>'id' and provider_product_id<>p_provider_product) then perform loopmark_private.fail('OPERATION_REUSED');end if;
 if p_enabled and (select count(*) from loopmark_private.billing_catalog where provider=p_provider and environment=p_environment and enabled and product_id<>p_product->>'id')>=20 then perform loopmark_private.fail('RATE_LIMITED'); end if;
 insert into loopmark_private.billing_catalog values(p_provider,p_environment,p_product->>'id',p_provider_product,p_product,p_enabled)
 on conflict(provider,environment,product_id) do update set provider_product_id=excluded.provider_product_id,product=excluded.product,enabled=excluded.enabled;
 insert into loopmark_private.audit_events(kind,correlation_id) values('billing-catalog-authorized',p_authorization);
end $$;
create function public.loopmark_billing_recovery_prepare(p_owner uuid,p_environment text,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; principal loopmark_private.billing_principals; item loopmark_private.purchase_recovery_cases; fingerprint text; key_hash text; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_environment(p_environment);
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into principal from loopmark_private.billing_principals where id=a.billing_principal_id for update;
 fingerprint:=encode(extensions.digest(loopmark_private.canonical(p_request),'sha256'),'hex');
 select * into item from loopmark_private.purchase_recovery_cases where id=(p_request->>'requestId')::uuid for update;
 if found then
  if item.owner_id is distinct from p_owner or item.request_hash<>fingerprint then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  return coalesce(item.result,jsonb_build_object('status','pending','caseId',item.id));
 end if;
 if p_request->>'action' not in ('set-key','claim') or p_request->>'nextRecoveryKeyHash'!~'^[a-f0-9]{64}$' then perform loopmark_private.fail('VALIDATION'); end if;
 perform loopmark_private.rate_limit(p_owner,'purchase-recovery',5,0.0166667);
 if p_request->>'action'='claim' or principal.recovery_key_hash is not null then
  perform loopmark_private.consume_reauthentication(p_owner,p_request#>>'{reauthentication,challengeId}',p_request#>>'{reauthentication,proof}');
 end if;
 key_hash:=case when p_request ? 'recoveryKey' then encode(extensions.digest(p_request->>'recoveryKey','sha256'),'hex') else null end;
 insert into loopmark_private.purchase_recovery_cases(id,owner_id,request_hash,action,provider,environment,purchase_id,next_key_hash,old_key_hash)
 values((p_request->>'requestId')::uuid,p_owner,fingerprint,p_request->>'action',p_request->>'provider',p_environment,p_request->>'evidenceId',p_request->>'nextRecoveryKeyHash',key_hash) returning * into item;
 if item.action='set-key' then
  update loopmark_private.billing_principals set recovery_key_hash=item.next_key_hash where id=principal.id;
  update loopmark_private.purchase_recovery_cases set status='key-saved',result=jsonb_build_object('status','key-saved','recoveryKeyHash',item.next_key_hash) where id=item.id returning * into item;
  insert into loopmark_private.audit_events(owner_id,kind,correlation_id) values(p_owner,'recovery-key-saved',item.id);
 end if;
 return coalesce(item.result,jsonb_build_object('status','pending','caseId',item.id));
end $$;
create function public.loopmark_billing_recovery_status(p_owner uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.purchase_recovery_cases; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_owner(p_owner);
 select * into item from loopmark_private.purchase_recovery_cases where id=p_request and owner_id=p_owner;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 return coalesce(item.result,jsonb_build_object('status','pending','caseId',item.id));
end $$;
create function public.loopmark_billing_recovery_case(p_owner uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare item loopmark_private.purchase_recovery_cases; begin
 perform loopmark_private.service_only(); perform loopmark_private.billing_owner(p_owner);
 select * into item from loopmark_private.purchase_recovery_cases where id=p_request and owner_id=p_owner;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 return jsonb_build_object('provider',item.provider,'environment',item.environment,'purchaseId',item.purchase_id,'status',item.status);
end $$;
create function public.loopmark_billing_recover(p_owner uuid,p_request uuid,p_purchase text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a loopmark_private.accounts; item loopmark_private.purchase_recovery_cases; grant_row loopmark_private.purchase_grants; source loopmark_private.billing_principals; target loopmark_private.billing_principals; response_value jsonb; begin
 perform loopmark_private.service_only();
 select * into a from loopmark_private.accounts where id=p_owner for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into item from loopmark_private.purchase_recovery_cases where id=p_request and owner_id=p_owner for update;
 if not found or item.action<>'claim' then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if item.result is not null then return item.result; end if;
 select * into grant_row from loopmark_private.purchase_grants where provider=item.provider and environment=item.environment and canonical_purchase_id=p_purchase;
 if not found then return jsonb_build_object('status','pending','caseId',item.id); end if;
 -- A fresh authoritative fetch is tagged with the case ID; client transaction IDs are not proof.
 if grant_row.state<>'valid' or grant_row.observation_id<>item.id::text or grant_row.observed_at<now()-interval '60 seconds' then return jsonb_build_object('status','pending','caseId',item.id); end if;
 perform 1 from loopmark_private.billing_principals where id in (grant_row.principal_id,a.billing_principal_id) order by id for update;
 select * into source from loopmark_private.billing_principals where id=grant_row.principal_id;
 select * into target from loopmark_private.billing_principals where id=a.billing_principal_id;
 select * into grant_row from loopmark_private.purchase_grants where provider=item.provider and environment=item.environment and canonical_purchase_id=p_purchase;
 if grant_row.state<>'valid' or grant_row.observation_id<>item.id::text or grant_row.observed_at<now()-interval '60 seconds' then return jsonb_build_object('status','pending','caseId',item.id); end if;
 if source.account_id is not null or not source.deleted_binding or source.id=target.id then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if exists(select 1 from loopmark_private.purchase_grants where principal_id=target.id) or exists(select 1 from loopmark_private.billing_promotions where principal_id=target.id) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if not (item.old_key_hash is not null and source.recovery_key_hash is not null and item.old_key_hash=source.recovery_key_hash) and not exists(select 1 from loopmark_private.billing_support_evidence where case_id=item.id and source_principal=source.id and expires_at>now()) then
  update loopmark_private.purchase_recovery_cases set source_principal=source.id where id=item.id;
  return jsonb_build_object('status','pending','caseId',item.id);
 end if;
 -- Detach the new empty principal first, then bind only the verified historical purchase principal.
 update loopmark_private.billing_principals set account_id=null,deleted_binding=true where id=target.id;
 -- Tombstones keep deletion identity but relinquish the historical billing binding.
 update loopmark_private.accounts set billing_principal_id=gen_random_uuid() where billing_principal_id=source.id and id<>p_owner and state<>'active';
 update loopmark_private.billing_principals set account_id=p_owner,deleted_binding=false,recovery_key_hash=item.next_key_hash where id=source.id;
 update loopmark_private.accounts set billing_principal_id=source.id where id=p_owner;
 delete from loopmark_private.entitlement_projection where account_id=p_owner;
 perform loopmark_private.billing_derive(source.id);
 response_value:=jsonb_build_object('status','recovered','entitlement',public.loopmark_billing_status(p_owner,item.environment,null)->'entitlement','recoveryKeyHash',item.next_key_hash);
 -- Detach cleanup clears owner-associated cases, so restore only this authorized narrow receipt.
 update loopmark_private.purchase_recovery_cases set owner_id=p_owner,request_hash=item.request_hash,status='recovered',source_principal=source.id,result=response_value,old_key_hash=null where id=item.id;
 insert into loopmark_private.audit_events(owner_id,kind,correlation_id) values(p_owner,'purchase-principal-recovered',item.id);
 return response_value;
end $$;
create function public.loopmark_billing_support_verify(p_case uuid,p_source uuid,p_operator uuid,p_evidence uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform loopmark_private.service_only();
 if p_operator is null or p_evidence is null or not exists(select 1 from loopmark_private.purchase_recovery_cases where id=p_case and status='pending' and source_principal=p_source and owner_id is not null) then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 insert into loopmark_private.billing_support_evidence(id,case_id,source_principal,reason,operator_id,expires_at) values(p_evidence,p_case,p_source,'provider-ownership-verified',p_operator,now()+interval '1 hour');
 insert into loopmark_private.audit_events(kind,correlation_id) values('purchase-support-ownership-verified',p_evidence);
end $$;
create function public.loopmark_billing_promote(p_authorization uuid) returns void language plpgsql security definer set search_path='' as $$
declare permit loopmark_private.billing_promotion_allowlist; a loopmark_private.accounts; begin
 perform loopmark_private.service_only();
 select * into permit from loopmark_private.billing_promotion_allowlist where authorization_id=p_authorization and expires_at>now();
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 a:=loopmark_private.billing_owner(permit.account_id);
 perform 1 from loopmark_private.billing_principals where id=a.billing_principal_id for update;
 insert into loopmark_private.billing_promotions(account_id,principal_id,environment,authorization_id) values(a.id,a.billing_principal_id,permit.environment,permit.authorization_id);
 perform loopmark_private.billing_derive(a.billing_principal_id);
 insert into loopmark_private.audit_events(owner_id,kind,correlation_id) values(a.id,'purchase-promotion-authorized',p_authorization);
end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
do $$ declare fn record; begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'loopmark_billing_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
