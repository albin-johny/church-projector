-- Verse Deck — Supabase schema (run once in Dashboard → SQL Editor).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.

create extension if not exists pg_trgm;

-- ---------- songs ----------
create table if not exists public.songs (
  id          text primary key,                 -- keeps existing "s_..." ids on import
  title       text not null,
  language    text not null check (language in ('en','ml','hi')),
  tags        text[] not null default '{}',
  slides      jsonb not null default '[]',      -- strings (en) or {text, en} pairs (ml/hi)
  in_setlist  boolean not null default false,   -- UI "bookmarks"
  source_url  text,
  lyricist    text,
  copyright   text,
  search_text text not null default '',         -- title + flattened slide text, filled by trigger
  updated_at  timestamptz not null default now()
);

create or replace function public.songs_set_search_text() returns trigger
language plpgsql as $$
begin
  new.search_text := coalesce(new.title,'') || ' ' ||
    coalesce((select string_agg(
        case when jsonb_typeof(e) = 'string' then e #>> '{}'
             else coalesce(e->>'text','') || ' ' || coalesce(e->>'en','') end, ' ')
      from jsonb_array_elements(new.slides) e), '') || ' ' ||
    coalesce(array_to_string(new.tags,' '),'');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists songs_search_text on public.songs;
create trigger songs_search_text before insert or update on public.songs
  for each row execute function public.songs_set_search_text();

create index if not exists songs_search_trgm on public.songs using gin (search_text gin_trgm_ops);
create index if not exists songs_title_idx   on public.songs (lower(title));

-- ---------- sessions (pairing) ----------
create table if not exists public.sessions (
  id                uuid primary key default gen_random_uuid(),
  pairing_code      text not null unique,
  active_control_id text,                        -- device id holding the control seat
  active_control_at timestamptz,                 -- last heartbeat of that device
  created_at        timestamptz not null default now()
);

-- ---------- live_state (last message, for reconnecting displays) ----------
create table if not exists public.live_state (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  message    jsonb not null default '{"type":"clear"}',
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.songs      enable row level security;
alter table public.sessions   enable row level security;
alter table public.live_state enable row level security;

-- Songs: only the signed-in church user can read/write.
drop policy if exists songs_auth_all on public.songs;
create policy songs_auth_all on public.songs
  for all to authenticated using (true) with check (true);

-- Sessions: only signed-in users touch the table directly.
drop policy if exists sessions_auth_all on public.sessions;
create policy sessions_auth_all on public.sessions
  for all to authenticated using (true) with check (true);

-- Live state: signed-in users write; displays (anon) may read.
-- Tradeoff: anon can read any live_state row, but session ids are random UUIDs and the
-- content is only the slide currently on the projector.
drop policy if exists live_auth_all on public.live_state;
create policy live_auth_all on public.live_state
  for all to authenticated using (true) with check (true);
drop policy if exists live_anon_read on public.live_state;
create policy live_anon_read on public.live_state
  for select to anon using (true);

-- Displays resolve a pairing code to a session id without being able to list sessions.
create or replace function public.join_session(code text) returns uuid
language sql security definer set search_path = public as $$
  select id from public.sessions where pairing_code = upper(code) limit 1;
$$;
grant execute on function public.join_session(text) to anon, authenticated;

-- Realtime: broadcast live_state changes.
alter publication supabase_realtime add table public.live_state;

-- Migration for projects created before the heartbeat column existed (safe to re-run):
alter table public.sessions add column if not exists active_control_at timestamptz;
