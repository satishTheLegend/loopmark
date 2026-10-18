create extension if not exists pg_jsonschema with schema extensions;
create function loopmark_private.command_schema() returns json language sql immutable set search_path='' as $schema$ select $json${"$schema":"https://json-schema.org/draft/2020-12/schema","oneOf":[{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"project.create"},"payload":{"type":"object","properties":{"project":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":100},"craft":{"type":"string","enum":["Crochet","Knitting","Other"]},"color":{"type":"string","enum":["clay","sage","lavender","ochre"]},"yarn":{"type":"string","maxLength":200},"toolSize":{"type":"string","maxLength":80},"notes":{"type":"string","maxLength":2000},"id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"code":{"type":"string","pattern":"^[A-Z0-9][A-Z0-9-]{2,23}$"},"status":{"type":"string","enum":["active","finished"]},"createdAt":{"type":"string"},"updatedAt":{"type":"string"}},"required":["name","craft","color","yarn","toolSize","notes","id","code","status","createdAt","updatedAt"],"additionalProperties":false}},"required":["project"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"project.update"},"payload":{"type":"object","properties":{"projectId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"fields":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":100},"craft":{"type":"string","enum":["Crochet","Knitting","Other"]},"color":{"type":"string","enum":["clay","sage","lavender","ochre"]},"yarn":{"type":"string","maxLength":200},"toolSize":{"type":"string","maxLength":80},"notes":{"type":"string","maxLength":2000}},"required":["name","craft","color","yarn","toolSize","notes"],"additionalProperties":false},"updatedAt":{"type":"string"}},"required":["projectId","fields","updatedAt"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"project.status"},"payload":{"type":"object","properties":{"projectId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"status":{"type":"string","enum":["active","finished"]},"updatedAt":{"type":"string"}},"required":["projectId","status","updatedAt"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"project.delete"},"payload":{"type":"object","properties":{"projectId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["projectId"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"checkpoint.create"},"payload":{"type":"object","properties":{"checkpoint":{"type":"object","properties":{"id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"projectId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"createdAt":{"type":"string"},"position":{"type":"string","maxLength":100},"toolSize":{"type":"string","maxLength":80},"nextStep":{"type":"string","minLength":1,"maxLength":1000},"notes":{"type":"string","maxLength":2000},"photo":{"type":"object","properties":{"id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"kind":{"type":"string","enum":["photo","voice"]},"mimeType":{"type":"string","maxLength":100},"bytes":{"type":"integer","exclusiveMinimum":0,"maximum":8388608},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["id","kind","mimeType","bytes","sha256"],"additionalProperties":false},"voice":{"type":"object","properties":{"id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"kind":{"type":"string","enum":["photo","voice"]},"mimeType":{"type":"string","maxLength":100},"bytes":{"type":"integer","exclusiveMinimum":0,"maximum":8388608},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["id","kind","mimeType","bytes","sha256"],"additionalProperties":false}},"required":["id","projectId","createdAt","position","toolSize","nextStep","notes"],"additionalProperties":false},"updatedAt":{"type":"string"}},"required":["checkpoint","updatedAt"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"media.attach"},"payload":{"type":"object","properties":{"projectId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"checkpointId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"reservationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"media":{"type":"object","properties":{"id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"kind":{"type":"string","enum":["photo","voice"]},"mimeType":{"type":"string","maxLength":100},"bytes":{"type":"integer","exclusiveMinimum":0,"maximum":8388608},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["id","kind","mimeType","bytes","sha256"],"additionalProperties":false}},"required":["projectId","checkpointId","reservationId","media"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false},{"type":"object","properties":{"protocolVersion":{"type":"number","const":2},"payloadVersion":{"type":"number","const":1},"collectionId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"epoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"deviceGeneration":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"sequence":{"type":"string"},"operationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"base":{"anyOf":[{"anyOf":[{"type":"object","properties":{"revision":{"type":"string"}},"required":["revision"],"additionalProperties":false},{"type":"object","properties":{"afterOperationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["afterOperationId"],"additionalProperties":false}]},{"type":"null"}]},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"kind":{"type":"string","const":"collection.replace"},"payload":{"type":"object","properties":{"reservationId":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"},"candidateSha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"nextEpoch":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"}},"required":["reservationId","candidateSha256","nextEpoch"],"additionalProperties":false}},"required":["protocolVersion","payloadVersion","collectionId","epoch","deviceId","deviceGeneration","sequence","operationId","base","sha256","kind","payload"],"additionalProperties":false}]}$json$::json $schema$;
create function loopmark_private.js_length(value text) returns integer language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(value,'') c
$$;
create function loopmark_private.validate_strings(value jsonb) returns void language plpgsql set search_path='' as $$
declare k text; v jsonb; n integer; t text; checked_date text; begin
 if jsonb_typeof(value)='object' then
  for k,v in select * from jsonb_each(value) loop
   if jsonb_typeof(v)='string' then
    t:=v#>>'{}'; n:=case k when 'name' then 100 when 'yarn' then 200 when 'toolSize' then 80 when 'notes' then 2000 when 'position' then 100 when 'nextStep' then 1000 else null end;
    if n is not null and loopmark_private.js_length(t)>n then perform loopmark_private.fail('VALIDATION'); end if;
    if k in ('name','nextStep') and length(btrim(t,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))=0 then perform loopmark_private.fail('VALIDATION'); end if;
    if k in ('createdAt','updatedAt') then
     -- JavaScript permits ISO year zero. Year 2000 has the same leap calendar,
     -- so it validates month/day/time without PostgreSQL's lack of year zero.
     checked_date:=case when left(t,5)='0000-' then '2000-'||substr(t,6) else t end;
     if t!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' or checked_date::timestamptz>now()+interval '36600 days' or to_char(checked_date::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>checked_date then perform loopmark_private.fail('VALIDATION'); end if;
    end if;
   end if;
   perform loopmark_private.validate_strings(v);
  end loop;
 elsif jsonb_typeof(value)='array' then for v in select * from jsonb_array_elements(value) loop perform loopmark_private.validate_strings(v); end loop; end if;
end $$;
create function loopmark_private.validate_command(cmd jsonb) returns void language plpgsql set search_path='' as $$
declare ref jsonb; k text; base jsonb:=cmd->'base'; begin
 if octet_length(loopmark_private.canonical(cmd))>262144 or not extensions.jsonb_matches_schema(loopmark_private.command_schema(),cmd) then perform loopmark_private.fail('VALIDATION'); end if;
 if (cmd->>'sequence')!~'^[1-9][0-9]{0,18}$' or (cmd->>'sequence')::numeric>9223372036854775807 then perform loopmark_private.fail('VALIDATION'); end if;
 if base?'revision' and ((base->>'revision')!~'^(0|[1-9][0-9]{0,18})$' or (base->>'revision')::numeric>9223372036854775807) then perform loopmark_private.fail('VALIDATION'); end if;
 if ((cmd->>'kind'='project.create')<>(base='null'::jsonb)) or base->>'afterOperationId'=cmd->>'operationId' then perform loopmark_private.fail('VALIDATION'); end if;
 if cmd->>'kind'='collection.replace' and (not(base?'revision') or cmd#>>'{payload,nextEpoch}'=cmd->>'epoch') then perform loopmark_private.fail('VALIDATION'); end if;
 perform loopmark_private.validate_strings(cmd);
 for k,ref in select key,value from jsonb_each(coalesce(cmd#>'{payload,checkpoint}','{}')) where key in ('photo','voice') union all select 'media',cmd#>'{payload,media}' where cmd->>'kind'='media.attach' loop
  if ref->>'mimeType'!~U&'^(image/(jpeg|png|webp)|audio/(webm|mp4|ogg|wav|x-wav))(;[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]*codecs=[A-Za-z0-9_., "-]+)?$' or
   (ref->>'kind'='photo' and ((ref->>'bytes')::bigint>4194304 or ref->>'mimeType' not like 'image/%')) or
   (ref->>'kind'='voice' and ref->>'mimeType' not like 'audio/%') or (k in ('photo','voice') and ref->>'kind'<>k) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
 end loop;
 if encode(extensions.digest(convert_to(loopmark_private.canonical(cmd-'sha256'),'UTF8'),'sha256'),'hex')<>cmd->>'sha256' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then perform loopmark_private.fail('VALIDATION');
end $$;
create function loopmark_private.portable_size(p_owner uuid,p_collection text) returns bigint language plpgsql stable set search_path='' as $$
declare p record; c record; ref jsonb; cp jsonb; cps jsonb; total bigint:=0; extra bigint; begin
 for p in select data from loopmark_private.projects where owner_id=p_owner and collection_id=p_collection and deleted_at is null order by id loop
  cps:='[]'; extra:=0;
  for c in select data from loopmark_private.checkpoints where owner_id=p_owner and collection_id=p_collection and project_id=p.data->>'id' and deleted_at is null order by id loop
   cp:=c.data-'projectId'-'revision'-'photo'-'voice';
   for ref in select value from jsonb_each(c.data) where key in ('photo','voice') loop
    cp:=cp||jsonb_build_object(ref->>'kind','');
    extra:=extra+4*ceil((ref->>'bytes')::numeric/3)::bigint+octet_length(to_jsonb('data:'||(ref->>'mimeType')||';base64,')::text)-2;
   end loop;
   cps:=cps||jsonb_build_array(cp);
  end loop;
  total:=total+octet_length(loopmark_private.canonical((p.data-'revision')||jsonb_build_object('checkpoints',cps)))+extra;
 end loop;
 return total;
end $$;
create function loopmark_private.lock_scope(p_collection text,p_epoch text,p_device text,p_generation text) returns loopmark_private.collections language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); a loopmark_private.accounts; c loopmark_private.collections; d loopmark_private.devices; begin
 if uid is null then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into a from loopmark_private.accounts where id=uid for update;
 if not found or a.state<>'active' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 select * into c from loopmark_private.collections where id=p_collection and owner_id=uid for update;
 if not found then perform loopmark_private.fail('NOT_AVAILABLE'); end if;
 if c.epoch<>p_epoch then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 select * into d from loopmark_private.devices where owner_id=uid and id=p_device for update;
 if not found or d.generation<>p_generation or d.retired_at is not null or d.last_seen<now()-interval '90 days' then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 update loopmark_private.devices set last_seen=now() where owner_id=uid and id=p_device;
 return c;
end $$;
create function loopmark_private.push_effect(cmd jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c loopmark_private.collections; d loopmark_private.devices; old loopmark_private.operation_receipts;
 p loopmark_private.projects; ck loopmark_private.checkpoints; prior jsonb; changes jsonb:='[]'; payload jsonb:=cmd->'payload';
 kind text:=cmd->>'kind'; target text; target_kind text; expected bigint; current_revision bigint; next_revision bigint; result_id text;
 result jsonb; value jsonb; ref jsonb; count_p integer; count_c integer; size_bytes bigint; valid_upgrade boolean;
begin
 perform loopmark_private.validate_command(cmd);
 c:=loopmark_private.lock_scope(cmd->>'collectionId',cmd->>'epoch',cmd->>'deviceId',cmd->>'deviceGeneration');
 select * into d from loopmark_private.devices where owner_id=uid and id=cmd->>'deviceId';
 if (cmd->>'sequence')::bigint<=d.sequence_floor then perform loopmark_private.fail('SYNC_REBASE_REQUIRED'); end if;
 select * into old from loopmark_private.operation_receipts where owner_id=uid and operation_id=cmd->>'operationId';
 if found then
  if old.sha256<>cmd->>'sha256' then perform loopmark_private.fail('OPERATION_REUSED'); end if;
  return old.receipt;
 end if;
 if exists(select 1 from loopmark_private.operation_receipts where owner_id=uid and device_id=d.id and device_generation=d.generation and sequence=(cmd->>'sequence')::bigint) then perform loopmark_private.fail('OPERATION_REUSED'); end if;

 if kind='collection.replace' or kind='media.attach' then perform loopmark_private.fail('CAPABILITY_UNAVAILABLE'); end if; -- implemented by I07, never silently accepted
 target:=case when kind='project.create' then payload#>>'{project,id}' when kind='checkpoint.create' then payload#>>'{checkpoint,projectId}' else payload->>'projectId' end;
 select * into p from loopmark_private.projects where owner_id=uid and collection_id=c.id and id=target for update;
 if kind='project.create' then
  if found or exists(select 1 from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and id=target) then perform loopmark_private.fail('REVISION_CONFLICT'); end if;
 else
  if not found or p.deleted_at is not null then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',null,'expected',cmd->'base')); end if;
  if cmd->'base'?'afterOperationId' then
   select receipt into prior from loopmark_private.operation_receipts where owner_id=uid and collection_id=c.id and epoch=c.epoch and device_id=d.id and device_generation=d.generation and operation_id=cmd#>>'{base,afterOperationId}';
   select (change#>>'{value,revision}')::bigint into expected from jsonb_array_elements(prior->'changes') change where change->>'kind'='project.put' and change#>>'{value,id}'=target;
   if expected is null then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',p.data||jsonb_build_object('revision',p.revision::text),'expected',cmd->'base')); end if;
  else expected:=(cmd#>>'{base,revision}')::bigint; end if;
  if expected<>p.revision then perform loopmark_private.fail('REVISION_CONFLICT',jsonb_build_object('operationId',cmd->>'operationId','current',p.data||jsonb_build_object('revision',p.revision::text),'expected',cmd->'base')); end if;
 end if;
 select coalesce(upgraded,false) into valid_upgrade from loopmark_private.entitlement_projection where account_id=uid;
 if not coalesce(valid_upgrade,false) and (kind='project.create' and payload#>>'{project,status}'='active' or kind='project.status' and payload->>'status'='active' and p.data->>'status'<>'active') and
  (select count(*) from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null and data->>'status'='active')>=3 then perform loopmark_private.fail('UPGRADE_REQUIRED'); end if;
 -- No independent sequence: row lock and transactional increment serialize visibility.
 next_revision:=c.next_cursor+1;
 if kind='project.create' then
  value:=payload->'project'; result_id:=value->>'id';
  insert into loopmark_private.projects(owner_id,collection_id,id,code,revision,data) values(uid,c.id,result_id,value->>'code',next_revision,value);
  changes:=jsonb_build_array(jsonb_build_object('kind','project.put','value',value||jsonb_build_object('revision',next_revision::text)));
 elsif kind='project.update' or kind='project.status' then
  value:=p.data||case when kind='project.update' then payload->'fields' else jsonb_build_object('status',payload->>'status') end||jsonb_build_object('updatedAt',payload->>'updatedAt'); result_id:=p.id;
  update loopmark_private.projects set data=value,revision=next_revision where owner_id=uid and collection_id=c.id and id=p.id;
  changes:=jsonb_build_array(jsonb_build_object('kind','project.put','value',value||jsonb_build_object('revision',next_revision::text)));
 elsif kind='checkpoint.create' then
  value:=payload->'checkpoint'; result_id:=value->>'id';
  if exists(select 1 from loopmark_private.projects where owner_id=uid and collection_id=c.id and id=result_id) then perform loopmark_private.fail('REVISION_CONFLICT'); end if;
  insert into loopmark_private.checkpoints(owner_id,collection_id,id,project_id,revision,data) values(uid,c.id,result_id,p.id,next_revision,value);
  for ref in select refs.ref from jsonb_each(value) as refs(key,ref) where refs.key in ('photo','voice') loop
   insert into loopmark_private.media(owner_id,collection_id,id,epoch,sha256,bytes,kind,mime_type) values(uid,c.id,ref->>'id',c.epoch,ref->>'sha256',(ref->>'bytes')::bigint,ref->>'kind',ref->>'mimeType') on conflict do nothing;
   if not exists(select 1 from loopmark_private.media m where m.owner_id=uid and m.collection_id=c.id and m.id=ref->>'id' and m.sha256=ref->>'sha256' and m.bytes=(ref->>'bytes')::bigint and m.kind=ref->>'kind' and m.mime_type=ref->>'mimeType' and m.epoch=c.epoch) then perform loopmark_private.fail('MEDIA_INVALID'); end if;
  end loop;
  changes:=jsonb_build_array(jsonb_build_object('kind','checkpoint.put','value',value||jsonb_build_object('revision',next_revision::text)));
  value:=p.data||jsonb_build_object('updatedAt',payload->>'updatedAt');
  update loopmark_private.projects set data=value,revision=next_revision where owner_id=uid and collection_id=c.id and id=p.id;
  changes:=changes||jsonb_build_array(jsonb_build_object('kind','project.put','value',value||jsonb_build_object('revision',next_revision::text)));
 elsif kind='project.delete' then
  result_id:=p.id;
  update loopmark_private.projects set revision=next_revision,deleted_at=now() where owner_id=uid and collection_id=c.id and id=p.id;
  changes:=jsonb_build_array(jsonb_build_object('kind','project.delete','id',p.id,'revision',next_revision::text));
  for ck in select * from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and project_id=p.id and deleted_at is null order by id for update loop
   update loopmark_private.checkpoints set revision=next_revision,deleted_at=now() where owner_id=uid and collection_id=c.id and id=ck.id;
   changes:=changes||jsonb_build_array(jsonb_build_object('kind','checkpoint.delete','id',ck.id,'projectId',p.id,'revision',next_revision::text));
  end loop;
 else perform loopmark_private.fail('VALIDATION'); end if;
 select count(*) into count_p from loopmark_private.projects where owner_id=uid and collection_id=c.id and deleted_at is null;
 select count(*) into count_c from loopmark_private.checkpoints where owner_id=uid and collection_id=c.id and deleted_at is null;
 size_bytes:=loopmark_private.portable_size(uid,c.id);
 if count_p>200 or count_c>1000 or size_bytes>50331648 then perform loopmark_private.fail('TECHNICAL_CAPACITY_REACHED'); end if;
 update loopmark_private.collections set revision=next_revision,next_cursor=next_revision,project_count=count_p,checkpoint_count=count_c,portable_bytes=size_bytes where owner_id=uid and id=c.id;
 result:=jsonb_build_object('operationId',cmd->>'operationId','sha256',cmd->>'sha256','epoch',c.epoch,'revision',next_revision::text,'cursor',next_revision::text,'resultId',result_id,'changes',changes);
 insert into loopmark_private.operation_receipts(owner_id,collection_id,operation_id,device_id,device_generation,sequence,sha256,epoch,receipt) values(uid,c.id,cmd->>'operationId',d.id,d.generation,(cmd->>'sequence')::bigint,cmd->>'sha256',c.epoch,result);
 insert into loopmark_private.change_feed(owner_id,collection_id,cursor,epoch,receipt) values(uid,c.id,next_revision,c.epoch,result);
 update loopmark_private.devices set max_sequence=greatest(max_sequence,(cmd->>'sequence')::bigint) where owner_id=uid and id=d.id;
 return result;
exception when unique_violation then perform loopmark_private.fail('REVISION_CONFLICT');
end $$;
-- The outer transaction commits request admission even when the effect subtransaction rejects.
create function public.loopmark_push(cmd jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); message text; detail text; begin
 if uid is null then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform 1 from loopmark_private.accounts where id=uid and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(uid,'command',20,1);
 begin return loopmark_private.push_effect(cmd);
 exception when others then
  get stacked diagnostics message=message_text,detail=pg_exception_detail;
  if sqlstate='P0001' then return jsonb_build_object('failure',jsonb_build_object('code',message,'detail',detail)); end if;
  return jsonb_build_object('failure',jsonb_build_object('code','SERVICE_UNAVAILABLE'));
 end;
end $$;
revoke all on all functions in schema loopmark_private from public,anon,authenticated,service_role;
grant execute on function loopmark_private.active_owner() to authenticated;
revoke all on function public.loopmark_push(jsonb) from public,anon,service_role;
grant execute on function public.loopmark_push(jsonb) to authenticated;
