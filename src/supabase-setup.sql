-- ============================================================================
-- GRIPE RUMMY — Supabase database setup
-- Run this ONCE in your Supabase project: Dashboard → SQL Editor → New query →
-- paste all of this → Run. It creates the single table the game needs and
-- turns on the live-sync feature.
-- ============================================================================

-- One row per table (game room). The whole game lives in the "state" column.
create table if not exists public.rooms (
  id text primary key,                 -- the short table code, e.g. "K7QP2"
  state jsonb not null,                -- the entire game state
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Turn on Realtime so every player's browser hears about changes instantly.
alter publication supabase_realtime add table public.rooms;

-- Row Level Security: on, with open policies suitable for a friends-and-family
-- game (anyone with the link can read/write that table's row). This is fine for
-- private family play. See README "Hardening" before opening it to strangers.
alter table public.rooms enable row level security;

create policy "anyone can read rooms"   on public.rooms for select using (true);
create policy "anyone can create rooms" on public.rooms for insert with check (true);
create policy "anyone can update rooms"  on public.rooms for update using (true);
