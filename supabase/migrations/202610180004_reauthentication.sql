create table loopmark_private.reauthentication_challenges (
 id text primary key, owner_id uuid not null references loopmark_private.accounts(id), proof_hash text not null,
 expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
alter table loopmark_private.reauthentication_challenges enable row level security;
revoke all on loopmark_private.reauthentication_challenges from public,anon,authenticated,service_role;
create function public.loopmark_issue_reauthentication(p_owner uuid,p_challenge text,p_hash text) returns text language plpgsql security definer set search_path='' as $$
declare expiry timestamptz:=now()+interval '5 minutes'; begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or not loopmark_private.valid_id(p_challenge) or p_hash!~'^[a-f0-9]{64}$' then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform 1 from loopmark_private.accounts where id=p_owner and state='active' for update;
 if not found then perform loopmark_private.fail('AUTH_REQUIRED'); end if;
 perform loopmark_private.rate_limit(p_owner,'reauthentication',5,0.0166667);
 update loopmark_private.reauthentication_challenges set used_at=now() where owner_id=p_owner and used_at is null;
 insert into loopmark_private.reauthentication_challenges(id,owner_id,proof_hash,expires_at) values(p_challenge,p_owner,p_hash,expiry);
 return to_char(expiry at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
end $$;
create function loopmark_private.consume_reauthentication(p_owner uuid,p_challenge text,p_proof text) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Called inside the account-locked deletion/recovery transaction, never directly by clients.
 update loopmark_private.reauthentication_challenges set used_at=now() where id=p_challenge and owner_id=p_owner and used_at is null and expires_at>now()
  and proof_hash=encode(extensions.digest(convert_to(p_proof,'UTF8'),'sha256'),'hex');
 if not found then perform loopmark_private.fail('REAUTH_REQUIRED'); end if;
end $$;
revoke all on function public.loopmark_issue_reauthentication(uuid,text,text),loopmark_private.consume_reauthentication(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.loopmark_issue_reauthentication(uuid,text,text) to service_role;
