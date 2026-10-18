-- Executed on the real isolated database by tests/server/boundaries.test.ts.
begin;
do $$
declare object record; caller text;
begin
 for object in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='loopmark_private' and c.relkind='r' loop
  if not object.relrowsecurity then raise exception 'Missing RLS: %',object.relname; end if;
  foreach caller in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(caller,object.oid,'INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Direct invariant write grant: % %',caller,object.relname; end if;
  end loop;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','loopmark_private') and p.prosecdef and (n.nspname='loopmark_private' or p.proname like 'loopmark_%') and not coalesce(p.proconfig @> array['search_path=""'],false)) then raise exception 'Unsafe definer search path'; end if;
 if has_function_privilege('authenticated','public.loopmark_compact(integer)','EXECUTE') or has_function_privilege('authenticated','public.loopmark_issue_reauthentication(uuid,text,text)','EXECUTE') then raise exception 'Client can invoke worker authority'; end if;
 if has_function_privilege('service_role','public.loopmark_push(jsonb)','EXECUTE') then raise exception 'Worker role can invoke client command'; end if;
end $$;
set local role authenticated;
do $$
begin
 begin update loopmark_private.collections set next_cursor=next_cursor+1; raise exception 'Direct cursor update accepted'; exception when insufficient_privilege then null; end;
 begin update loopmark_private.entitlement_projection set upgraded=true; raise exception 'Direct grant update accepted'; exception when insufficient_privilege then null; end;
 begin delete from loopmark_private.operation_receipts; raise exception 'Direct receipt delete accepted'; exception when insufficient_privilege then null; end;
 begin perform public.loopmark_compact(1); raise exception 'Client worker execution accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;
