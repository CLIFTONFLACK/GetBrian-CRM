insert into public.disposal_agents (agency_id, disposal_id, user_id)
  select d.agency_id, d.id, m.user_id
    from public.disposals d
    join public.agency_members m on m.agency_id = d.agency_id
   where d.agency_id = (select id from public.agencies where name = 'CDG demo' limit 1)
     and m.user_id is distinct from d.lead_agent_id
     and random() < 0.22
  on conflict do nothing;
