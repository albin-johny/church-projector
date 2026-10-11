# Verse Deck — project context (for Claude Code)

This file exists purely to hand off context to an AI coding assistant continuing this
project. It's not part of the app itself — safe to delete once you don't need it, or keep it
updated as a running dev log.

## What this is

A static, no-build web app for projecting song lyrics and Bible verses in a church service
(English / Malayalam / Hindi). Built because installing dedicated presentation software
(ProPresenter/EasyWorship/OpenLP) is blocked on the operator's Windows PC, but a browser is
available. The frontend is plain static files; **Supabase** (Postgres + Auth + Realtime) provides
login, the shared song library and the live link between control panel and projector displays.
Hosted on **Vercel**, pointed at a church subdomain.

## Architecture (all vanilla JS, no framework, no bundler)

```
church-projector/
  index.html        landing page, links to control.html and display.html
  control.html       operator UI (song library + Bible picker + live controls)
  display.html        the actual projector output (separate window / device / tab)
  css/style.css        control panel styling (design tokens as CSS vars in :root)
  css/display.css     projector output styling (separate token set)
  js/config.js         Supabase project URL + publishable key (safe to expose; RLS protects data)
  js/auth.js           Auth — Supabase Auth login gate for control.html (exposes Auth.client)
  js/link.js           ProjectorLink — local BroadcastChannel link + Supabase Realtime (.remote)
  js/store.js          SongStore — async song library backed by Supabase Postgres
  js/bible.js           BibleAPI — reads bundled local JSON (data/bible/*.json), no live API calls
  js/control.js         all operator-panel UI logic and state (single IIFE, no framework)
  js/display.js         projector output rendering logic (listens via ProjectorLink)
  data/songs.json      starter seed — ONLY 2 genuinely public-domain hymns (Amazing Grace, Doxology)
  data/bible/           bundled Bible text (JSON used by the app; .db/.xml are conversion sources)
  scripts/convert_bible_db.py   converts the .db / .xml Bible sources to the app's JSON shape
  supabase/schema.sql  database schema + RLS (already run on the project)
  robots.txt            Disallow: / (keeps the deployed site out of search engines)
  .vercelignore         keeps data/bible/*.db, *.xml, scripts/, supabase/ out of the deployment
  README.md             deployment + usage instructions (partly STALE — see "Pending")
```

## Key design decisions (so you don't accidentally undo them)

1. **No song lyrics are pre-populated beyond 2 public-domain hymns.** Almost all
   contemporary worship songs (Malayalam and English) are copyrighted. The church pastes in
   lyrics it has rights to use — don't add a bundled song database of copyrighted material.
