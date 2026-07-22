import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard Vite + React setup. Netlify/Vercel/Supabase-hosting all understand this.
export default defineConfig({
  plugins: [react()],
});
