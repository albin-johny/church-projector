# Verse Deck

A browser-based song & scripture projector for church services — English, Malayalam and Hindi.
Nothing to install on the operator's PC: the control panel and the projector screen are two
web pages. The front end is plain static files (no build step); [Supabase](https://supabase.com)
provides the login, the shared song library and the live link between devices.

## How it works

- **`control.html`** — the operator's panel (laptop, tablet or phone). Log in, pick songs or
  Bible verses, build a service order, and click a slide to put it live.
- **`display.html`** — the screen that goes on the projector. Open it on any device, enter the
  display code shown on the control panel (or open the "Copy link" URL), and go fullscreen
  (**F** / **F11**).
- Control and display are linked two ways: instantly in the same browser (`BroadcastChannel`),
  and over Supabase Realtime for other devices. A display that reconnects catches up to the
  slide currently on screen.
- The **song library** and the **service order** live in the Supabase database, shared by
  everyone using the church login.
- The **Bible** is bundled in the site (`data/bible/*.json`) — no lookups, works offline.

## Installing as an app (PWA)

Open the site in Chrome/Edge/Safari and use *Install app* / *Add to Home Screen*. Install the
control panel (`control.html`) on phones and tablets, and `display.html` on the projector
device — the display installs full screen and remembers its code. Songs and the live link still
need the internet; the Bible and the app itself load even when the connection is poor.

## Working without internet (one laptop + projector)

Open the site once with internet (a phone hotspot is fine), log in, and let it finish — you'll
see "Saved N songs for offline use". After that the same laptop can run a service with no
internet: search and show songs, the Bible, Custom text, and the display window on the projector
all work. Editing songs, bookmarks and changing the service order need a connection. A phone
remote talking to a *separate* display PC needs internet.

## Using the control panel

| Area | What it does |
|---|---|
| **Songs** | Search (title, lyrics, tags — any language), ★ bookmarks, add/edit/delete, Import / Export. Click a slide to show it. |
| **Bible** | Pick **Version 1** (and optionally **Version 2** to show two versions side by side), choose a book and chapter on the left. Click a verse; **Shift+click** for a range; **Ctrl/⌘+click** to add/remove single verses. |
| **Jump box** | Above the books list: type `John 3:16`, `1 cor 13:4-7`, `ps 23` (English names for every version). **Enter** jumps and selects, **Enter again** puts it on screen. `/` focuses it. |
| **Custom** | Paste one-off announcements/readings; a blank line starts a new slide. |
| **Service** | Your running order. Use "＋ Add to service" on songs, selected Bible verses and custom text; reorder with ▲ ▼; **Next item / Prev item** loads and shows each item. |

Controls on the right: **Prev / Next**, **Blank**, **Clear**, **A− / A+** (projector text
size), **Open display window**, **Present on this screen** (single-monitor mode). Keyboard:
←/→ or ↑/↓ for previous/next slide, **B** blank, **Space/Enter** show the selection.

On a phone or portrait tablet (≤ 900px) the panel is one scrolling page with Prev / Next /
Blank / Clear pinned to the bottom.

### Moving the control panel between devices

Log in on the new device. If another device was active in the last minute you'll be asked to
take over; the old panel locks. The display keeps its connection and its last slide the whole
time.

## First-time setup (once per church)

1. **Supabase project** (free tier): create one at supabase.com.
2. **Database**: SQL Editor → paste and run [`supabase/schema.sql`](supabase/schema.sql)
   (safe to re-run).
3. **Login**: Authentication → Users → *Add user* (email + password, auto-confirm). This one
   shared login is for the control panel.
4. **Config**: put the project URL and the *publishable* key in [`js/config.js`](js/config.js).
   Never put the database password or a secret / service_role key in this repo.
5. **Deploy** (below), then add the final site URL under Authentication → URL Configuration.

## Deploying

The site is static; it is hosted on **Vercel** (connected to this GitHub repo, so every push to
`main` deploys) and can be pointed at a church subdomain (CNAME → Vercel, then add the domain
in Vercel's Domains settings). Any static host also works. `.vercelignore` keeps the Bible
source files, `scripts/` and `supabase/` out of the deployment.

`.github/workflows/keep-alive.yml` pings Supabase every 3 days so the free tier doesn't pause
after a week of inactivity (GitHub disables scheduled workflows after 60 days without commits —
re-enable it in the Actions tab if that happens).

## Songs and copyright

Nearly all modern worship songs are copyrighted. The app ships with just two public-domain
hymns as examples (`data/songs.json`, loaded only into an empty library). Add songs your church
has the right to use: Songs tab → **New song**, paste the lyrics, a blank line = a new slide.
Malayalam and Hindi songs take native-script lyrics plus an optional English/Manglish line per
stanza, shown together.

Use **Export** now and then for a JSON backup of the library (the free tier has no automatic
backups).

## Bible versions

Bundled: KJV, UKJV, NIV (English), Malayalam 1910 and Malayalam BSI, Hindi IRV and Hindi Bible
(BSI). To add one, put its `.db` (SQLite `words` table) or simple `.xml` file in `data/bible/`,
add it to `TARGETS` in `scripts/convert_bible_db.py`, run `python3 scripts/convert_bible_db.py`,
then add the generated JSON to `TRANSLATIONS` in `js/bible.js`. Check the licence of any
translation you add — the NIV in particular is copyrighted.

## Notes

- Needs internet for: Google Fonts on first load, the song library, and the cross-device link.
  The Bible, Custom text and the same-browser display link work without it.
- Malayalam and Hindi use Noto Sans Malayalam / Noto Sans Devanagari so verses and songs show
  correctly on the projector without extra setup.
- `CONTEXT.md` is a developer hand-off log (architecture, decisions, pending work).
