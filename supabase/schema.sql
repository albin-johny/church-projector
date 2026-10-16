-- Verse Deck — Supabase schema (run once in Dashboard → SQL Editor).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.

create extension if not exists pg_trgm;

-- ---------- songs ----------
create table if not exists public.songs (
  id          text primary key,                 -- keeps existing "s_..." ids on import
  title       text not null,
  language    text not null check (language in ('en','ml','hi','ta')),
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

-- ---------- services (ordered running order for a service) ----------
-- items: [{ id, type:'song'|'bible'|'custom', ... }] — see js/service.js.
create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'Service',
  service_date date,
  items        jsonb not null default '[]',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.services enable row level security;
drop policy if exists services_auth_all on public.services;
create policy services_auth_all on public.services
  for all to authenticated using (true) with check (true);

-- ---------- Ranked song search (first line first) ----------
-- Run this block once (safe to re-run). It adds songs.first_line, keeps it up to date, and
-- adds search_songs(): results are ordered
--   0  first line STARTS with the search text
--   1  first line contains it
--   2  title or tags contain it
--   3  found only in later stanzas
-- then alphabetically by title within each group.
alter table public.songs add column if not exists first_line text not null default '';

create or replace function public.songs_set_search_text() returns trigger
language plpgsql as $$
declare
  s0 jsonb := new.slides -> 0;
  a text := '';
  b text := '';
begin
  if jsonb_typeof(s0) = 'string' then
    a := s0 #>> '{}';
  elsif jsonb_typeof(s0) = 'object' then
    a := coalesce(s0->>'text', '');
    b := coalesce(s0->>'en', '');
  end if;
  -- first line of the first slide: native script, then Manglish/English, newline-separated
  new.first_line := split_part(trim(a), E'\n', 1) || E'\n' || split_part(trim(b), E'\n', 1);

  new.search_text := coalesce(new.title,'') || ' ' ||
    coalesce((select string_agg(
        case when jsonb_typeof(e) = 'string' then e #>> '{}'
             else coalesce(e->>'text','') || ' ' || coalesce(e->>'en','') end, ' ')
      from jsonb_array_elements(new.slides) e), '') || ' ' ||
    coalesce(array_to_string(new.tags,' '),'');
  new.updated_at := now();
  return new;
end $$;

-- Backfill first_line for existing songs (fires the trigger above).
update public.songs set title = title;

create or replace function public.search_songs(
  q text, lang text default 'all', setlist_only boolean default false,
  off int default 0, lim int default 50
) returns table (
  id text, title text, language text, tags text[], slides jsonb, in_setlist boolean,
  source_url text, lyricist text, copyright text, updated_at timestamptz, total bigint
)
language sql stable security invoker as $$
  with p as (
    select lower(trim(coalesce(q, ''))) as t,
           replace(replace(replace(lower(trim(coalesce(q, ''))), '\', '\\'), '%', '\%'), '_', '\_') as pat
  ), r as (
    select s.*,
      case
        when p.t = '' then 3
        when lower(s.first_line) like p.pat || '%' or lower(s.first_line) like '%' || E'\n' || p.pat || '%' then 0
        when lower(s.first_line) like '%' || p.pat || '%' then 1
        when lower(s.title) like '%' || p.pat || '%' or lower(array_to_string(s.tags, ' ')) like '%' || p.pat || '%' then 2
        else 3
      end as rank
    from public.songs s, p
    where (lang is null or lang = 'all' or s.language = lang)
      and (not setlist_only or s.in_setlist)
      and (p.t = '' or lower(s.search_text) like '%' || p.pat || '%')
  )
  select r.id, r.title, r.language, r.tags, r.slides, r.in_setlist,
         r.source_url, r.lyricist, r.copyright, r.updated_at,
         count(*) over () as total
  from r
  order by r.rank, lower(r.title)
  offset off limit lim;
$$;
grant execute on function public.search_songs(text, text, boolean, int, int) to authenticated;
