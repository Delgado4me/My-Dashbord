-- Optional local wall-clock deadline for a dated reminder. Existing reminders keep NULL.
-- The timezone column already records the creator's IANA timezone.
alter table public.dashboard_reminders
  add column due_time time without time zone;

alter table public.dashboard_reminders
  add constraint dashboard_reminders_time_requires_date
  check (due_time is null or due_on is not null);
