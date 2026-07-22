import React, { useState } from "react";
import { cardFace, CONTRACTS, dealHand, scoreHand } from "./engine.js";

/* =========================================================================
   Game — the SPINE of online play.

   What this proves (the milestone we agreed on): real game state syncing
   across separate browsers. It runs the core turn loop end to end —
   draw → discard → turn passes clockwise — with each player's private hand
   on their own screen and the shared piles visible to everyone. When you
   discard on one device, every other device sees it instantly.

   Deliberately NOT here yet (these layer on next, once the plumbing is
   proven in deployment): melding UI, the buy auction, laying off, and the
   full kitchen-table visuals. The engine already contains all those rules —
   we wire them into this synced loop after the spine is live.
   ========================================================================= */

export default function Game({ state, me, roomId, writeState }) {
  const [sel, setSel] = useState(null);
  const players = state.players;
  const n = players.length;
  const mySeat = players.find((p) => p.id === me)?.seat;
  const myHand = state.hands[me] || [];
  const myTurn = state.turn === mySeat;
  const contract = CONTRACTS[state.handNo];
  const seatName = (seat) => players.find((p) => p.seat === seat)?.name || "—";

  function draw(fromDiscard) {
    if (!myTurn || !state.drawPhase) return;
    const s = clone(state);
    if (fromDiscard) {
      if (!s.discard.length) return;
      s.hands[me] = s.hands[me].concat([s.discard.pop()]);
      s.log = pushLog(s, `${myName()} took the discard.`);
    } else {
      if (!s.stock.length) { reshuffle(s); }
      s.hands[me] = s.hands[me].concat([s.stock.shift()]);
      s.log = pushLog(s, `${myName()} drew from the stock.`);
    }
    s.drawPhase = false;
    writeState(s);
  }

  function discard() {
    if (!myTurn || state.drawPhase || sel == null) return;
    const s = clone(state);
    const card = s.hands[me].find((c) => c.id === sel);
    if (!card) return;
    s.hands[me] = s.hands[me].filter((c) => c.id !== sel);
    s.discard.push(card);
    s.log = pushLog(s, `${myName()} discarded ${cardFace(card)}.`);
    setSel(null);

    if (s.hands[me].length === 0) { endHand(s); writeState(s); return; }
    // pass the turn clockwise
    s.turn = (s.turn + 1) % n;
    s.drawPhase = true;
    writeState(s);
  }

  function endHand(s) {
    // score everyone's remaining cards, add to totals
    const handsBySeat = players.slice().sort((a, b) => a.seat - b.seat).map((p) => s.hands[p.id] || []);
    const scores = scoreHand(handsBySeat);
    s.totals = s.totals.map((t, i) => t + scores[i]);
    if (s.handNo + 1 >= 7) { s.phase = "over"; s.log = pushLog(s, "Game over."); return; }
    // next hand: deal rotates one seat
    const nextHand = s.handNo + 1;
    const nextDealer = (s.dealer + 1) % n;
    const { hands, stock, discard, firstPlayer } = dealHand(nextHand, nextDealer, n);
    const handsById = {};
    players.forEach((p) => { handsById[p.id] = hands[p.seat]; });
    s.handNo = nextHand; s.dealer = nextDealer; s.turn = firstPlayer; s.drawPhase = true;
    s.hands = handsById; s.stock = stock; s.discard = discard;
    s.down = Array(n).fill(false); s.table = [];
    s.log = pushLog(s, `Hand ${nextHand + 1} dealt. ${seatName(firstPlayer)} starts.`);
  }

  function myName() { return players.find((p) => p.id === me)?.name; }

  if (state.phase === "over") {
    const ranked = players.slice().sort((a, b) => state.totals[a.seat] - state.totals[b.seat]);
    return (
      <div style={S.wrap}>
        <div style={S.overCard}>
          <div style={S.h1}>Final result</div>
          {ranked.map((p, i) => (
            <div key={p.id} style={S.scoreLine}><span>{i === 0 ? "👑 " : `${i + 1}. `}{p.name}</span><b>{state.totals[p.seat]}</b></div>
          ))}
          <div style={S.note}>Lowest total wins. Well griped.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.hud}>
        <span style={S.brand}>Gripe Rummy</span>
        <span style={S.hudHand}>Hand {state.handNo + 1}/7 · {contract.label}</span>
        <span style={S.room}>Table {roomId}</span>
      </div>

      {/* other players */}
      <div style={S.players}>
        {players.slice().sort((a, b) => a.seat - b.seat).map((p) => (
          <div key={p.id} style={{ ...S.player, ...(state.turn === p.seat ? S.playerActive : {}) }}>
            <div style={S.avatar}>{p.name[0]?.toUpperCase()}</div>
            <div>
              <div style={S.pName}>{p.name}{p.id === me ? " (you)" : ""}{p.seat === state.dealer ? " · D" : ""}</div>
              <div style={S.pMeta}>{state.totals[p.seat] ?? 0} pts · {(state.hands[p.id] || []).length} cards</div>
            </div>
          </div>
        ))}
      </div>

      {/* piles */}
      <div style={S.piles}>
        <button style={{ ...S.pile, ...(myTurn && state.drawPhase ? S.pileLive : {}) }} disabled={!(myTurn && state.drawPhase)} onClick={() => draw(false)}>
          <div style={S.back}>🂠</div><div style={S.cap}>Stock · {state.stock.length}</div>
        </button>
        <button style={{ ...S.pile, ...(myTurn && state.drawPhase && state.discard.length ? S.pileLive : {}) }} disabled={!(myTurn && state.drawPhase && state.discard.length)} onClick={() => draw(true)}>
          <div style={S.face}>{state.discard.length ? cardFace(state.discard[state.discard.length - 1]) : "—"}</div><div style={S.cap}>Discard</div>
        </button>
      </div>

      <div style={S.turnBanner}>
        {myTurn ? (state.drawPhase ? "Your turn — draw from the stock or take the discard." : "Now pick a card and discard.") : `Waiting on ${seatName(state.turn)}…`}
      </div>

      {/* my hand */}
      <div style={S.handLabel}>Your hand · {myHand.length} cards</div>
      <div style={S.hand}>
        {myHand.map((c) => {
          const red = c.suit === "H" || c.suit === "D";
          return (
            <button key={c.id} onClick={() => setSel(sel === c.id ? null : c.id)}
              style={{ ...S.card, ...(sel === c.id ? S.cardSel : {}), color: c.joker ? "#c88f3f" : red ? "#b03a2e" : "#20160e" }}>
              {c.joker ? "★" : cardFace(c)}
            </button>
          );
        })}
      </div>
      <div style={S.actions}>
        <button style={{ ...S.btn, ...S.btnGold }} disabled={!(myTurn && !state.drawPhase && sel != null)} onClick={discard}>Discard</button>
      </div>

      <div style={S.log}>{(state.log || []).slice(-5).reverse().map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.16 }}>{l}</div>)}</div>

      <div style={S.spineNote}>
        Spine build: draw &amp; discard sync across devices. Melding, the buy auction, and the
        kitchen-table look layer on next, once this is live.
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function pushLog(s, msg) { return [...(s.log || []), msg].slice(-40); }
function reshuffle(s) {
  if (s.discard.length <= 1) return;
  const keep = s.discard[s.discard.length - 1];
  const rest = s.discard.slice(0, -1);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  s.stock = rest; s.discard = [keep];
}

