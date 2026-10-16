#!/usr/bin/env node
/* Verse View songbook importer (internal use — our own community site).

   Three resumable steps, all state kept under import/ (git-ignored, never deployed):

     node scripts/import-verseview.mjs titles            # 1 request: the title list
     node scripts/import-verseview.mjs fetch --limit 700 # fetch up to N not-yet-fetched songs
     node scripts/import-verseview.mjs convert           # build import/songs-import.json

   Add `--lang hi` (Hindi) or `--lang ta` (Tamil) to any step; state goes in import/<code>/.
   Default is `--lang ml` (Malayalam).

   Then load import/songs-import.json with the control panel's Songs → Import button.

   Polite by design: one request at a time, DELAY_MS + jitter between requests, stops after
   consecutive failures, skips songs already saved in import/raw/ — so run `fetch` once a day
   until it reports 0 remaining.

   The site's TLS certificate doesn't validate, so (like the browser's "--insecure" curl) the
   requests skip certificate verification for verseview.info ONLY.
*/
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'verseview.info';
// One entry per supported language; every song in a category shares its language.
// Malayalam keeps its original state in import/; other languages get import/<code>/.
const CATEGORIES = {
  ml: 'VV Malayalam 2021',
  hi: 'VV Hindi 2021',
  ta: 'VV Tamil 2021'
};
const argv = process.argv.slice(2);
const langIdx = argv.indexOf('--lang');
const LANGUAGE = langIdx >= 0 ? argv[langIdx + 1] : 'ml';
const CATEGORY = CATEGORIES[LANGUAGE];
if (!CATEGORY) { console.error(`Unknown --lang "${LANGUAGE}". Use: ${Object.keys(CATEGORIES).join(', ')}`); process.exit(1); }
const DELAY_MS = 2500;                  // between song requests (+ up to 1.5s jitter)
const MAX_CONSECUTIVE_FAILURES = 3;
const UA = 'VerseDeck-internal-importer/1.0 (church songbook migration)';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'import');
const ROOT = LANGUAGE === 'ml' ? BASE : path.join(BASE, LANGUAGE);
const RAW = path.join(ROOT, 'raw');
const TITLES = path.join(ROOT, 'titles.json');
const OUT = path.join(ROOT, 'songs-import.json');
const REPORT = path.join(ROOT, 'report.txt');

