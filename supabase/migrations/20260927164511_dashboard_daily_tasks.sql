-- Daily priorities and their single focus share one row per task.
create table public.dashboard_daily_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  timezone text not null check (char_length(timezone) between 1 and 64)
);

create table public.dashboard_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  position smallint not null check (position between 1 and 3),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  details text not null default '' check (char_length(details) <= 2000),
  is_complete boolean not null default false,
  completed_at timestamptz,
  is_focus boolean not null default false,
  source_type text check (source_type in ('mail', 'event', 'note', 'reminder', 'obsidian')),
  source_key text check (char_length(source_key) <= 500),
  source_label text check (char_length(source_label) <= 250),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_daily_tasks_completion check (is_complete = (completed_at is not null)),
  constraint dashboard_daily_tasks_source_pair check ((source_type is null) = (source_key is null))
);

create unique index dashboard_daily_tasks_slot on public.dashboard_daily_tasks (user_id, day, position);
create unique index dashboard_daily_tasks_focus on public.dashboard_daily_tasks (user_id, day) where is_focus;
create unique index dashboard_daily_tasks_source on public.dashboard_daily_tasks (user_id, day, source_type, source_key) where source_key is not null;

alter table public.dashboard_daily_settings enable row level security;
alter table public.dashboard_daily_tasks enable row level security;
revoke all on public.dashboard_daily_settings, public.dashboard_daily_tasks from anon, authenticated;
grant select, insert, update, delete on public.dashboard_daily_tasks to authenticated;
grant select, insert on public.dashboard_daily_settings to authenticated;

create policy dashboard_daily_settings_select on public.dashboard_daily_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_daily_settings_insert on public.dashboard_daily_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_daily_tasks_select on public.dashboard_daily_tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_daily_tasks_insert on public.dashboard_daily_tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_daily_tasks_update on public.dashboard_daily_tasks
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy dashboard_daily_tasks_delete on public.dashboard_daily_tasks
  for delete to authenticated using ((select auth.uid()) = user_id);
