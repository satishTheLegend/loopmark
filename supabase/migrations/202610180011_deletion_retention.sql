-- Recovery points can be created after authorization while live purge is pending.
-- The published deadline starts at successful live removal, never preparation.
create function loopmark_private.deletion_retention_floor() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='live-data-removed' then
  if new.removed_at is null then perform loopmark_private.fail('VALIDATION'); end if;
  new.backup_expires_at:=greatest(coalesce(new.backup_expires_at,new.removed_at),new.removed_at+interval '7 days');
 end if;
 return new;
end $$;
revoke all on function loopmark_private.deletion_retention_floor() from public,anon,authenticated,service_role;
create trigger deletion_retention_floor before insert or update on loopmark_private.deletion_requests
 for each row execute function loopmark_private.deletion_retention_floor();
update loopmark_private.deletion_requests set backup_expires_at=greatest(coalesce(backup_expires_at,removed_at),removed_at+interval '7 days') where status='live-data-removed';
