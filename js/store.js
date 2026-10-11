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

  // Server-side search + pagination. Matching is a case-insensitive substring over title,
  // lyrics (both scripts) and tags, backed by a trigram index.
  // Returns { songs, total } for the requested page.
  async function search(query, { lang = 'all', setlistOnly = false, offset = 0, limit = PAGE } = {}) {
    let q = db().from(TABLE).select('*', { count: 'exact' });
    if (lang && lang !== 'all') q = q.eq('language', lang);
    if (setlistOnly) q = q.eq('in_setlist', true);
    const term = (query || '').trim();
    if (term) q = q.ilike('search_text', '%' + term.replace(/[\\%_]/g, '\\$&') + '%');
    const res = check(await q.order('title', { ascending: true }).range(offset, offset + limit - 1));
    return { songs: res.data.map(fromRow).map(remember), total: res.count || 0 };
  }

  function getCached(id) {
    return cache.get(id) || null;
  }

  async function get(id) {
    if (cache.has(id)) return cache.get(id);
    const res = check(await db().from(TABLE).select('*').eq('id', id).maybeSingle());
    return res.data ? remember(fromRow(res.data)) : null;
  }

  async function save(song) {
    if (!song.id) song.id = uid();
    const existing = cache.get(song.id);
    const merged = Object.assign({}, existing || {}, song);
    const res = check(await db().from(TABLE).upsert(toRow(merged)).select().single());
    return remember(fromRow(res.data));
  }

  async function remove(id) {
    check(await db().from(TABLE).delete().eq('id', id));
    cache.delete(id);
  }

  // Flips a song's bookmark ("setlist") flag; returns the new value.
  async function toggleSetlist(id) {
    const song = await get(id);
    if (!song) return false;
    const next = !song.inSetlist;
    check(await db().from(TABLE).update({ in_setlist: next }).eq('id', id));
    song.inSetlist = next;
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

  return { search, get, getCached, save, remove, toggleSetlist, count, exportJSON, importJSON, seedIfEmpty, loadSharedFromServer, PAGE };
})();
