/* =========================================================================
   The buy auction ("the gripe") — multiplayer version.

   HOW THE SHARED CLOCK WORKS
   Rather than each browser running its own timer (which would drift apart),
   the shared state carries a DEADLINE: an absolute timestamp. Every browser
   simply counts down to that same instant, so all five screens agree.

   Holding: any player may pause the countdown — important at a family table
   where someone may need a moment. Pausing stores how much time was left;
   releasing sets a fresh deadline from that remaining time.

   Priority is unchanged from the kitchen-table rules: the next player
   clockwise may take the discard free; otherwise the bidder closest
   clockwise to the discarder wins, and pays a penalty draw.
   ========================================================================= */

export const BASE_MS = 20000;   // generous base window
export const CEIL_MS = 60000;   // hard ceiling on one auction
export const BUMP_MS = 8000;    // fresh time granted when a higher bid lands

/* Open a buy window on a fresh discard. */
export function openAuction({ card, discarder, numPlayers, now = Date.now() }) {
  const freeTaker = (discarder + 1) % numPlayers;
  const priority = [];
  for (let i = 2; i < numPlayers; i++) priority.push((discarder + i) % numPlayers);
  return {
    card, discarder, freeTaker, priority,
    bids: [], passed: [], leader: null,
    freeDecided: false,
    deadline: now + BASE_MS,
    startedAt: now,
    heldBy: null, heldRemaining: null,
  };
}

/* Milliseconds left; while held, the frozen remainder. */
export function msLeft(a, now = Date.now()) {
  if (!a) return 0;
  if (a.heldBy !== null && a.heldRemaining != null) return a.heldRemaining;
  return Math.max(0, a.deadline - now);
}
export function isExpired(a, now = Date.now()) {
  return a && a.heldBy === null && now >= a.deadline;
}

/* Anyone at the table may hold the clock. */
export function holdAuction(a, seat, now = Date.now()) {
  if (a.heldBy !== null) return a;
  return { ...a, heldBy: seat, heldRemaining: Math.max(0, a.deadline - now) };
}
export function releaseAuction(a, now = Date.now()) {
  if (a.heldBy === null) return a;
  const remain = a.heldRemaining ?? BASE_MS;
  return { ...a, heldBy: null, heldRemaining: null, deadline: now + remain };
}

/* Place a bid. A higher-priority bid overrides and grants fresh time
   (capped so one auction can't run forever). */
export function placeBid(a, seat, now = Date.now()) {
  if (!a.priority.includes(seat) || a.bids.includes(seat)) return a;
  const bids = a.bids.concat([seat]);
  const leader = a.priority.find((s) => bids.includes(s)) ?? null;
  let next = { ...a, bids, leader, passed: a.passed.filter((s) => s !== seat) };
  if (leader !== a.leader) {
    const hardStop = a.startedAt + CEIL_MS;
    next.deadline = Math.min(now + BUMP_MS, hardStop);
    next.heldBy = null; next.heldRemaining = null; // a new leader cancels a hold
  }
  return next;
}

/* Withdraw a bid; priority falls to the next bidder. */
export function withdrawBid(a, seat) {
  const bids = a.bids.filter((s) => s !== seat);
  const leader = a.priority.find((s) => bids.includes(s)) ?? null;
  return { ...a, bids, leader };
}

/* Explicit pass — lets the table settle early once no threats remain. */
export function passBid(a, seat) {
  if (a.passed.includes(seat)) return a;
  return { ...a, passed: a.passed.concat([seat]), bids: a.bids.filter((s) => s !== seat),
           leader: a.priority.find((s) => a.bids.filter((x) => x !== seat).includes(s)) ?? null };
}

/* The free-taker declines their free take. */
export function passFree(a) { return { ...a, freeDecided: true }; }

/* Can we settle right now without waiting out the clock?
   Yes when every player who could still outrank the current leader has passed. */
export function canResolveEarly(a) {
  if (!a.freeDecided) return false;
  if (a.leader === null) return a.priority.every((s) => a.passed.includes(s));
  const idx = a.priority.indexOf(a.leader);
  return a.priority.slice(0, idx).every((s) => a.passed.includes(s));
}

/* Who wins when the window closes: the free-taker (if they took it),
   else the leading bidder, else nobody. */
export function auctionResult(a) {
  if (a.leader !== null) return { winner: a.leader, penalty: true };
  return { winner: null, penalty: false };
}
