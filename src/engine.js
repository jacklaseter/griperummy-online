/* =========================================================================
   GRIPE RUMMY — rules engine (pure logic, no UI, no network)
   This is the same engine we perfected in the single-device version, carried
   over intact. It knows nothing about Supabase or React — it just knows the
   rules. The multiplayer layer calls into this and syncs the results.
   ========================================================================= */

export const SUITS = ["S", "H", "D", "C"];
export const SUIT_GLYPH = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
export const RANK_LABEL = { 1: "A", 11: "J", 12: "Q", 13: "K" };
export const NUM_DECKS = 4;

export const CONTRACTS = [
  { deal: 7,  sets: [3, 3],    runs: [],     runMin: 0, label: "2 sets of 3" },
  { deal: 8,  sets: [3],       runs: [4],    runMin: 4, label: "1 set of 3 + 1 run of 4" },
  { deal: 9,  sets: [],        runs: [4, 4], runMin: 4, label: "2 runs of 4 (different suits)" },
  { deal: 10, sets: [3, 3, 3], runs: [],     runMin: 0, label: "3 sets of 3 (different ranks)" },
  { deal: 11, sets: [3],       runs: [7],    runMin: 7, label: "1 set of 3 + 1 run of 7" },
  { deal: 12, sets: [3],       runs: [4, 4], runMin: 4, label: "1 set of 3 + 2 runs of 4 (different suits)" },
  { deal: 13, sets: [3, 3],    runs: [7],    runMin: 7, label: "2 sets of 3 + 1 run of 7 — go out on lay-down", goOut: true },
];

let _id = 0;
export const isWild = (c) => c.joker || c.rank === 2;

export function buildDeck() {
  const cards = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const s of SUITS) for (let r = 1; r <= 13; r++) cards.push({ id: ++_id, rank: r, suit: s, joker: false });
    cards.push({ id: ++_id, rank: 0, suit: null, joker: true });
    cards.push({ id: ++_id, rank: 0, suit: null, joker: true });
  }
  return cards;
}
export function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
export const cardScore = (c) => (isWild(c) ? 20 : c.rank === 1 ? 15 : c.rank >= 10 ? 10 : 5);
export const valFace = (val, suit) => (RANK_LABEL[val === 14 ? 1 : val] || val) + SUIT_GLYPH[suit];
export const cardFace = (c) => (c.joker ? "WILD" : (RANK_LABEL[c.rank] || c.rank) + SUIT_GLYPH[c.suit]);

