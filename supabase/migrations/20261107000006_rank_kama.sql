-- קמ"א is an officer rank equal to סגן for every rank range, so two ranks may share
-- a sort_order. Reference data: add קמ"א at the level of סגן.

alter table ranks drop constraint if exists ranks_sort_order_key;

insert into ranks (name, short_name, sort_order, population_tags)
select 'קמ"א', 'קמ"א', r.sort_order, '{officer}' from ranks r where r.name = 'סגן'
on conflict (name) do nothing;
