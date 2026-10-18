-- Local drill expiry must not race a paused live owner. Unknown legacy owners fail closed.
alter table loopmark_private.restore_drills add column owner_pid integer not null default 0 check(owner_pid>=0);
