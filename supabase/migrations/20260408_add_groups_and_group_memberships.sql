create extension if not exists pgcrypto;

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

alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;

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
    and exists (
      select 1
      from public.nodes n
      where n.id = node_id
        and n.user_id = auth.uid()
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
    and exists (
      select 1
      from public.nodes n
      where n.id = node_id
        and n.user_id = auth.uid()
    )
  );

drop policy if exists "group_memberships_delete_own" on public.group_memberships;
create policy "group_memberships_delete_own"
  on public.group_memberships
  for delete
  using (auth.uid() = user_id);