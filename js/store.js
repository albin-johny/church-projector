/* Song library storage — Supabase Postgres (table `songs`, see supabase/schema.sql).
   Requires the signed-in church user (js/auth.js); RLS blocks everyone else.

   Everything that talks to the server is async. Songs seen by search()/get()/save() are kept
   in an in-memory cache so the UI can read an already-listed song synchronously with
   getCached(). The cache is a convenience only — the database is the single source of truth.

   App-side song shape (camelCase) <-> DB row (snake_case):
     id, title, language, tags[], slides[], inSetlist <-> in_setlist,
     sourceUrl <-> source_url, lyricist, copyright, updatedAt <-> updated_at
*/
const SongStore = (() => {
  const TABLE = 'songs';
  const PAGE = 50;
  const cache = new Map();

  /* ---- Offline copy (fallback only) ----------------------------------------------------
     A snapshot of the whole library is kept in IndexedDB and refreshed in the background
     whenever the app is online (syncOffline). It is used ONLY when the server can't be
     reached: search() and get() fall back to it; editing is disabled. While online nothing
     reads from it, so normal behaviour is unchanged. */
  let dbp = null;
  function idb() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('verse-deck', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('songs', { keyPath: 'id' });
          req.result.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function idbRun(store, mode, fn) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      let out;
      try { out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }
  const idbPutMany = (songs) => idbRun('songs', 'readwrite', (s) => { songs.forEach((x) => s.put(x)); });
  const idbDelete = (id) => idbRun('songs', 'readwrite', (s) => { s.delete(id); });
  const idbClear = () => idbRun('songs', 'readwrite', (s) => { s.clear(); });
  const idbAll = () => idbRun('songs', 'readonly', (s) => s.getAll());
  const idbCount = () => idbRun('songs', 'readonly', (s) => s.count());
  const metaGet = (k) => idbRun('meta', 'readonly', (s) => s.get(k));
  const metaSet = (k, v) => idbRun('meta', 'readwrite', (s) => { s.put(v, k); });
  const idbSafe = (p) => p.catch((e) => { console.warn('Offline copy:', e); });

  let localList = null;   // decorated in-memory copy of the IndexedDB snapshot

  function isNetworkError(e) {
    return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(String(e && e.message || e));
  }
  function requireOnline() {
    if (!navigator.onLine) throw new Error('You are offline — editing is unavailable.');
  }
  const firstLines = (s) => {
    const s0 = (s.slides || [])[0];
    const a = typeof s0 === 'string' ? s0 : (s0 && s0.text) || '';
    const b = s0 && typeof s0 === 'object' ? (s0.en || '') : '';
    const line = (x) => String(x).trim().split('\n')[0];
    return (line(a) + '\n' + line(b)).toLowerCase();
  };
  const slideText = (sl) => (typeof sl === 'string' ? sl : [sl && sl.text, sl && sl.en].filter(Boolean).join(' '));

  async function loadLocal() {
    if (localList) return localList;
    const all = await idbAll();
    localList = all.map((song) => ({
      song,
      title: (song.title || '').toLowerCase(),
      tags: (song.tags || []).join(' ').toLowerCase(),
      first: firstLines(song),
      text: ((song.title || '') + ' ' + (song.slides || []).map(slideText).join(' ') + ' ' + (song.tags || []).join(' ')).toLowerCase()
    }));
    return localList;
  }

  // Same ordering as the SQL function search_songs().
  async function localSearch(query, { lang, setlistOnly, offset, limit }) {
    const list = await loadLocal();
    if (!list.length) return { songs: [], total: 0, offline: true, noCopy: true };
    const t = (query || '').trim().toLowerCase();
    const rows = [];
    for (const it of list) {
      if (lang && lang !== 'all' && it.song.language !== lang) continue;
      if (setlistOnly && !it.song.inSetlist) continue;
      if (t && !it.text.includes(t)) continue;
      let rank = 3;
      if (t) {
        if (it.first.startsWith(t) || it.first.includes('\n' + t)) rank = 0;
        else if (it.first.includes(t)) rank = 1;
        else if (it.title.includes(t) || it.tags.includes(t)) rank = 2;
      }
      rows.push({ it, rank });
    }
    rows.sort((x, y) => x.rank - y.rank || (x.it.title < y.it.title ? -1 : x.it.title > y.it.title ? 1 : 0));
    return {
      songs: rows.slice(offset, offset + limit).map((r) => remember(r.it.song)),
      total: rows.length,
      offline: true
    };
  }

  // Brings the offline copy up to date: only rows changed since the last sync, plus a full
  // refresh if the server's song count differs (a deletion happened). Returns
  // { total, changed, full } or null if it couldn't run.
  let syncing = false;
  async function syncOffline() {
    if (syncing || !navigator.onLine) return null;
    syncing = true;
    try {
      const meta = (await metaGet('sync')) || {};
      let since = meta.syncedAt || null;
      const startedAt = new Date().toISOString();
      let changed = 0, full = !since;
      const pull = async (sinceTs) => {
        for (let offset = 0; ; offset += 1000) {
          let q = db().from(TABLE).select('*').order('updated_at', { ascending: true });
          if (sinceTs) q = q.gt('updated_at', sinceTs);
          const res = check(await q.range(offset, offset + 999));
          if (res.data.length) { await idbPutMany(res.data.map(fromRow)); changed += res.data.length; }
          if (res.data.length < 1000) break;
        }
      };
      await pull(since);
      const serverCount = await count();
      if (serverCount !== (await idbCount())) {
        await idbClear(); changed = 0; full = true;
        await pull(null);
      }
      await metaSet('sync', { syncedAt: startedAt, count: serverCount });
      if (changed) localList = null;
      return { total: serverCount, changed, full };
    } catch (e) {
      console.warn('Offline sync skipped:', e);
      return null;
    } finally {
      syncing = false;
    }
  }

  function db() { return Auth.client; }

  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function fromRow(r) {
    return {
      id: r.id,
      title: r.title,
      language: r.language,
      tags: r.tags || [],
      slides: r.slides || [],
      inSetlist: !!r.in_setlist,
      sourceUrl: r.source_url || null,
      lyricist: r.lyricist || null,
      copyright: r.copyright || null,
      updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now()
    };
  }

  function toRow(s) {
    const row = {
      id: s.id,
      title: s.title,
      language: s.language,
      tags: s.tags || [],
      slides: s.slides || [],
      in_setlist: !!s.inSetlist
    };
    if (s.sourceUrl !== undefined) row.source_url = s.sourceUrl;
    if (s.lyricist !== undefined) row.lyricist = s.lyricist;
    if (s.copyright !== undefined) row.copyright = s.copyright;
    return row;
  }

  function check(res) {
    if (res.error) throw new Error(res.error.message);
    return res;
  }

  function remember(song) {
    cache.set(song.id, song);
    return song;
  }

  // Server-side ranked search + pagination (SQL function search_songs). Results are ordered:
  // first line starts with the text, first line contains it, title/tags contain it, then
  // anything found in later stanzas — alphabetical within each group.
  // Returns { songs, total } for the requested page.
  async function search(query, { lang = 'all', setlistOnly = false, offset = 0, limit = PAGE } = {}) {
    const opts = { lang, setlistOnly, offset, limit };
    if (!navigator.onLine) return localSearch(query, opts);
    try {
      const res = check(await db().rpc('search_songs', {
        q: (query || '').trim(), lang, setlist_only: !!setlistOnly, off: offset, lim: limit
      }));
      const rows = res.data || [];
      return { songs: rows.map(fromRow).map(remember), total: rows.length ? Number(rows[0].total) : 0 };
    } catch (e) {
      if (isNetworkError(e)) return localSearch(query, opts);   // server unreachable → saved copy
      throw e;
    }
  }

  function getCached(id) {
    return cache.get(id) || null;
  }

  async function get(id) {
    if (cache.has(id)) return cache.get(id);
    try {
      const res = check(await db().from(TABLE).select('*').eq('id', id).maybeSingle());
      return res.data ? remember(fromRow(res.data)) : null;
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const list = await loadLocal();
      const hit = list.find((it) => it.song.id === id);
      return hit ? remember(hit.song) : null;
    }
  }

  async function save(song) {
    requireOnline();
    if (!song.id) song.id = uid();
    const existing = cache.get(song.id);
    const merged = Object.assign({}, existing || {}, song);
    const res = check(await db().from(TABLE).upsert(toRow(merged)).select().single());
    const saved = remember(fromRow(res.data));
    localList = null; idbSafe(idbPutMany([saved]));
    return saved;
  }

  async function remove(id) {
    requireOnline();
    check(await db().from(TABLE).delete().eq('id', id));
    cache.delete(id);
    localList = null; idbSafe(idbDelete(id));
  }

  // Flips a song's bookmark ("setlist") flag; returns the new value.
  async function toggleSetlist(id) {
    requireOnline();
    const song = await get(id);
    if (!song) return false;
    const next = !song.inSetlist;
    check(await db().from(TABLE).update({ in_setlist: next }).eq('id', id));
    song.inSetlist = next;
    localList = null; idbSafe(idbPutMany([song]));
    return next;
  }

  async function count() {
    const res = check(await db().from(TABLE).select('id', { count: 'exact', head: true }));
    return res.count || 0;
  }

  async function fetchAll() {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const res = check(await db().from(TABLE).select('*').order('title').range(offset, offset + 999));
      out.push(...res.data.map(fromRow));
      if (res.data.length < 1000) break;
    }
    return out;
  }

  async function exportJSON() {
    const songs = await fetchAll();
    const data = JSON.stringify({ songs, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songs.json';
    a.click();
    URL.revokeObjectURL(url);
    return songs.length;
  }

  // Upserts by id (existing songs with the same id are overwritten). Returns the number of
  // songs written.
  async function importJSON(text) {
    requireOnline();
    const parsed = JSON.parse(text);
    const incoming = (Array.isArray(parsed) ? parsed : (parsed.songs || []))
      .filter((s) => s && s.title && Array.isArray(s.slides));
    incoming.forEach((s) => { if (!s.id) s.id = uid(); });
    for (let i = 0; i < incoming.length; i += 200) {
      check(await db().from(TABLE).upsert(incoming.slice(i, i + 200).map(toRow)));
    }
    cache.clear();
    return incoming.length;
  }

  // One-time move of a library saved by the old localStorage version of the app (key
  // cp_songs_v1) into the database. The old data is left in place but marked as migrated.
  async function migrateLocal() {
    const DONE = 'cp_songs_v1_migrated';
    if (localStorage.getItem(DONE)) return;
    const raw = localStorage.getItem('cp_songs_v1');
    if (raw) {
      const songs = JSON.parse(raw);
      if (Array.isArray(songs) && songs.length) await importJSON(JSON.stringify(songs));
    }
    localStorage.setItem(DONE, new Date().toISOString());
  }

  // First run only: if the database has no songs at all, load the bundled public-domain
  // starter hymns from data/songs.json.
  async function seedIfEmpty() {
    try {
      await migrateLocal();
      if ((await count()) > 0) return;
      const res = await fetch('data/songs.json', { cache: 'no-store' });
      if (!res.ok) return;
      await importJSON(await res.text());
    } catch (e) {
      console.warn('SongStore seed skipped:', e);
    }
  }

  async function loadSharedFromServer() {
    const res = await fetch('data/songs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not fetch data/songs.json (' + res.status + ')');
    return importJSON(await res.text());
  }

  return { syncOffline, search, get, getCached, save, remove, toggleSetlist, count, exportJSON, importJSON, seedIfEmpty, loadSharedFromServer, PAGE };
})();
