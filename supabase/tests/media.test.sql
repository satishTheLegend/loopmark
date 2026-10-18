begin;
do $$ declare signature text; begin
 foreach signature in array array[
  'public.loopmark_media_verified(uuid,text,bigint)',
  'public.loopmark_media_check(uuid,text,bigint)',
  'public.loopmark_media_sweep_claim(integer,uuid)',
  'public.loopmark_media_sweep_finish(uuid,text,bigint)'
 ] loop
  if has_function_privilege('authenticated',signature,'EXECUTE') or has_function_privilege('anon',signature,'EXECUTE') then raise exception 'Client has media worker authority: %',signature; end if;
  if not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'Missing narrow media worker authority: %',signature; end if;
 end loop;
 if exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and (polcmd in ('a','w','d','*'))) then raise exception 'Public Storage write policy bypasses verified admission'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.loopmark_media_verified(gen_random_uuid(),'forged',1); raise exception 'Unverified ready flag accepted'; exception when insufficient_privilege then null; end;
 begin update loopmark_private.media_objects set state='ready'; raise exception 'Direct ready write accepted'; exception when insufficient_privilege then null; end;
 begin insert into storage.objects(bucket_id,name) values('loopmark-private','forged/object'); raise exception 'Direct Storage upload accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;
