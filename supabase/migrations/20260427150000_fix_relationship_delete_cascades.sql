-- Repair legacy relationship-table foreign keys so node deletes cascade.
-- This is safe to run on projects that only have links, as well as older
-- projects that still use connections or edges.

do $$
declare
  relation_table text;
  has_source boolean;
  has_target boolean;
begin
  foreach relation_table in array array['links', 'connections', 'edges'] loop
    if to_regclass('public.' || relation_table) is null then
      continue;
    end if;

    select exists (
             select 1
             from information_schema.columns
             where table_schema = 'public'
               and table_name = relation_table
               and column_name = 'source'
           ),
           exists (
             select 1
             from information_schema.columns
             where table_schema = 'public'
               and table_name = relation_table
               and column_name = 'target'
           )
      into has_source, has_target;

    if not has_source or not has_target then
      continue;
    end if;

    execute format('alter table public.%I drop constraint if exists %I_source_fkey', relation_table, relation_table);
    execute format('alter table public.%I drop constraint if exists %I_target_fkey', relation_table, relation_table);
    execute format(
      'alter table public.%I add constraint %I_source_fkey foreign key (source) references public.nodes (id) on delete cascade',
      relation_table,
      relation_table
    );
    execute format(
      'alter table public.%I add constraint %I_target_fkey foreign key (target) references public.nodes (id) on delete cascade',
      relation_table,
      relation_table
    );
  end loop;
end $$;