-- Clasificación de servicios para agrupar el catálogo de Luni Cliente.
-- Se puede ejecutar más de una vez. Los registros antiguos se clasifican usando
-- nombre y descripción; las categorías podrán ajustarse desde Luni Manicurista.

alter table public.services
  add column if not exists category text not null default 'Otros';

update public.services
set category = case
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%pedicura%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%pedicure%'
    then 'Pedicura'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%relleno%'
    then 'Rellenos'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%retirada%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%retiro%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%quitar%'
    then 'Retirada'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%uñas naturales%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%unas naturales%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%rubber base natural%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%semipermanente%'
    then 'Uñas naturales'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%diseño%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%diseno%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%decoración%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%decoracion%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%encapsulad%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%ojo de gato%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%aurora%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%efecto espejo%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%azúcar%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%azucar%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%baby boomer%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%difuminad%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%cromad%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%joyería%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%joyeria%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%piedras%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%calcomanía%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%calcomania%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%relieve%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%francesa%'
    then 'Diseños y decoración'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%uñas nuevas%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%unas nuevas%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%acrílic%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%acrilic%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%acripie%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%tips%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%extensión%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%extension%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%cover%'
    then 'Extensiones'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%hidrat%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%tratamiento%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%parafina%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%cutícula%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%cuticula%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%reparación%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%reparacion%'
    or lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%fortalecimiento%'
    then 'Tratamientos'
  when lower(coalesce(name, '') || ' ' || coalesce(description, '')) like '%manicura%'
    then 'Manicura'
  else 'Otros'
end
where category is null or category = 'Otros';

create index if not exists services_provider_category_active_idx
  on public.services (provider_id, category, name)
  where is_active = true and deleted_at is null;

comment on column public.services.category is
  'Tipo de servicio usado para ordenar y filtrar el catálogo de Luni.';
