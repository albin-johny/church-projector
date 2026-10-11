(() => {
  const titleTag = document.getElementById('title-tag');
  const mainText = document.getElementById('main-text');
  const mainText2 = document.getElementById('main-text-2');
  const subRef = document.getElementById('sub-ref');
  const idleMark = document.getElementById('idle-mark');
  const blankOverlay = document.getElementById('blank-overlay');
  const verseFooter = document.getElementById('verse-footer');

  const LANG_CLASS = { ml: 'lang-mal', hi: 'lang-hin' };

  function applyLangClass(el, lang) {
    el.classList.remove('lang-mal', 'lang-hin');
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

  // Online pairing: ?code=ABC123 in the URL, or press P to enter/change the code. The last
  // code is remembered so reopening the window reconnects by itself.
  const PAIR_KEY = 'cp_pair_code';
  const netStatus = document.getElementById('net-status');
  function pair(code) {
    if (!code) return;
    localStorage.setItem(PAIR_KEY, code);
    ProjectorLink.remote.joinDisplay(code).then((r) => {
      if (!r.ok) netStatus.textContent = 'Code not recognised — press P';
    });
  }
  ProjectorLink.remote.onStatus((st) => {
    if (st === 'online') netStatus.textContent = '';
    else if (st === 'connecting') netStatus.textContent = 'Connecting…';
    else if (st === 'offline') netStatus.textContent = 'Offline — showing local link only';
    else netStatus.textContent = 'Connection problem';
  });
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'p') return;
    const c = prompt('Enter the display code from the control panel:');
    if (c) pair(c.trim().toUpperCase());
  });
  const urlCode = new URLSearchParams(location.search).get('code');
  pair((urlCode || localStorage.getItem(PAIR_KEY) || '').toUpperCase());

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
