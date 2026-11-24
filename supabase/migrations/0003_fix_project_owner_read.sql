-- Fix: creating a project failed with "new row violates row-level security policy for table projects".
-- Apply after 0002: Supabase dashboard → SQL Editor → paste this file → Run.
--
-- Why: the app inserts a project and reads it back in one statement (INSERT ... RETURNING). The read
-- is checked by the SELECT policy, which called is_project_member(). The owner's membership row is
-- added by an AFTER INSERT trigger in that same statement, and a STABLE function doesn't see rows
-- written during its own statement, so the check failed. The owner is on the row itself, so check
-- that first; members still get access through is_project_member().

drop policy "members read projects" on public.projects;
create policy "members read projects" on public.projects
  for select using (owner_id = auth.uid() or public.is_project_member(id));
