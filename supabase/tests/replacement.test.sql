begin;
set local role authenticated;
do $$ begin
 begin perform public.loopmark_candidate_prepare(gen_random_uuid(),'{}'::jsonb,'{}'::jsonb); raise exception 'Client staged forged candidate'; exception when insufficient_privilege then null; end;
 begin update loopmark_private.candidates set state='committed'; raise exception 'Direct candidate commit accepted'; exception when insufficient_privilege then null; end;
 begin update loopmark_private.collections set epoch='forged'; raise exception 'Direct epoch swap accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin perform public.loopmark_candidate_action('forged','cancel'); raise exception 'Service invoked owner command'; exception when insufficient_privilege then null; end;
 begin perform public.loopmark_push('{}'::jsonb); raise exception 'Service forged owner receipt'; exception when insufficient_privilege then null; end;
end $$;
rollback;
