(() => {
  const titleTag = document.getElementById('title-tag');
  const mainText = document.getElementById('main-text');
  const mainText2 = document.getElementById('main-text-2');
  const subRef = document.getElementById('sub-ref');
  const idleMark = document.getElementById('idle-mark');
  const blankOverlay = document.getElementById('blank-overlay');

  const LANG_CLASS = { ml: 'lang-mal', hi: 'lang-hin' };

  function applyLangClass(el, lang) {
    el.classList.remove('lang-mal', 'lang-hin');
    if (LANG_CLASS[lang]) el.classList.add(LANG_CLASS[lang]);
  }

  function applyFontScale(scale) {
    document.documentElement.style.setProperty('--font-scale', scale);
  }

  function render(msg) {
    if (!msg) return;
    if (msg.type === 'fontscale') {
      applyFontScale(msg.scale);
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

      const totalLen = (msg.text || '').length + (msg.text2 ? msg.text2.length : 0);
      const size = `calc(${ProjectorLink.pickFontSize(totalLen)} * var(--font-scale))`;
      mainText.style.fontSize = size;
      mainText2.style.fontSize = size;
    }
  }

  ProjectorLink.onMessage(render);
  // Pick up whatever was already live (and whatever font scale was last set)
  // when this window opens.
  applyFontScale(ProjectorLink.getFontScale());
  render(ProjectorLink.lastMessage());

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
