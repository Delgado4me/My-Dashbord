-- OAuth credentials are server-only. No browser role can access these tables.
create table public.dashboard_google_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
create index dashboard_google_states_expiry_idx on public.dashboard_google_states (expires_at);

create table public.dashboard_google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  scopes text not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_google_states enable row level security;
alter table public.dashboard_google_connections enable row level security;
revoke all on public.dashboard_google_states, public.dashboard_google_connections from anon, authenticated;
-- No policies: only the trusted Edge Functions' secret key may access these rows.
