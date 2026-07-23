# Gripe Rummy — Online (multiplayer spine)

Link-to-join, real-time multiplayer Gripe Rummy. Built with **React + Vite** on
the front end and **Supabase** (Postgres + Realtime) for shared state — no custom
server to run or maintain.

**To deploy it, follow `SETUP.md`.** This README is the "how it works" for
anyone reading the code (you, later; a developer, if you ever bring one in).

---

## What's in this build (the "spine")

The agreed first milestone: **prove that real game state syncs across separate
devices.** It does the full turn loop — deal, draw, discard, turn passes
clockwise, hand/score rollover across all seven hands — with each player's hand
private to their screen and the piles shared. Discard on one device, every
device updates instantly.

**Intentionally not wired in yet** (all the *rules* for these already live in
`src/engine.js` from the single-device version — they just need connecting to
the synced loop):

- Melding / going down / laying off (UI)
- The buy auction (the "gripe") — needs a shared timer + concurrent-bid handling
- The kitchen-table visuals from the single-device prototype

These layer on next, once the spine is confirmed live in deployment.

---

## Architecture in one picture

```
  Browser A ─┐                        ┌─ Browser B
             │   writes new state     │
             ▼                        ▼
        ┌───────────────────────────────┐
        │  Supabase: public.rooms row   │   one row per table
        │  { id, state (JSON), ... }    │
        └───────────────────────────────┘
             │   Realtime broadcast     │
             ▼                          ▼
   every subscribed browser re-renders the new state
```

- **`src/engine.js`** — pure rules (deck, deal, validation, scoring, buy
  priority). No UI, no network. Ported intact from the single-device game.
- **`src/App.jsx`** — room routing, create/join, the Realtime subscription, and
  `writeState` (the one function that pushes a new state to Supabase).
- **`src/Lobby.jsx`** — seat list + shareable link + host start.
- **`src/Game.jsx`** — the synced turn loop.
- **`supabase-setup.sql`** — the one table + Realtime + RLS policies.

State model: the entire game is one JSON object in `rooms.state`. A move =
compute the next state locally, `writeState(next)`. Supabase broadcasts the row
change; all clients render it. Turn-based play makes this simple and robust:
only the player whose turn it is writes game moves.

---

## Hardening (before this goes beyond friends & family)

This spine optimizes for simplicity and trust, appropriate for private family
play. Known things to firm up before any public/stranger use:

1. **Hand privacy.** All players' hands sit in the shared row, so a technically
   savvy player could read another's hand via the network. Fix: move authority
   into a Supabase **Edge Function** (or Postgres RLS + row-per-player) so each
   client only receives its own hand. The UI already only *renders* your own
   hand — this is about not *sending* the others.
2. **Move authority.** Clients currently compute and trust their own moves. The
   Edge Function above would also validate moves server-side (anti-cheat).
3. **Disconnect / rejoin.** Happy-path today. Add presence + reconnection so a
   dropped player can rejoin their seat and the game can continue.
4. **Concurrency.** Turn-based writes rarely collide, but the buy auction (when
   added) has concurrent bids and a timer — best handled in an Edge Function
   with a server-authoritative clock.

None of these block family play; they're the roadmap from "works for us" to
"works for anyone."

---

## Running locally (optional, for a developer)

```bash
npm install
cp .env.example .env      # fill in your Supabase URL + anon key
npm run dev               # opens http://localhost:5173
```
