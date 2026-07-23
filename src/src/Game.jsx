import React, { useState, useEffect } from "react";
import {
  CONTRACTS, RANK_LABEL, SUIT_GLYPH, isWild, cardFace, valFace,
  checkSet, runWindows, validateContract, validateGoOut,
  layoffOptions, applyLayoff, runEnds, dealHand, scoreHand, shuffle,
} from "./engine.js";
import * as AU from "./auction.js";

/* =========================================================================
   The full online game: melding, laying off, wild covering, the buy auction,
   and the kitchen-table look — all synced through the shared room state.
   ========================================================================= */

export default function Game({ state, me, roomId, writeState }) {
  const players = [...state.players].sort((a, b) => a.seat - b.seat);
  const n = players.length;
  const mySeat = players.find((p) => p.id === me)?.seat ?? 0;
  const myHand = state.hands[me] || [];
  const myTurn = state.turn === mySeat;
  const contract = CONTRACTS[state.handNo];
  const iAmDown = !!state.down?.[mySeat];
  const a = state.auction;

  const [sel, setSel] = useState([]);
  const [staged, setStaged] = useState([]);
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState(null);
  const [placeRun, setPlaceRun] = useState(null);
  const [, tick] = useState(0);

  // drive the countdown display (the deadline itself lives in shared state)
  useEffect(() => {
    if (!a) return;
    const t = setInterval(() => tick((x) => x + 1), 200);
    return () => clearInterval(t);
  }, [a]);

  // the discarder's browser closes an expired window (one writer, no races)
  useEffect(() => {
    if (!a || a.discarder !== mySeat) return;
    if (!AU.isExpired(a) && !AU.canResolveEarly(a)) return;
    const id = setTimeout(() => resolveAuction(), 250);
    return () => clearTimeout(id);
  });

  const seatName = (s) => players.find((p) => p.seat === s)?.name || "—";
  const myName = () => players.find((p) => p.id === me)?.name;
  const idFor = (seat) => players.find((p) => p.seat === seat)?.id;
  const selCards = () => myHand.filter((c) => sel.includes(c.id));
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const log = (s, m) => { s.log = [...(s.log || []), m].slice(-40); };

  /* ----------------- drawing ----------------- */
  function draw(fromDiscard) {
    if (!myTurn || !state.drawPhase || a) return;
    const s = clone(state);
    if (fromDiscard) {
      if (!s.discard.length) return;
      s.hands[me] = s.hands[me].concat([s.discard.pop()]);
      log(s, `${myName()} took the discard.`);
    } else {
      if (!s.stock.length) restock(s);
      s.hands[me] = s.hands[me].concat([s.stock.shift()]);
      log(s, `${myName()} drew from the stock.`);
    }
    s.drawPhase = false;
    writeState(s);
  }
  function restock(s) {
    if (s.discard.length <= 1) return;
    const keep = s.discard[s.discard.length - 1];
    s.stock = shuffle(s.discard.slice(0, -1));
    s.discard = [keep];
    log(s, "Stock ran out — discard reshuffled.");
  }

  /* ----------------- melding ----------------- */
  function stageSet() {
    const cards = selCards();
    if (!checkSet(cards, 3)) { setNote("Those cards aren't a legal set."); return; }
    setStaged(staged.concat([{ type: "set", cards }]));
    setSel([]); setNote("");
  }
  function stageRun() {
    const cards = selCards();
    const wins = runWindows(cards, contract.runMin || 3);
    if (!wins.length) { setNote("Those cards aren't a legal run."); return; }
    if (wins.length === 1) { setStaged(staged.concat([{ type: "run", cards, seq: wins[0].seq }])); setSel([]); setNote(""); return; }
    setPlaceRun({ cards, windows: wins });
  }
  function chooseRunPlacement(w) {
    setStaged(staged.concat([{ type: "run", cards: placeRun.cards, seq: w.seq }]));
    setSel([]); setPlaceRun(null); setNote("");
  }
  const stagedIds = staged.flatMap((g) => g.cards.map((c) => c.id));
  const handMinusStaged = myHand.filter((c) => !stagedIds.includes(c.id));

  function goDown() {
    if (!myTurn || state.drawPhase) { setNote("You can only go down on your turn, after drawing."); return; }
    const left = handMinusStaged.length;
    const v = contract.goOut ? validateGoOut(staged, left, contract) : validateContract(staged, contract);
    if (!v.ok) { setNote(v.why); return; }
    if (!contract.goOut && left === 0) { setNote("Keep at least one card to discard."); return; }

    const s = clone(state);
    const melds = staged.map((g, i) => {
      if (g.type === "set") return { owner: mySeat, type: "set", rank: checkSet(g.cards, 3).rank, cards: g.cards, id: `${mySeat}-${Date.now()}-${i}` };
      const suit = g.cards.filter((c) => !isWild(c))[0].suit;
      return { owner: mySeat, type: "run", suit, seq: g.seq, id: `${mySeat}-${Date.now()}-${i}` };
    });
    s.table = (s.table || []).concat(melds);
    s.down[mySeat] = true;
    s.hands[me] = handMinusStaged;
    log(s, `${myName()} went down.`);
    setStaged([]); setSel([]); setNote("");

    if (contract.goOut) {
      const last = s.hands[me][0];
      s.hands[me] = [];
      s.discard.push(last);
      log(s, `${myName()} laid down everything and went out, discarding ${cardFace(last)}.`);
      endHand(s);
    }
    writeState(s);
  }

  /* ----------------- laying off ----------------- */
  function tapMeld(meldId) {
    if (!myTurn || state.drawPhase) { setNote("You can only lay off on your turn, after drawing."); return; }
    if (!iAmDown) { setNote("Complete your contract before laying off."); return; }
    const cards = selCards();
    if (cards.length !== 1) { setNote("Select exactly one card to lay off."); return; }
    if (myHand.length <= 1) { setNote("That's your last card — go out by discarding it, not laying it off."); return; }
    const meld = state.table.find((m) => m.id === meldId);
    const opts = layoffOptions(meld, cards[0]);
    if (!opts.length) { setNote("That card can't go on this meld."); return; }
    if (opts.length === 1) { doLayoff(meldId, cards[0], opts[0]); return; }
    setChoice({ meldId, card: cards[0], opts, meld });
  }
  function doLayoff(meldId, card, opt) {
    const s = clone(state);
    const i = s.table.findIndex((m) => m.id === meldId);
    s.table[i] = applyLayoff(s.table[i], card, opt);
    s.hands[me] = s.hands[me].filter((c) => c.id !== card.id);
    const where = opt.kind === "cover" ? " covering a wild" : opt.kind === "end" ? ` on the ${opt.end} end` : "";
    log(s, `${myName()} laid off ${cardFace(card)}${where}.`);
    setSel([]); setChoice(null); setNote("");
    writeState(s);
  }

  /* ----------------- discarding + opening the buy window ----------------- */
  function discard() {
    if (!myTurn || state.drawPhase || sel.length !== 1) return;
    if (staged.length) { setNote("Finish going down or clear your staged melds first."); return; }
    const s = clone(state);
    const card = s.hands[me].find((c) => c.id === sel[0]);
    s.hands[me] = s.hands[me].filter((c) => c.id !== sel[0]);
    s.discard.push(card);
    log(s, `${myName()} discarded ${cardFace(card)}.`);
    setSel([]); setNote("");
    if (s.hands[me].length === 0) { endHand(s); writeState(s); return; }
    s.auction = AU.openAuction({ card, discarder: mySeat, numPlayers: n });
    writeState(s);
  }

  /* ----------------- the buy window ----------------- */
  function takeFree() {
    const s = clone(state);
    const seat = s.auction.freeTaker;
    const id = idFor(seat);
    s.hands[id] = s.hands[id].concat([s.discard.pop()]);
    log(s, `${seatName(seat)} took the ${cardFace(s.auction.card)} free.`);
    s.auction = null;
    s.turn = seat; s.drawPhase = false;   // the free take was their draw
    writeState(s);
  }
  function bid()      { const s = clone(state); s.auction = AU.placeBid(s.auction, mySeat);    writeState(s); }
  function withdraw() { const s = clone(state); s.auction = AU.withdrawBid(s.auction, mySeat); writeState(s); }
  function passBuy()  { const s = clone(state); s.auction = AU.passBid(s.auction, mySeat);     writeState(s); }
  function passFree() { const s = clone(state); s.auction = AU.passFree(s.auction);            writeState(s); }
  function hold()     { const s = clone(state); s.auction = AU.holdAuction(s.auction, mySeat); log(s, `${myName()} paused the clock.`); writeState(s); }
  function release()  { const s = clone(state); s.auction = AU.releaseAuction(s.auction);      log(s, `${myName()} released the clock.`); writeState(s); }

  function resolveAuction() {
    const s = clone(state);
    const au = s.auction;
    if (!au) return;
    const { winner } = AU.auctionResult(au);
    if (winner !== null) {
      const id = idFor(winner);
      s.hands[id] = s.hands[id].concat([s.discard.pop()]);
      if (!s.stock.length) restock(s);
      const pen = s.stock.shift();
      if (pen) s.hands[id] = s.hands[id].concat([pen]);
      log(s, `${seatName(winner)} bought the ${cardFace(au.card)} (+1 penalty). Play continues clockwise.`);
    } else {
      log(s, "No buyers.");
    }
    s.auction = null;
    s.turn = au.freeTaker;   // play always continues clockwise from the discarder
    s.drawPhase = true;
    writeState(s);
  }

  /* ----------------- hand end / scoring ----------------- */
  function endHand(s) {
    const bySeat = players.map((p) => s.hands[p.id] || []);
    const scores = scoreHand(bySeat);
    s.totals = s.totals.map((t, i) => t + scores[i]);
    s.auction = null;
    if (s.handNo + 1 >= 7) { s.phase = "over"; log(s, "Game over."); return; }
    const hn = s.handNo + 1, dl = (s.dealer + 1) % n;
    const d = dealHand(hn, dl, n);
    const byId = {}; players.forEach((p) => { byId[p.id] = d.hands[p.seat]; });
    s.handNo = hn; s.dealer = dl; s.turn = d.firstPlayer; s.drawPhase = true;
    s.hands = byId; s.stock = d.stock; s.discard = d.discard;
    s.down = Array(n).fill(false); s.table = [];
    log(s, `Hand ${hn + 1} dealt by ${seatName(dl)}. ${seatName(d.firstPlayer)} starts.`);
    s.auction = AU.openAuction({ card: d.discard[0], discarder: dl, numPlayers: n }); // opening flip is live
  }

  function newGame() {
    const s = clone(state);
    const d = dealHand(0, 0, n);
    const byId = {}; players.forEach((p) => { byId[p.id] = d.hands[p.seat]; });
    Object.assign(s, {
      phase: "playing", handNo: 0, dealer: 0, turn: d.firstPlayer, drawPhase: true,
      totals: Array(n).fill(0), hands: byId, stock: d.stock, discard: d.discard,
      down: Array(n).fill(false), table: [], auction: null,
      log: [`New game. ${seatName(d.firstPlayer)} starts.`],
    });
    s.auction = AU.openAuction({ card: d.discard[0], discarder: 0, numPlayers: n });
    writeState(s);
  }

  /* ============================ RENDER ============================ */
  if (state.phase === "over") {
    const ranked = [...players].sort((x, y) => state.totals[x.seat] - state.totals[y.seat]);
    return (
      <Room>
        <div style={{ ...K.sheetBox, margin: "60px auto" }}>
          <div style={K.sheetTitle}>Final result</div>
          {ranked.map((p, i) => (
            <div key={p.id} style={K.scoreLine}>
              <span>{i === 0 ? "\u{1F451} " : `${i + 1}. `}{p.name}</span><b>{state.totals[p.seat]}</b>
            </div>
          ))}
          <div style={K.sheetText}>Lowest total wins. Well griped.</div>
          <button style={{ ...K.btn, ...K.btnGold, width: "100%" }} onClick={newGame}>Play again</button>
        </div>
      </Room>
    );
  }

  const left = a ? AU.msLeft(a) : 0;
  const pct = a ? Math.max(0, Math.min(100, (left / AU.BASE_MS) * 100)) : 0;
  const iAmFree = a && a.freeTaker === mySeat && !a.freeDecided;
  const iCanBid = a && a.priority.includes(mySeat);
  const opponents = players.filter((p) => p.seat !== mySeat);
  const canLay = myTurn && !state.drawPhase && iAmDown && sel.length === 1;

  return (
    <Room>
      <div style={K.hud}>
        <span style={K.brand}>Gripe Rummy</span>
        <span style={K.hudHand}>Hand {state.handNo + 1}/7 · {contract.label}</span>
        <span style={K.dealerPill}>{seatName(state.dealer)} deals</span>
        <span style={K.roomPill}>Table {roomId}</span>
      </div>

      <div style={K.seats}>
        {opponents.map((p) => {
          const pri = a ? a.priority.indexOf(p.seat) : -1;
          const lead = a && a.leader === p.seat;
          const bidding = a && a.bids.includes(p.seat);
          const passed = a && a.passed.includes(p.seat);
          return (
            <div key={p.id} style={{ ...K.seat, ...(state.turn === p.seat ? K.seatActive : {}), ...(lead ? K.seatLead : {}) }}>
              <div style={K.avatar}>{p.name[0]?.toUpperCase()}</div>
              <div>
                <div style={K.seatName}>{p.name}{p.seat === state.dealer ? " · D" : ""}</div>
                <div style={K.seatMeta}>{state.totals[p.seat]} pts · {(state.hands[p.id] || []).length} cards</div>
              </div>
              {state.down?.[p.seat] && <span style={K.downTag}>DOWN</span>}
              {a && (lead ? <span style={{ ...K.priTag, background: HONEY, color: "#2a1c0e" }}>WINNING</span>
                : bidding ? <span style={{ ...K.priTag, background: BARN, color: "#fff" }}>BIDDING</span>
                : passed ? <span style={{ ...K.priTag, background: "#5a5048" }}>PASSED</span>
                : a.freeTaker === p.seat ? <span style={{ ...K.priTag, background: "#5d8c4e" }}>FREE TAKE</span>
                : pri >= 0 ? <span style={K.priTag}>#{pri + 1}</span> : null)}
            </div>
          );
        })}
      </div>

      <div style={K.felt}>
        <div style={K.piles}>
          <button style={{ ...K.pile, ...(myTurn && state.drawPhase && !a ? K.live : {}) }} disabled={!(myTurn && state.drawPhase && !a)} onClick={() => draw(false)}>
            <div style={K.back}>{"\u{1F0A0}"}</div><div style={K.cap}>Stock · {state.stock.length}</div>
          </button>
          <button style={{ ...K.pile, ...(myTurn && state.drawPhase && !a && state.discard.length ? K.live : {}) }} disabled={!(myTurn && state.drawPhase && !a && state.discard.length)} onClick={() => draw(true)}>
            {state.discard.length ? <Card c={state.discard[state.discard.length - 1]} sm /> : <div style={K.back}>—</div>}
            <div style={K.cap}>Discard</div>
          </button>
        </div>

        <div style={K.melds}>
          {!(state.table || []).length && <div style={K.hint}>The table fills as players lay down their contracts.</div>}
          {players.map((p) => {
            const ms = (state.table || []).filter((m) => m.owner === p.seat);
            if (!ms.length) return null;
            return (
              <div key={p.id} style={K.meldGroup}>
                <div style={K.meldOwner}>{p.name}{p.seat === mySeat ? " (you)" : ""}</div>
                <div style={K.meldRow}>
                  {ms.map((m) => (
                    <button key={m.id} style={{ ...K.meld, ...(canLay ? K.meldLive : {}) }} onClick={() => tapMeld(m.id)} disabled={!canLay}>
                      <span style={K.meldTag}>{m.type}</span>
                      <span style={K.chips}>
                        {m.type === "set"
                          ? m.cards.map((c) => <Chip key={c.id} label={isWild(c) ? String(RANK_LABEL[m.rank] || m.rank) : cardFace(c)} wild={isWild(c)} red={!isWild(c) && "HD".includes(c.suit)} />)
                          : m.seq.map((e) => <Chip key={e.card.id} label={valFace(e.val, m.suit)} wild={e.wild && !e.coveredBy} covered={!!e.coveredBy} red={"HD".includes(m.suit)} />)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {a && (
        <div style={K.buyBar}>
          <div style={K.buyLeft}>
            <div style={K.buyTitle}>BUY WINDOW<br /><span style={{ color: BARN }}>the gripe</span></div>
            <Card c={a.card} sm />
          </div>
          <div style={K.buyMid}>
            <div style={K.track}><div style={{ ...K.fill, width: pct + "%", background: a.heldBy !== null ? HONEY : `linear-gradient(90deg,${BARN},${HONEY})` }} /></div>
            <div style={K.timeNum}>{a.heldBy !== null ? `Paused by ${seatName(a.heldBy)}` : (left / 1000).toFixed(1) + "s"}</div>
            <div style={K.buyMeta}>
              <b>{seatName(a.freeTaker)}</b> may take it free · closest clockwise to <b>{seatName(a.discarder)}</b> wins a buy (+penalty draw)
            </div>
          </div>
          <div style={K.buyBtns}>
            {iAmFree && <>
              <button style={{ ...K.btn, ...K.btnGold }} onClick={takeFree}>Take free</button>
              <button style={K.btn} onClick={passFree}>Pass</button>
            </>}
            {iCanBid && <>
              {a.bids.includes(mySeat)
                ? <button style={{ ...K.btn, ...K.btnBarn }} onClick={withdraw}>{a.leader === mySeat ? "Withdraw (winning)" : "Withdraw"}</button>
                : <button style={{ ...K.btn, ...K.btnBarn }} onClick={bid}>Buy it</button>}
              {!a.passed.includes(mySeat) && !a.bids.includes(mySeat) && <button style={K.btn} onClick={passBuy}>Pass</button>}
            </>}
            {a.heldBy === null
              ? <button style={K.btn} onClick={hold}>Hold</button>
              : <button style={{ ...K.btn, ...K.btnGold }} onClick={release}>Release</button>}
          </div>
        </div>
      )}

      <div style={K.youBar}>
        <div style={{ ...K.seat, ...(myTurn ? K.seatActive : {}) }}>
          <div style={K.avatar}>{myName()?.[0]?.toUpperCase()}</div>
          <div>
            <div style={K.seatName}>{myName()} (you){mySeat === state.dealer ? " · D" : ""}</div>
            <div style={K.seatMeta}>{state.totals[mySeat]} pts · {myHand.length} cards{iAmDown ? " · down" : ""}</div>
          </div>
        </div>
        <div style={K.actions}>
          {myTurn && !state.drawPhase && !iAmDown && <>
            <button style={K.btn} onClick={stageSet} disabled={sel.length < 3}>Set</button>
            <button style={K.btn} onClick={stageRun} disabled={sel.length < 3}>Run</button>
            <button style={{ ...K.btn, ...K.btnGold }} onClick={goDown} disabled={!staged.length}>{contract.goOut ? "Go out" : "Go down"}</button>
          </>}
          {myTurn && !state.drawPhase && <button style={{ ...K.btn, ...K.btnBarn }} onClick={discard} disabled={sel.length !== 1 || staged.length > 0}>Discard</button>}
        </div>
      </div>

      <div style={K.banner}>
        {note || (a ? "Buy window open — the table is deciding."
          : myTurn ? (state.drawPhase ? "Your turn — draw from the stock or take the discard." : "Meld, lay off, then discard.")
          : `Waiting on ${seatName(state.turn)}…`)}
      </div>

      {staged.length > 0 && (
        <div style={K.stagedWrap}>
          {staged.map((g, i) => (
            <button key={i} style={K.stagedMeld} onClick={() => setStaged(staged.filter((_, k) => k !== i))}>
              <span style={K.meldTag}>{g.type} ✕</span>
              <span style={K.chips}>
                {g.type === "run"
                  ? g.seq.map((e) => <Chip key={e.card.id} label={valFace(e.val, g.cards.filter((c) => !isWild(c))[0].suit)} wild={e.wild} red={"HD".includes(g.cards.filter((c) => !isWild(c))[0].suit)} />)
                  : g.cards.map((c) => <Chip key={c.id} label={cardFace(c)} wild={isWild(c)} red={!isWild(c) && "HD".includes(c.suit)} />)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={K.handLabel}>Your hand · {handMinusStaged.length} cards</div>
      <div style={K.hand}>
        {handMinusStaged.map((c) => (
          <div key={c.id} onClick={() => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : sel.concat(c.id))}
            style={{ cursor: "pointer", transform: sel.includes(c.id) ? "translateY(-12px)" : "none", transition: "transform .1s" }}>
            <Card c={c} selected={sel.includes(c.id)} />
          </div>
        ))}
      </div>

      <div style={K.log}>{(state.log || []).slice(-4).reverse().map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.18 }}>{l}</div>)}</div>

      {choice && (
        <Sheet title="Where does it go?" onCancel={() => setChoice(null)}>
          {choice.opts.map((o, i) => {
            let label = "Add to set";
            if (o.kind === "end") { const e = runEnds(choice.meld); label = `${o.end === "low" ? "Low" : "High"} end (${valFace(o.end === "low" ? e.lo - 1 : e.hi + 1, choice.meld.suit)})`; }
            else if (o.kind === "cover") label = `Cover the wild ${valFace(choice.meld.seq[o.index].val, choice.meld.suit)}`;
            return <button key={i} style={{ ...K.btn, ...K.btnGold }} onClick={() => doLayoff(choice.meldId, choice.card, o)}>{label}</button>;
          })}
        </Sheet>
      )}
      {placeRun && (
        <Sheet title="Where do the wilds sit?" onCancel={() => setPlaceRun(null)}>
          {placeRun.windows.map((w, i) => {
            const suit = placeRun.cards.filter((c) => !isWild(c))[0].suit;
            return (
              <button key={i} style={{ ...K.btn, ...K.btnGold, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }} onClick={() => chooseRunPlacement(w)}>
                {w.seq.map((e) => <Chip key={e.card.id} label={valFace(e.val, suit)} wild={e.wild} red={"HD".includes(suit)} />)}
              </button>
            );
          })}
        </Sheet>
      )}
    </Room>
  );
}

/* ---------- pieces ---------- */
function Room({ children }) { return <div style={K.room}><div style={K.inner}>{children}</div></div>; }
function Sheet({ title, children, onCancel }) {
  return (
    <div style={K.sheet}>
      <div style={K.sheetBox}>
        <div style={K.sheetTitle}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {children}
          <button style={K.btn} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
function Card({ c, sm, selected }) {
  const red = "HD".includes(c.suit);
  const base = { ...K.card, ...(sm ? K.cardSm : {}), ...(selected ? K.cardSel : {}) };
  if (c.joker) return <div style={{ ...base, background: "#3a2a1c", borderColor: HONEY, color: HONEY }}><div style={{ fontSize: 9 }}>WILD</div><div style={{ fontSize: 20 }}>★</div></div>;
  return (
    <div style={{ ...base, color: red ? "#b03a2e" : "#20160e", position: "relative" }}>
      <div style={{ position: "absolute", top: 2, left: 4, fontSize: 11, fontWeight: 800, lineHeight: 1 }}>{RANK_LABEL[c.rank] || c.rank}{SUIT_GLYPH[c.suit]}</div>
      <div style={{ fontWeight: 800, fontSize: sm ? 15 : 17 }}>{RANK_LABEL[c.rank] || c.rank}</div>
      <div style={{ fontSize: sm ? 18 : 22, lineHeight: 1 }}>{SUIT_GLYPH[c.suit]}</div>
      {isWild(c) && <div style={{ fontSize: 8, color: HONEY, fontWeight: 700 }}>WILD</div>}
    </div>
  );
}
function Chip({ label, wild, covered, red }) {
  return <span style={{ ...K.chip, color: wild ? "#9a6a20" : red ? "#b03a2e" : "#20160e", borderColor: wild ? HONEY : "rgba(0,0,0,.16)", ...(covered ? { boxShadow: `inset 0 0 0 2px ${HONEY}` } : {}) }}>
    {label}{wild ? " ✦" : ""}{covered ? " ◈" : ""}
  </span>;
}

/* ---------- kitchen palette ---------- */
const LINEN = "#efe4cd", LINEN2 = "#e7d8ba", CREAM = "#f8f0e1", INK = "#3a2a1c", HONEY = "#c88f3f", BARN = "#b0472e";
const K = {
  room: { minHeight: "100vh", background: "linear-gradient(180deg,#6b4a2d,#5c3f27)", color: CREAM, fontFamily: "'Iowan Old Style',Palatino,Georgia,serif", padding: "10px 12px 40px" },
  inner: { maxWidth: 900, margin: "0 auto" },
  hud: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 8, borderBottom: "1px solid rgba(255,240,215,.2)" },
  brand: { fontSize: 20, fontWeight: 800, letterSpacing: 1 },
  hudHand: { fontSize: 12.5, opacity: 0.9, fontFamily: "ui-sans-serif,system-ui" },
  dealerPill: { fontSize: 11, background: "#fdfaf2", color: "#2a1c0e", borderRadius: 20, padding: "2px 9px", fontWeight: 700, fontFamily: "ui-sans-serif,system-ui" },
  roomPill: { marginLeft: "auto", fontSize: 11, opacity: 0.7, fontFamily: "ui-sans-serif,system-ui" },
  seats: { display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" },
  seat: { position: "relative", display: "flex", alignItems: "center", gap: 8, background: "rgba(38,26,16,.55)", border: "1px solid rgba(255,240,215,.16)", borderRadius: 40, padding: "5px 12px 5px 5px" },
  seatActive: { borderColor: HONEY, boxShadow: `0 0 0 1px ${HONEY}, 0 0 12px ${HONEY}55` },
  seatLead: { borderColor: HONEY, boxShadow: `0 0 0 2px ${HONEY}` },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(150deg,${HONEY},#8a5f22)`, color: "#2a1c0e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15 },
  seatName: { fontSize: 13, fontWeight: 700, fontFamily: "ui-sans-serif,system-ui" },
  seatMeta: { fontSize: 11, opacity: 0.8, fontFamily: "ui-sans-serif,system-ui" },
  downTag: { fontSize: 8.5, fontWeight: 800, background: "#8fbf7a", color: "#2a1c0e", borderRadius: 6, padding: "2px 5px" },
  priTag: { position: "absolute", top: -8, right: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, borderRadius: 7, padding: "2px 6px", background: "rgba(0,0,0,.5)", color: CREAM, fontFamily: "ui-sans-serif,system-ui" },
  felt: { background: `radial-gradient(120% 100% at 50% 0%, ${LINEN}, ${LINEN2})`, border: "5px solid #4f3620", borderRadius: 20, padding: "10px 14px", minHeight: 150, display: "flex", flexDirection: "column", gap: 10 },
  piles: { display: "flex", gap: 12, justifyContent: "center" },
  pile: { background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 0, cursor: "default" },
  live: { cursor: "pointer" },
  back: { width: 44, height: 62, borderRadius: 7, background: "repeating-linear-gradient(45deg,#7a5230,#7a5230 5px,#8a6038 5px,#8a6038 10px)", border: `1px solid ${HONEY}88`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: CREAM },
  cap: { fontSize: 10.5, color: "#6b5232", fontFamily: "ui-sans-serif,system-ui" },
  melds: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  hint: { color: "#8a6f47", fontStyle: "italic", fontSize: 13, margin: "auto", fontFamily: "ui-sans-serif,system-ui" },
  meldGroup: { background: "rgba(255,255,255,.42)", border: "1px solid rgba(120,90,50,.25)", borderRadius: 10, padding: "6px 8px" },
  meldOwner: { fontSize: 10.5, fontWeight: 700, color: "#6b5232", marginBottom: 4, fontFamily: "ui-sans-serif,system-ui" },
  meldRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  meld: { background: "rgba(255,255,255,.55)", border: "1px solid rgba(120,90,50,.28)", borderRadius: 8, padding: "5px 7px", display: "flex", flexDirection: "column", gap: 3, textAlign: "left", cursor: "default" },
  meldLive: { borderColor: HONEY, cursor: "pointer", boxShadow: `0 0 8px ${HONEY}88` },
  meldTag: { fontSize: 8.5, textTransform: "uppercase", letterSpacing: 1, color: "#8a6f47", fontFamily: "ui-sans-serif,system-ui" },
  chips: { display: "flex", gap: 3, flexWrap: "wrap" },
  chip: { background: CREAM, borderRadius: 5, padding: "3px 6px", fontSize: 12.5, fontWeight: 700, fontFamily: "ui-sans-serif,system-ui", border: "1px solid rgba(0,0,0,.16)" },
  buyBar: { marginTop: 10, background: `linear-gradient(${LINEN},#e3d3b2)`, border: `2px solid ${HONEY}`, borderRadius: 14, padding: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", color: INK },
  buyLeft: { display: "flex", alignItems: "center", gap: 8 },
  buyTitle: { fontSize: 10, fontWeight: 800, letterSpacing: 0.8, fontFamily: "ui-sans-serif,system-ui", lineHeight: 1.3 },
  buyMid: { flex: 1, minWidth: 200 },
  track: { height: 9, background: "rgba(90,60,30,.25)", borderRadius: 6, overflow: "hidden" },
  fill: { height: "100%", transition: "width .2s linear" },
  timeNum: { fontSize: 11.5, marginTop: 3, color: "#6b5232", fontFamily: "ui-monospace,monospace" },
  buyMeta: { fontSize: 10.5, color: "#6b5232", marginTop: 4, lineHeight: 1.4, fontFamily: "ui-sans-serif,system-ui" },
  buyBtns: { display: "flex", gap: 6, flexWrap: "wrap" },
  youBar: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 },
  actions: { display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" },
  btn: { background: "#5c3f27", color: CREAM, border: `1px solid ${HONEY}88`, borderRadius: 9, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", fontFamily: "ui-sans-serif,system-ui", minHeight: 42 },
  btnGold: { background: HONEY, color: "#2a1c0e", fontWeight: 800, borderColor: HONEY },
  btnBarn: { background: BARN, color: "#fff", fontWeight: 800, borderColor: BARN },
  banner: { marginTop: 10, background: "rgba(0,0,0,.22)", border: `1px solid ${BARN}55`, borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontFamily: "ui-sans-serif,system-ui" },
  stagedWrap: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 },
  stagedMeld: { background: "rgba(200,143,63,.28)", border: `1px dashed ${HONEY}`, borderRadius: 8, padding: "5px 7px", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" },
  handLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: HONEY, margin: "14px 0 8px", fontFamily: "ui-sans-serif,system-ui" },
  hand: { display: "flex", gap: 5, flexWrap: "wrap", minHeight: 74 },
  card: { width: 48, height: 68, background: CREAM, borderRadius: 8, border: "1px solid rgba(60,40,20,.35)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 5px rgba(0,0,0,.3)", userSelect: "none" },
  cardSm: { width: 42, height: 60 },
  cardSel: { boxShadow: `0 0 0 2px ${HONEY}, 0 8px 14px rgba(0,0,0,.45)` },
  log: { marginTop: 14, fontSize: 11.5, fontFamily: "ui-monospace,monospace", lineHeight: 1.6, opacity: 0.85 },
  sheet: { position: "fixed", inset: 0, background: "rgba(30,20,10,.68)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 16 },
  sheetBox: { background: `linear-gradient(${LINEN},#e3d3b2)`, border: `2px solid ${HONEY}`, borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, color: INK },
  sheetTitle: { fontSize: 19, fontWeight: 800, textAlign: "center", marginBottom: 12 },
  sheetText: { fontSize: 13, color: "#6b5232", textAlign: "center", margin: "10px 0", fontFamily: "ui-sans-serif,system-ui" },
  scoreLine: { display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,.45)", borderRadius: 8, marginBottom: 6, fontSize: 15, fontFamily: "ui-sans-serif,system-ui" },
};
