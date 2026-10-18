-- Complement HTTP effects with cross-language serialization and malformed SQL inputs.
begin;
do $$
begin
 if loopmark_private.canonical('{"b":[true,null,"🧶"],"a":"quoted \"value\""}'::jsonb)<>'{"a":"quoted \"value\"","b":[true,null,"🧶"]}' then raise exception 'Canonical serialization differs'; end if;
 if loopmark_private.js_length('🧶')<>2 then raise exception 'UTF-16 field length differs'; end if;
 if loopmark_private.canonical('{"n":3.00}'::jsonb)<>'{"n":3}' then raise exception 'Integer normalization differs'; end if;
 perform loopmark_private.validate_strings('{"createdAt":"0000-02-29T00:00:00.000Z"}'::jsonb);
 begin perform loopmark_private.validate_strings('{"createdAt":"2026-02-30T00:00:00.000Z"}'::jsonb); raise exception 'Invalid date accepted'; exception when datetime_field_overflow then null; end;
 begin perform loopmark_private.validate_strings(jsonb_build_object('name',U&'\00A0\FEFF')); raise exception 'JS blank accepted'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
 begin perform loopmark_private.validate_command('{}'); raise exception 'Empty command accepted'; exception when raise_exception then if sqlerrm<>'VALIDATION' then raise; end if; end;
end $$;
rollback;
