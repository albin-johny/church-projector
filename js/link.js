/* Live link between the operator control panel and the projector display window.
   Uses BroadcastChannel (instant, same-origin) with a localStorage fallback
   for browsers/contexts where BroadcastChannel isn't available. Everything
   is local to the machine — nothing goes over the network, so it's fast
   even with a large song/Bible library open.

   Online mode (Supabase Realtime) is layered on top: once ProjectorLink.remote
   has joined a session, every message is also broadcast to the session channel
   (and the last slide message is stored in live_state so a reconnecting display
   catches up). Local delivery keeps working when offline.
*/
const ProjectorLink = (() => {
  const CHANNEL = 'church-projector-v1';
  const LS_KEY = 'cp_live_message';
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }


  // ---------------- Online mode (Supabase Realtime) ----------------
  // Control: remote.startControl() -> { code } (creates/reuses the church session, claims the
  //   control seat; asks first if another device holds it).
  // Display: remote.joinDisplay(code) -> resolves the pairing code and subscribes.
  // Both: remote.onStatus(cb) with 'connecting' | 'online' | 'offline' | 'error'.
  // Control only: remote.onTakeover(cb) fires when another device claims the seat.
  const remote = (() => {
    const DEVICE_KEY = 'cp_device_id';
    let client = null, channel = null, sessionId = null, role = null;
    let status = 'offline', lost = false;
    const statusCbs = [], takeoverCbs = [], displayCountCbs = [];
    const instanceId = Math.random().toString(36).slice(2, 10);
    let displayCount = 0;

    function deviceId() {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    }
    function getClient() {
      if (client) return client;
      if (!window.supabase || !window.SUPABASE_CONFIG) throw new Error('Supabase not loaded');
      // Control page already owns an authenticated client (Auth.client); reuse it.
      if (typeof Auth !== 'undefined' && Auth.client) client = Auth.client;
      else client = window.supabase.createClient(
        SUPABASE_CONFIG.url, SUPABASE_CONFIG.key, { auth: { persistSession: false } });
      return client;
    }
    function setStatus(s) {
      status = s;
      statusCbs.forEach((cb) => cb(s));
    }
    function subscribe() {
      const c = getClient();
      if (channel) c.removeChannel(channel);
      setStatus('connecting');
      channel = c.channel('session:' + sessionId, { config: { presence: { key: instanceId } } });
      // Presence: every open display tracks itself so the control panel can count them.
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        let n = 0;
        Object.values(state).forEach((metas) => metas.forEach((m) => { if (m.role === 'display') n++; }));
        displayCount = n;
        displayCountCbs.forEach((cb) => cb(n));
      });
      channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
        if (payload && payload.type === 'takeover') {
          if (role === 'control' && payload.device !== deviceId()) {
            lost = true;
            takeoverCbs.forEach((cb) => cb());
          }
          return;
        }
        if (role === 'display') {
          try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
        }
        emit(payload);
      });
      channel.subscribe((st) => {
        if (st === 'SUBSCRIBED') {
          setStatus('online');
          channel.track({ role, at: Date.now() });
          if (role === 'display') catchUp();
        } else if (st === 'TIMED_OUT' || st === 'CHANNEL_ERROR') setStatus('error');
        else if (st === 'CLOSED') setStatus('offline');
      });
    }
    async function catchUp() {
      const { data } = await getClient().from('live_state')
        .select('message').eq('session_id', sessionId).maybeSingle();
      if (data && data.message) emit(data.message);
    }

    function randomCode() {
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let c = '';
      for (let i = 0; i < 6; i++) c += alphabet[Math.floor(Math.random() * alphabet.length)];
      return c;
    }

    async function startControl({ confirmTakeover } = {}) {
      role = 'control';
      const c = getClient();
      let { data: rows, error } = await c.from('sessions')
        .select('*').order('created_at', { ascending: true }).limit(1);
      if (error) { setStatus('error'); throw error; }
      let row = rows && rows[0];
      if (!row) {
        const ins = await c.from('sessions').insert({ pairing_code: randomCode() }).select().single();
        if (ins.error) { setStatus('error'); throw ins.error; }
        row = ins.data;
        await c.from('live_state').insert({ session_id: row.id });
      }
      const me = deviceId();
      // The seat only counts as held if its holder heartbeated recently — a closed tab or a
      // logged-out panel shouldn't trigger the take-over prompt.
      const fresh = row.active_control_at && (Date.now() - Date.parse(row.active_control_at)) < SEAT_TTL_MS;
      if (row.active_control_id && row.active_control_id !== me && fresh && confirmTakeover) {
        if (!(await confirmTakeover())) { role = null; return { code: row.pairing_code, declined: true }; }
      }
      sessionId = row.id;
      lost = false;
      await c.from('sessions')
        .update({ active_control_id: me, active_control_at: new Date().toISOString() }).eq('id', sessionId);
      startHeartbeat();
      subscribe();
      // Announce once the channel is up so the previous panel locks itself.
      const t = setInterval(() => {
        if (status === 'online') {
          clearInterval(t);
          channel.send({ type: 'broadcast', event: 'msg', payload: { type: 'takeover', device: me } });
        }
      }, 200);
      setTimeout(() => clearInterval(t), 10000);
      return { code: row.pairing_code };
    }

    // Seat heartbeat + release. Heartbeat every 15s; a seat older than SEAT_TTL_MS is free.
    const SEAT_TTL_MS = 45000;
    let hbTimer = null, lastToken = null;
    async function heartbeat() {
      if (role !== 'control' || lost || !sessionId) return;
      const c = getClient();
      const { data } = await c.auth.getSession();
      lastToken = data.session ? data.session.access_token : lastToken;
      await c.from('sessions').update({ active_control_at: new Date().toISOString() })
        .eq('id', sessionId).eq('active_control_id', deviceId());
    }
    function startHeartbeat() {
      clearInterval(hbTimer);
      heartbeat();
      hbTimer = setInterval(heartbeat, 15000);
    }
    // Frees the control seat (logout / closing the page).
    async function release() {
      clearInterval(hbTimer);
      if (role !== 'control' || !sessionId || lost) return;
      try {
        await getClient().from('sessions').update({ active_control_id: null, active_control_at: null })
          .eq('id', sessionId).eq('active_control_id', deviceId());
      } catch (e) {}
    }
    window.addEventListener('pagehide', () => {
      if (role !== 'control' || !sessionId || lost || !lastToken) return;
      try {
        fetch(SUPABASE_CONFIG.url + '/rest/v1/sessions?id=eq.' + sessionId + '&active_control_id=eq.' + deviceId(), {
          method: 'PATCH', keepalive: true,
          headers: { apikey: SUPABASE_CONFIG.key, Authorization: 'Bearer ' + lastToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ active_control_id: null, active_control_at: null })
        });
      } catch (e) {}
    });

    // Last message saved for this session (what the projector is showing), or null.
    async function getLiveState() {
      if (!sessionId) return null;
      try {
        const { data } = await getClient().from('live_state')
          .select('message').eq('session_id', sessionId).maybeSingle();
        return data ? data.message : null;
      } catch (e) { return null; }
    }

    async function joinDisplay(code) {
      role = 'display';
      setStatus('connecting');
      const { data, error } = await getClient().rpc('join_session', { code: String(code || '').trim() });
      if (error || !data) { setStatus('error'); return { ok: false }; }
      sessionId = data;
      subscribe();
      return { ok: true };
    }

    function publish(msg, { persist = true } = {}) {
      if (role !== 'control' || !channel || lost || status !== 'online') return;
      channel.send({ type: 'broadcast', event: 'msg', payload: msg });
      if (persist && ['slide', 'blank', 'clear'].includes(msg.type)) {
        getClient().from('live_state')
          .upsert({ session_id: sessionId, message: msg, updated_at: new Date().toISOString() })
          .then(() => {}, () => {});
      }
    }

    return {
      startControl, joinDisplay, publish, release, getLiveState,
      onStatus: (cb) => { statusCbs.push(cb); cb(status); },
      onTakeover: (cb) => takeoverCbs.push(cb),
      onDisplayCount: (cb) => { displayCountCbs.push(cb); cb(displayCount); },
      get status() { return status; },
      get lost() { return lost; },
    };
  })();

  const listeners = [];
  function emit(msg) { listeners.forEach((cb) => cb(msg)); }

  function send(message) {
    message.ts = Date.now();
    if (bc) bc.postMessage(message);
    localStorage.setItem(LS_KEY, JSON.stringify(message));
    remote.publish(message);
  }

  function onMessage(cb) {
    listeners.push(cb);
    if (bc) bc.onmessage = (e) => emit(e.data);
    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY && e.newValue) cb(JSON.parse(e.newValue));
      if (e.key === FONT_SCALE_KEY && e.newValue) cb({ type: 'fontscale', scale: parseFloat(e.newValue) });
      if (e.key === THEME_KEY && e.newValue) cb({ type: 'theme', theme: e.newValue });
    });
  }

  function lastMessage() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // Manual +/- font-size override, on top of the automatic length-based
  // sizing — lets the operator compensate for a projector that crops or
  // letterboxes the edges of the image, without touching per-slide content.
  // Persisted so a freshly opened display window picks up whatever scale
  // was last set, even if it missed the broadcast.
  const FONT_SCALE_KEY = 'cp_font_scale';
  function setFontScale(scale) {
    localStorage.setItem(FONT_SCALE_KEY, String(scale));
    const msg = { type: 'fontscale', scale, ts: Date.now() };
    if (bc) bc.postMessage(msg);
    remote.publish(msg, { persist: false });
  }
  function getFontScale() {
    const raw = localStorage.getItem(FONT_SCALE_KEY);
    const n = raw ? parseFloat(raw) : 1;
    return isNaN(n) ? 1 : n;
  }

  // Light/dark theme — the operator toggles it in the control panel, and it
  // applies to the control panel itself, the in-page Present overlay (same
  // document), and any popup display.html window (synced here). Persisted
  // so a freshly opened display window picks up the last-set theme even if
  // it missed the broadcast.
  const THEME_KEY = 'cp_theme';
  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    const msg = { type: 'theme', theme, ts: Date.now() };
    if (bc) bc.postMessage(msg);
    remote.publish(msg, { persist: false });
  }
  function getTheme() {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  }

  // Shared between display.js and control.js's in-page presentation overlay,
  // so long verses (or a verse + its second-language pairing) shrink to fit
  // instead of overflowing the stage.
  function pickFontSize(len) {
    if (len > 500) return 'clamp(20px, 2.6vw, 40px)';
    if (len > 320) return 'clamp(22px, 3.2vw, 50px)';
    if (len > 200) return 'clamp(24px, 3.8vw, 62px)';
    if (len > 100) return 'clamp(26px, 4.2vw, 72px)';
    return 'clamp(28px, 4.6vw, 82px)';
  }

  // Shrinks the given text elements (starting from `base`, any CSS size) until everything
  // inside `container` fits its height, so long verses never run into the footer. The
  // length-based pickFontSize() is only the starting point.
  function fitText(container, els, base) {
    els.forEach((el) => { el.style.fontSize = base; });
    let size = parseFloat(getComputedStyle(els[0]).fontSize);
    for (let i = 0; i < 40 && container.scrollHeight > container.clientHeight + 1 && size > 14; i++) {
      size *= 0.94;
      els.forEach((el) => { el.style.fontSize = size + 'px'; });
    }
  }

  return { fitText, remote, send, onMessage, lastMessage, pickFontSize, setFontScale, getFontScale, setTheme, getTheme };
})();
