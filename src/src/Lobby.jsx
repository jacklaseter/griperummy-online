import React, { useState } from "react";

/* The lobby. Everyone who has tapped the link and taken a seat shows up here,
   updating live as more people join (that's the Realtime subscription at work).
   The host sees a "Start game" button. */
export default function Lobby({ state, me, roomId, onStart, error }) {
  const [copied, setCopied] = useState(false);
  const isHost = state.hostId === me;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  function copy() {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>GRIPE <span style={{ color: "#d6ab61" }}>RUMMY</span></div>
        <div style={S.code}>Table <b>{roomId}</b></div>

        <div style={S.shareBox}>
          <div style={S.shareLabel}>Text this link to your family so they can join:</div>
          <div style={S.shareRow}>
            <input readOnly value={shareUrl} style={S.shareInput} onFocus={(e) => e.target.select()} />
            <button style={S.copyBtn} onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
          </div>
        </div>

        <div style={S.seatsLabel}>At the table ({state.players.length})</div>
        <div style={S.seats}>
          {state.players.map((p) => (
            <div key={p.id} style={S.seat}>
              <div style={S.avatar}>{p.name[0]?.toUpperCase()}</div>
              <span>{p.name}{p.id === me ? " (you)" : ""}{p.id === state.hostId ? " · host" : ""}</span>
            </div>
          ))}
        </div>

        {isHost ? (
          <button style={S.start} disabled={state.players.length < 2} onClick={onStart}>
            {state.players.length < 2 ? "Waiting for players…" : "Start game"}
          </button>
        ) : (
          <div style={S.waiting}>Waiting for the host to start…</div>
        )}
        {error && <div style={S.err}>{error}</div>}
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(1000px 500px at 50% -10%, #3a2340, #221629)", color: "#f3ead9", fontFamily: "system-ui, sans-serif", padding: 20 },
  card: { background: "#2e2038", border: "1px solid #d6ab6155", borderRadius: 16, padding: 24, width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,.4)" },
  brand: { fontSize: 26, fontWeight: 800, letterSpacing: 2, textAlign: "center" },
  code: { textAlign: "center", opacity: 0.85, letterSpacing: 1 },
  shareBox: { background: "#241826", borderRadius: 10, padding: 12, border: "1px solid #d6ab6122" },
  shareLabel: { fontSize: 12.5, opacity: 0.8, marginBottom: 8 },
  shareRow: { display: "flex", gap: 8 },
  shareInput: { flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 8, border: "1px solid #d6ab6144", background: "#1b1220", color: "#f3ead9", fontSize: 12 },
  copyBtn: { padding: "9px 14px", borderRadius: 8, border: "none", background: "#d6ab61", color: "#2a1c10", fontWeight: 700, cursor: "pointer" },
  seatsLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "#d6ab61" },
  seats: { display: "flex", flexDirection: "column", gap: 8 },
  seat: { display: "flex", alignItems: "center", gap: 10, background: "#241826", borderRadius: 10, padding: "8px 12px" },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(150deg,#d6ab61,#9a6a26)", color: "#2a1c0e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 },
  start: { padding: "13px 14px", borderRadius: 10, border: "none", background: "#d6ab61", color: "#2a1c10", fontWeight: 800, fontSize: 16, cursor: "pointer" },
  waiting: { textAlign: "center", opacity: 0.7, fontStyle: "italic", padding: "10px 0" },
  err: { color: "#e4886e", fontSize: 13, textAlign: "center" },
};
