delete from public.disposals where agency_id = (select id from public.agencies where name = 'CDG demo' limit 1);
