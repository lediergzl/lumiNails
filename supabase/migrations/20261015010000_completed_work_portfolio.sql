-- LuniNails: portafolio público de trabajos terminados.
-- Las fotos se guardan en Supabase Storage (bucket service-images); aquí solo se guardan sus rutas.
begin;

create table if not exists public.provider_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  category text not null default 'Diseños',
  image_paths text[] not null default '{}',
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint provider_portfolio_title_length check (char_length(title) <= 120),
  constraint provider_portfolio_description_length check (char_length(description) <= 1000),
  constraint provider_portfolio_category_length check (char_length(category) between 1 and 60),
  constraint provider_portfolio_photos_count check (cardinality(image_paths) between 0 and 6)
);

create index if not exists provider_portfolio_public_idx
  on public.provider_portfolio_items(provider_id, is_published, created_at desc)
  where deleted_at is null;

alter table public.provider_portfolio_items enable row level security;

drop policy if exists "provider manages own portfolio" on public.provider_portfolio_items;
create policy "provider manages own portfolio"
  on public.provider_portfolio_items for all to authenticated
  using (public.luni_is_provider_owner(provider_id))
  with check (public.luni_is_provider_owner(provider_id));

-- El catálogo público se expone mediante esta función limitada; no se abre el acceso
-- anónimo a las tablas privadas de perfiles, clientas, servicios o citas.
create or replace function public.luni_public_portfolio()
returns table (
  item_id uuid,
  provider_id uuid,
  business_name text,
  provider_slug text,
  provider_bio text,
  title text,
  description text,
  category text,
  image_paths text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select i.id, p.id, p.business_name, p.slug, p.bio,
         i.title, i.description, i.category, i.image_paths, i.created_at
  from public.provider_portfolio_items i
  join public.provider_profiles p on p.id = i.provider_id
  where i.is_published
    and i.deleted_at is null
    and p.is_published
    and p.deleted_at is null
  order by i.created_at desc
  limit 300;
$fn$;

revoke all on function public.luni_public_portfolio() from public;
grant execute on function public.luni_public_portfolio() to anon, authenticated;

commit;