/* ---------- meld validation ---------- */
export function checkSet(cards, min) {
  if (cards.length < Math.max(min, 3)) return null;
  const nat = cards.filter((c) => !isWild(c));
  if (nat.length === 0) return null;
  const rank = nat[0].rank;
  if (!nat.every((c) => c.rank === rank)) return null;
  return { type: "set", rank };
}
export function buildRunSeq(cards, min) {
  if (cards.length < Math.max(min, 3)) return null;
  const nat = cards.filter((c) => !isWild(c));
  const wilds = cards.filter(isWild);
  if (nat.length === 0) return null;
  const suit = nat[0].suit;
  if (!nat.every((c) => c.suit === suit)) return null;
  const total = cards.length;
  const attempt = (aceHigh) => {
    const nv = nat.map((c) => ({ card: c, val: c.rank === 1 ? (aceHigh ? 14 : 1) : c.rank }));
    const vals = nv.map((x) => x.val);
    if (new Set(vals).size !== vals.length) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo > total - 1) return null;
    for (let start = Math.max(1, hi - total + 1); start <= Math.min(lo, 14 - total + 1); start++) {
      const occ = {}; nv.forEach((x) => (occ[x.val] = x.card));
      const wq = wilds.slice(); const seq = []; let ok = true;
      for (let v = start; v < start + total; v++) {
        if (occ[v]) seq.push({ card: occ[v], val: v, wild: false });
        else { const w = wq.shift(); if (!w) { ok = false; break; } seq.push({ card: w, val: v, wild: true }); }
      }
      if (ok) return { suit, seq };
    }
    return null;
  };
  const hasAce = nat.some((c) => c.rank === 1);
  return hasAce ? attempt(true) || attempt(false) : attempt(false);
}
export function runWindows(cards, min) {
  if (cards.length < Math.max(min, 3)) return [];
  const nat = cards.filter((c) => !isWild(c));
  const wilds = cards.filter(isWild);
  if (nat.length === 0) return [];
  const suit = nat[0].suit;
  if (!nat.every((c) => c.suit === suit)) return [];
  const total = cards.length;
  const out = []; const seen = new Set();
  const build = (aceHigh) => {
    const nv = nat.map((c) => ({ card: c, val: c.rank === 1 ? (aceHigh ? 14 : 1) : c.rank }));
    const vals = nv.map((x) => x.val);
    if (new Set(vals).size !== vals.length) return;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo > total - 1) return;
    for (let start = Math.max(1, hi - total + 1); start <= Math.min(lo, 14 - total + 1); start++) {
      const occ = {}; nv.forEach((x) => (occ[x.val] = x.card));
      const wq = wilds.slice(); const seq = []; let ok = true;
      for (let v = start; v < start + total; v++) {
        if (occ[v]) seq.push({ card: occ[v], val: v, wild: false });
        else { const w = wq.shift(); if (!w) { ok = false; break; } seq.push({ card: w, val: v, wild: true }); }
      }
      if (!ok) continue;
      const key = seq.map((e) => e.val).join(",");
      if (!seen.has(key)) { seen.add(key); out.push({ suit, seq }); }
    }
  };
  const hasAce = nat.some((c) => c.rank === 1);
  if (hasAce) { build(true); build(false); } else build(false);
  return out;
}
export function classify(cards, min) {
  const s = checkSet(cards, min); if (s) return s;
  const r = buildRunSeq(cards, Math.max(min, 3)); return r ? { type: "run", suit: r.suit } : null;
}
export function validateContract(groups, contract) {
  const info = groups.map((g) => classify(g.cards, g.type === "run" ? contract.runMin : 3));
  if (info.some((x) => x === null)) return { ok: false, why: "One group isn't a legal meld." };
  const sets = info.filter((x) => x.type === "set");
  const runs = info.filter((x) => x.type === "run");
  if (sets.length !== contract.sets.length) return { ok: false, why: `This hand needs exactly ${contract.sets.length} set(s).` };
  if (runs.length !== contract.runs.length) return { ok: false, why: `This hand needs exactly ${contract.runs.length} run(s).` };
  if (contract.runs.length > 1) {
    const s = runs.map((r) => r.suit); if (new Set(s).size !== s.length) return { ok: false, why: "The runs must be different suits." };
  }
  if (contract.sets.length > 1) {
    const r = sets.map((s) => s.rank); if (new Set(r).size !== r.length) return { ok: false, why: "The sets must be different ranks." };
  }
  return { ok: true };
}

/* ---------- dealing ---------- */
/* Deals a hand for `numPlayers` seated clockwise, dealer at index `dealer`.
   Returns { hands, stock, discard, firstPlayer }. */
export function dealHand(handNo, dealer, numPlayers) {
  const c = CONTRACTS[handNo];
  const deck = shuffle(buildDeck());
  const hands = Array(numPlayers).fill(null).map(() => []);
  let k = 0;
  for (let r = 0; r < c.deal; r++)
    for (let p = 0; p < numPlayers; p++) hands[(dealer + 1 + p) % numPlayers].push(deck[k++]);
  const flip = deck[k++];
  const stock = deck.slice(k);
  return { hands, stock, discard: [flip], firstPlayer: (dealer + 1) % numPlayers };
}

/* buy-window priority: free-taker is next clockwise; buyers ranked closest
   clockwise to the discarder win first. */
export function buyOrder(discarder, numPlayers) {
  const freeTaker = (discarder + 1) % numPlayers;
  const priority = [];
  for (let i = 2; i < numPlayers; i++) priority.push((discarder + i) % numPlayers);
  return { freeTaker, priority };
}

