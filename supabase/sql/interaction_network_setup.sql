-- Interaction Network: Supabase bootstrap script
-- Paste this file into Supabase SQL Editor and run once per project.

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper: approver checks for signup request moderation.
-- Add one row per approver email in public.approver_emails.
-- ----------------------------------------------------------------------------
create table if not exists public.approver_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.is_approver()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.approver_emails a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ----------------------------------------------------------------------------
-- Core graph tables
-- ----------------------------------------------------------------------------
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#3b82f6',
  created_at timestamptz not null default now()
);

create unique index if not exists nodes_user_id_name_lower_uidx
  on public.nodes (user_id, lower(name));

create index if not exists nodes_user_id_idx
  on public.nodes (user_id);

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source uuid not null references public.nodes (id) on delete cascade,
  target uuid not null references public.nodes (id) on delete cascade,
  type text not null default 'friends',
  color text not null default '#22c55e',
  created_at timestamptz not null default now(),
  constraint links_no_self_ref check (source <> target)
);

create unique index if not exists links_unique_pair_type_uidx
  on public.links (user_id, least(source, target), greatest(source, target), lower(type));

create index if not exists links_user_id_idx
  on public.links (user_id);

create index if not exists links_source_idx
  on public.links (source);

create index if not exists links_target_idx
  on public.links (target);

-- ----------------------------------------------------------------------------
-- Groups
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#2563eb',
  created_at timestamptz not null default now()
);

create unique index if not exists groups_user_id_name_lower_idx
  on public.groups (user_id, lower(name));

create index if not exists groups_user_id_idx
  on public.groups (user_id);

create table if not exists public.group_memberships (
  node_id uuid not null references public.nodes (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (node_id, group_id)
);

create index if not exists group_memberships_user_id_idx
  on public.group_memberships (user_id);

create index if not exists group_memberships_node_id_idx
  on public.group_memberships (node_id);

create index if not exists group_memberships_group_id_idx
  on public.group_memberships (group_id);

-- ----------------------------------------------------------------------------
-- Events
-- ----------------------------------------------------------------------------
create table if not exists public.planned_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  attendees jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists planned_events_user_id_created_at_idx
  on public.planned_events (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Account request workflow
-- ----------------------------------------------------------------------------
create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  status text not null default 'pending',
  approved_at timestamptz,
  approved_by text,
  denied_at timestamptz,
  denied_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signup_requests_status_chk check (status in ('pending', 'approved', 'denied'))
);

create unique index if not exists signup_requests_pending_email_uidx
  on public.signup_requests (lower(email))
  where status = 'pending';

create index if not exists signup_requests_status_idx
  on public.signup_requests (status);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.approver_emails enable row level security;
alter table public.nodes enable row level security;
alter table public.links enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.planned_events enable row level security;
alter table public.signup_requests enable row level security;

drop policy if exists "approver_emails_select_approver" on public.approver_emails;
create policy "approver_emails_select_approver"
  on public.approver_emails
  for select
  using (public.is_approver());

drop policy if exists "nodes_select_own" on public.nodes;
create policy "nodes_select_own"
  on public.nodes
  for select
  using (auth.uid() = user_id);

drop policy if exists "nodes_insert_own" on public.nodes;
create policy "nodes_insert_own"
  on public.nodes
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "nodes_update_own" on public.nodes;
create policy "nodes_update_own"
  on public.nodes
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "nodes_delete_own" on public.nodes;
create policy "nodes_delete_own"
  on public.nodes
  for delete
  using (auth.uid() = user_id);

drop policy if exists "links_select_own" on public.links;
create policy "links_select_own"
  on public.links
  for select
  using (auth.uid() = user_id);

drop policy if exists "links_insert_own" on public.links;
create policy "links_insert_own"
  on public.links
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.nodes n
      where n.id = source
        and n.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.nodes n
      where n.id = target
        and n.user_id = auth.uid()
    )
  );

drop policy if exists "links_update_own" on public.links;
create policy "links_update_own"
  on public.links
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.nodes n
      where n.id = source
        and n.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.nodes n
      where n.id = target
        and n.user_id = auth.uid()
    )
  );

drop policy if exists "links_delete_own" on public.links;
create policy "links_delete_own"
  on public.links
  for delete
  using (auth.uid() = user_id);

drop policy if exists "groups_select_own" on public.groups;
create policy "groups_select_own"
  on public.groups
  for select
  using (auth.uid() = user_id);

drop policy if exists "groups_insert_own" on public.groups;
create policy "groups_insert_own"
  on public.groups
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "groups_update_own" on public.groups;
create policy "groups_update_own"
  on public.groups
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "groups_delete_own" on public.groups;
create policy "groups_delete_own"
  on public.groups
  for delete
  using (auth.uid() = user_id);

drop policy if exists "group_memberships_select_own" on public.group_memberships;
create policy "group_memberships_select_own"
  on public.group_memberships
  for select
  using (auth.uid() = user_id);

drop policy if exists "group_memberships_insert_own" on public.group_memberships;
create policy "group_memberships_insert_own"
  on public.group_memberships
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.groups g
      where g.id = group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists "group_memberships_update_own" on public.group_memberships;
create policy "group_memberships_update_own"
  on public.group_memberships
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.groups g
      where g.id = group_id
        and g.user_id = auth.uid()
    )
  );

drop policy if exists "group_memberships_delete_own" on public.group_memberships;
create policy "group_memberships_delete_own"
  on public.group_memberships
  for delete
  using (auth.uid() = user_id);

drop policy if exists "planned_events_select_own" on public.planned_events;
create policy "planned_events_select_own"
  on public.planned_events
  for select
  using (auth.uid() = user_id);

drop policy if exists "planned_events_insert_own" on public.planned_events;
create policy "planned_events_insert_own"
  on public.planned_events
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "planned_events_update_own" on public.planned_events;
create policy "planned_events_update_own"
  on public.planned_events
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "planned_events_delete_own" on public.planned_events;
create policy "planned_events_delete_own"
  on public.planned_events
  for delete
  using (auth.uid() = user_id);

drop policy if exists "signup_requests_insert_any" on public.signup_requests;
create policy "signup_requests_insert_any"
  on public.signup_requests
  for insert
  with check (true);

drop policy if exists "signup_requests_select_approver" on public.signup_requests;
create policy "signup_requests_select_approver"
  on public.signup_requests
  for select
  using (public.is_approver());

drop policy if exists "signup_requests_update_approver" on public.signup_requests;
create policy "signup_requests_update_approver"
  on public.signup_requests
  for update
  using (public.is_approver())
  with check (public.is_approver());

drop policy if exists "signup_requests_delete_approver" on public.signup_requests;
create policy "signup_requests_delete_approver"
  on public.signup_requests
  for delete
  using (public.is_approver());

-- ----------------------------------------------------------------------------
-- Seed approver list (edit email before running in production).
-- ----------------------------------------------------------------------------
insert into public.approver_emails (email)
values ('replace-with-your-approver@example.com')
on conflict (email) do nothing;
