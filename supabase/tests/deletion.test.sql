begin;
do $$ declare signature text; begin
 foreach signature in array array[
  'public.loopmark_deletion_barrier(jsonb,text)',
  'public.loopmark_deletion_status(text,text)',
  'public.loopmark_deletion_claim(integer,uuid)',
  'public.loopmark_deletion_step(uuid,bigint,text)'
 ] loop
  if has_function_privilege('authenticated',signature,'EXECUTE') or has_function_privilege('anon',signature,'EXECUTE') then raise exception 'Client has deletion worker authority: %',signature; end if;
 end loop;
 if exists(select 1 from pg_constraint where conrelid='loopmark_private.accounts'::regclass and confrelid='auth.users'::regclass) then raise exception 'Auth deletion could remove the erasure barrier'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.loopmark_deletion_barrier('{}'::jsonb,'0:'||repeat('0',64)); raise exception 'Unledgered client deletion accepted'; exception when insufficient_privilege then null; end;
 begin update loopmark_private.accounts set state='active'; raise exception 'Client reactivated deleted account'; exception when insufficient_privilege then null; end;
 begin delete from loopmark_private.deletion_requests; raise exception 'Client removed erasure intent'; exception when insufficient_privilege then null; end;
end $$;
rollback;
