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