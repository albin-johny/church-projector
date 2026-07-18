/* Live link between the operator control panel and the projector display window.
   Uses BroadcastChannel (instant, same-origin) with a localStorage fallback
   for browsers/contexts where BroadcastChannel isn't available. Everything
   is local to the machine — nothing goes over the network, so it's fast
   even with a large song/Bible library open.
*/
const ProjectorLink = (() => {
  const CHANNEL = 'church-projector-v1';
  const LS_KEY = 'cp_live_message';
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }

  function send(message) {
    message.ts = Date.now();
    if (bc) bc.postMessage(message);
    localStorage.setItem(LS_KEY, JSON.stringify(message));
  }

  function onMessage(cb) {
    if (bc) bc.onmessage = (e) => cb(e.data);
    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY && e.newValue) cb(JSON.parse(e.newValue));
      if (e.key === FONT_SCALE_KEY && e.newValue) cb({ type: 'fontscale', scale: parseFloat(e.newValue) });
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
  }
  function getFontScale() {
    const raw = localStorage.getItem(FONT_SCALE_KEY);
    const n = raw ? parseFloat(raw) : 1;
    return isNaN(n) ? 1 : n;
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

  return { send, onMessage, lastMessage, pickFontSize, setFontScale, getFontScale };
})();
