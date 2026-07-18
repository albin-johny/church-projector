# Verse Deck

A browser-only song & scripture projector for church services — English, Malayalam and Hindi.
No installation on any machine, no server-side code, no database. Just static files you can
host anywhere, opened in a normal browser tab.

## How it works

- **`control.html`** — the operator's panel. Search/add/edit songs, browse the Bible, click a
  slide to put it live.
- **`display.html`** — the plain black screen that actually goes on the projector. Open it,
  drag it onto the extended/projector monitor, press **F** for fullscreen.
- The two pages talk to each other instantly over `BroadcastChannel` (same browser, same
  machine) — nothing goes over the internet for that part, so it's as fast as your monitor's
  refresh rate.
- The **song library** lives in the browser's `localStorage` on whichever machine you're using,
  seeded from `data/songs.json` the first time it loads.
- The **Bible** is fetched live from the [Free Use Bible API](https://bible.helloao.org) —
  free, no key, no copyright restrictions on the text — filtered to English, Malayalam and
  Hindi translations.

## Deploying to your church subdomain

This is a fully static site — there is no build step and no server requirement beyond serving
files. Any of these work:

1. **cPanel / shared hosting** (most church website hosts): create the subdomain (e.g.
   `verses.yourchurch.org`), then upload every file in this folder to its document root via
   the File Manager or FTP, keeping the folder structure (`css/`, `js/`, `data/`) intact.
2. **Netlify / Vercel / GitHub Pages** (free): drag-and-drop this folder, or connect it as a
   repo — point the custom subdomain at it. Also works well if you'd rather not touch the
   church's main hosting at all.
3. **A shared network drive / USB**, for a single-laptop setup with no hosting at all — open
   `index.html` directly in the browser. (The Bible lookup still needs internet; the song
   library and display link work fully offline.)

Once uploaded, `https://verses.yourchurch.org/` is your landing page, with links into the
control panel and display.

## Building your song library (the copyright-safe way)

Nearly all modern worship songs — Malayalam and English — are copyrighted, even the ones sung
freely in services. This app deliberately ships with an **empty library** (plus two
genuinely public-domain hymns as a working example) rather than pre-loaded lyrics. Add the
songs your church already has the right to use:

1. Open the control panel → **Songs** tab → **New song**.
2. Paste in the lyrics you already use (from your own songbook, files, or CCLI SongSelect if
   your church has a licence). Leave a blank line between verses/chorus — each blank line
   becomes a new projector slide.
3. Save. It's now in your browser's library permanently.

### Sharing the library across the team

Because this is a static site with no database, the simplest reliable way to keep everyone's
copy in sync is:

1. Build up the library on one machine.
2. Songs tab → **Export** → downloads `songs.json`.
3. Upload that file to `data/songs.json` on your hosting, replacing the starter file.
4. On any other machine, open the app fresh (or clear the browser's local song data) — it
   will seed itself from the shared `data/songs.json` automatically. You can also re-import a
   newer copy any time via **Import** (it merges by title, so duplicates get updated, not
   doubled).

This is deliberately low-tech so it works on any hosting with zero setup. If down the track
you want *live* shared editing (no export/upload step), the natural upgrade is a small PHP
endpoint or a free tier of Firebase/Supabase writing to the same `data/songs.json` shape —
happy to build that layer once you know what your host supports.

## Using the Bible

Bible → pick a language pill (English / Malayalam / Hindi) → pick a translation, book and
chapter → **Load** → click any verse (or verse range) to put it live. "Verses per slide" lets
you group 2–3 short verses onto one slide if that reads better on your screen.

## Notes

- Needs an internet connection for: loading the Google fonts on first visit, and any Bible
  lookup. The song library and the control↔display link work with no internet at all once the
  page has loaded once.
- Everything renders in the browser's own fonts for Malayalam (Noto Sans Malayalam) and Hindi
  (Noto Sans Devanagari), so verses and song titles in either script display correctly on the
  projector without extra setup.