2. **Database is the only song source.** Songs live in Supabase Postgres (see "Songs in the
   database"). localStorage is not a song store any more.
3. **Control ↔ Display link has two layers.** `BroadcastChannel('church-projector-v1')` +
   `localStorage` fallback for same-origin windows on one machine (instant, works offline —
   both pages must be served over http(s), not `file://`), and Supabase Realtime for
   other browsers/devices (see "Online mode").
4. **Bible data is bundled locally, not fetched live.** Zero per-chapter network requests and it
   works offline. Each version is a separate JSON file, fetched only when selected (see
   "Bible translations").
5. **Song slides are separated by blank lines** in the editor textarea (`parseSlides()` in
   `control.js`, splits on `/\n\s*\n/`). Bible slides are one verse each, or a combined
   selection (see "Bible tab").
6. **Fonts**: Fraunces (serif, display/verse text) + Hanken Grotesk (UI) + Noto Sans
   Malayalam + Noto Sans Devanagari, loaded from Google Fonts CDN in each HTML `<head>`.
   Requires internet on first load; not self-hosted.
7. **Theme**: the ☀/☾ toggle in the rail header applies to the control panel, the in-page
   "Present" overlay and any display window (`localStorage['cp_theme']`, broadcast via
   `ProjectorLink.setTheme()`). The projector output follows the theme (it is not always dark).
8. **Secrets**: only the Supabase publishable key is in the frontend. The database password /
   service_role key must never be put in the repo or frontend.

## Authentication

- Supabase Auth, one shared church email/password user (created in the Supabase dashboard).
- `js/auth.js` exposes async `Auth.isLoggedIn()/login(email, password)/logout()` plus
  `Auth.client` (the shared supabase-js client, reused by `store.js` and `link.js`). supabase-js
  is loaded from jsdelivr (pinned version). `control.js` shows `#login-overlay` until a session
  exists. Reminder: `Auth` is a top-level `const`, so check it with `typeof Auth`, not
  `window.Auth`.
- `display.html` is intentionally not gated; it uses the anon role (`join_session()` RPC +
  read `live_state` + Realtime broadcast).
- Logout releases the control seat before signing out.
- The old hardcoded-password gate is gone, but that old password remains in git history
  (treat as burned; it grants nothing now).

## Online mode (Supabase Realtime) — implemented

- **Session & pairing:** one `sessions` row for the church. After login the control panel
  shows its 6-character pairing code and a "Copy link" button. Displays pair via
  `display.html?code=XXXXXX`, or — for a display opened without a code (e.g. from a phone's home
  screen) — by typing the code into the on-screen **"Connect to control panel"** form that
  `display.html` shows when it has no saved code (also reachable via the corner **Code** button,
  which appears on mouse move/touch, or the P key). "Use this window without a code" skips it
  for the session (local same-browser link only). The code is remembered in
  `localStorage['cp_pair_code']`; a saved code that no longer matches reopens the form. `join_session(code)` (security definer) resolves a code to a
  session id for the anon role.
- **Transport:** Realtime *broadcast* channel `session:<uuid>`. `ProjectorLink.send()` delivers
  locally and, when online, broadcasts too; the last slide/blank/clear is upserted into
  `live_state` so a display that (re)connects catches up. Font scale and theme changes are
  broadcast too (not persisted remotely).
- **Take-over:** the control seat is `sessions.active_control_id` + `active_control_at`
  (heartbeat every 15s; a seat older than 45s counts as free). Logging in on another device
  asks "Take over?" only if the seat is genuinely active; the old panel then shows an
  "another device took over" overlay with a "take control back" button. Logout and page close
  release the seat.
- **Reconnect/refresh:** the display is independent of the control panel and keeps its last
  slide. After the control panel reloads it reads `live_state` (`remote.getLiveState()`) and shows
  the current slide in the mini preview (or "Display is blanked"); Next/Prev still start fresh
  from the selected song/chapter.
- **Presence:** every display tracks itself on the channel; the control panel shows
  "N displays connected" (falls back to the popup check when offline). Control panels don't
  count themselves.
- **Status:** control shows "Online: connected / connecting / error" (error text is the real
  message); displays show a small corner message only when not connected.
- RLS: `songs` and `sessions` require an authenticated user; `live_state` is writable by
  authenticated, readable by anon (session ids are random UUIDs; content is only the slide
  already on the projector).
- Messages over `ProjectorLink`:

```js
{ type: "slide", lang, title, text, ref,                 // songs: title on top, ref "1/4" under text
  text2?, lang2?,                                         // optional second text block
  footer?, footer2? }                                     // Bible: reference / version(s), bottom-centre
{ type: "blank" }
{ type: "clear" }
{ type: "fontscale", scale }   { type: "theme", theme }   { type: "takeover", device }
```

## Songs in the database — implemented

- `js/store.js` (`SongStore`) is Supabase-backed and **async**: `search(query, {lang,
  setlistOnly, offset, limit})` → `{songs, total}` (server-side `ilike` on `search_text`, 50 per
  page, "Load more" in the UI), `get`, `save` (upsert), `remove`, `toggleSetlist`, `count`,
  `exportJSON`, `importJSON` (upsert by id), `seedIfEmpty`, `loadSharedFromServer`. An in-memory
  cache makes already-listed songs readable synchronously via `getCached(id)`.
- `seedIfEmpty()` does a one-time migration of any old `cp_songs_v1` localStorage library into
  the DB (flag `cp_songs_v1_migrated`), then loads `data/songs.json` only if the table is empty.
- `control.js`: `state.songList/songTotal`, `refreshList()` (re-query) vs `renderList()` (draw).
  Search input is debounced 250ms. Bookmarks (`inSetlist`) are one shared flag for everyone.
- Offline: the song library is unavailable without a connection. The Bible, Custom text and the
  local display link still work offline.
- Import matches by id only (no title de-duplication). Export pages through the whole table.

### Data model

```js
// One song in SongStore (app side, camelCase; DB columns are snake_case):
{
  id: "s_...",
  title: "Amazing Grace",
  language: "en" | "ml" | "hi",
  tags: ["hymn", "grace"],
  // language === "en": slides are plain strings, one per projector slide.
  slides: ["slide 1 text", "slide 2 text", ...],
  // language === "ml" or "hi": slides are { text, en } pairs instead — native-script lyrics plus
  // a Manglish/English transliteration, shown stacked (text / text2). Either side can be blank,
  // but not both — enforced in control.js's saveSongFromEditor(). Anything touching song.slides
  // directly must check typeof slide first (see songToLiveSlides()/isDualTextSong()).
  inSetlist: false,          // the UI calls it "bookmarks"
  sourceUrl, lyricist, copyright,   // reserved for the importer
  updatedAt: <timestamp>
}
```

### Database (supabase/schema.sql)

- `songs`: `id` text pk (keeps `s_...` ids), `title`, `language`, `tags` text[], `slides` jsonb,
  `in_setlist`, `source_url`, `lyricist`, `copyright`, `search_text` (filled by trigger from
  title + flattened slides + tags, trigram-indexed so Malayalam/Devanagari search works),
  `updated_at`.
- `sessions`: `id`, `pairing_code` unique, `active_control_id`, `active_control_at`, `created_at`.
- `live_state`: `session_id` pk/fk, `message` jsonb, `updated_at`; in the realtime publication.
- An ordered per-service setlist is NOT modelled yet (would be a `setlist_items` table).

## Bible translations (bundled)

| lang | id | file | source |
|---|---|---|---|
| en | `eng_kjv` (default) | `data/bible/en.json` | helloao complete.json |
| en | `eng_ukjv` | `data/bible/en_ukjv.json` | `english_ukjv.db` |
| en | `eng_niv` | `data/bible/en_niv.json` | `EnglishNIVBible.xml` (NIV is copyrighted — check the church's licence; the repo/site is publicly downloadable) |
| ml | `mal_fbf` (default) | `data/bible/ml.json` | helloao complete.json |
| ml | `mal_bsi` | `data/bible/ml_bsi.json` | `municode_12.db` (Malayalam BSI Unicode; 8 verses empty in source) |
| hi | `HINIRV` (default) | `data/bible/hi.json` | helloao complete.json |
| hi | `hin_unicode` | `data/bible/hi_unicode.json` | `hindi_unicode.db` (Bible Society of India) |

- `TRANSLATIONS` in `js/bible.js` is an ordered list per language with a short `label` shown in
  the UI and footer ("KJV", "Malayalam BSI", …). `BibleAPI.getVersionList()` returns all
  versions synchronously. All files share helloao's shape and USFM book ids (GEN…REV).
- The `.db` files are SQLite (`words(word, bookNum, chNum, verseNum)` + `configuration`); the
  `.xml` is `<bible><testament><book number><chapter number><verse number>`. Browsers can't use
  them directly, so `scripts/convert_bible_db.py` converts them to JSON. Re-run it after
  adding/changing a source. The sources are kept in `data/bible/` on purpose (not deleted) but
  are excluded from deployment by `.vercelignore`.
- JSON is the right runtime format here (native in the browser; SQLite would need a WASM
  library, XML is bigger/slower). If load time ever matters, split per book.

## Bible tab (current layout & behaviour)

- Left rail: **books** (left column) and **chapters** (narrow right column), each scrolling
  independently — `renderBibleRail()`. The book list comes from Version 1. The rail list itself
  is `overflow:hidden` in Bible mode so the page never scrolls (`.app` has
  `grid-template-rows: minmax(0,1fr)`).
- Centre pane: **Version 1** and optional **Version 2** dropdowns (all versions, grouped by
  language; remembered in `localStorage['cp_bible_versions']`). The whole chapter is always
  loaded and drawn as rows `verse number | Version 1 | Version 2`, aligned by verse number
  (`drawVerseList()`). There is no language pill, verse-range, per-slide, Load or status line.
  Errors show as toasts.
- Selecting: click = that verse; **Shift+click** = range from the last clicked verse;
  **Ctrl/⌘+click** = add/remove a verse. The selection goes on screen as one slide
  (`makeBibleSlide()`: `text` = Version 1, `text2` = Version 2, `nums`, `key`). Next/Prev then
  continue one verse at a time (`state.liveOverride` holds the combined slide while the index
  is unchanged). Live rows are highlighted from `state.liveNums`/`state.liveKey`.
- Footer: Bible slides carry `footer` (reference, e.g. "John 3:16-18") and `footer2`
  (version(s), e.g. "KJV · Malayalam BSI"). The display (`#verse-footer`) and the in-page
  present overlay (`#present-footer`) show the reference prominently at bottom-centre with the
  versions small underneath; `pushLive()` blanks the top title and verse-number line for them.

## Mobile / portrait-tablet control layout (<= 900px)

- One screen at a time: header + tabs on top, then either the library list (`.app.view-list`)
  or the content (`.app.view-stage`: song / chapter verses / editor / custom), toggled by
  `setMobileView()` in `control.js`; a "← Back to list" button (`#btn-mobile-back`) returns.
  Picking a song, a Bible chapter, "+ New song" or the Custom tab opens the content view.
- The preview pane becomes a bottom dock: status dots, a small preview, and Prev / Next /
  Blank / Clear. Font scale, open-display/present buttons, pairing row and hints are hidden
  there (use desktop for those). `.rail` is `display: contents` so its pieces are direct flex
  children of `.app`. Desktop (> 900px) keeps the three-column grid; view classes do nothing.

## Projector display layout

- The text area (`#stage-inner`) is a flex child above the footer, so long verses can't run
  into the reference. `ProjectorLink.fitText()` starts from the length-based `pickFontSize()`
  and shrinks the text (min 14px) until it fits; it re-runs on window resize, font load and
  A−/A+. Same logic in the in-page present overlay (`refitPresent()`).
- The control panel's mini preview uses the stage background/text colours so it follows the
  theme.

## Keep-alive

`.github/workflows/keep-alive.yml` (GitHub Actions) sends one read request to Supabase every
3 days (and on manual "Run workflow") so the free tier doesn't pause after ~7 idle days. It
uses the public URL + publishable key and expects HTTP 200 from `live_state`. GitHub disables
scheduled workflows after 60 days without repo activity — re-enable under the Actions tab if
that ever happens.

## Current status / what's working

- Login (Supabase Auth), shared song library in Postgres (add/edit/delete/search/bookmark/
  import/export), Bible tab with 7 versions and two-version view, realtime pairing/take-over/
  presence, local popup display, light/dark theme, font scale, blank/clear.
- Deployed on Vercel (to be pointed at the church subdomain; add the final URL under Supabase →
  Authentication → URL Configuration).

## Pending / next (paused items)

- **Keep-alive caveat**: GitHub disables the scheduled workflow after 60 days without commits;
  the operator chose to find a workaround later (e.g. cron-job.org ping, or a Vercel cron).


- **Subdomain**: point the church subdomain (GoDaddy DNS CNAME → Vercel), add it in Vercel and
  in Supabase allowed URLs; decide whether to rotate the old git-history password / make the
  repo private (NIV text is in the repo).
- **README.md is stale** (still describes localStorage-only + manual export sharing).
- **Importer** (web scraping with attribution) — last, runs outside the app, copyright caveat.
- **Ordered service setlist** (today only unordered bookmarks).
- Bible reference jump box ("John 3:16").
- Keyboard shortcut cheatsheet in the UI; "which song is live" indicator; undo for delete.
- Optional: choose a different default Bible version per language (reorder `TRANSLATIONS`).

## Person's environment

Testing locally on a MacBook via VS Code + Live Server extension, folder at
`~/Desktop/files/church-projector`. Production on Vercel (church subdomain planned); the operator
PC is Windows with a browser only.
