-- Preflux dashboard schema.
-- Apply once: Supabase dashboard → SQL Editor → paste this file → Run.
--
-- Security model:
--   * Row-level security on every table: you only see projects you're a member of.
--   * The CLI never gets database access. It sends results with a per-project token to the
--     ingest_push() function, which checks the token (stored only as a SHA-256 hash) and inserts.
--   * No service-role key is needed anywhere in the app.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  repo_url text check (repo_url is null or char_length(repo_url) <= 300),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.project_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text not null default 'default',
  token_hash text not null unique,      -- sha256 of the token; the token itself is shown once and never stored
  token_hint text not null,             -- last 4 characters, to recognise it in the list
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.push_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  branch text,
  head_sha text,
  author text,
  mode text,
  score int check (score between 0 and 100),
  decision text not null check (decision in ('allow', 'warn', 'block')),
  blocked_by text check (blocked_by in ('secrets', 'score')),
  forced boolean not null default false,
  bug_risk real,
  conflict_risk real,
  tool_version text,
  created_at timestamptz not null default now()
);
create index push_events_project_time on public.push_events (project_id, created_at desc);

create table public.findings (
  id bigint generated always as identity primary key,
  push_id uuid not null references public.push_events (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade, -- copied for RLS and per-project queries
  kind text not null check (kind in ('secret', 'bug_risk', 'conflict')),
  rule_id text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  file text not null,
  line int,
  message text not null,
  reasons text[],
  probability real,
  percentile real
);
create index findings_push on public.findings (push_id);
create index findings_project_kind on public.findings (project_id, kind);

-- ---------------------------------------------------------------- helpers

-- security definer so RLS policies can call it without recursing into project_members' own policy.
create function public.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid());
$$;

create function public.is_project_owner(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid());
$$;

-- The creator of a project is automatically its owner-member.
create function public.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger projects_owner_member after insert on public.projects
  for each row execute function public.add_owner_as_member();

-- ---------------------------------------------------------------- row-level security

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_tokens enable row level security;
alter table public.push_events enable row level security;
alter table public.findings enable row level security;

create policy "members read projects" on public.projects for select using (public.is_project_member(id));
create policy "users create own projects" on public.projects for insert with check (owner_id = auth.uid());
create policy "owners update projects" on public.projects for update using (owner_id = auth.uid());
create policy "owners delete projects" on public.projects for delete using (owner_id = auth.uid());

create policy "members read members" on public.project_members for select using (public.is_project_member(project_id));
create policy "owners remove members" on public.project_members for delete using (public.is_project_owner(project_id) and role <> 'owner');

create policy "owners read tokens" on public.project_tokens for select using (public.is_project_owner(project_id));
create policy "owners revoke tokens" on public.project_tokens for delete using (public.is_project_owner(project_id));

create policy "members read pushes" on public.push_events for select using (public.is_project_member(project_id));
create policy "members read findings" on public.findings for select using (public.is_project_member(project_id));
-- No insert policies on push_events/findings: rows only arrive through ingest_push().

-- ---------------------------------------------------------------- functions called by the app

-- Owner creates a token; the plain token is returned once and only its hash is kept.
create function public.create_project_token(p_project uuid, p_label text default 'default') returns text
language plpgsql security definer set search_path = '' as $$
declare
  t text;
begin
  if not public.is_project_owner(p_project) then
    raise exception 'only the project owner can create tokens';
  end if;
  t := 'pfx_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.project_tokens (project_id, label, token_hash, token_hint)
  values (p_project, left(coalesce(nullif(trim(p_label), ''), 'default'), 40), encode(extensions.digest(t, 'sha256'), 'hex'), right(t, 4));
  return t;
end;
$$;

-- Owner adds a teammate by the email they signed up with.
create function public.add_project_member(p_project uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member uuid;
begin
  if not public.is_project_owner(p_project) then
    raise exception 'only the project owner can add members';
  end if;
  select id into member from auth.users where lower(email) = lower(trim(p_email));
  if member is null then
    raise exception 'no Preflux account uses that email yet: ask them to sign up first';
  end if;
  insert into public.project_members (project_id, user_id) values (p_project, member) on conflict do nothing;
end;
$$;

-- Members of a project (emails live in auth.users, which the app can't read directly).
create function public.list_project_members(p_project uuid) returns table (email text, role text, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_project_member(p_project) then
    raise exception 'not a member of this project';
  end if;
  return query
    select u.email::text, m.role, m.added_at
    from public.project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p_project
    order by m.role desc, m.added_at;
end;
$$;

-- The CLI's upload. Checks the token, then stores one push and its findings (bounded sizes).
create function public.ingest_push(p_token text, p_push jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  proj uuid;
  push uuid;
  hashed text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  f jsonb;
  n int := 0;
begin
  select project_id into proj from public.project_tokens where token_hash = hashed;
  if proj is null then
    raise exception 'invalid project token' using errcode = '28000';
  end if;
  update public.project_tokens set last_used_at = now() where token_hash = hashed;

  insert into public.push_events (project_id, branch, head_sha, author, mode, score, decision, blocked_by, forced, bug_risk, conflict_risk, tool_version)
  values (
    proj,
    left(p_push ->> 'branch', 200),
    left(p_push ->> 'headSha', 64),
    left(p_push ->> 'author', 120),
    left(p_push ->> 'mode', 20),
    (p_push ->> 'score')::int,
    p_push ->> 'decision',
    p_push ->> 'blockedBy',
    coalesce((p_push ->> 'forced')::boolean, false),
    (p_push ->> 'bugRisk')::real,
    (p_push ->> 'conflictRisk')::real,
    left(p_push ->> 'toolVersion', 20)
  )
  returning id into push;

  for f in select value from jsonb_array_elements(coalesce(p_push -> 'findings', '[]'::jsonb)) loop
    n := n + 1;
    exit when n > 300;
    insert into public.findings (push_id, project_id, kind, rule_id, severity, file, line, message, reasons, probability, percentile)
    values (
      push, proj,
      f ->> 'kind',
      left(f ->> 'ruleId', 80),
      f ->> 'severity',
      left(f ->> 'file', 300),
      (f ->> 'line')::int,
      left(f ->> 'message', 500),
      (select array_agg(left(r.value, 200)) from jsonb_array_elements_text(coalesce(f -> 'reasons', '[]'::jsonb)) as r (value)),
      (f ->> 'probability')::real,
      (f ->> 'percentile')::real
    );
  end loop;
  return push;
end;
$$;

-- Functions are executable by everyone by default in Postgres: narrow that down.
revoke execute on function public.create_project_token(uuid, text) from public, anon;
revoke execute on function public.add_project_member(uuid, text) from public, anon;
grant execute on function public.create_project_token(uuid, text) to authenticated;
grant execute on function public.add_project_member(uuid, text) to authenticated;
revoke execute on function public.list_project_members(uuid) from public, anon;
grant execute on function public.list_project_members(uuid) to authenticated;
revoke execute on function public.ingest_push(text, jsonb) from public;
grant execute on function public.ingest_push(text, jsonb) to anon, authenticated;
