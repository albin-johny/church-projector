(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    tab: 'songs',
    songQuery: '',
    setlistOnly: false,
    selectedSongId: null,
    songMode: 'view',        // 'view' or 'edit' — songs open read-only, Edit button switches to the form
    editingDraft: null,      // { id, title, language, tags, slidesText }
    liveSlides: [],          // [{text, ref, title, lang}]
    liveIndex: -1,
    displayWin: null,
    presentMode: false,
    fontScale: 1,
    custom: { text: '', slides: [] },
    bible: {
      langKey: 'en',
      translations: [],
      translationId: '',
      books: [],
      bookId: '',
      chapter: 1,
      chapterVerses: [],
      verseFrom: null,
      verseTo: null,
      perSlide: null,
      loading: false,
      error: '',
      slides: [],
      secondLangEnabled: false,
      secondLangKey: 'ml'
    }
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------------- Tabs ---------------- */
  function setTab(tab) {
    state.tab = tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#songs-search-wrap').style.display = tab === 'songs' ? '' : 'none';
    $('#songs-footer').style.display = tab === 'songs' ? '' : 'none';
    renderList();
    renderStage();
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ---------------- Song list (left rail) ---------------- */
  function renderList() {
    const list = $('#song-list');
    if (state.tab !== 'songs') {
      list.innerHTML = '';
      return;
    }
    let songs = SongStore.search(state.songQuery);
    if (state.setlistOnly) songs = songs.filter(s => s.inSetlist);
    $('#library-count').textContent = songs.length + (songs.length === 1 ? ' song' : ' songs') + (state.setlistOnly ? ' bookmarked' : ' in your library');
    if (!songs.length) {
      list.innerHTML = state.setlistOnly
        ? `<div class="empty-note">No songs bookmarked yet.<br>Click the star on a song to add it.</div>`
        : `<div class="empty-note">No songs yet.<br>Click "New song" to add your first one.</div>`;
      return;
    }
    list.innerHTML = songs.map(s => `
      <div class="list-item ${s.id === state.selectedSongId ? 'selected' : ''}" data-id="${s.id}">
        <div class="item-main">
          <div class="t1">${escapeHtml(s.title)}</div>
          <div class="t2">${langLabel(s.language)} · ${s.slides.length} slide${s.slides.length === 1 ? '' : 's'}</div>
        </div>
        <button class="star-btn ${s.inSetlist ? 'active' : ''}" data-star-id="${s.id}" title="${s.inSetlist ? 'Remove from bookmarks' : 'Add to bookmarks'}">${s.inSetlist ? '★' : '☆'}</button>
      </div>`).join('');
    $$('.list-item').forEach(el => el.addEventListener('click', () => {
      state.selectedSongId = el.dataset.id;
      state.songMode = 'view';
      renderList();
      renderStage();
    }));
    $$('.star-btn').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      SongStore.toggleSetlist(el.dataset.starId);
      renderList();
      if (state.selectedSongId === el.dataset.starId && state.songMode === 'view') renderStage();
    }));
  }
  $('#song-search').addEventListener('input', (e) => { state.songQuery = e.target.value; renderList(); });
  $('#btn-bookmarks-filter').addEventListener('click', () => {
    state.setlistOnly = !state.setlistOnly;
    $('#btn-bookmarks-filter').classList.toggle('active', state.setlistOnly);
    renderList();
  });

  function langLabel(code) {
    return { en: 'English', ml: 'Malayalam', hi: 'Hindi', bi: 'Bilingual' }[code] || 'Other';
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Song editor (center stage) ---------------- */
  function loadSongIntoEditor(id) {
    const song = SongStore.get(id);
    state.editingDraft = song
      ? { id: song.id, title: song.title, language: song.language, tags: (song.tags || []).join(', '), slidesText: song.slides.join('\n\n') }
      : null;
  }

  function newSongDraft() {
    state.selectedSongId = null;
    state.songMode = 'edit';
    state.editingDraft = { id: null, title: '', language: 'en', tags: '', slidesText: '' };
    setTab('songs');
    renderStage();
  }
  $('#btn-new-song').addEventListener('click', newSongDraft);

  function renderStage() {
    const stage = $('#stage');
    if (state.tab === 'bible') { renderBibleStage(); return; }
    if (state.tab === 'custom') { renderCustomStage(); return; }

    if (state.songMode === 'edit' && state.editingDraft) { renderSongEditor(); return; }

    if (state.selectedSongId) {
      renderSongView(SongStore.get(state.selectedSongId));
      return;
    }

    stage.innerHTML = `<div class="empty-note" style="padding-top:80px;">Select a song on the left, or click "New song" to add one to your library.</div>`;
  }

  function renderSongView(song) {
    const stage = $('#stage');
    if (!song) {
      stage.innerHTML = `<div class="empty-note" style="padding-top:80px;">Select a song on the left, or click "New song" to add one to your library.</div>`;
      return;
    }
    stage.innerHTML = `
      <h1>${escapeHtml(song.title)}</h1>
      <div class="meta">${langLabel(song.language)}${(song.tags || []).length ? ' · ' + song.tags.map(escapeHtml).join(', ') : ''}</div>
      <div class="row">
        <button class="btn btn-gold" id="btn-edit-song">Edit</button>
        <button class="btn" id="btn-toggle-setlist">${song.inSetlist ? '★ Bookmarked — remove' : '☆ Add to bookmarks'}</button>
      </div>
      <div id="slide-preview" class="verse-slides"></div>
    `;
    $('#btn-edit-song').addEventListener('click', () => {
      state.songMode = 'edit';
      loadSongIntoEditor(song.id);
      renderStage();
    });
    $('#btn-toggle-setlist').addEventListener('click', () => {
      SongStore.toggleSetlist(song.id);
      renderList();
      renderStage();
    });
    const box = $('#slide-preview');
    box.innerHTML = song.slides.map((s, i) => `
      <div class="verse-slide" data-i="${i}">
        <span class="slide-label">Slide ${i + 1} of ${song.slides.length} — click to show</span>${escapeHtml(s)}
      </div>`).join('');
    $$('#slide-preview .verse-slide').forEach(el => el.addEventListener('click', () => {
      state.liveSlides = song.slides.map((t, i) => ({ text: t, ref: `${i + 1}/${song.slides.length}`, title: song.title, lang: song.language }));
      state.liveIndex = Number(el.dataset.i);
      pushLive();
    }));
    highlightLiveSlide();
  }

  function renderSongEditor() {
    const stage = $('#stage');
    const d = state.editingDraft;
    stage.innerHTML = `
      <h1>${d.id ? 'Edit song' : 'New song'}</h1>
      <div class="meta">${d.id ? 'Editing existing entry' : 'Adding to your library'}</div>

      <div class="field">
        <label>Title</label>
        <input type="text" id="f-title" value="${escapeHtml(d.title)}" placeholder="e.g. Amazing Grace">
      </div>
      <div class="row">
        <div class="field">
          <label>Language</label>
          <select id="f-lang">
            <option value="en" ${d.language === 'en' ? 'selected' : ''}>English</option>
            <option value="ml" ${d.language === 'ml' ? 'selected' : ''}>Malayalam</option>
            <option value="hi" ${d.language === 'hi' ? 'selected' : ''}>Hindi</option>
            <option value="bi" ${d.language === 'bi' ? 'selected' : ''}>Bilingual / mixed</option>
          </select>
        </div>
        <div class="field">
          <label>Tags (comma separated)</label>
          <input type="text" id="f-tags" value="${escapeHtml(d.tags)}" placeholder="hymn, worship, christmas">
        </div>
      </div>
      <div class="field">
        <label>Slides — separate each projector slide with a blank line</label>
        <textarea id="f-slides" placeholder="Amazing grace, how sweet the sound&#10;That saved a wretch like me...&#10;&#10;I once was lost, but now am found&#10;Was blind but now I see.">${escapeHtml(d.slidesText)}</textarea>
        <div class="hint">Paste lyrics you already use in service — a blank line between verses/chorus becomes a new slide.</div>
      </div>
      <div class="row">
        <button class="btn btn-gold" id="btn-save-song">Save song</button>
        <button class="btn" id="btn-cancel-edit">Cancel</button>
        ${d.id ? '<button class="btn btn-danger" id="btn-delete-song">Delete</button>' : ''}
      </div>
      <div id="slide-preview" class="verse-slides"></div>
    `;
    $('#f-title').addEventListener('input', () => d.title = $('#f-title').value);
    $('#f-lang').addEventListener('change', () => d.language = $('#f-lang').value);
    $('#f-tags').addEventListener('input', () => d.tags = $('#f-tags').value);
    $('#f-slides').addEventListener('input', () => { d.slidesText = $('#f-slides').value; renderSlidePreview(); });
    $('#btn-save-song').addEventListener('click', saveSongFromEditor);
    $('#btn-cancel-edit').addEventListener('click', () => {
      if (d.id) { state.songMode = 'view'; }
      else { state.selectedSongId = null; state.editingDraft = null; }
      renderStage();
    });
    if (d.id) $('#btn-delete-song').addEventListener('click', () => {
      if (!confirm('Delete "' + d.title + '"? This can\'t be undone.')) return;
      SongStore.remove(d.id);
      state.selectedSongId = null;
      state.editingDraft = null;
      state.songMode = 'view';
      renderList(); renderStage();
      toast('Song deleted');
    });
    renderSlidePreview();
  }

  function parseSlides(text) {
    return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  }

  function renderSlidePreview() {
    const d = state.editingDraft;
    const slides = parseSlides(d.slidesText);
    const box = $('#slide-preview');
    if (!slides.length) { box.innerHTML = ''; return; }
    box.innerHTML = slides.map((s, i) => `
      <div class="verse-slide" data-i="${i}">
        <span class="slide-label">Slide ${i + 1} of ${slides.length} — click to show</span>${escapeHtml(s)}
      </div>`).join('');
    $$('.verse-slide').forEach(el => el.addEventListener('click', () => {
      const slides2 = parseSlides(d.slidesText);
      state.liveSlides = slides2.map((t, i) => ({ text: t, ref: `${i + 1}/${slides2.length}`, title: d.title || 'Untitled', lang: d.language }));
      state.liveIndex = Number(el.dataset.i);
      pushLive();
    }));
  }

  function saveSongFromEditor() {
    const d = state.editingDraft;
    if (!d.title.trim()) { toast('Give the song a title first'); return; }
    const slides = parseSlides(d.slidesText);
    if (!slides.length) { toast('Add at least one slide of lyrics'); return; }
    const saved = SongStore.save({
      id: d.id,
      title: d.title.trim(),
      language: d.language,
      tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
      slides
    });
    state.selectedSongId = saved.id;
    state.editingDraft.id = saved.id;
    state.songMode = 'view';
    renderList();
    renderStage();
    toast('Saved "' + saved.title + '"');
  }

  /* ---------------- Import / export ---------------- */
  $('#btn-export').addEventListener('click', () => { SongStore.exportJSON(); toast('Downloaded songs.json'); });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const added = SongStore.importJSON(text, { merge: true });
      renderList();
      toast(`Imported — ${added} new song(s) added`);
    } catch (err) {
      toast('Could not read that file: ' + err.message);
    }
    e.target.value = '';
  });

  /* ---------------- Custom stage (on-demand paste-and-present) ---------------- */
  function renderCustomStage() {
    const stage = $('#stage');
    const c = state.custom;
    stage.innerHTML = `
      <h1>Custom</h1>
      <div class="meta">For one-off announcements or readings — nothing here is saved to the library</div>
      <div class="field">
        <label>Content — separate each projector slide with a blank line</label>
        <textarea id="f-custom-text" placeholder="Welcome everyone!&#10;&#10;Please silence your phones during the service.">${escapeHtml(c.text)}</textarea>
        <div class="hint">A blank line between paragraphs becomes a new slide, just like the song editor.</div>
      </div>
      <div id="custom-preview" class="verse-slides"></div>
    `;
    $('#f-custom-text').addEventListener('input', () => { c.text = $('#f-custom-text').value; renderCustomPreview(); });
    renderCustomPreview();
  }

  function renderCustomPreview() {
    const c = state.custom;
    const raw = parseSlides(c.text);
    c.slides = raw.map((t, i) => ({ text: t, ref: `${i + 1}/${raw.length}`, title: '', lang: 'en' }));
    const box = $('#custom-preview');
    if (!c.slides.length) { box.innerHTML = ''; return; }
    box.innerHTML = c.slides.map((s, i) => `
      <div class="verse-slide" data-i="${i}">
        <span class="slide-label">Slide ${i + 1} of ${c.slides.length} — click to show</span>${escapeHtml(s.text)}
      </div>`).join('');
    $$('#custom-preview .verse-slide').forEach(el => el.addEventListener('click', () => {
      state.liveSlides = c.slides;
      state.liveIndex = Number(el.dataset.i);
      pushLive();
    }));
    highlightLiveSlide();
  }

  /* ---------------- Bible stage ---------------- */
  async function renderBibleStage() {
    const stage = $('#stage');
    const b = state.bible;
    stage.innerHTML = `
      <h1>Bible</h1>
      <div class="meta">Powered by the Free Use Bible API — no copyright restrictions</div>
      <div class="bible-picker">
        <div class="language-pills" id="bible-lang-pills">
          ${Object.entries(BibleAPI.LANGS).map(([key, v]) => `<span class="pill ${b.langKey === key ? 'active' : ''}" data-lang="${key}">${v.label}</span>`).join('')}
        </div>
        <div class="row">
          <div class="field"><label>Translation</label><select id="f-translation"><option>Loading…</option></select></div>
        </div>
        <div class="row">
          <div class="field"><label>Book</label><select id="f-book"><option>Loading…</option></select></div>
          <div class="field"><label>Chapter</label><input type="number" id="f-chapter" min="1" value="${b.chapter}" style="width:100%"></div>
        </div>
        <div class="row">
          <div class="field"><label>Verse from</label><input type="number" id="f-vfrom" min="1" placeholder="1" value="${b.verseFrom != null ? b.verseFrom : ''}"></div>
          <div class="field"><label>Verse to</label><input type="number" id="f-vto" min="1" placeholder="last verse" value="${b.verseTo != null ? b.verseTo : ''}"></div>
          <div class="field"><label>Verses per slide</label><input type="number" id="f-persLide" min="1" max="5" placeholder="1" value="${b.perSlide != null ? b.perSlide : ''}"></div>
        </div>
        <div class="hint">Leave verse from/to/per-slide blank to load the whole chapter.</div>
        <div class="row">
          <div class="field" style="flex:0 0 auto;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="f-second-lang-toggle" ${b.secondLangEnabled ? 'checked' : ''}>
              Show second language at the same time
            </label>
          </div>
          <div class="field" id="second-lang-field" style="${b.secondLangEnabled ? '' : 'display:none;'}">
            <label>Second language</label>
            <select id="f-second-lang">
              ${Object.entries(BibleAPI.LANGS).filter(([key]) => key !== b.langKey).map(([key, v]) => `<option value="${key}" ${b.secondLangKey === key ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn btn-gold" id="btn-load-chapter">Load</button>
        <div id="bible-status" class="hint"></div>
        <div id="bible-slides" class="verse-slides"></div>
      </div>
    `;
    $$('#bible-lang-pills .pill').forEach(p => p.addEventListener('click', async () => {
      b.langKey = p.dataset.lang;
      b.translationId = '';
      b.books = []; b.bookId = '';
      b.verseFrom = null; b.verseTo = null; b.perSlide = null;
      if (b.secondLangKey === b.langKey) {
        b.secondLangKey = Object.keys(BibleAPI.LANGS).find(k => k !== b.langKey);
      }
      await renderBibleStage();
      loadTranslationsForLang();
    }));
    $('#f-chapter').addEventListener('input', () => { b.chapter = Number($('#f-chapter').value) || 1; resetVerseRangeFields(); });
    $('#f-vfrom').addEventListener('input', () => {
      const v = $('#f-vfrom').value.trim();
      b.verseFrom = v === '' ? null : Number(v);
    });
    $('#f-vto').addEventListener('input', () => {
      const v = $('#f-vto').value.trim();
      b.verseTo = v === '' ? null : Number(v);
    });
    $('#f-persLide').addEventListener('input', () => {
      const v = $('#f-persLide').value.trim();
      b.perSlide = v === '' ? null : Number(v);
    });
    $('#f-second-lang-toggle').addEventListener('change', () => {
      b.secondLangEnabled = $('#f-second-lang-toggle').checked;
      $('#second-lang-field').style.display = b.secondLangEnabled ? '' : 'none';
    });
    $('#f-second-lang').addEventListener('change', () => { b.secondLangKey = $('#f-second-lang').value; });
    $('#btn-load-chapter').addEventListener('click', loadChapter);

    await loadTranslationsForLang();
  }

  // Verse from/to/per-slide are meant to reset to blank whenever the book or
  // chapter changes, so the operator gets the whole chapter by default and
  // only narrows it down when they actually want a specific verse range.
  function resetVerseRangeFields() {
    const b = state.bible;
    b.verseFrom = null;
    b.verseTo = null;
    b.perSlide = null;
    const vf = $('#f-vfrom'), vt = $('#f-vto'), ps = $('#f-persLide');
    if (vf) vf.value = '';
    if (vt) vt.value = '';
    if (ps) ps.value = '';
  }

  async function loadTranslationsForLang() {
    const b = state.bible;
    const statusEl = $('#bible-status');
    try {
      const list = await BibleAPI.getTranslationsForLang(b.langKey);
      b.translations = list;
      if (!list.length) {
        $('#f-translation').innerHTML = `<option>No translations found</option>`;
        return;
      }
      if (!b.translationId || !list.some(t => t.id === b.translationId)) b.translationId = list[0].id;
      $('#f-translation').innerHTML = list.map(t => `<option value="${t.id}" ${t.id === b.translationId ? 'selected' : ''}>${escapeHtml(t.englishName)} (${t.shortName})</option>`).join('');
      $('#f-translation').addEventListener('change', () => { b.translationId = $('#f-translation').value; loadBooks(); });
      await loadBooks();
    } catch (err) {
      statusEl.textContent = 'Could not reach the Bible API — check your internet connection.';
    }
  }

  async function loadBooks() {
    const b = state.bible;
    const statusEl = $('#bible-status');
    statusEl.textContent = 'Loading books…';
    try {
      const books = await BibleAPI.getBooks(b.translationId);
      b.books = books;
      if (!b.bookId || !books.some(x => x.id === b.bookId)) b.bookId = books.length ? books[0].id : '';
      $('#f-book').innerHTML = books.map(bk => `<option value="${bk.id}" ${bk.id === b.bookId ? 'selected' : ''}>${escapeHtml(bk.name || bk.commonName)}</option>`).join('');
      $('#f-book').addEventListener('change', () => { b.bookId = $('#f-book').value; resetVerseRangeFields(); });
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Could not load the book list for this translation.';
    }
  }

  async function loadChapter() {
    const b = state.bible;
    const statusEl = $('#bible-status');
    const slidesBox = $('#bible-slides');
    statusEl.textContent = 'Loading chapter…';
    slidesBox.innerHTML = '';
    try {
      const data = await BibleAPI.getChapter(b.translationId, b.bookId, b.chapter);
      const verses = BibleAPI.extractVerses(data);
      b.chapterVerses = verses;
      if (!verses.length) { statusEl.textContent = 'No verses found for that chapter.'; return; }
      statusEl.textContent = `${verses.length} verses loaded.`;

      // Blank verse-range fields mean "whole chapter" — computed here without
      // writing back into b.verseFrom/verseTo/perSlide, so the fields stay
      // blank for the operator until they actually type a range.
      const rangeFrom = b.verseFrom || 1;
      const rangeTo = b.verseTo || verses[verses.length - 1].number;
      const rangePerSlide = b.perSlide || 1;

      const bookName = (b.books.find(x => x.id === b.bookId) || {}).name || b.bookId;
      let slides = BibleAPI.buildSlides(verses, rangeFrom, rangeTo, rangePerSlide)
        .map(s => ({ ...s, title: `${bookName} ${b.chapter}`, lang: b.langKey }));

      if (b.secondLangEnabled && b.secondLangKey && b.secondLangKey !== b.langKey) {
        try {
          const list2 = await BibleAPI.getTranslationsForLang(b.secondLangKey);
          if (list2.length) {
            const data2 = await BibleAPI.getChapter(list2[0].id, b.bookId, b.chapter);
            const verses2 = BibleAPI.extractVerses(data2);
            if (verses2.length) {
              const rangeTo2 = b.verseTo || verses2[verses2.length - 1].number;
              const slides2 = BibleAPI.buildSlides(verses2, rangeFrom, rangeTo2, rangePerSlide);
              slides = slides.map((s, i) => slides2[i] ? { ...s, text2: slides2[i].text, lang2: b.secondLangKey } : s);
            }
          }
        } catch (err) {
          statusEl.textContent += ' (Could not load the second language for this book/chapter.)';
        }
      }
      b.slides = slides;

      slidesBox.innerHTML = slides.map((s, i) => `
        <div class="verse-slide" data-i="${i}">
          <span class="slide-label">v${s.ref} — click to show</span>${escapeHtml(s.text)}
          ${s.text2 ? `<div class="verse-slide-secondary">${escapeHtml(s.text2)}</div>` : ''}
        </div>`).join('');
      $$('#bible-slides .verse-slide').forEach(el => el.addEventListener('click', () => {
        state.liveSlides = slides;
        state.liveIndex = Number(el.dataset.i);
        pushLive();
      }));
    } catch (err) {
      statusEl.textContent = 'Could not load that chapter: ' + err.message;
    }
  }

  /* ---------------- Live display control ---------------- */
  function pushLive() {
    const s = state.liveSlides[state.liveIndex];
    if (!s) return;
    const msg = { type: 'slide', lang: s.lang, title: s.title, text: s.text, ref: s.ref };
    if (s.text2) { msg.text2 = s.text2; msg.lang2 = s.lang2; }
    ProjectorLink.send(msg);
    renderMiniScreen(s);
    highlightLiveSlide();
    updatePresentScreen(msg);
  }

  /* ---------------- In-page presentation (single-monitor mode) ---------------- */
  const LANG_CLASS = { ml: 'lang-mal', hi: 'lang-hin' };
  function applyPresentLangClass(el, lang) {
    el.classList.remove('lang-mal', 'lang-hin');
    if (LANG_CLASS[lang]) el.classList.add(LANG_CLASS[lang]);
  }
  function updatePresentScreen(msg) {
    if (!state.presentMode || !msg) return;
    const blank = $('#present-blank-overlay');
    if (msg.type === 'blank') { blank.classList.add('on'); return; }
    blank.classList.remove('on');
    if (msg.type === 'clear') {
      $('#present-title').textContent = '';
      $('#present-text').textContent = '';
      $('#present-text-2').textContent = '';
      $('#present-text-2').classList.add('hidden');
      $('#present-ref').textContent = '';
      $('#present-idle').classList.remove('hidden');
      return;
    }
    if (msg.type === 'slide') {
      $('#present-idle').classList.add('hidden');
      $('#present-title').textContent = msg.title || '';
      applyPresentLangClass($('#present-title'), msg.lang);
      $('#present-text').textContent = msg.text || '';
      applyPresentLangClass($('#present-text'), msg.lang);
      const text2El = $('#present-text-2');
      if (msg.text2) {
        text2El.textContent = msg.text2;
        applyPresentLangClass(text2El, msg.lang2);
        text2El.classList.remove('hidden');
      } else {
        text2El.textContent = '';
        text2El.classList.add('hidden');
      }
      $('#present-ref').textContent = msg.ref || '';

      const totalLen = (msg.text || '').length + (msg.text2 ? msg.text2.length : 0);
      const size = `calc(${ProjectorLink.pickFontSize(totalLen)} * var(--font-scale))`;
      $('#present-text').style.fontSize = size;
      text2El.style.fontSize = size;
    }
  }
  function openPresentMode() {
    state.presentMode = true;
    $('#present-overlay').classList.add('on');
    if (state.liveIndex === -1) startCurrentSelectionLive();
    else updatePresentScreen(ProjectorLink.lastMessage() || { type: 'clear' });
  }
  function closePresentMode() {
    state.presentMode = false;
    $('#present-overlay').classList.remove('on');
  }
  $('#btn-present').addEventListener('click', openPresentMode);

  // Manual font-size override — compensates for a projector that crops or
  // letterboxes the edges of the image, independent of the automatic
  // length-based sizing. Applies to the control panel's own document (which
  // covers the in-page Present overlay) and is broadcast to any open
  // popup display window too.
  function applyFontScale() {
    document.documentElement.style.setProperty('--font-scale', state.fontScale);
    $('#font-scale-label').textContent = Math.round(state.fontScale * 100) + '%';
  }
  function adjustFontScale(delta) {
    state.fontScale = Math.max(0.5, Math.min(2, +(state.fontScale + delta).toFixed(2)));
    applyFontScale();
    ProjectorLink.setFontScale(state.fontScale);
  }
  $('#btn-font-dec').addEventListener('click', () => adjustFontScale(-0.05));
  $('#btn-font-inc').addEventListener('click', () => adjustFontScale(0.05));

  function highlightLiveSlide() {
    $$('.verse-slide').forEach((el, i) => el.classList.toggle('live', Number(el.dataset.i) === state.liveIndex));
  }

  function renderMiniScreen(s) {
    const mini = $('#mini-screen');
    if (!s) { mini.textContent = 'Nothing live yet'; return; }
    mini.textContent = s.text2 ? `${s.text}\n\n— ${langLabel(s.lang2)} —\n${s.text2}` : s.text;
  }

  function startSelectedSongLive() {
    const song = state.selectedSongId ? SongStore.get(state.selectedSongId) : null;
    if (!song || !song.slides.length) return;
    state.liveSlides = song.slides.map((t, i) => ({ text: t, ref: `${i + 1}/${song.slides.length}`, title: song.title, lang: song.language }));
    state.liveIndex = 0;
    pushLive();
  }

  // Starts whatever is selected in the current tab (song or the last-loaded
  // Bible passage) live from its first slide — used by Space/Enter and by
  // "Open display" / "Present" when nothing is live yet.
  function startCurrentSelectionLive() {
    if (state.tab === 'bible') {
      if (!state.bible.slides.length) return;
      state.liveSlides = state.bible.slides;
      state.liveIndex = 0;
      pushLive();
      return;
    }
    if (state.tab === 'custom') {
      if (!state.custom.slides.length) return;
      state.liveSlides = state.custom.slides;
      state.liveIndex = 0;
      pushLive();
      return;
    }
    startSelectedSongLive();
  }

  $('#btn-prev').addEventListener('click', () => {
    if (state.liveIndex > 0) { state.liveIndex--; pushLive(); }
  });
  $('#btn-next').addEventListener('click', () => {
    if (state.liveIndex < state.liveSlides.length - 1) { state.liveIndex++; pushLive(); }
  });
  $('#btn-blank').addEventListener('click', () => {
    ProjectorLink.send({ type: 'blank' });
    updatePresentScreen({ type: 'blank' });
  });
  $('#btn-clear').addEventListener('click', () => {
    ProjectorLink.send({ type: 'clear' });
    updatePresentScreen({ type: 'clear' });
    $('#mini-screen').textContent = 'Nothing live yet';
    state.liveIndex = -1;
    highlightLiveSlide();
  });

  /* ---------------- Display window management ---------------- */
  $('#btn-open-display').addEventListener('click', () => {
    state.displayWin = window.open('display.html', 'churchProjectorDisplay', 'width=1280,height=720');
    setDisplayStatus(true);
    if (state.liveIndex === -1) startCurrentSelectionLive();
  });
  function setDisplayStatus(open) {
    $('#display-dot').classList.toggle('on', open);
    $('#display-status').textContent = open ? 'Display window open' : 'Display window not open';
  }
  setInterval(() => {
    if (state.displayWin) setDisplayStatus(!state.displayWin.closed);
  }, 1500);

  // Keyboard shortcuts on the panel itself.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.presentMode) { closePresentMode(); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); $('#btn-next').click(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); $('#btn-prev').click(); }
    if (e.key.toLowerCase() === 'b') $('#btn-blank').click();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startCurrentSelectionLive(); }
  });

  /* ---------------- Boot ---------------- */
  (async function init() {
    state.fontScale = ProjectorLink.getFontScale();
    applyFontScale();
    await SongStore.seedIfEmpty();
    renderList();
    renderStage();
  })();
})();
