import React, { useEffect, useState, useCallback } from "react";
import { supabase, myClientId } from "./supabase.js";
import Lobby from "./Lobby.jsx";
import Game from "./Game.jsx";
import { dealHand } from "./engine.js";
import { openAuction } from "./auction.js";

/* =========================================================================
   App — the spine of the online game.

   HOW THE MULTIPLAYER WORKS (the important part to understand):
   - Every table is one row in the Supabase "rooms" table.
   - That row has a "state" column (JSON) holding the WHOLE game.
   - When any player acts, their browser writes the new state to that row.
   - Supabase Realtime instantly tells every other browser the row changed,
     and they re-render. That's the sync — no server code of our own.

   This file: figures out which room you're in (from the ?room= link),
   subscribes to that room's row, and shows either the Lobby or the Game.
   ========================================================================= */

const me = myClientId();

function roomFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return p.get("room");
}
function randomRoomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase(); // e.g. "K7QP2"
}

export default function App() {
  const [roomId, setRoomId] = useState(roomFromUrl());
  const [state, setState] = useState(null);     // the shared game state
  const [status, setStatus] = useState("idle"); // idle | loading | joined | error
  const [error, setError] = useState("");

  /* ----- load + subscribe to the room row ----- */
  useEffect(() => {
    if (!roomId) return;
    let channel;
    (async () => {
      setStatus("loading");
      const { data, error } = await supabase.from("rooms").select("state").eq("id", roomId).maybeSingle();
      if (error) { setError(error.message); setStatus("error"); return; }
      if (data) setState(data.state);
      setStatus("joined");
      // live updates whenever this room's row changes
      channel = supabase
        .channel("room:" + roomId)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          (payload) => setState(payload.new.state))
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [roomId]);

  /* ----- write helper: any move = write the new state, everyone syncs ----- */
  const writeState = useCallback(async (next) => {
    setState(next); // optimistic local update
    const { error } = await supabase.from("rooms").update({ state: next, updated_at: new Date().toISOString() }).eq("id", roomId);
    if (error) setError(error.message);
  }, [roomId]);

  /* ----- create a brand-new table ----- */
  async function createRoom(name) {
    const code = randomRoomCode();
    const initial = {
      phase: "lobby",
      hostId: me,
      players: [{ id: me, name, seat: 0 }],
      handNo: 0, dealer: 0, totals: [], turn: 0,
      hands: {}, stock: [], discard: [],
    };
    const { error } = await supabase.from("rooms").insert({ id: code, state: initial });
    if (error) { setError(error.message); return; }
    // put ?room=CODE in the address bar so it's shareable, then enter
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    window.history.replaceState({}, "", url);
    setRoomId(code);
  }

  /* ----- join an existing table from a shared link ----- */
  async function joinRoom(name) {
    const { data, error } = await supabase.from("rooms").select("state").eq("id", roomId).maybeSingle();
    if (error || !data) { setError("That table code wasn't found."); return; }
    const s = data.state;
    if (s.phase !== "lobby") { setError("That game has already started."); return; }
    if (s.players.some((p) => p.id === me)) { setStatus("joined"); return; } // already seated
    if (s.players.length >= 6) { setError("That table is full."); return; }
    const seat = s.players.length;
    const next = { ...s, players: [...s.players, { id: me, name, seat }] };
    await writeState(next);
  }

  /* ----- host starts the game: deal hand 1 and flip ----- */
  async function startGame() {
    const s = state;
    const n = s.players.length;
    if (n < 2) { setError("Need at least 2 players to start."); return; }
    const { hands, stock, discard, firstPlayer } = dealHand(0, 0, n);
    const handsById = {};
    s.players.forEach((p) => { handsById[p.id] = hands[p.seat]; });
    await writeState({
      ...s, phase: "playing",
      handNo: 0, dealer: 0, turn: firstPlayer, drawPhase: true,
      totals: Array(n).fill(0),
      hands: handsById, stock, discard,
      down: Array(n).fill(false), table: [],
      // the opening flip is immediately live for a free take or a buy
      auction: openAuction({ card: discard[0], discarder: 0, numPlayers: n }),
      log: [`Hand 1 dealt. Flip is live — ${s.players[firstPlayer].name} may take it free.`],
    });
  }

  if (!roomId || (status !== "joined" && status !== "loading" && !state)) {
    return <Landing onCreate={createRoom} hasRoom={!!roomId} onJoin={joinRoom} error={error} roomId={roomId} setRoomId={setRoomId} />;
  }
  if (status === "loading") return <Center>Loading table…</Center>;
  if (status === "error") return <Center>Something went wrong: {error}</Center>;
  if (!state) return <Center>Table not found. <a style={{ color: "#d6ab61" }} href="/">Start a new one</a></Center>;

  const seated = state.players.some((p) => p.id === me);
  if (!seated && state.phase === "lobby") {
    return <Landing onCreate={createRoom} hasRoom onJoin={joinRoom} error={error} roomId={roomId} setRoomId={setRoomId} joinMode />;
  }

  if (state.phase === "lobby") {
    return <Lobby state={state} me={me} roomId={roomId} onStart={startGame} error={error} />;
  }
  return <Game state={state} me={me} roomId={roomId} writeState={writeState} />;
}

/* ---------- small landing / name-entry screen ---------- */
function Landing({ onCreate, onJoin, hasRoom, joinMode, error, roomId, setRoomId }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(roomId || "");
  return (
    <Center>
      <div style={S.card}>
        <div style={S.brand}>GRIPE <span style={{ color: "#d6ab61" }}>RUMMY</span></div>
        <input style={S.input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        {(hasRoom || joinMode) ? (
          <>
            <div style={S.sub}>Joining table <b>{roomId}</b></div>
            <button style={S.btn} disabled={!name} onClick={() => onJoin(name)}>Take a seat</button>
          </>
        ) : (
          <>
            <button style={S.btn} disabled={!name} onClick={() => onCreate(name)}>Create a table</button>
            <div style={S.or}>— or join with a code —</div>
            <input style={S.input} placeholder="Table code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button style={S.btnGhost} disabled={!code} onClick={() => setRoomId(code)}>Find table</button>
          </>
        )}
        {error && <div style={S.err}>{error}</div>}
      </div>
    </Center>
  );
}

function Center({ children }) {
  return <div style={S.center}>{children}</div>;
}

const S = {
  center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(1000px 500px at 50% -10%, #3a2340, #221629)", color: "#f3ead9", fontFamily: "system-ui, sans-serif", padding: 20 },
  card: { background: "#2e2038", border: "1px solid #d6ab6155", borderRadius: 16, padding: 26, width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,.4)" },
  brand: { fontSize: 30, fontWeight: 800, letterSpacing: 2, textAlign: "center", marginBottom: 8 },
  input: { padding: "12px 14px", borderRadius: 9, border: "1px solid #d6ab6155", background: "#241826", color: "#f3ead9", fontSize: 16 },
  btn: { padding: "12px 14px", borderRadius: 9, border: "none", background: "#d6ab61", color: "#2a1c10", fontWeight: 800, fontSize: 16, cursor: "pointer" },
  btnGhost: { padding: "12px 14px", borderRadius: 9, border: "1px solid #d6ab6188", background: "transparent", color: "#f3ead9", fontSize: 15, cursor: "pointer" },
  sub: { fontSize: 14, opacity: 0.8, textAlign: "center" },
  or: { fontSize: 12, opacity: 0.5, textAlign: "center", margin: "4px 0" },
  err: { color: "#e4886e", fontSize: 13, textAlign: "center" },
};
