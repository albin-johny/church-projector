/* Service order (running order) storage — Supabase table `services` (see supabase/schema.sql).
   Phase 1 works with one "current" service: the most recently updated row, created on first
   use. Items are an ordered array saved as a whole (reordering is one atomic update):

     { id, type: 'song',   songId, title, sub }
     { id, type: 'bible',  versionA, versionB, bookId, chapter, nums: [16,17,18], title, sub }
     { id, type: 'custom', text, title, sub }

   `title`/`sub` are display labels captured when the item was added.
*/
const ServiceStore = (() => {
  const TABLE = 'services';
  let current = null;

  function db() { return Auth.client; }

  function check(res) {
    if (res.error) throw new Error(res.error.message);
    return res;
  }

  function fromRow(r) {
    return { id: r.id, name: r.name, serviceDate: r.service_date, items: Array.isArray(r.items) ? r.items : [] };
  }

  function uid() {
    return 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  const CACHE_KEY = 'cp_service_cache';   // last known service, for offline viewing
  function remember(cur) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cur)); } catch (e) {}
  }

  async function load() {
    try {
      if (!navigator.onLine) throw new Error('Failed to fetch');
      const res = check(await db().from(TABLE).select('*').order('updated_at', { ascending: false }).limit(1));
      if (res.data.length) {
        current = fromRow(res.data[0]);
      } else {
        const ins = check(await db().from(TABLE).insert({ name: 'Service', items: [] }).select().single());
        current = fromRow(ins.data);
      }
      remember(current);
    } catch (e) {
      // Offline: show the last saved service (read-only — saving requires a connection).
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (x) {}
      if (!cached) throw e;
      current = cached;
    }
    return current;
  }

  async function saveItems(items) {
    if (!navigator.onLine) throw new Error('You are offline — the service can’t be changed.');
    if (!current) await load();
    check(await db().from(TABLE)
      .update({ items, updated_at: new Date().toISOString() }).eq('id', current.id));
    current.items = items;
    remember(current);
    return current;
  }

  async function rename(name) {
    if (!current) await load();
    check(await db().from(TABLE)
      .update({ name, updated_at: new Date().toISOString() }).eq('id', current.id));
    current.name = name;
  }

  return { load, saveItems, rename, uid, get current() { return current; } };
})();
