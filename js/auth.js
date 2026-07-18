/* Client-side login gate for the control panel only (display.html stays
   open — it's just projector output, not the admin interface).
   IMPORTANT: this is a deterrent, not real security. It's a static site with
   no server, so the credentials below are readable by anyone who views the
   page source, and the gate can be bypassed by editing localStorage
   directly. Don't rely on this to protect anything actually sensitive.
*/
const Auth = (() => {
  const USERNAME = 'admin';
  const PASSWORD = 'cogdarwin';
  const KEY = 'cp_auth_ok';

  function isLoggedIn() {
    return localStorage.getItem(KEY) === '1';
  }

  function login(username, password) {
    if (username === USERNAME && password === PASSWORD) {
      localStorage.setItem(KEY, '1');
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(KEY);
  }

  return { isLoggedIn, login, logout };
})();
