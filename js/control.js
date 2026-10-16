(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    tab: 'songs',
    songQuery: '',
    setlistOnly: false,
    songList: [],            // currently loaded page(s) of songs
    songTotal: 0,
    listError: null,
    selectedSongId: null,
    songMode: 'view',        // 'view' or 'edit' — songs open read-only, Edit button switches to the form
    editingDraft: null,      // { id, title, language, tags, slidesText }
    liveSlides: [],          // [{text, ref, title, lang}]
    liveIndex: -1,
    displayWin: null,
    presentMode: false,
    fontScale: 1,
    custom: { text: '', slides: [] },
    service: { loaded: false, loading: false, name: 'Service', items: [], active: -1, slides: [], error: null },
    bible: {
      versionA: 'eng_niv',   // primary (left) version — also supplies the book list
      versionB: 'mal_bsi',   // secondary version shown beside it (can be set to none)
      books: [],
      bookId: '',
      chapter: 1,
      rows: [],              // [{ number, a, b }] one per verse number in the chapter
      slides: [],            // one single-verse slide per row (for next/prev)
      selection: [],         // selected row indices (what is on screen)
      anchor: null           // row index shift-click ranges extend from
    }
  };

  // toast(msg) or toast(msg, { label, onClick, ms }) — the latter shows a clickable action
  // (e.g. "Undo") and stays up longer.
  function toast(msg, opts) {
    const t = $('#toast');
    t.textContent = '';
    t.classList.remove('has-action');
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if (opts && opts.label) {
      const b = document.createElement('button');
      b.className = 'toast-action';
      b.textContent = opts.label;
      b.addEventListener('click', () => {
        t.classList.remove('show', 'has-action');
        clearTimeout(toast._h);
        opts.onClick();
      });
      t.appendChild(b);
      t.classList.add('has-action');
    }
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show', 'has-action'), (opts && opts.ms) || 2200);
  }

  /* ---------------- Tabs ---------------- */
  function setTab(tab) {
    state.tab = tab;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#songs-search-wrap').style.display = tab === 'songs' ? '' : 'none';
    $('#bible-jump-wrap').style.display = tab === 'bible' ? '' : 'none';
    $('#songs-footer').style.display = tab === 'songs' ? '' : 'none';
    refreshList();
    renderStage();
  }
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ---------------- Song list (left rail) ---------------- */
  // Songs come from the database a page at a time. state.songList holds what's currently
  // loaded for the active search/filter; renderList() draws it, refreshList() re-queries.
  let listRequest = 0;
  async function refreshList({ append = false } = {}) {
    if (state.tab !== 'songs') { renderList(); return; }
    const req = ++listRequest;
    try {
      const res = await SongStore.search(state.songQuery, {
        setlistOnly: state.setlistOnly,
        offset: append ? state.songList.length : 0
      });
      if (req !== listRequest) return;   // a newer search superseded this one
      state.songList = append ? state.songList.concat(res.songs) : res.songs;
      state.songTotal = res.total;
      state.listError = res.noCopy
        ? 'You are offline and no saved copy of the library exists yet. Open the app once with internet to save one.'
        : null;
      if (res.offline && !state.offlineNoticed) {
        state.offlineNoticed = true;
        toast('Offline — showing the saved song list (read-only)');
      }
      if (!res.offline) state.offlineNoticed = false;
      state.listOffline = !!res.offline;
    } catch (e) {
      if (req !== listRequest) return;
      state.listError = e.message;
    }
    renderList();
  }

  function renderList() {
    const list = $('#song-list');
    list.classList.toggle('bible-mode', state.tab === 'bible');
    if (state.tab === 'bible') { renderBibleRail(); return; }
    if (state.tab === 'service') { renderServiceRail(); return; }
    if (state.tab !== 'songs') {
      list.innerHTML = '';
      return;
    }
    if (state.listError) {
      $('#library-count').textContent = 'Could not load songs';
      list.innerHTML = `<div class="empty-note">Could not load the library:<br>${escapeHtml(state.listError)}</div>`;
      return;
    }
    const songs = state.songList;
    const total = state.songTotal;
    const filtered = !!state.songQuery.trim();
    $('#library-count').textContent = total + (total === 1 ? ' song' : ' songs') +
      (state.setlistOnly ? ' bookmarked' : filtered ? ' found' : ' in your library') +
      (state.listOffline ? ' · offline copy' : '');
    if (!songs.length) {
      list.innerHTML = filtered
        ? `<div class="empty-note">No songs match “${escapeHtml(state.songQuery.trim())}”.</div>`
        : state.setlistOnly
          ? `<div class="empty-note">No songs bookmarked yet.<br>Click the star on a song to add it.</div>`
          : `<div class="empty-note">No songs yet.<br>Click "New song" to add your first one.</div>`;
      return;
    }
    list.innerHTML = songs.map(s => `
      <div class="list-item ${s.id === state.selectedSongId ? 'selected' : ''} ${s.id === state.liveSongId ? 'is-live' : ''}" data-id="${s.id}">
        <div class="item-main">
          <div class="t1">${escapeHtml(s.title)}${s.id === state.liveSongId ? '<span class="live-badge">LIVE</span>' : ''}</div>
          <div class="t2">${langLabel(s.language)} · ${s.slides.length} slide${s.slides.length === 1 ? '' : 's'}</div>
        </div>
        <button class="star-btn ${s.inSetlist ? 'active' : ''}" data-star-id="${s.id}" title="${s.inSetlist ? 'Remove from bookmarks' : 'Add to bookmarks'}">${s.inSetlist ? '★' : '☆'}</button>
      </div>`).join('') +
      (songs.length < total ? `<button class="btn btn-small" id="btn-load-more" style="margin:10px auto;display:block;">Load more (${songs.length} of ${total})</button>` : '');
    $$('.list-item').forEach(el => el.addEventListener('click', () => {
      state.selectedSongId = el.dataset.id;
      state.songMode = 'view';
      renderList();
      renderStage();
    }));
    $$('.star-btn').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await SongStore.toggleSetlist(el.dataset.starId);
      } catch (err) { toast('Could not update bookmark: ' + err.message); return; }
      if (state.setlistOnly) await refreshList(); else renderList();
      if (state.selectedSongId === el.dataset.starId && state.songMode === 'view') renderStage();
    }));
    const more = $('#btn-load-more');
    if (more) more.addEventListener('click', () => refreshList({ append: true }));
  }
  let searchTimer = null;
  $('#song-search').addEventListener('input', (e) => {
    state.songQuery = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshList, 250);
  });
  $('#btn-bookmarks-filter').addEventListener('click', () => {
    state.setlistOnly = !state.setlistOnly;
    $('#btn-bookmarks-filter').classList.toggle('active', state.setlistOnly);
    refreshList();
  });

  function langLabel(code) {
    return { en: 'English', ml: 'Malayalam', hi: 'Hindi', ta: 'Tamil', bi: 'Bilingual' }[code] || 'Other';
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Malayalam and Hindi songs always get a second "Manglish/English"
  // transliteration box alongside the native-script lyrics — English songs
  // don't need one. When a song has this, its slides are { text, en } pairs
  // instead of plain strings (either side can be blank, but not both,
  // enforced at save time). Reuses the same text/text2 shape the Bible
  // dual-language mode already pushes to the display, so both languages
  // show stacked together while presenting.
  function hasSecondLangBox(language) {
    return language === 'ml' || language === 'hi' || language === 'ta';
  }
  function isDualTextSong(song) {
    return hasSecondLangBox(song.language) && song.slides.length > 0 && typeof song.slides[0] === 'object';
  }
  function buildDualSlide(text, en, i, total, title, lang) {
    const ref = `${i + 1}/${total}`;
    if (text && en) return { text, text2: en, ref, title, lang, lang2: 'en' };
    if (text) return { text, ref, title, lang };
    return { text: en, ref, title, lang: 'en' };
  }
  function songToLiveSlides(song) {
    let slides;
    if (isDualTextSong(song)) {
      slides = song.slides.map((s, i) => buildDualSlide(s.text, s.en, i, song.slides.length, song.title, song.language));
    } else {
      slides = song.slides.map((t, i) => ({ text: t, ref: `${i + 1}/${song.slides.length}`, title: song.title, lang: song.language }));
    }
    return slides.map(sl => Object.assign(sl, { songId: song.id }));   // lets the UI mark the live song
  }

  /* ---------------- Song editor (center stage) ---------------- */
  function loadSongIntoEditor(id) {
    const song = SongStore.getCached(id);
    if (!song) { state.editingDraft = null; return; }
    const base = { id: song.id, title: song.title, language: song.language, tags: (song.tags || []).join(', ') };
    if (isDualTextSong(song)) {
      state.editingDraft = Object.assign(base, {
        slidesText: '',
        slidesTextPrimary: song.slides.map(s => s.text || '').join('\n\n'),
        slidesTextEn: song.slides.map(s => s.en || '').join('\n\n')
      });
    } else if (hasSecondLangBox(song.language)) {
      // Malayalam/Hindi song saved before this feature existed — its slides
      // are plain strings. Land them in the native-script box so nothing is
      // lost; the operator can fill in the English box if they want it.
      state.editingDraft = Object.assign(base, { slidesText: '', slidesTextPrimary: song.slides.join('\n\n'), slidesTextEn: '' });
    } else {
      state.editingDraft = Object.assign(base, { slidesText: song.slides.join('\n\n'), slidesTextPrimary: '', slidesTextEn: '' });
    }
  }

  function newSongDraft() {
    state.selectedSongId = null;
    state.songMode = 'edit';
    state.editingDraft = { id: null, title: '', language: 'en', tags: '', slidesText: '', slidesTextPrimary: '', slidesTextEn: '' };
    setTab('songs');
    renderStage();
  }
  $('#btn-new-song').addEventListener('click', newSongDraft);

  function renderStage() {
    const stage = $('#stage');
    if (state.tab === 'bible') { renderBibleStage(); return; }
    if (state.tab === 'custom') { renderCustomStage(); return; }
    if (state.tab === 'service') { renderServiceStage(); return; }

    if (state.songMode === 'edit' && state.editingDraft) { renderSongEditor(); return; }

    if (state.selectedSongId) {
      const cached = SongStore.getCached(state.selectedSongId);
      if (cached) { renderSongView(cached); return; }
      stage.innerHTML = `<div class="empty-note" style="padding-top:80px;">Loading song…</div>`;
      const wanted = state.selectedSongId;
      SongStore.get(wanted).then(() => { if (state.selectedSongId === wanted) renderStage(); })
        .catch((e) => toast('Could not load song: ' + e.message));
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
        <button class="btn" id="btn-add-service">＋ Add to service</button>
      </div>
      <div id="slide-preview" class="verse-slides"></div>
    `;
    $('#btn-edit-song').addEventListener('click', () => {
      state.songMode = 'edit';
      loadSongIntoEditor(song.id);
      renderStage();
    });
    $('#btn-add-service').addEventListener('click', () => addToService({
      type: 'song', songId: song.id, title: song.title, sub: `Song · ${langLabel(song.language)}`
    }));
    $('#btn-toggle-setlist').addEventListener('click', async () => {
      try { await SongStore.toggleSetlist(song.id); }
      catch (err) { toast('Could not update bookmark: ' + err.message); return; }
      await refreshList();
      renderStage();
    });
    const box = $('#slide-preview');
    const dual = isDualTextSong(song);
    box.innerHTML = song.slides.map((s, i) => dual
      ? `<div class="verse-slide" data-i="${i}">
          <span class="slide-label">Slide ${i + 1} of ${song.slides.length} — click to show</span>
          ${s.text ? escapeHtml(s.text) : `<span class="slide-missing">(no ${langLabel(song.language)})</span>`}
          ${s.en ? `<div class="verse-slide-secondary">${escapeHtml(s.en)}</div>` : ''}
        </div>`
      : `<div class="verse-slide" data-i="${i}">
          <span class="slide-label">Slide ${i + 1} of ${song.slides.length} — click to show</span>${escapeHtml(s)}
        </div>`).join('');
    $$('#slide-preview .verse-slide').forEach(el => el.addEventListener('click', () => {
      state.liveSlides = songToLiveSlides(song);
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
            <option value="ta" ${d.language === 'ta' ? 'selected' : ''}>Tamil</option>
          </select>
        </div>
        <div class="field">
          <label>Tags (comma separated)</label>
          <input type="text" id="f-tags" value="${escapeHtml(d.tags)}" placeholder="hymn, worship, christmas">
        </div>
      </div>
      ${hasSecondLangBox(d.language) ? `
      <div class="field">
        <label>${langLabel(d.language)} — separate each stanza with a blank line</label>
        <textarea id="f-slides-primary" placeholder="യേശുവിൻ നാമം വിജയിക്കട്ടെ&#10;സാത്താന്യ കോട്ടകൾ തകർന്നിടട്ടെ&#10;&#10;പോകുക നാം... പോർവീരരായ്…">${escapeHtml(d.slidesTextPrimary)}</textarea>
      </div>
      <div class="field">
        <label>Manglish / English transliteration — same stanza order</label>
        <textarea id="f-slides-en" placeholder="yeshuvin naamam vijayikkatte&#10;sathanya kottakal thakarnnidatte&#10;&#10;pokuka naam.. por veerarayi">${escapeHtml(d.slidesTextEn)}</textarea>
        <div class="hint">Both boxes are optional per stanza, but every stanza needs at least one of the two filled in. Match the blank-line breaks between the two boxes so stanzas line up — the two are paired by position, not by matching text.</div>
      </div>
      ` : `
      <div class="field">
        <label>Slides — separate each projector slide with a blank line</label>
        <textarea id="f-slides" placeholder="Amazing grace, how sweet the sound&#10;That saved a wretch like me...&#10;&#10;I once was lost, but now am found&#10;Was blind but now I see.">${escapeHtml(d.slidesText)}</textarea>
        <div class="hint">Paste lyrics you already use in service — a blank line between verses/chorus becomes a new slide.</div>
      </div>
      `}
      <div class="row">
        <button class="btn btn-gold" id="btn-save-song">Save song</button>
        <button class="btn" id="btn-cancel-edit">Cancel</button>
        ${d.id ? '<button class="btn btn-danger" id="btn-delete-song">Delete</button>' : ''}
      </div>
      <div id="slide-preview" class="verse-slides"></div>
    `;
    $('#f-title').addEventListener('input', () => d.title = $('#f-title').value);
    $('#f-lang').addEventListener('change', () => { d.language = $('#f-lang').value; renderStage(); });
    $('#f-tags').addEventListener('input', () => d.tags = $('#f-tags').value);
    if (hasSecondLangBox(d.language)) {
      $('#f-slides-primary').addEventListener('input', () => { d.slidesTextPrimary = $('#f-slides-primary').value; renderSlidePreview(); });
      $('#f-slides-en').addEventListener('input', () => { d.slidesTextEn = $('#f-slides-en').value; renderSlidePreview(); });
    } else {
      $('#f-slides').addEventListener('input', () => { d.slidesText = $('#f-slides').value; renderSlidePreview(); });
    }
    $('#btn-save-song').addEventListener('click', saveSongFromEditor);
    $('#btn-cancel-edit').addEventListener('click', () => {
      if (d.id) { state.songMode = 'view'; }
      else { state.selectedSongId = null; state.editingDraft = null; }
      renderStage();
    });
    if (d.id) $('#btn-delete-song').addEventListener('click', async () => {
      if (!confirm('Delete "' + d.title + '"?')) return;
      const backup = JSON.parse(JSON.stringify(SongStore.getCached(d.id) || { id: d.id }));
      try { await SongStore.remove(d.id); }
      catch (err) { toast('Could not delete: ' + err.message); return; }
      state.selectedSongId = null;
      state.editingDraft = null;
      state.songMode = 'view';
      await refreshList(); renderStage();
      toast('Song deleted', {
        label: 'Undo', ms: 10000,
        onClick: async () => {
          try {
            const restored = await SongStore.save(backup);
            state.selectedSongId = restored.id;
            state.songMode = 'view';
            await refreshList(); renderStage();
            toast('Restored “' + restored.title + '”');
          } catch (err) { toast('Could not restore: ' + err.message); }
        }
      });
    });
    renderSlidePreview();
  }

  function parseSlides(text) {
    return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  }

  // { text, en } pairs built from the two textareas, matched by stanza
  // position. A stanza is dropped only if both sides are blank.
  function buildDualPairs(d) {
    const primarySlides = parseSlides(d.slidesTextPrimary || '');
    const enSlides = parseSlides(d.slidesTextEn || '');
    const count = Math.max(primarySlides.length, enSlides.length);
    const pairs = [];
    for (let i = 0; i < count; i++) {
      const text = primarySlides[i] || '';
      const en = enSlides[i] || '';
      if (!text && !en) continue;
      pairs.push({ text, en });
    }
    return pairs;
  }

  function renderSlidePreview() {
    const d = state.editingDraft;
    if (hasSecondLangBox(d.language)) { renderDualSlidePreview(d); return; }
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

  function renderDualSlidePreview(d) {
    const pairs = buildDualPairs(d);
    const box = $('#slide-preview');
    if (!pairs.length) { box.innerHTML = ''; return; }
    box.innerHTML = pairs.map((p, i) => `
      <div class="verse-slide" data-i="${i}">
        <span class="slide-label">Slide ${i + 1} of ${pairs.length} — click to show</span>
        ${p.text ? escapeHtml(p.text) : `<span class="slide-missing">(no ${langLabel(d.language)})</span>`}
        ${p.en ? `<div class="verse-slide-secondary">${escapeHtml(p.en)}</div>` : ''}
      </div>`).join('');
    $$('.verse-slide').forEach(el => el.addEventListener('click', () => {
      const pairs2 = buildDualPairs(d);
      state.liveSlides = pairs2.map((p, i) => buildDualSlide(p.text, p.en, i, pairs2.length, d.title || 'Untitled', d.language));
      state.liveIndex = Number(el.dataset.i);
      pushLive();
    }));
  }

  async function saveSongFromEditor() {
    const d = state.editingDraft;
    if (!d.title.trim()) { toast('Give the song a title first'); return; }
    let slides;
    if (hasSecondLangBox(d.language)) {
      slides = buildDualPairs(d);
      if (!slides.length) { toast(`Add ${langLabel(d.language)} and/or Manglish lyrics for at least one stanza`); return; }
    } else {
      slides = parseSlides(d.slidesText);
      if (!slides.length) { toast('Add at least one slide of lyrics'); return; }
    }
    let saved;
    try {
      saved = await SongStore.save({
        id: d.id,
        title: d.title.trim(),
        language: d.language,
        tags: d.tags.split(',').map(t => t.trim()).filter(Boolean),
        slides
      });
    } catch (err) { toast('Could not save: ' + err.message); return; }
    state.selectedSongId = saved.id;
    state.editingDraft.id = saved.id;
    state.songMode = 'view';
    await refreshList();
    renderStage();
    toast('Saved "' + saved.title + '"');
  }

  /* ---------------- Import / export ---------------- */
  $('#btn-export').addEventListener('click', async () => {
    try { const n = await SongStore.exportJSON(); toast(`Downloaded songs.json (${n} songs)`); }
    catch (err) { toast('Could not export: ' + err.message); }
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const n = await SongStore.importJSON(text);
      await refreshList();
      toast(`Imported ${n} song(s)`);
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
      <div class="row"><button class="btn" id="btn-custom-add-service">＋ Add to service</button></div>
      <div id="custom-preview" class="verse-slides"></div>
    `;
    $('#btn-custom-add-service').addEventListener('click', () => {
      const text = c.text.trim();
      if (!text) { toast('Type something first'); return; }
      const first = text.split('\n').find(l => l.trim()) || 'Custom';
      addToService({ type: 'custom', text, title: first.length > 40 ? first.slice(0, 40) + '…' : first, sub: 'Custom text' });
    });
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
  // Left rail: books (left column) and chapters of the selected book (right column).
  function renderBibleRail() {
    const b = state.bible;
    const list = $('#song-list');
    const v = BibleAPI.getVersionList().find(x => x.id === b.versionA);
    $('#library-count').textContent = v ? `Bible · ${v.label}` : 'Bible';
    if (!b.books.length) {
      list.innerHTML = `<div class="empty-note">Loading books…</div>`;
      return;
    }
    const book = b.books.find(x => x.id === b.bookId);
    const chapters = book ? book.chapters : 0;
    list.innerHTML = `
      <div class="bible-rail">
        <div class="bible-books">
          ${b.books.map(bk => `<button class="bible-book ${bk.id === b.bookId ? 'selected' : ''}" data-book="${bk.id}">${escapeHtml(bk.name || bk.commonName)}</button>`).join('')}
        </div>
        <div class="bible-chapters">
          ${Array.from({ length: chapters }, (_, i) => `<button class="bible-chapter ${i + 1 === b.chapter ? 'selected' : ''}" data-ch="${i + 1}">${i + 1}</button>`).join('')}
        </div>
      </div>`;
    $$('.bible-book').forEach(el => el.addEventListener('click', () => {
      b.bookId = el.dataset.book;
      b.chapter = 1;
      renderBibleRail();
      loadChapter();
    }));
    $$('.bible-chapter').forEach(el => el.addEventListener('click', () => {
      b.chapter = Number(el.dataset.ch);
      renderBibleRail();
      loadChapter();
    }));
    // Keep the selected book in view when the rail is re-drawn.
    const sel = list.querySelector('.bible-book.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  // Defaults are fixed on every load: primary = English NIV, secondary = Malayalam BSI. The
  // dropdowns can still be changed during a session.
  function versionOptions(selectedId, allowNone) {
    const groups = {};
    BibleAPI.getVersionList().forEach(v => { (groups[v.langLabel] = groups[v.langLabel] || []).push(v); });
    return (allowNone ? `<option value="">— none —</option>` : '') +
      Object.entries(groups).map(([lang, vs]) =>
        `<optgroup label="${escapeHtml(lang)}">${vs.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</optgroup>`
      ).join('');
  }

  async function renderBibleStage() {
    const stage = $('#stage');
    const b = state.bible;
    stage.innerHTML = `
      <h1>Bible</h1>
      <div class="meta" id="bible-ref-title">Choose a book and chapter on the left</div>
      <div class="bible-picker">
        <div class="row">
          <div class="field"><label>Version 1</label><select id="f-version-a">${versionOptions(b.versionA, false)}</select></div>
          <div class="field"><label>Version 2 (optional)</label><select id="f-version-b">${versionOptions(b.versionB, true)}</select></div>
        </div>
        <div class="hint">Click a verse to show it. Shift+click to show a range, Ctrl/⌘+click to add or remove single verses.</div>
        <div class="row"><button class="btn btn-small" id="btn-bible-add-service">＋ Add selected verses to service</button></div>
        <div id="bible-slides" class="verse-slides"></div>
      </div>
    `;
    $('#f-version-a').addEventListener('change', async () => {
      b.versionA = $('#f-version-a').value;
      if (b.versionB === b.versionA) { b.versionB = ''; $('#f-version-b').value = ''; }
      b.books = [];
      await loadBooks();
    });
    $('#f-version-b').addEventListener('change', () => {
      b.versionB = $('#f-version-b').value;
      if (b.versionB === b.versionA) { b.versionB = ''; $('#f-version-b').value = ''; }
      loadChapter();
    });
    $('#btn-bible-add-service').addEventListener('click', () => {
      if (!b.selection.length) { toast('Click or shift-click the verses first'); return; }
      const slide = makeBibleSlide(b.selection.map(k => b.rows[k]));
      addToService({
        type: 'bible', versionA: b.versionA, versionB: b.versionB, bookId: b.bookId,
        chapter: b.chapter, nums: slide.nums, title: slide.footer, sub: slide.footer2
      });
    });
    renderBibleRail();
    drawVerseList();
    await loadBooks();
  }

  async function loadBooks() {
    const b = state.bible;
    try {
      const books = await BibleAPI.getBooks(b.versionA);
      b.books = books;
      if (!b.bookId || !books.some(x => x.id === b.bookId)) { b.bookId = books.length ? books[0].id : ''; b.chapter = 1; }
      const cur = books.find(x => x.id === b.bookId);
      if (cur && b.chapter > cur.chapters) b.chapter = 1;
      renderBibleRail();
      if (b.bookId) await loadChapter();
    } catch (err) {
      toast('Could not load the Bible data — check your internet connection.');
    }
  }

  // "1-3,5" style label for a sorted list of verse numbers.
  function compactRef(nums) {
    const parts = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
      i = j;
    }
    return parts.join(',');
  }

  // Builds one projector slide from one or more verse rows (primary text + optional
  // second-version text). The footer is what the display shows bottom-centre.
  function makeBibleSlide(rows) {
    const b = state.bible;
    const book = b.books.find(x => x.id === b.bookId);
    return composeBibleSlide(rows, {
      versionA: b.versionA, versionB: b.versionB, bookId: b.bookId, chapter: b.chapter,
      bookName: (book && (book.name || book.commonName)) || b.bookId
    });
  }

  // Pure builder shared with the Service tab: rows [{number, a, b}] + which versions/book.
  function composeBibleSlide(rows, o) {
    const vs = BibleAPI.getVersionList();
    const vA = vs.find(x => x.id === o.versionA) || {};
    const vB = vs.find(x => x.id === o.versionB) || {};
    const aText = rows.map(r => r.a).filter(Boolean).join(' ');
    const bText = rows.map(r => r.b).filter(Boolean).join(' ');
    const nums = rows.map(r => r.number);
    const ref = compactRef(nums);
    const slide = { nums, ref, key: o.bookId + ':' + o.chapter, title: `${o.bookName} ${o.chapter}` };
    let labels;
    if (aText) {
      Object.assign(slide, { text: aText, lang: vA.langKey });
      if (bText) Object.assign(slide, { text2: bText, lang2: vB.langKey });
      labels = [vA.label, bText ? vB.label : null];
    } else {
      Object.assign(slide, { text: bText, lang: vB.langKey });
      labels = [vB.label];
    }
    slide.footer = `${o.bookName} ${o.chapter}:${ref}`;        // reference, prominent
    slide.footer2 = labels.filter(Boolean).join(' · ');        // version(s), small, beneath
    return slide;
  }

  // Draws the full chapter in the centre pane: verse number + text per row, with a second
  // column when a second version is chosen. Rows are aligned by verse number.
  function drawVerseList() {
    const b = state.bible;
    const box = $('#bible-slides');
    if (!box) return;
    const vs = BibleAPI.getVersionList();
    const two = !!b.versionB;
    const labelA = (vs.find(x => x.id === b.versionA) || {}).label || '';
    const labelB = (vs.find(x => x.id === b.versionB) || {}).label || '';
    const head = two ? `<div class="verse-head two"><span></span><span>${escapeHtml(labelA)}</span><span>${escapeHtml(labelB)}</span></div>` : '';
    box.innerHTML = head + b.rows.map((r, i) => `
      <div class="verse-slide verse-row ${two ? 'two' : ''} ${b.selection.includes(i) ? 'picked' : ''}" data-i="${i}" data-num="${r.number}">
        <span class="vnum">${r.number}</span>
        <div class="vtext">${escapeHtml(r.a)}</div>
        ${two ? `<div class="vtext vtext-b">${escapeHtml(r.b)}</div>` : ''}
      </div>`).join('');
    $$('#bible-slides .verse-row').forEach(el => el.addEventListener('click', (e) => {
      onVerseClick(Number(el.dataset.i), e);
    }));
    highlightLiveSlide();
  }

  // Click = just that verse. Shift+click = range from the last clicked verse. Ctrl/⌘+click =
  // add/remove a single verse. Whatever is selected goes on screen together as one slide.
  function onVerseClick(i, e) {
    const b = state.bible;
    let sel;
    if (e.shiftKey && b.anchor != null) {
      const lo = Math.min(b.anchor, i), hi = Math.max(b.anchor, i);
      sel = [];
      for (let k = lo; k <= hi; k++) sel.push(k);
    } else if (e.metaKey || e.ctrlKey) {
      const set = new Set(b.selection);
      if (set.has(i)) set.delete(i); else set.add(i);
      sel = Array.from(set).sort((x, y) => x - y);
      b.anchor = i;
      if (!sel.length) sel = [i];
    } else {
      sel = [i];
      b.anchor = i;
    }
    b.selection = sel;
    showBibleSelection();
  }

  function markPicked() {
    const b = state.bible;
    $$('#bible-slides .verse-row').forEach((el, i) => el.classList.toggle('picked', b.selection.includes(i)));
  }

  function showBibleSelection() {
    const b = state.bible;
    if (!b.selection.length) return;
    markPicked();
    const last = b.selection[b.selection.length - 1];
    state.liveSlides = b.slides;
    state.liveIndex = last;       // Next/Prev continue one verse at a time from here
    state.liveOverride = b.selection.length > 1
      ? { forSlides: b.slides, forIndex: last, slide: makeBibleSlide(b.selection.map(k => b.rows[k])) }
      : null;
    pushLive();
  }

  async function loadChapter() {
    const b = state.bible;
    const requestKey = `${b.versionA}|${b.versionB}|${b.bookId}|${b.chapter}`;
    try {
      const dataA = await BibleAPI.getChapter(b.versionA, b.bookId, b.chapter);
      const versesA = BibleAPI.extractVerses(dataA);
      let versesB = [];
      let bNote = '';
      if (b.versionB) {
        try {
          versesB = BibleAPI.extractVerses(await BibleAPI.getChapter(b.versionB, b.bookId, b.chapter));
        } catch (err) {
          bNote = 'Version 2 has no text for this chapter.';
        }
      }
      if (requestKey !== `${b.versionA}|${b.versionB}|${b.bookId}|${b.chapter}`) return; // superseded
      const mapA = new Map(versesA.map(v => [v.number, v.text]));
      const mapB = new Map(versesB.map(v => [v.number, v.text]));
      const nums = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((x, y) => x - y);
      b.rows = nums.map(n => ({ number: n, a: mapA.get(n) || '', b: mapB.get(n) || '' }));
      b.slides = b.rows.map(r => makeBibleSlide([r]));
      b.selection = [];
      b.anchor = null;
      const book = b.books.find(x => x.id === b.bookId);
      const bookName = (book && (book.name || book.commonName)) || b.bookId;
      const vs = BibleAPI.getVersionList();
      const names = [b.versionA, b.versionB].filter(Boolean).map(id => (vs.find(x => x.id === id) || {}).label);
      const refTitle = $('#bible-ref-title');
      if (refTitle) refTitle.textContent = `${bookName} ${b.chapter} · ${names.join(' · ')}`;
      if (!b.rows.length) toast('No verses found for that chapter.');
      else if (bNote) toast(bNote);
      drawVerseList();
    } catch (err) {
      toast('Could not load that chapter: ' + err.message);
    }
  }

  /* ---------------- Bible reference jump box ---------------- */
  // "John 3:16" -> Enter jumps to the book/chapter and selects the verses; Enter again (or the
  // "Show on screen" button) puts them on the projector. English names only, any version.
  const jumpState = { shownFor: '' };   // normalised input that is currently jumped-to
  const jumpEl = $('#bible-jump');
  const jumpHint = $('#bible-jump-hint');

  function jumpLabel(p) {
    const b = state.bible;
    const bookId = p.bookId || b.bookId;
    const chapter = p.chapter !== undefined ? p.chapter : (p.bookId ? 1 : b.chapter);
    let t = `${BibleAPI.bookName(bookId)} ${chapter}`;
    if (p.verses && p.verses.length) {
      const nums = p.verses.slice().sort((x, y) => x - y);
      t += ':' + compactRef(nums);
    }
    return t;
  }

  function updateJumpHint() {
    const raw = jumpEl.value;
    jumpState.shownFor = '';
    if (!raw.trim()) { jumpHint.className = 'jump-hint'; jumpHint.textContent = ''; return; }
    const p = BibleAPI.parseReference(raw);
    if (p.ok) {
      jumpHint.className = 'jump-hint ok';
      jumpHint.textContent = `Enter → ${jumpLabel(p)}`;
    } else if (p.matches) {
      jumpHint.className = 'jump-hint';
      jumpHint.innerHTML = p.matches.map(id =>
        `<button type="button" data-book="${id}">${escapeHtml(BibleAPI.bookName(id))}</button>`).join('');
      jumpHint.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        const rest = raw.trim().match(/\d.*$/);   // keep any "3:16" already typed
        jumpEl.value = BibleAPI.bookName(btn.dataset.book) + ' ' + (rest ? rest[0] : '');
        jumpEl.focus();
        updateJumpHint();
      }));
    } else {
      jumpHint.className = 'jump-hint err';
      jumpHint.textContent = p.message || '';
    }
  }

  async function runJump() {
    const b = state.bible;
    const p = BibleAPI.parseReference(jumpEl.value);
    if (!p.ok) { updateJumpHint(); return; }
    const bookId = p.bookId || b.bookId;
    const chapter = p.chapter !== undefined ? p.chapter : (p.bookId ? 1 : b.chapter);
    const book = b.books.find(x => x.id === bookId);
    if (!book) { jumpHint.className = 'jump-hint err'; jumpHint.textContent = 'That book isn’t in this version.'; return; }
    if (chapter < 1 || chapter > book.chapters) {
      jumpHint.className = 'jump-hint err';
      jumpHint.textContent = `${BibleAPI.bookName(bookId)} has ${book.chapters} chapter${book.chapters === 1 ? '' : 's'}.`;
      return;
    }
    b.bookId = bookId;
    b.chapter = chapter;
    renderBibleRail();
    await loadChapter();
    let note = '';
    if (p.verses && p.verses.length) {
      const idx = [];
      const missing = [];
      p.verses.forEach(n => {
        const k = b.rows.findIndex(r => r.number === n);
        if (k >= 0) idx.push(k); else missing.push(n);
      });
      b.selection = idx.sort((x, y) => x - y);
      b.anchor = b.selection.length ? b.selection[0] : null;
      markPicked();
      if (missing.length) note = ` (no verse ${compactRef(missing)})`;
      const first = $$('#bible-slides .verse-row')[b.selection[0]];
      if (first) first.scrollIntoView({ block: 'center' });
    }
    jumpState.shownFor = jumpEl.value.trim().toLowerCase();
    jumpHint.className = 'jump-hint ok';
    if (b.selection.length) {
      jumpHint.innerHTML = `${escapeHtml(jumpLabel(p))}${escapeHtml(note)} <button type="button" class="show-btn">Show on screen</button>`;
      jumpHint.querySelector('.show-btn').addEventListener('click', () => { showBibleSelection(); jumpEl.blur(); });
    } else {
      jumpHint.textContent = `${jumpLabel(p)} — click a verse to show it`;
    }
  }

  jumpEl.addEventListener('input', updateJumpHint);
  jumpEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const same = jumpEl.value.trim().toLowerCase() === jumpState.shownFor;
      if (same && state.bible.selection.length) { showBibleSelection(); jumpEl.blur(); }
      else runJump();
    } else if (e.key === 'Escape') {
      jumpEl.blur();
    }
  });

  /* ---------------- Service order (running order) ---------------- */
  const svc = () => state.service;
  let svcLoadToken = 0;

  async function ensureService() {
    const sv = svc();
    if (sv.loaded) return;
    if (sv.loading) { await sv.loading; return; }
    sv.loading = ServiceStore.load().then((cur) => {
      sv.id = cur.id; sv.name = cur.name; sv.items = cur.items; sv.loaded = true; sv.error = null;
    }).catch((e) => { sv.error = e.message; }).finally(() => { sv.loading = null; });
    await sv.loading;
  }

  async function saveServiceItems(items) {
    const sv = svc();
    const prev = sv.items;
    sv.items = items;
    try { await ServiceStore.saveItems(items); }
    catch (e) { sv.items = prev; toast('Could not save the service: ' + e.message); return false; }
    return true;
  }

  async function addToService(item) {
    await ensureService();
    const sv = svc();
    if (sv.error) { toast('Service unavailable: ' + sv.error); return; }
    item.id = ServiceStore.uid();
    const ok = await saveServiceItems(sv.items.concat([item]));
    if (!ok) return;
    toast(`Added “${item.title}” to the service (${sv.items.length} item${sv.items.length === 1 ? '' : 's'})`);
    if (state.tab === 'service') renderList();
  }

  // Builds the projector slides for one service item.
  async function buildServiceSlides(item) {
    if (item.type === 'song') {
      const song = await SongStore.get(item.songId);
      if (!song) throw new Error('This song is no longer in the library.');
      return songToLiveSlides(song);
    }
    if (item.type === 'custom') {
      const raw = parseSlides(item.text || '');
      return raw.map((t, i) => ({ text: t, ref: `${i + 1}/${raw.length}`, title: '', lang: 'en' }));
    }
    if (item.type === 'bible') {
      const books = await BibleAPI.getBooks(item.versionA);
      const book = books.find(x => x.id === item.bookId);
      const mapFor = async (id) => {
        if (!id) return new Map();
        try {
          const verses = BibleAPI.extractVerses(await BibleAPI.getChapter(id, item.bookId, item.chapter));
          return new Map(verses.map(v => [v.number, v.text]));
        } catch (e) { return new Map(); }
      };
      const [mA, mB] = await Promise.all([mapFor(item.versionA), mapFor(item.versionB)]);
      const rows = item.nums.map(n => ({ number: n, a: mA.get(n) || '', b: mB.get(n) || '' }));
      return [composeBibleSlide(rows, {
        versionA: item.versionA, versionB: item.versionB, bookId: item.bookId, chapter: item.chapter,
        bookName: (book && (book.name || book.commonName)) || item.bookId
      })];
    }
    return [];
  }

  // Loads item i into the centre pane; with {live:true} also puts its first slide on screen.
  async function selectServiceItem(i, { live = false } = {}) {
    const sv = svc();
    if (i < 0 || i >= sv.items.length) return;
    const token = ++svcLoadToken;
    sv.active = i;
    sv.slides = [];
    sv.itemError = null;
    renderList();
    renderStage();
    try {
      const slides = await buildServiceSlides(sv.items[i]);
      if (token !== svcLoadToken) return;
      sv.slides = slides;
    } catch (e) {
      if (token !== svcLoadToken) return;
      sv.itemError = e.message;
    }
    renderStage();
    if (live && sv.slides.length) {
      state.liveSlides = sv.slides;
      state.liveIndex = 0;
      state.liveOverride = null;
      pushLive();
    }
  }

  async function moveServiceItem(i, delta) {
    const sv = svc();
    const j = i + delta;
    if (j < 0 || j >= sv.items.length) return;
    const items = sv.items.slice();
    [items[i], items[j]] = [items[j], items[i]];
    const activeId = sv.active >= 0 ? sv.items[sv.active].id : null;
    if (!(await saveServiceItems(items))) return;
    sv.active = activeId ? items.findIndex(x => x.id === activeId) : -1;
    renderList();
  }

  async function removeServiceItem(i) {
    const sv = svc();
    const activeId = sv.active >= 0 ? sv.items[sv.active].id : null;
    const items = sv.items.filter((_, k) => k !== i);
    if (!(await saveServiceItems(items))) return;
    sv.active = activeId ? items.findIndex(x => x.id === activeId) : -1;
    if (sv.active === -1) sv.slides = [];
    renderList();
    renderStage();
  }

  function renderServiceRail() {
    const list = $('#song-list');
    const sv = svc();
    $('#library-count').textContent = sv.loaded ? `Service · ${sv.items.length} item${sv.items.length === 1 ? '' : 's'}` : 'Service';
    if (!sv.loaded) {
      if (sv.error) {
        list.innerHTML = `<div class="empty-note">Could not load the service:<br>${escapeHtml(sv.error)}</div>`;
        return;
      }
      list.innerHTML = `<div class="empty-note">Loading service…</div>`;
      ensureService().then(() => { if (state.tab === 'service') { renderList(); renderStage(); } });
      return;
    }
    const bar = `
      <div class="svc-bar">
        <button class="btn btn-small" id="btn-svc-prev">◀ Prev item</button>
        <button class="btn btn-small btn-gold" id="btn-svc-next">Next item ▶</button>
      </div>`;
    if (!sv.items.length) {
      list.innerHTML = bar + `<div class="empty-note">The service is empty.<br>Open a song, Bible verses or Custom text and use “Add to service”.</div>`;
    } else {
      list.innerHTML = bar + sv.items.map((it, i) => `
        <div class="list-item svc-item ${i === sv.active ? 'selected' : ''} ${it.type === 'song' && it.songId === state.liveSongId ? 'is-live' : ''}" data-i="${i}">
          <span class="svc-num">${i + 1}</span>
          <div class="item-main">
            <div class="t1">${escapeHtml(it.title || '')}${it.type === 'song' && it.songId === state.liveSongId ? '<span class="live-badge">LIVE</span>' : ''}</div>
            <div class="t2">${escapeHtml(it.sub || it.type)}</div>
          </div>
          <div class="svc-actions">
            <button class="star-btn" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="star-btn" data-act="down" title="Move down" ${i === sv.items.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="star-btn" data-act="del" title="Remove from service">✕</button>
          </div>
        </div>`).join('');
    }
    $('#btn-svc-prev').addEventListener('click', () => {
      const i = sv.active <= 0 ? 0 : sv.active - 1;
      selectServiceItem(i, { live: true });
    });
    $('#btn-svc-next').addEventListener('click', () => {
      const i = sv.active < 0 ? 0 : Math.min(sv.items.length - 1, sv.active + 1);
      selectServiceItem(i, { live: true });
    });
    $$('.svc-item').forEach(el => {
      const i = Number(el.dataset.i);
      el.addEventListener('click', () => selectServiceItem(i));
      el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'up') moveServiceItem(i, -1);
        else if (act === 'down') moveServiceItem(i, 1);
        else if (act === 'del') removeServiceItem(i);
      }));
    });
  }

  function renderServiceStage() {
    const stage = $('#stage');
    const sv = svc();
    if (!sv.loaded) {
      stage.innerHTML = `<div class="empty-note" style="padding-top:80px;">${sv.error ? 'Could not load the service: ' + escapeHtml(sv.error) : 'Loading service…'}</div>`;
      return;
    }
    const it = sv.items[sv.active];
    if (!it) {
      stage.innerHTML = `
        <h1>${escapeHtml(sv.name)}</h1>
        <div class="meta">${sv.items.length} item${sv.items.length === 1 ? '' : 's'}</div>
        <div class="empty-note" style="padding-top:40px;">Pick an item on the left to load it, then click a slide — or press “Next item” to put it on screen.</div>`;
      return;
    }
    stage.innerHTML = `
      <h1>${escapeHtml(it.title || '')}</h1>
      <div class="meta">Item ${sv.active + 1} of ${sv.items.length} · ${escapeHtml(it.sub || it.type)}</div>
      ${sv.itemError ? `<div class="empty-note">${escapeHtml(sv.itemError)}</div>` : ''}
      <div id="svc-slides" class="verse-slides"></div>`;
    const box = $('#svc-slides');
    box.innerHTML = sv.slides.map((s, i) => `
      <div class="verse-slide" data-i="${i}">
        <span class="slide-label">Slide ${i + 1} of ${sv.slides.length} — click to show</span>${escapeHtml(s.text)}
        ${s.text2 ? `<div class="verse-slide-secondary">${escapeHtml(s.text2)}</div>` : ''}
      </div>`).join('');
    $$('#svc-slides .verse-slide').forEach(el => el.addEventListener('click', () => {
      state.liveSlides = sv.slides;
      state.liveIndex = Number(el.dataset.i);
      state.liveOverride = null;
      pushLive();
    }));
    highlightLiveSlide();
  }

  /* ---------------- Live display control ---------------- */
  // Which song is on the projector, plus a "Live: …" line above the preview. Clicking it jumps
  // to that song. Re-draws the list only when the live song actually changes.
  function setLiveSource(songId, label) {
    const changed = (state.liveSongId || null) !== (songId || null);
    state.liveSongId = songId || null;
    const el = $('#live-now');
    el.textContent = label ? 'Live: ' + label : '';
    el.classList.toggle('on', !!label);
    if (changed && (state.tab === 'songs' || state.tab === 'service')) renderList();
  }
  $('#live-now').addEventListener('click', () => {
    if (!state.liveSongId) return;
    state.selectedSongId = state.liveSongId;
    state.songMode = 'view';
    if (state.tab === 'songs') { renderList(); renderStage(); }
    else setTab('songs');
  });

  function pushLive() {
    let s = state.liveSlides[state.liveIndex];
    const o = state.liveOverride;
    if (o && o.forSlides === state.liveSlides && o.forIndex === state.liveIndex) s = o.slide;
    else state.liveOverride = null;
    if (!s) return;
    state.liveNums = s.nums || [];
    state.liveKey = s.key || '';
    setLiveSource(s.songId || null, s.footer ? s.footer : `${s.title || 'Custom'}${s.ref ? ' · ' + s.ref : ''}`);
    const msg = { type: 'slide', lang: s.lang, title: s.title, text: s.text, ref: s.ref };
    if (s.footer) { msg.footer = s.footer; msg.footer2 = s.footer2 || ''; msg.title = ''; msg.ref = ''; }
    if (s.text2) { msg.text2 = s.text2; msg.lang2 = s.lang2; }
    ProjectorLink.send(msg);
    renderMiniScreen(s);
    highlightLiveSlide();
    updatePresentScreen(msg);
  }

  /* ---------------- In-page presentation (single-monitor mode) ---------------- */
  const LANG_CLASS = { ml: 'lang-mal', hi: 'lang-hin', ta: 'lang-tam' };
  function applyPresentLangClass(el, lang) {
    el.classList.remove('lang-mal', 'lang-hin', 'lang-tam');
    if (LANG_CLASS[lang]) el.classList.add(LANG_CLASS[lang]);
  }
  function setPresentFooter(ref, ver) {
    const el = $('#present-footer');
    el.textContent = '';
    if (!ref) return;
    const r = document.createElement('div'); r.className = 'ref'; r.textContent = ref;
    el.appendChild(r);
    if (ver) {
      const v = document.createElement('div'); v.className = 'ver'; v.textContent = ver;
      el.appendChild(v);
    }
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
      $('#present-footer').textContent = '';
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
      setPresentFooter(msg.footer, msg.footer2);
      applyPresentLangClass($('#present-footer'), msg.lang);

      const totalLen = (msg.text || '').length + (msg.text2 ? msg.text2.length : 0);
      const size = `calc(${ProjectorLink.pickFontSize(totalLen)} * var(--font-scale))`;
      state.presentBase = size;
      refitPresent();
    }
  }
  function refitPresent() {
    if (!state.presentMode || !state.presentBase) return;
    ProjectorLink.fitText($('#present-stage-inner'), [$('#present-text'), $('#present-text-2')], state.presentBase);
  }
  window.addEventListener('resize', refitPresent);
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

  // Double-clicking any slide (song, Bible, or Custom) opens/focuses the
  // in-page Present overlay on that slide — the preceding single-click
  // (fired first, by the browser's own click/dblclick sequencing) already
  // pushed it live, so this just needs to bring the overlay up.
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('.verse-slide')) openPresentMode();
  });

  // Manual font-size override — compensates for a projector that crops or
  // letterboxes the edges of the image, independent of the automatic
  // length-based sizing. Applies to the control panel's own document (which
  // covers the in-page Present overlay) and is broadcast to any open
  // popup display window too.
  function applyFontScale() {
    document.documentElement.style.setProperty('--font-scale', state.fontScale);
    $('#font-scale-label').textContent = Math.round(state.fontScale * 100) + '%';
    if (typeof refitPresent === 'function') refitPresent();
  }
  function adjustFontScale(delta) {
    state.fontScale = Math.max(0.5, Math.min(2, +(state.fontScale + delta).toFixed(2)));
    applyFontScale();
    ProjectorLink.setFontScale(state.fontScale);
  }
  $('#btn-font-dec').addEventListener('click', () => adjustFontScale(-0.05));
  $('#btn-font-inc').addEventListener('click', () => adjustFontScale(0.05));

  function highlightLiveSlide() {
    if (state.tab === 'bible') {
      const b = state.bible;
      const here = state.liveKey === b.bookId + ':' + b.chapter;
      const rows = $$('#bible-slides .verse-row');
      rows.forEach(el => el.classList.toggle('live', here && (state.liveNums || []).includes(Number(el.dataset.num))));
      const first = rows.find(el => el.classList.contains('live'));
      if (first) first.scrollIntoView({ block: 'nearest' });
      return;
    }
    $$('.verse-slide').forEach((el, i) => el.classList.toggle('live', Number(el.dataset.i) === state.liveIndex));
  }

  function renderMiniScreen(s) {
    const mini = $('#mini-screen');
    if (!s) { mini.textContent = 'Nothing live yet'; return; }
    mini.textContent = s.text2 ? `${s.text}\n\n— ${langLabel(s.lang2)} —\n${s.text2}` : s.text;
  }

  function startSelectedSongLive() {
    const song = state.selectedSongId ? SongStore.getCached(state.selectedSongId) : null;
    if (!song || !song.slides.length) return;
    state.liveSlides = songToLiveSlides(song);
    state.liveIndex = 0;
    pushLive();
  }

  // Starts whatever is selected in the current tab (song or the last-loaded
  // Bible passage) live from its first slide — used by Space/Enter and by
  // "Open display" / "Present" when nothing is live yet.
  function startCurrentSelectionLive() {
    if (state.tab === 'bible') {
      if (state.bible.selection.length) { showBibleSelection(); return; }
      if (!state.bible.slides.length) return;
      state.liveSlides = state.bible.slides;
      state.liveIndex = 0;
      state.liveOverride = null;
      pushLive();
      return;
    }
    if (state.tab === 'service') {
      const sv = svc();
      if (!sv.slides.length) return;
      state.liveSlides = sv.slides;
      state.liveIndex = 0;
      state.liveOverride = null;
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
    const el = $('#live-now');
    if (el.classList.contains('on')) el.textContent = 'Display is blanked';
    ProjectorLink.send({ type: 'blank' });
    updatePresentScreen({ type: 'blank' });
  });
  $('#btn-clear').addEventListener('click', () => {
    ProjectorLink.send({ type: 'clear' });
    updatePresentScreen({ type: 'clear' });
    $('#mini-screen').textContent = 'Nothing live yet';
    state.liveIndex = -1;
    setLiveSource(null, '');
    highlightLiveSlide();
  });

  /* ---------------- Display window management ---------------- */
  $('#btn-open-display').addEventListener('click', () => {
    state.displayWin = window.open('display.html' + (state.pairCode ? '?code=' + state.pairCode : ''), 'churchProjectorDisplay', 'width=1280,height=720');
    setDisplayStatus(true);
    if (state.liveIndex === -1) startCurrentSelectionLive();
  });
  // Shows how many display windows are connected online (any device that paired with the
  // code); falls back to the local popup check when offline.
  function setDisplayStatus(open) {
    if (open !== undefined) state.popupOpen = open;
    const online = ProjectorLink.remote.status === 'online';
    const n = state.displayCount || 0;
    let text, on;
    if (online && n > 0) {
      text = n === 1 ? '1 display connected' : n + ' displays connected';
      on = true;
    } else if (state.popupOpen) {
      text = online ? 'Display window open (connecting…)' : 'Display window open';
      on = true;
    } else {
      text = online ? 'No display connected' : 'Display window not open';
      on = false;
    }
    $('#display-dot').classList.toggle('on', on);
    $('#display-status').textContent = text;
  }
  ProjectorLink.remote.onDisplayCount((n) => { state.displayCount = n; setDisplayStatus(); });
  setInterval(() => {
    if (state.displayWin) setDisplayStatus(!state.displayWin.closed);
  }, 1500);

  // Shortcut cheat sheet ("?" button or the ? key).
  const helpEl = $('#help-overlay');
  const openHelp = () => helpEl.classList.remove('hidden');
  const closeHelp = () => helpEl.classList.add('hidden');
  $('#btn-help').addEventListener('click', openHelp);
  $('#btn-help-close').addEventListener('click', closeHelp);
  helpEl.addEventListener('click', (e) => { if (e.target === helpEl) closeHelp(); });

  // Keyboard shortcuts on the panel itself.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !helpEl.classList.contains('hidden')) { closeHelp(); return; }
    if (e.key === 'Escape' && state.presentMode) { closePresentMode(); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key === '/' && state.tab === 'bible') { e.preventDefault(); jumpEl.focus(); jumpEl.select(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); $('#btn-next').click(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); $('#btn-prev').click(); }
    if (e.key.toLowerCase() === 'b') $('#btn-blank').click();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startCurrentSelectionLive(); }
  });

  /* ---------------- Theme (control panel + presentation surfaces) ---------------- */
  // Applies to this document (control panel UI + the in-page Present
  // overlay, since they share a document) and is broadcast via
  // ProjectorLink so a popup display.html window matches too.
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('#btn-theme-toggle').textContent = theme === 'light' ? '☾' : '☀';
  }
  $('#btn-theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    ProjectorLink.setTheme(next);
    applyTheme(next);
  });

  /* ---------------- Login gate ---------------- */
  let remoteWired = false, remoteStarting = false;
  async function startRemote() {
    const R = ProjectorLink.remote;
    if (!remoteWired) {
      remoteWired = true;
      R.onStatus((st) => {
        const text = { online: 'Online: connected', connecting: 'Online: connecting…',
          offline: 'Offline: using this device only', error: 'Online: connection problem' }[st] || st;
        $('#online-status').textContent = text;
        $('#online-dot').classList.toggle('on', st === 'online');
        setDisplayStatus();
      });
      R.onTakeover(() => $('#takeover-overlay').classList.remove('hidden'));
    }
    if (remoteStarting) return;
    remoteStarting = true;
    if (!navigator.onLine) {
      $('#online-status').textContent = 'Offline: using this device only';
      remoteStarting = false;
      return;
    }
    try {
      const res = await R.startControl({
        confirmTakeover: async () => confirm('Another device is controlling the projector. Take over?')
      });
      if (res.declined) {
        $('#takeover-overlay').classList.remove('hidden');
        return;
      }
      state.pairCode = res.code;
      $('#pair-code').textContent = res.code;
      $('#pair-row').style.display = '';
      // After a refresh the panel has forgotten what is on the projector; show it again.
      const live = await R.getLiveState();
      if (live && state.liveIndex === -1) {
        if (live.type === 'slide') renderMiniScreen(live);
        else if (live.type === 'blank') $('#mini-screen').textContent = 'Display is blanked';
      }
    } catch (e) {
      console.warn('Online mode unavailable, working locally:', e);
      $('#online-status').textContent = navigator.onLine
        ? 'Online: ' + (e && e.message ? e.message : 'connection problem')
        : 'Offline: using this device only';
    } finally {
      remoteStarting = false;
    }
  }
  // Connection comes back: reconnect the live link and refresh the library.
  window.addEventListener('online', () => {
    if (!$('#app-root').classList.contains('hidden')) {
      startRemote();
      refreshList();
      SongStore.syncOffline();
    }
  });
  window.addEventListener('offline', () => {
    $('#online-status').textContent = 'Offline: using this device only';
    $('#online-dot').classList.remove('on');
  });
  $('#btn-take-back').addEventListener('click', () => location.reload());
  $('#btn-copy-display-link').addEventListener('click', async () => {
    const url = new URL('display.html', location.href);
    url.searchParams.set('code', state.pairCode);
    try { await navigator.clipboard.writeText(url.href); toast('Display link copied'); }
    catch (e) { prompt('Copy this link:', url.href); }
  });

  // Fetching the default versions once lets the service worker cache them for offline use.
  function prefetchBibleForOffline() {
    if (!navigator.onLine || (navigator.connection && navigator.connection.saveData)) return;
    const files = ['data/bible/en_niv.json', 'data/bible/ml_bsi.json'];
    const run = async () => { for (const f of files) { try { await fetch(f); } catch (e) { /* ignore */ } } };
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 3000)))(run);
  }

  async function startApp() {
    startRemote();
    applyTheme(ProjectorLink.getTheme());
    state.fontScale = ProjectorLink.getFontScale();
    applyFontScale();
    if (navigator.onLine) await SongStore.seedIfEmpty();
    await refreshList();
    // Background: keep the offline copy fresh and pre-load the default Bible versions.
    SongStore.syncOffline().then((r) => {
      if (r && r.full && r.total) toast(`Saved ${r.total} songs for offline use`);
    });
    prefetchBibleForOffline();
    renderStage();
  }

  function showApp() {
    $('#login-overlay').classList.add('hidden');
    $('#app-root').classList.remove('hidden');
    startApp();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#f-login-user').value.trim();
    const p = $('#f-login-pass').value;
    if (await Auth.login(u, p)) {
      $('#login-error').classList.add('hidden');
      showApp();
    } else {
      $('#login-error').classList.remove('hidden');
      $('#f-login-pass').value = '';
      $('#f-login-pass').focus();
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('Log out of the control panel?')) return;
    await ProjectorLink.remote.release();
    await Auth.logout();
    location.reload();
  });

  /* ---------------- Boot ---------------- */
  Auth.isLoggedIn().then((ok) => {
    if (ok) showApp();
    else $('#f-login-user').focus();
  });
})();