const agent = new https.Agent({ rejectUnauthorized: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(endpoint, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, path: '/songbook/' + endpoint, method: 'POST', agent,
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'content-length': Buffer.byteLength(body),
        accept: 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://' + HOST,
        referer: 'https://' + HOST + '/songbook/',
        'user-agent': UA
      },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('Not JSON: ' + text.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

const rawFile = (id) => path.join(RAW, `${id}.json`);
const asArray = (v) => (Array.isArray(v) ? v : Object.values(v || {}));

async function cmdTitles() {
  fs.mkdirSync(RAW, { recursive: true });
  const list = asArray(await post('titledb.php', { catName: CATEGORY }));
  const seen = new Set();
  const titles = list.filter((t) => t && t.name && !seen.has(t.name) && seen.add(t.name));
  fs.writeFileSync(TITLES, JSON.stringify(titles, null, 1));
  console.log(`Saved ${titles.length} titles (${list.length - titles.length} duplicates dropped) → ${TITLES}`);
}

async function cmdFetch(limit) {
  if (!fs.existsSync(TITLES)) throw new Error('Run the "titles" step first.');
  fs.mkdirSync(RAW, { recursive: true });
  const titles = JSON.parse(fs.readFileSync(TITLES, 'utf8'));
  // Raw files are named by the song's site id once known; titles carry no id, so we track
  // fetched names in a small index.
  const indexFile = path.join(ROOT, 'fetched.json');
  const fetched = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
  const todo = titles.filter((t) => !fetched[t.name]);
  console.log(`${titles.length} titles, ${Object.keys(fetched).length} fetched, ${todo.length} remaining.`);
  let done = 0, fails = 0;
  for (const t of todo) {
    if (done >= limit) break;
    try {
      const res = asArray(await post('songsdb.php', { songName: t.name, category: CATEGORY }));
      const song = res.find((s) => s && s.name === t.name) || res[0];
      if (!song || !song.id) throw new Error('empty result');
      fs.writeFileSync(rawFile(song.id), JSON.stringify(song, null, 1));
      fetched[t.name] = song.id;
      // Write-then-rename so stopping the script (Ctrl+C) can never leave a half-written index.
      fs.writeFileSync(indexFile + '.tmp', JSON.stringify(fetched));
      fs.renameSync(indexFile + '.tmp', indexFile);
      done++; fails = 0;
      console.log(`[${done}/${Math.min(limit, todo.length)}] ${t.name}`);
    } catch (e) {
      fails++;
      console.error(`FAILED "${t.name}": ${e.message}`);
      if (fails >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`Stopping after ${fails} failures in a row. Progress is saved; run again later.`);
        break;
      }
    }
    await sleep(DELAY_MS + Math.random() * 1500);
  }
  const remaining = todo.length - done;
  console.log(`Done: ${done} fetched this run, ${remaining} remaining.`);
}

/* ---------- conversion ---------- */
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

// "<slide>"-separated stanzas; <BR> = line break; leading "1 ", "2 " verse numbers dropped.
// Empty stanzas are KEPT here so the native and transliteration lists stay aligned by position;
// pairs that are empty on both sides are dropped afterwards.
function splitSlides(html, keepMarkers) {
  return String(html || '')
    .split(/<slide>/i)
    .map((chunk) => {
      let t = chunk.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      t = decode(t).replace(/\r/g, '');
      t = t.split('\n').map((l) => l.trim()).join('\n').trim();
      t = t.replace(/^\d+\s+/, '');                      // stanza number
      if (!keepMarkers) t = t.split('\n').map((l) => l.replace(/\s*;-\s*$/, '')).join('\n');
      return t.trim();
    });
}

function cmdConvert(keepMarkers) {
  const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.json')) : [];
  const songs = [];
  const notes = [];
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    const a = splitSlides(r.lyrics, keepMarkers);
    const b = splitSlides(r.lyrics2, keepMarkers);
    const na = a.filter(Boolean).length, nb = b.filter(Boolean).length;
    if (!na && !nb) { notes.push(`SKIPPED (no lyrics): ${r.name} [${r.id}]`); continue; }
    if (nb && na !== nb) {
      notes.push(`PARTIAL transliteration (${nb} of ${na} stanzas): ${r.name} [${r.id}]`);
    }
    const n = Math.max(a.length, b.length);
    const slides = Array.from({ length: n }, (_, i) => ({ text: a[i] || '', en: b[i] || '' }))
      .filter((sl) => sl.text || sl.en);
    const tags = new Set(String(r.tags || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean));
    if (r.title2 && r.title2.trim()) tags.add(r.title2.trim());       // native-script title, searchable
    songs.push({
      id: 'vv_' + r.id,
      title: String(r.name).trim(),
      language: LANGUAGE,
      tags: Array.from(tags),
      slides,
      inSetlist: false,
      lyricist: (r.copy || '').trim() || null
    });
  }
  fs.writeFileSync(OUT, JSON.stringify({ songs, exportedAt: new Date().toISOString() }, null, 1));
  const withLyricist = songs.filter((s) => s.lyricist).length;
  const report = [`${songs.length} songs → ${OUT}`, `${withLyricist} with a lyricist (copy field)`, ...notes].join('\n');
  fs.writeFileSync(REPORT, report + '\n');
  console.log(report);
}

const [cmd, ...rest] = argv;
const flag = (name, dflt) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : dflt; };
try {
  if (cmd === 'titles') await cmdTitles();
  else if (cmd === 'fetch') await cmdFetch(Number(flag('--limit', 700)));
  else if (cmd === 'convert') cmdConvert(rest.includes('--keep-markers'));
  else console.log('Usage: import-verseview.mjs titles | fetch [--limit N] | convert [--keep-markers]  (add --lang ml|hi|ta)');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
