(() => {
  const titleTag = document.getElementById('title-tag');
  const mainText = document.getElementById('main-text');
  const mainText2 = document.getElementById('main-text-2');
  const subRef = document.getElementById('sub-ref');
  const idleMark = document.getElementById('idle-mark');
  const blankOverlay = document.getElementById('blank-overlay');
  const verseFooter = document.getElementById('verse-footer');

  const LANG_CLASS = { ml: 'lang-mal', hi: 'lang-hin', ta: 'lang-tam' };

  function applyLangClass(el, lang) {
    el.classList.remove('lang-mal', 'lang-hin', 'lang-tam');
    if (LANG_CLASS[lang]) el.classList.add(LANG_CLASS[lang]);
  }

  // Reference on one line (prominent), version name(s) in small type beneath it.
  function setFooter(el, ref, ver) {
    el.textContent = '';
    if (!ref) return;
    const r = document.createElement('div'); r.className = 'ref'; r.textContent = ref;
    el.appendChild(r);
    if (ver) {
      const v = document.createElement('div'); v.className = 'ver'; v.textContent = ver;
      el.appendChild(v);
    }
  }

  let lastBase = '';
  function refit() {
    if (!lastBase) return;
    ProjectorLink.fitText(document.getElementById('stage-inner'), [mainText, mainText2], lastBase);
  }
  window.addEventListener('resize', refit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

  function applyFontScale(scale) {
    document.documentElement.style.setProperty('--font-scale', scale);
    refit();
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  function render(msg) {
    if (!msg) return;
    if (msg.type === 'fontscale') {
      applyFontScale(msg.scale);
      return;
    }
    if (msg.type === 'theme') {
      applyTheme(msg.theme);
      return;
    }
    if (msg.type === 'blank') {
      blankOverlay.classList.add('on');
      return;
    }
    blankOverlay.classList.remove('on');

    if (msg.type === 'clear') {
      titleTag.textContent = '';
      mainText.textContent = '';
      mainText2.textContent = '';
      mainText2.classList.add('hidden');
      subRef.textContent = '';
      verseFooter.textContent = '';
      idleMark.classList.remove('hidden');
      return;
    }

    if (msg.type === 'slide') {
      idleMark.classList.add('hidden');
      titleTag.textContent = msg.title || '';
      applyLangClass(titleTag, msg.lang);
      mainText.textContent = msg.text || '';
      applyLangClass(mainText, msg.lang);
      if (msg.text2) {
        mainText2.textContent = msg.text2;
        applyLangClass(mainText2, msg.lang2);
        mainText2.classList.remove('hidden');
      } else {
        mainText2.textContent = '';
        mainText2.classList.add('hidden');
      }
      subRef.textContent = msg.ref || '';
      // Bible slides carry a footer ("John 3:16 · KJV") shown bottom-centre instead of the
      // top title / verse-number line.
      setFooter(verseFooter, msg.footer, msg.footer2);
      applyLangClass(verseFooter, msg.lang);

      const totalLen = (msg.text || '').length + (msg.text2 ? msg.text2.length : 0);
      const size = `calc(${ProjectorLink.pickFontSize(totalLen)} * var(--font-scale))`;
      lastBase = size;
      refit();
    }
  }

  ProjectorLink.onMessage(render);
  // Pick up whatever was already live (and whatever font scale/theme was
  // last set) when this window opens.
  applyFontScale(ProjectorLink.getFontScale());
  applyTheme(ProjectorLink.getTheme());
  render(ProjectorLink.lastMessage());

  // Online pairing: ?code=ABC123 in the URL, a remembered code, or the on-screen "Connect to
  // control panel" form (also reachable via the corner "Code" button or the P key).
  const PAIR_KEY = 'cp_pair_code';
  const SKIP_KEY = 'cp_pair_skip';
  const netStatus = document.getElementById('net-status');
  const pairScreen = document.getElementById('pair-screen');
  const pairInput = document.getElementById('pair-input');
  const pairGo = document.getElementById('pair-go');
  const pairError = document.getElementById('pair-error');
  const pairOpen = document.getElementById('pair-open');
  const pairOk = () => window.supabase && window.SUPABASE_CONFIG;

  function showPairScreen(message) {
    pairError.textContent = message || '';
    pairScreen.classList.remove('hidden');
    pairInput.focus();
    pairInput.select();
  }
  function hidePairScreen() { pairScreen.classList.add('hidden'); }

  async function pair(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return { ok: false };
    const r = await ProjectorLink.remote.joinDisplay(code);
    if (r.ok) {
      localStorage.setItem(PAIR_KEY, code);
      try { sessionStorage.removeItem(SKIP_KEY); } catch (e) {}
      hidePairScreen();
    }
    return r;
  }

  ProjectorLink.remote.onStatus((st) => {
    if (st === 'online') netStatus.textContent = '';
    else if (st === 'connecting') netStatus.textContent = 'Connecting…';
    else if (st === 'offline') netStatus.textContent = 'Offline — showing local link only';
    else netStatus.textContent = 'Connection problem';
  });

  document.getElementById('pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pairOk()) { pairError.textContent = 'Online mode is not available.'; return; }
    pairGo.disabled = true;
    pairError.textContent = '';
    const r = await pair(pairInput.value);
    pairGo.disabled = false;
    if (!r.ok) {
      pairError.textContent = r.network
        ? 'Can’t reach the server — check the internet connection, or use this window without a code.'
        : 'Code not recognised — check it and try again.';
      pairInput.focus(); pairInput.select();
    }
  });
  pairInput.addEventListener('input', () => {
    pairInput.value = pairInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    pairError.textContent = '';
  });
  document.getElementById('pair-skip').addEventListener('click', () => {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) {}
    hidePairScreen();
  });
  pairOpen.addEventListener('click', () => showPairScreen(''));

  // Show the "Code" button when the pointer moves or the screen is touched.
  let pairBtnTimer = null;
  function revealPairButton() {
    if (!pairOk()) return;
    pairOpen.classList.add('show');
    clearTimeout(pairBtnTimer);
    pairBtnTimer = setTimeout(() => pairOpen.classList.remove('show'), 3000);
  }
  window.addEventListener('mousemove', revealPairButton);
  window.addEventListener('touchstart', revealPairButton, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.target === pairInput || e.key.toLowerCase() !== 'p') return;
    showPairScreen('');
  });

  (async () => {
    if (!pairOk()) return;
    const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
    const saved = (localStorage.getItem(PAIR_KEY) || '').toUpperCase();
    const code = urlCode || saved;
    if (code) {
      const r = await pair(code);
      // Offline (network failure) is fine: the same-browser link keeps working, and we retry
      // when the connection returns. Only a genuinely unknown code asks for a new one.
      if (!r.ok && r.notFound) showPairScreen('Code not recognised — enter the current code.');
      return;
    }
    let skipped = false;
    try { skipped = sessionStorage.getItem(SKIP_KEY) === '1'; } catch (e) {}
    if (!skipped && navigator.onLine) showPairScreen('');
  })();

  // Back online: re-join the session automatically.
  window.addEventListener('online', () => {
    if (!pairOk() || ProjectorLink.remote.status === 'online') return;
    const code = (localStorage.getItem(PAIR_KEY) || '').toUpperCase();
    if (code) pair(code);
  });

  // Local convenience shortcuts (also controllable from the panel).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F11') {
      e.preventDefault();
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    }
  });

  // Hide the mouse cursor after a moment of inactivity; show it on move.
  let cursorTimer = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.add('show-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 2000);
  });
})();
