import { createClient } from "@supabase/supabase-js";

// The two values below come from your Supabase project (Settings → API).
// They live in a ".env" file so they're not hard-coded. Vite exposes any
// variable that starts with VITE_ to the browser.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Friendly message instead of a blank white screen if the .env isn't set yet.
  console.error("Missing Supabase config. Copy .env.example to .env and fill in your values.");
}

export const supabase = createClient(url, anonKey);

// A stable per-browser id so a player keeps their seat across refreshes.
export function myClientId() {
  let id = localStorage.getItem("gr_client_id");
  if (!id) { id = "p_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("gr_client_id", id); }
  return id;
}
