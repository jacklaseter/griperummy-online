# Getting Gripe Rummy online — the recipe

This is a follow-along guide. We'll do it together, live — you tell me what you
see, I tell you the next step. Nothing here can break anything permanently, and
every step can be redone. Set aside an afternoon.

You'll make **three free accounts**: GitHub (holds the code), Supabase (the
database + live sync), and Netlify (puts the website online). None require a
credit card for what we're doing.

There is **no coding**. A few times you'll copy a value I give you and paste it
into a box. That's it.

---

## The map (what we're doing and why)

1. **Supabase** — creates the shared "table" the game state lives in, and does
   the live syncing between players. You'll run one setup script and copy two
   values.
2. **GitHub** — an online folder that holds the game's code.
3. **Netlify** — reads the code from GitHub and turns it into a real website
   with a link you can text your family.

---

## Step 1 — Supabase (the database + live sync)

1. Go to **supabase.com** → sign up (free) → **New project**.
2. Give it a name (e.g. "gripe-rummy"), set a database password (save it
   somewhere), pick the closest region → **Create**. Wait ~2 minutes.
3. Left sidebar → **SQL Editor** → **New query**. Open the file
   `supabase-setup.sql` from this project, copy ALL of it, paste it in, and
   click **Run**. You should see "Success".
4. Left sidebar → **Project Settings** (gear) → **API**. You'll see two values
   we need. Keep this tab open — we'll paste these into Netlify in Step 3:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long string). Use the one labeled **anon / public**,
     NOT the "service_role" one.

That's all Supabase needs. ✅

---

## Step 2 — GitHub (store the code)

1. Go to **github.com** → sign up (free).
2. Click **New repository** → name it `griperummy-online` → keep it Public or
   Private (either is fine) → **Create repository**.
3. On the new repo page, click **"uploading an existing file"**.
4. Drag in **all the files and folders from this project** (the whole
   `griperummy-online` folder's contents — `src`, `package.json`, `index.html`,
   `vite.config.js`, `supabase-setup.sql`, etc.). Do **not** upload
   `node_modules` if it exists — it's not needed.
5. Click **Commit changes**.

The code now lives on GitHub. ✅

---

## Step 3 — Netlify (put it online)

1. Go to **netlify.com** → sign up with your **GitHub** account (easiest).
2. **Add new site** → **Import an existing project** → **GitHub** → authorize →
   pick your `griperummy-online` repo.
3. Netlify auto-detects Vite. Confirm these (it usually fills them in):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Before deploying, click **"Add environment variables"** (or **Site settings →
   Environment variables** afterward) and add the two Supabase values from
   Step 1:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. Click **Deploy**. Wait ~1 minute. Netlify gives you a link like
   `https://something-random.netlify.app`.

Open that link. You should see the Gripe Rummy start screen. 🎉

---

## Step 4 — Try it with two "players"

1. Open the Netlify link, type a name, **Create a table**. You'll get a table
   code and a shareable link.
2. Copy that link, open it in a **second browser** (or your phone), type a
   different name, **Take a seat**.
3. Watch: the first screen shows the new player appear instantly. That's the
   live sync working.
4. Host clicks **Start game**. Deal happens; each device shows its own hand;
   draw and discard, and watch it move on the other screen.

If that works, the plumbing is proven and we move on to layering the full game
(melding, the buy auction, the kitchen-table look) on top.

---

## A friendly web address (optional, later)

Netlify lets you rename the free address (Site settings → Change site name) to
something like `griperummy.netlify.app` for free. A custom domain like
`griperummy.com` is the same domain-pointing you've done before — buy the name,
paste two records Netlify gives you into the domain's DNS. Not needed to play.

---

## If something goes wrong

- **Blank screen / "Missing Supabase config":** the two environment variables in
  Netlify aren't set or are misspelled. They must be exactly
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. After fixing, redeploy
  (Netlify → Deploys → Trigger deploy).
- **"Table not found" when joining:** the code was mistyped, or the room was
  created on a different Supabase project.
- **Players don't sync:** the SQL script's Realtime line didn't run — re-run
  `supabase-setup.sql`.
- **Anything else:** copy the exact error text and send it to me. Almost every
  first-time snag is a value in the wrong box, and it's a two-minute fix.
