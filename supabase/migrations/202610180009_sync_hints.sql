-- One coalesced hint per owner; clients still read the authoritative bounded feed.
create table public.loopmark_sync_hints (
 owner_id uuid primary key references loopmark_private.accounts(id),
 collection_id text not null, epoch text not null, revision text not null, nonce uuid not null default gen_random_uuid()
);
alter table public.loopmark_sync_hints enable row level security;
revoke all on public.loopmark_sync_hints from public,anon,authenticated,service_role;
grant select on public.loopmark_sync_hints to authenticated;
create policy own_active_sync_hint on public.loopmark_sync_hints for select to authenticated using(owner_id=loopmark_private.active_owner());
create function loopmark_private.emit_sync_hint() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.loopmark_sync_hints(owner_id,collection_id,epoch,revision) values(new.owner_id,new.id,new.epoch,new.revision::text)
 on conflict(owner_id) do update set collection_id=excluded.collection_id,epoch=excluded.epoch,revision=excluded.revision,nonce=gen_random_uuid();
 return new;
end $$;
revoke all on function loopmark_private.emit_sync_hint() from public,anon,authenticated,service_role;
create trigger collection_sync_hint after insert or update of revision,epoch on loopmark_private.collections for each row execute function loopmark_private.emit_sync_hint();
insert into public.loopmark_sync_hints(owner_id,collection_id,epoch,revision) select owner_id,id,epoch,revision::text from loopmark_private.collections on conflict do nothing;
alter publication supabase_realtime add table public.loopmark_sync_hints;
-- Do not delete hint rows during erasure: DELETE events do not enforce row filters
-- in Postgres Changes. The active-account policy denies the retained opaque row.
