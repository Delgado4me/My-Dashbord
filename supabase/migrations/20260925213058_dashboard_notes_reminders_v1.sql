-- Personal dashboard: one user's notes and reminders are isolated by Supabase Auth.
create table public.dashboard_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dashboard_notes_user_updated_idx
  on public.dashboard_notes (user_id, updated_at desc);

create table public.dashboard_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  due_on date,
  show_from date,
  timezone text not null default 'Europe/Istanbul' check (char_length(timezone) <= 64),
  source_type text not null default 'manual' check (source_type in ('manual', 'mail', 'note')),
  source_key text,
  source_label text check (char_length(source_label) <= 250),
  status text not null default 'active' check (status in ('active', 'completed', 'dismissed', 'needs_review')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_reminders_completion_consistency
    check ((status = 'completed') = (completed_at is not null))
);

create index dashboard_reminders_user_due_idx
  on public.dashboard_reminders (user_id, status, due_on);
create unique index dashboard_reminders_source_key_unique
  on public.dashboard_reminders (user_id, source_type, source_key)
  where source_key is not null;

alter table public.dashboard_notes enable row level security;
alter table public.dashboard_reminders enable row level security;

revoke all on public.dashboard_notes, public.dashboard_reminders from anon;
grant select, insert, update, delete on public.dashboard_notes, public.dashboard_reminders to authenticated;

create policy dashboard_notes_owner_select on public.dashboard_notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_notes_owner_insert on public.dashboard_notes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_notes_owner_update on public.dashboard_notes
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy dashboard_notes_owner_delete on public.dashboard_notes
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy dashboard_reminders_owner_select on public.dashboard_reminders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_reminders_owner_insert on public.dashboard_reminders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_reminders_owner_update on public.dashboard_reminders
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy dashboard_reminders_owner_delete on public.dashboard_reminders
  for delete to authenticated using ((select auth.uid()) = user_id);
