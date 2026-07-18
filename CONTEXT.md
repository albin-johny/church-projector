# Verse Deck — project context (for Claude Code)

This file exists purely to hand off context to an AI coding assistant continuing this
project. It's not part of the app itself — safe to delete once you don't need it, or keep it
updated as a running dev log.

## What this is

A static, no-build, no-server web app for projecting song lyrics and Bible verses in a church
service (English / Malayalam / Hindi). Built because installing dedicated presentation
software (ProPresenter/EasyWorship/OpenLP) is blocked on the operator's Windows PC, but a
browser is available. Runs identically on the operator's laptop locally, or hosted statically
on a church subdomain later.

## Architecture (all vanilla JS, no framework, no bundler)

```
church-projector/
  index.html        landing page, links to control.html and display.html
  control.html       operator UI (song library + Bible picker + live controls)
  display.html        the actual projector output, opened as a separate window/tab
  css/style.css        control panel styling (design tokens as CSS vars in :root)
  css/display.css     projector output styling (separate token set, dark stage look)
  js/link.js           ProjectorLink — cross-window messaging (BroadcastChannel + localStorage fallback)
  js/store.js          SongStore — song library CRUD, backed by localStorage, import/export JSON
  js/bible.js           BibleAPI — reads bundled local JSON (data/bible/*.json), no live API calls
  js/control.js         all operator-panel UI logic and state (single IIFE, no framework)
  js/display.js         projector output rendering logic (listens via ProjectorLink)
  data/songs.json      starter seed — ONLY 2 genuinely public-domain hymns (Amazing Grace, Doxology)
  data/bible/           bundled full Bible text for the 3 fixed translations (~31MB total, see below)
  README.md             deployment + usage instructions for the church's team
```

## Key design decisions (so you don't accidentally undo them)

1. **No song lyrics are pre-populated beyond 2 public-domain hymns.** Almost all
   contemporary worship songs (Malayalam and English) are copyrighted. The app is designed
   for the church to paste in lyrics they already have rights to use — don't add a bundled
   song database of copyrighted material.
2. **No backend/database.** Song library lives in `localStorage`, seeded from
   `data/songs.json` on first load if localStorage is empty (`SongStore.seedIfEmpty()`).
   Sharing across machines currently works via manual Export → upload `data/songs.json` →
   other machines re-seed. This was a deliberate simplicity trade-off — see README's "Sharing
   the library across the team" section if asked to build a real shared backend later.
3. **Control ↔ Display link is same-origin only.** Uses `BroadcastChannel('church-projector-v1')`
   with a `localStorage` fallback (`js/link.js`). This is why both pages must be served from
   the same origin (e.g. both via `http://127.0.0.1:5500/...` through a local dev server) —
   opening HTML files directly via `file://` breaks it, since each `file://` document is
   treated as a unique origin. Currently being run locally via VS Code's Live Server extension.
4. **Bible data is bundled locally, not fetched live.** The church only ever needs one fixed
   translation per language — KJV (`eng_kjv`), Malayalam 1910/BSI (`mal_fbf`), Hindi IRV
   (`HINIRV`, note the uppercase ID — the API's ID casing is inconsistent) — so
   `data/bible/{en,ml,hi}.json` are one-time downloads of each translation's
   `/api/<id>/complete.json` from `https://bible.helloao.org`, committed to the repo.
   `js/bible.js` reads these files instead of hitting the API, so the Bible tab works fully
   offline and has zero per-chapter network requests. Total ~31MB uncompressed / ~5.6MB
   gzipped (most static hosts gzip automatically). To add/change a translation, re-download
   the relevant `complete.json` and update the `TRANSLATIONS` map in `js/bible.js`.
5. **Slides are separated by blank lines** in the song editor textarea
   (`parseSlides()` in `control.js`, splits on `/\n\s*\n/`). Bible verses are grouped into
   slides via `BibleAPI.buildSlides(verses, from, to, perSlide)`.
6. **Fonts**: Fraunces (serif, display/verse text) + Hanken Grotesk (UI) + Noto Sans
   Malayalam + Noto Sans Devanagari, loaded from Google Fonts CDN in the `<head>` of each
   HTML file. Requires internet on first load; not self-hosted.

## Data model

```js
// One song in SongStore:
{
  id: "s_...",
  title: "Amazing Grace",
  language: "en" | "ml" | "hi" | "bi",   // bi = bilingual/mixed
  tags: ["hymn", "grace"],
  slides: ["slide 1 text", "slide 2 text", ...],
  updatedAt: <timestamp>
}
```

```js
// A "live" message sent over ProjectorLink:
{ type: "slide", lang: "en"|"ml"|"hi", title: "...", text: "...", ref: "1/4" }
{ type: "blank" }
{ type: "clear" }
```

## Current status / what's working

- Song library: add/edit/delete/search/import/export — working.
- Bible: language pill → translation → book → chapter → verse-range slides — working, calls
  the live API each time (not cached beyond `sessionStorage` for translations/books lists).
- Control panel ↔ display window: working *only when served over http(s), not file://*.
- Not yet built: any authentication, any shared/live-sync backend, any way to reorder songs
  into a service order/setlist (currently one song or one Bible passage at a time, no queue).

## Known rough edges / things worth improving next

- No confirmation/undo on song delete beyond a `confirm()` dialog.
- No keyboard shortcut cheatsheet visible in the UI (Arrow keys / B for blank are wired up in
  `control.js` but undocumented in-app).
- No visual indicator in the song list of *which* song is currently live if the operator
  navigates away from it.
- Bible reference jump box (e.g. typing "John 3:16" directly) doesn't exist yet — currently
  book/chapter dropdowns + verse-from/verse-to number fields only.
- No dark/light theme toggle — display.html is intentionally always dark/black for projector
  legibility; that's a deliberate choice, not an oversight.

## Person's environment

Testing locally on a MacBook via VS Code + Live Server extension, folder at
`~/Desktop/files/church-projector`. Eventually deploying to a church subdomain via static
hosting (cPanel/FTP or Netlify) — see README.md for that part.
