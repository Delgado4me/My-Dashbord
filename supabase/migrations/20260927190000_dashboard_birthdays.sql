-- Personal annual dates. Keep names and imported CSV outside source control.
create table public.dashboard_birthdays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  birth_month smallint not null check (birth_month between 1 and 12),
  birth_day smallint not null check (birth_day between 1 and 31),
  birth_year smallint check (birth_year between 1800 and 2100),
  relationship text not null default '' check (char_length(relationship) <= 60),
  note text not null default '' check (char_length(note) <= 1000),
  remind_days smallint not null default 2 check (remind_days in (0,1,2,7)),
  enabled boolean not null default true,
  import_key text check (char_length(import_key) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_birthdays_valid_date check (
    birth_day <= extract(day from (make_date(2000, birth_month, 1) + interval '1 month - 1 day'))
    and (birth_year is null or birth_month <> 2 or birth_day <> 29 or
      (birth_year % 4 = 0 and (birth_year % 100 <> 0 or birth_year % 400 = 0)))
  )
);

create index dashboard_birthdays_user_date on public.dashboard_birthdays (user_id,birth_month,birth_day);
create unique index dashboard_birthdays_import_unique on public.dashboard_birthdays (user_id,import_key) where import_key is not null;
alter table public.dashboard_birthdays enable row level security;
revoke all on public.dashboard_birthdays from anon;
grant select,insert,update,delete on public.dashboard_birthdays to authenticated;
create policy dashboard_birthdays_select on public.dashboard_birthdays for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_birthdays_insert on public.dashboard_birthdays for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_birthdays_update on public.dashboard_birthdays for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy dashboard_birthdays_delete on public.dashboard_birthdays for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.dashboard_reminders drop constraint dashboard_reminders_source_type_check;
alter table public.dashboard_reminders add constraint dashboard_reminders_source_type_check
  check (source_type in ('manual','mail','note','birthday'));

-- A birthday priority is always a deliberate user action.
alter table public.dashboard_daily_tasks drop constraint dashboard_daily_tasks_source_type_check;
alter table public.dashboard_daily_tasks add constraint dashboard_daily_tasks_source_type_check
  check (source_type in ('mail','event','note','reminder','obsidian','birthday'));