const S = {
  wrap: { minHeight: "100vh", background: "radial-gradient(1000px 500px at 50% -10%, #3a2340, #221629)", color: "#f3ead9", fontFamily: "system-ui, sans-serif", padding: "10px 12px 40px", boxSizing: "border-box", maxWidth: 720, margin: "0 auto" },
  hud: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", borderBottom: "1px solid #d6ab6133", paddingBottom: 8 },
  brand: { fontSize: 20, fontWeight: 800, letterSpacing: 1 },
  hudHand: { fontSize: 13, opacity: 0.85 },
  room: { marginLeft: "auto", fontSize: 12, opacity: 0.6 },
  players: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 },
  player: { display: "flex", alignItems: "center", gap: 8, background: "#2e2038", border: "1px solid #ffffff14", borderRadius: 12, padding: "6px 12px 6px 6px" },
  playerActive: { borderColor: "#d6ab61", boxShadow: "0 0 0 1px #d6ab61, 0 0 14px #d6ab6144" },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(150deg,#d6ab61,#9a6a26)", color: "#2a1c0e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 },
  pName: { fontSize: 13, fontWeight: 700 },
  pMeta: { fontSize: 11, opacity: 0.75 },
  piles: { display: "flex", gap: 14, justifyContent: "center", marginTop: 18 },
  pile: { background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "default", padding: 0 },
  pileLive: { cursor: "pointer" },
  back: { width: 54, height: 74, borderRadius: 8, background: "repeating-linear-gradient(45deg,#2e2038,#2e2038 6px,#3a2942 6px,#3a2942 12px)", border: "1px solid #d6ab6188", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#d6ab61" },
  face: { width: 54, height: 74, borderRadius: 8, background: "#f3ead9", color: "#20160e", border: "1px solid rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 },
  cap: { fontSize: 11, opacity: 0.75 },
  turnBanner: { textAlign: "center", marginTop: 14, fontSize: 14, background: "#00000026", border: "1px solid #e4572e44", borderRadius: 10, padding: "9px 14px" },
  handLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "#d6ab61", marginTop: 18, marginBottom: 8 },
  hand: { display: "flex", gap: 6, flexWrap: "wrap" },
  card: { minWidth: 44, height: 62, borderRadius: 8, background: "#f3ead9", border: "1px solid rgba(0,0,0,.3)", fontSize: 16, fontWeight: 800, cursor: "pointer", boxShadow: "0 2px 5px rgba(0,0,0,.3)" },
  cardSel: { transform: "translateY(-10px)", boxShadow: "0 0 0 2px #d6ab61, 0 8px 14px rgba(0,0,0,.5)" },
  actions: { display: "flex", gap: 8, marginTop: 12 },
  btn: { padding: "11px 16px", borderRadius: 9, border: "1px solid #d6ab6188", background: "#2e2038", color: "#f3ead9", fontSize: 15, cursor: "pointer" },
  btnGold: { background: "#d6ab61", color: "#2a1c10", fontWeight: 800, border: "none" },
  log: { marginTop: 18, fontSize: 12, fontFamily: "ui-monospace, monospace", lineHeight: 1.7, opacity: 0.9 },
  spineNote: { marginTop: 22, fontSize: 12, opacity: 0.6, borderTop: "1px solid #ffffff14", paddingTop: 12, lineHeight: 1.5 },
  overCard: { maxWidth: 380, margin: "60px auto", background: "#2e2038", border: "1px solid #d6ab61", borderRadius: 16, padding: 24 },
  h1: { fontSize: 22, fontWeight: 800, textAlign: "center", marginBottom: 14 },
  scoreLine: { display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#00000026", borderRadius: 8, marginBottom: 6, fontSize: 15 },
  note: { textAlign: "center", opacity: 0.7, marginTop: 8, fontSize: 13 },
};
