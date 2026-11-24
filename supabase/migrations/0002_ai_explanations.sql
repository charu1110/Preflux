-- AI explanations of pushes (Objective 3: an LLM gives plain-English explanations).
-- Apply after 0001_preflux.sql: Supabase dashboard → SQL Editor → paste this file → Run.
--
-- Each push is explained at most once and the text is stored, so reopening a push page costs nothing.
-- The API key never touches the database: the dashboard server calls the LLM, then saves only the text.

alter table public.push_events
  add column ai_explanation text check (ai_explanation is null or char_length(ai_explanation) <= 4000),
  add column ai_model text,
  add column ai_created_at timestamptz;

-- Members can read push_events but not update them (rows only arrive through ingest_push()).
-- This function lets a project member store the explanation of one of their project's pushes, once.
create function public.save_push_explanation(p_push uuid, p_text text, p_model text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  proj uuid;
begin
  select project_id into proj from public.push_events where id = p_push;
  if proj is null or not public.is_project_member(proj) then
    raise exception 'not a member of this project';
  end if;
  update public.push_events
     set ai_explanation = left(p_text, 4000), ai_model = left(p_model, 60), ai_created_at = now()
   where id = p_push and ai_explanation is null;
  return found;
end;
$$;

revoke execute on function public.save_push_explanation(uuid, text, text) from public, anon;
grant execute on function public.save_push_explanation(uuid, text, text) to authenticated;
