/* Login gate for the control panel (display.html stays open — it's only projector output).
   Backed by Supabase Auth (one shared church email/password user). Real security comes from
   Row Level Security in supabase/schema.sql; this module just manages the session.
   Needs js/config.js and the supabase-js CDN script loaded first. */
const Auth = (() => {
  const client = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.key
  );

  // Offline fallback: if the network is down and this browser logged in successfully within
  // the last 30 days, let the panel open (read-only songs come from the saved copy). Real
  // access control is still Row Level Security on the server.
  const OK_KEY = 'cp_auth_last_ok';
  const STORAGE_KEY = 'sb-' + new URL(window.SUPABASE_CONFIG.url).hostname.split('.')[0] + '-auth-token';
  const OFFLINE_MAX_MS = 30 * 24 * 3600 * 1000;
  let offline = false;

  async function isLoggedIn() {
    let session = null, failed = false;
    try {
      const { data, error } = await client.auth.getSession();
      session = data && data.session;
      failed = !!error;
    } catch (e) { failed = true; }
    if (session) {
      try { localStorage.setItem(OK_KEY, String(Date.now())); } catch (e) {}
      offline = false;
      return true;
    }
    if (!navigator.onLine || failed) {
      let at = 0, hasSession = false;
      try { at = Number(localStorage.getItem(OK_KEY) || 0); hasSession = !!localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (at && hasSession && Date.now() - at < OFFLINE_MAX_MS) { offline = true; return true; }
    }
    return false;
  }

  async function login(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) { try { localStorage.setItem(OK_KEY, String(Date.now())); } catch (e) {} }
    return !error;
  }

  async function logout() {
    try { localStorage.removeItem(OK_KEY); } catch (e) {}
    await client.auth.signOut();
  }

  return { isLoggedIn, login, logout, client, get offline() { return offline; } };
})();