export function scoreHand(hands) {
  return hands.map((h) => h.reduce((s, c) => s + cardScore(c), 0));
}

/* =========================================================================
   Lay-off / wild-covering helpers (ported from the single-device build)
   ========================================================================= */
export function runEnds(meld) {
  const lo = meld.seq[0].val, hi = meld.seq[meld.seq.length - 1].val;
  return { lo, hi, canLow: lo - 1 >= 1, canHigh: hi + 1 <= 14 };
}
export function cardFitsRunEnd(meld, card, end) {
  const { lo, hi, canLow, canHigh } = runEnds(meld);
  if (isWild(card)) return end === "low" ? canLow : canHigh;
  if (card.suit !== meld.suit) return false;
  const targets = card.rank === 1 ? [1, 14] : [card.rank];
  if (end === "low") return canLow && targets.includes(lo - 1);
  return canHigh && targets.includes(hi + 1);
}
export function validRunEndsFor(meld, card) {
  const ends = [];
  if (cardFitsRunEnd(meld, card, "low")) ends.push("low");
  if (cardFitsRunEnd(meld, card, "high")) ends.push("high");
  return ends;
}
export function extendRun(meld, card, end) {
  const { lo, hi } = runEnds(meld);
  const val = end === "low" ? lo - 1 : hi + 1;
  const entry = { card, val, wild: isWild(card) };
  const seq = end === "low" ? [entry, ...meld.seq] : [...meld.seq, entry];
  return { ...meld, seq };
}
export function cardFitsSet(meld, card) { return isWild(card) || card.rank === meld.rank; }
/* interior wilds that this true card may cover (wild stays locked underneath) */
export function coverTargetsInRun(meld, card) {
  if (meld.type !== "run" || isWild(card) || card.suit !== meld.suit) return [];
  const vals = card.rank === 1 ? [1, 14] : [card.rank];
  const res = [];
  meld.seq.forEach((e, i) => { if (e.wild && !e.coveredBy && vals.includes(e.val)) res.push(i); });
  return res;
}
/* every legal spot this card could take on a meld */
export function layoffOptions(meld, card) {
  if (meld.type === "set") return cardFitsSet(meld, card) ? [{ kind: "set" }] : [];
  const opts = [];
  validRunEndsFor(meld, card).forEach((end) => opts.push({ kind: "end", end }));
  coverTargetsInRun(meld, card).forEach((i) => opts.push({ kind: "cover", index: i }));
  return opts;
}
export function applyLayoff(meld, card, opt) {
  if (opt.kind === "set") return { ...meld, cards: meld.cards.concat([card]) };
  if (opt.kind === "end") return extendRun(meld, card, opt.end);
  return { ...meld, seq: meld.seq.map((e, i) => (i === opt.index ? { ...e, coveredBy: card } : e)) };
}
/* Hand 7: lay everything down and go out in one move. */
export function validateGoOut(groups, handAfter, contract) {
  const info = groups.map((g) => classify(g.cards, g.type === "run" ? contract.runMin : 3));
  if (info.some((x) => x === null)) return { ok: false, why: "One group isn't a legal meld." };
  const sets = info.filter((x) => x.type === "set");
  const runs = info.filter((x, i) => x.type === "run" && groups[i].cards.length >= contract.runMin);
  const setRanks = [...new Set(sets.map((s) => s.rank))];
  if (sets.length < contract.sets.length || setRanks.length < contract.sets.length)
    return { ok: false, why: `Lay down at least ${contract.sets.length} sets of 3 (different ranks).` };
  const runSuits = [...new Set(runs.map((r) => r.suit))];
  if (runs.length < contract.runs.length || runSuits.length < contract.runs.length)
    return { ok: false, why: `Lay down at least ${contract.runs.length} run(s) of ${contract.runMin} (different suits).` };
  if (handAfter !== 1) return { ok: false, why: `Keep exactly one card to discard — you have ${handAfter}.` };
  return { ok: true };
}
