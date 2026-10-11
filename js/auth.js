/* Login gate for the control panel (display.html stays open — it's only projector output).
   Backed by Supabase Auth (one shared church email/password user). Real security comes from
   Row Level Security in supabase/schema.sql; this module just manages the session.
   Needs js/config.js and the supabase-js CDN script loaded first. */
const Auth = (() => {
  const client = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.key
  );

  async function isLoggedIn() {
    const { data } = await client.auth.getSession();
    return !!data.session;
  }

  async function login(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    return !error;
  }

  async function logout() {
    await client.auth.signOut();
  }

  return { isLoggedIn, login, logout, client };
})();
