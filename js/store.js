/* Song library storage.
   Data lives in the browser's localStorage (per machine) under KEY.
   To share a library across the team's machines/projector laptop:
     1. Build the library on one machine.
     2. Click "Export library" -> saves songs.json.
     3. Upload that songs.json to /data/songs.json on your hosting (replacing the seed file).
     4. On every other machine, open Songs tab -> "Load shared library" to pull that file in.
   This keeps the app 100% static (no server/database required), while still
   letting the whole team work from one canonical song list. See README.md
   for the optional step-up to a PHP/Firebase backend for live shared editing.
*/
const SongStore = (() => {
  const KEY = 'cp_songs_v1';

  function _read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('SongStore read error', e);
      return [];
    }
  }

  function _write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getAll() {
    return _read().sort((a, b) => a.title.localeCompare(b.title));
  }

  function get(id) {
    return _read().find(s => s.id === id) || null;
  }

  function save(song) {
    const list = _read();
    if (!song.id) song.id = uid();
    song.updatedAt = Date.now();
    const idx = list.findIndex(s => s.id === song.id);
    if (idx >= 0) list[idx] = song; else list.push(song);
    _write(list);
    return song;
  }

  function remove(id) {
    _write(_read().filter(s => s.id !== id));
  }

  // Flips a song's inclusion in the current setlist — the operator marks
  // which songs are lined up for the next service, then unmarks them once
  // that service is over and marks a new set for next time.
  function toggleSetlist(id) {
    const list = _read();
    const song = list.find(s => s.id === id);
    if (!song) return false;
    song.inSetlist = !song.inSetlist;
    song.updatedAt = Date.now();
    _write(list);
    return song.inSetlist;
  }

  function search(query, langFilter) {
    const q = (query || '').trim().toLowerCase();
    return getAll().filter(s => {
      if (langFilter && langFilter !== 'all' && s.language !== langFilter) return false;
      if (!q) return true;
      const hay = (s.title + ' ' + (s.tags || []).join(' ') + ' ' + s.slides.join(' ')).toLowerCase();
      return hay.includes(q);
    });
  }

  function exportJSON() {
    const data = JSON.stringify({ songs: _read(), exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songs.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(text, { merge = true } = {}) {
    const parsed = JSON.parse(text);
    const incoming = Array.isArray(parsed) ? parsed : (parsed.songs || []);
    if (!merge) {
      _write(incoming);
      return incoming.length;
    }
    const list = _read();
    const byId = new Map(list.map(s => [s.id, s]));
    const byTitle = new Map(list.map(s => [s.title.trim().toLowerCase(), s]));
    let added = 0;
    incoming.forEach(s => {
      if (s.id && byId.has(s.id)) { Object.assign(byId.get(s.id), s); return; }
      const key = (s.title || '').trim().toLowerCase();
      if (key && byTitle.has(key)) { Object.assign(byTitle.get(key), s); return; }
      if (!s.id) s.id = uid();
      list.push(s);
      added++;
    });
    _write(list);
    return added;
  }

  // Runs on every app load (not just when the library is empty), so new
  // bundled hymns added to data/songs.json show up automatically without
  // the operator having to click Import. It only ever *adds* songs that
  // aren't already present (matched by id, then by title) — it never
  // overwrites a song already in localStorage, so local edits/additions
  // are always safe.
  async function seedIfEmpty() {
    try {
      const res = await fetch('data/songs.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const songs = Array.isArray(data) ? data : (data.songs || []);
      if (!songs.length) return;
      const list = _read();
      const existingIds = new Set(list.map(s => s.id));
      const existingTitles = new Set(list.map(s => (s.title || '').trim().toLowerCase()));
      let added = false;
      songs.forEach(s => {
        if (existingIds.has(s.id)) return;
        if (existingTitles.has((s.title || '').trim().toLowerCase())) return;
        list.push(s);
        added = true;
      });
      if (added) _write(list);
    } catch (e) {
      /* offline or no seed file — fine, keep whatever's local */
    }
  }

  async function loadSharedFromServer({ merge = true } = {}) {
    const res = await fetch('data/songs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not fetch data/songs.json (' + res.status + ')');
    const text = await res.text();
    return importJSON(text, { merge });
  }

  return { getAll, get, save, remove, toggleSetlist, search, exportJSON, importJSON, seedIfEmpty, loadSharedFromServer };
})();
