-- Favorites belong to the signed-in dashboard user; the vault remains read-only.
create table public.dashboard_obsidian_favorites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null check (char_length(path) between 4 and 500 and path like '%.md'
    and path not like 'Haven/%' and path not like '.%'),
  created_at timestamptz not null default now(),
  primary key (user_id, path)
);

alter table public.dashboard_obsidian_favorites enable row level security;
revoke all on public.dashboard_obsidian_favorites from anon;
grant select, insert, delete on public.dashboard_obsidian_favorites to authenticated;

create policy dashboard_obsidian_favorites_owner_select on public.dashboard_obsidian_favorites
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_obsidian_favorites_owner_insert on public.dashboard_obsidian_favorites
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_obsidian_favorites_owner_delete on public.dashboard_obsidian_favorites
  for delete to authenticated using ((select auth.uid()) = user_id);
