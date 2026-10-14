/* Bible lookup — reads from bundled local JSON (data/bible/*.json) instead of
   hitting bible.helloao.org at runtime. The church only ever needs one fixed
   translation per language (KJV / Malayalam 1910 BSI / Hindi IRV), so the
   full text for each was downloaded once and committed here — this avoids
   an API round-trip per chapter and works fully offline. Files are the
   unmodified `/api/<translationId>/complete.json` payloads from that API,
   so re-downloading a fresh copy later is a drop-in replacement if a
   translation ever needs updating.
*/
const BibleAPI = (() => {
  const LANGS = {
    en: { label: 'English' },
    ml: { label: 'Malayalam' },
    hi: { label: 'Hindi' }
  };

  // Translations offered per language. The FIRST entry is the default (and the one used
  // for the second-language box in dual mode). The en_ukjv / ml_bsi / hi_unicode files are
  // generated from the .db sources by scripts/convert_bible_db.py.
  const TRANSLATIONS = {
    en: [
      { id: 'eng_niv',  file: 'data/bible/en_niv.json',     label: 'NIV' },
      { id: 'eng_kjv',  file: 'data/bible/en.json',          label: 'KJV' },
      { id: 'eng_ukjv', file: 'data/bible/en_ukjv.json',    label: 'UKJV' }
    ],
    ml: [
      { id: 'mal_bsi', file: 'data/bible/ml_bsi.json',     label: 'Malayalam BSI' },
      { id: 'mal_fbf', file: 'data/bible/ml.json',         label: 'Malayalam 1910' }
    ],
    hi: [
      { id: 'HINIRV',      file: 'data/bible/hi.json',          label: 'Hindi IRV' },
      { id: 'hin_unicode', file: 'data/bible/hi_unicode.json',  label: 'Hindi BSI' }
    ]
  };
  const FILE_BY_ID = {};
  Object.values(TRANSLATIONS).flat().forEach(t => { FILE_BY_ID[t.id] = t.file; });

  const _cache = {}; // translationId -> parsed complete.json

  async function loadById(translationId) {
    if (_cache[translationId]) return _cache[translationId];
    const file = FILE_BY_ID[translationId];
    if (!file) throw new Error('Unknown translation id: ' + translationId);
    const res = await fetch(file);
    if (!res.ok) throw new Error('Could not load bundled Bible data (' + file + ')');
    const data = await res.json();
    _cache[translationId] = data;
    return data;
  }

  async function getTranslationsForLang(langKey) {
    const list = TRANSLATIONS[langKey] || [];
    // Loaded one after another so only the (cached) files actually needed are fetched.
    const out = [];
    for (const t of list) {
      const data = await loadById(t.id);
      out.push({
        id: data.translation.id,
        shortName: data.translation.shortName,
        label: t.label || data.translation.shortName,
        englishName: data.translation.englishName,
        language: data.translation.language
      });
    }
    return out;
  }

  async function getBooks(translationId) {
    const data = await loadById(translationId);
    return data.books.map(b => ({ id: b.id, name: b.name, commonName: b.commonName, chapters: b.chapters.length }));
  }

  async function getChapter(translationId, bookId, chapterNum) {
    const data = await loadById(translationId);
    const book = data.books.find(b => b.id === bookId);
    if (!book) throw new Error('Book not found: ' + bookId);
    const num = Number(chapterNum);
    const entry = book.chapters.find(c => c.chapter.number === num);
    if (!entry) throw new Error('Chapter not found: ' + bookId + ' ' + chapterNum);
    return { chapter: entry.chapter };
  }

  // Flattens a verse's `content` array (strings + {text}/{lineBreak}/{noteId} objects) into plain text.
  function verseText(contentArr) {
    return contentArr
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (part.lineBreak) return ' ';
          if (typeof part.text === 'string') return part.text;
        }
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?”])/g, '$1')
      .trim();
  }

  // Extracts {number, text}[] for a chapter, skipping headings/line breaks.
  function extractVerses(chapterData) {
    const items = (chapterData.chapter && chapterData.chapter.content) || [];
    return items
      .filter(it => it.type === 'verse')
      .map(it => ({ number: it.number, text: verseText(it.content) }));
  }

  // Builds projector-ready slides: verseFrom..verseTo grouped `perSlide` verses at a time.
  function buildSlides(verses, verseFrom, verseTo, perSlide = 1) {
    const range = verses.filter(v => v.number >= verseFrom && v.number <= (verseTo || verseFrom));
    const slides = [];
    for (let i = 0; i < range.length; i += perSlide) {
      const chunk = range.slice(i, i + perSlide);
      slides.push({
        text: chunk.map(v => v.text).join(' '),
        ref: chunk.length > 1
          ? `${chunk[0].number}-${chunk[chunk.length - 1].number}`
          : `${chunk[0].number}`
      });
    }
    return slides;
  }

  // ---------- Reference parsing ("John 3:16", "1 cor 13:4-7", "ps 23") ----------
  // English names/abbreviations only — used for every version, including Malayalam/Hindi.
  // [bookId, full name, ...aliases]; spaces are ignored when matching.
  const BOOK_ALIASES = [
    ['GEN','Genesis','gen','ge','gn'], ['EXO','Exodus','exod','exo','ex'],
    ['LEV','Leviticus','lev','le','lv'], ['NUM','Numbers','num','nu','nm','nb'],
    ['DEU','Deuteronomy','deut','deu','de','dt'], ['JOS','Joshua','josh','jos','jsh'],
    ['JDG','Judges','judg','jdg','jg','jdgs'], ['RUT','Ruth','rut','ru','rth'],
    ['1SA','1 Samuel','1sam','1sa','1sm'], ['2SA','2 Samuel','2sam','2sa','2sm'],
    ['1KI','1 Kings','1kgs','1ki','1kin'], ['2KI','2 Kings','2kgs','2ki','2kin'],
    ['1CH','1 Chronicles','1chron','1chr','1ch'], ['2CH','2 Chronicles','2chron','2chr','2ch'],
    ['EZR','Ezra','ezr'], ['NEH','Nehemiah','neh','ne'], ['EST','Esther','esth','est'],
    ['JOB','Job','jb'], ['PSA','Psalms','psalm','ps','psa','pss','psm'],
    ['PRO','Proverbs','prov','pro','pr','prv'], ['ECC','Ecclesiastes','eccl','eccles','ecc','ec'],
    ['SNG','Song of Solomon','song of songs','song','sos','sng','sg','canticles'],
    ['ISA','Isaiah','isa','is'], ['JER','Jeremiah','jer','je','jr'],
    ['LAM','Lamentations','lam','la'], ['EZK','Ezekiel','ezek','eze','ezk'],
    ['DAN','Daniel','dan','da','dn'], ['HOS','Hosea','hos','ho'], ['JOL','Joel','joe','jl'],
    ['AMO','Amos','amo','am'], ['OBA','Obadiah','obad','oba','ob'], ['JON','Jonah','jnh','jon'],
    ['MIC','Micah','mic','mi'], ['NAM','Nahum','nah','nam','na'], ['HAB','Habakkuk','hab','hb'],
    ['ZEP','Zephaniah','zeph','zep','zp'], ['HAG','Haggai','hag','hg'],
    ['ZEC','Zechariah','zech','zec','zc'], ['MAL','Malachi','mal','ml'],
    ['MAT','Matthew','matt','mat','mt'], ['MRK','Mark','mrk','mar','mk','mr'],
    ['LUK','Luke','luk','lk'], ['JHN','John','jhn','joh','jn'], ['ACT','Acts','act','ac'],
    ['ROM','Romans','rom','ro','rm'], ['1CO','1 Corinthians','1cor','1co'],
    ['2CO','2 Corinthians','2cor','2co'], ['GAL','Galatians','gal','ga'],
    ['EPH','Ephesians','ephes','eph'], ['PHP','Philippians','phil','php','pp'],
    ['COL','Colossians','col'], ['1TH','1 Thessalonians','1thess','1thes','1th'],
    ['2TH','2 Thessalonians','2thess','2thes','2th'], ['1TI','1 Timothy','1tim','1ti'],
    ['2TI','2 Timothy','2tim','2ti'], ['TIT','Titus','tit','ti'],
    ['PHM','Philemon','philem','phm'], ['HEB','Hebrews','heb'], ['JAS','James','jas','jam','jm'],
    ['1PE','1 Peter','1pet','1pe','1pt'], ['2PE','2 Peter','2pet','2pe','2pt'],
    ['1JN','1 John','1jn','1jo','1joh'], ['2JN','2 John','2jn','2jo','2joh'],
    ['3JN','3 John','3jn','3jo','3joh'], ['JUD','Jude','jud'],
    ['REV','Revelation','revelations','rev','re','apocalypse']
  ];
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIAS_INDEX = []; // [{ key, id }]
  BOOK_ALIASES.forEach(([id, name, ...aliases]) => {
    [name, ...aliases].forEach(a => ALIAS_INDEX.push({ key: norm(a), id }));
  });
  const BOOK_NAME_BY_ID = {};
  BOOK_ALIASES.forEach(([id, name]) => { BOOK_NAME_BY_ID[id] = name; });

  // Books whose name/abbreviation equals (exact) or starts with (prefix) the typed text.
  function matchBooks(text) {
    const k = norm(text);
    if (!k) return [];
    const exact = ALIAS_INDEX.filter(a => a.key === k).map(a => a.id);
    if (exact.length) return Array.from(new Set(exact));
    const ids = ALIAS_INDEX.filter(a => a.key.startsWith(k)).map(a => a.id);
    const set = new Set(ids);
    return BOOK_ALIASES.map(b => b[0]).filter(id => set.has(id));
  }

  function expandVerses(spec) {
    const out = [];
    spec.split(',').forEach(part => {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return;
      const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
      for (let v = from; v <= Math.max(from, to) && v - from < 200; v++) out.push(v);
    });
    return Array.from(new Set(out));
  }

  // -> { ok, bookId?, chapter?, verses?: number[], matches?: string[] (ids), message? }
  function parseReference(input) {
    let t = String(input || '').toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/\b(chapter|verses|verse)\b/g, ' ')
      .replace(/\bfirst\b/g, '1').replace(/\bsecond\b/g, '2').replace(/\bthird\b/g, '3')
      .replace(/^\s*iii\s+/, '3 ').replace(/^\s*ii\s+/, '2 ').replace(/^\s*i\s+(?=[a-z])/, '1 ')
      .replace(/\s+/g, ' ').trim();
    if (!t) return { ok: false, empty: true };
    const m = t.match(/^(?:([123])\s*)?([a-z]+(?:\s[a-z]+)*)?(?:\s*(\d+)(?:\s*[:.]\s*|\s+)?(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)?)?$/);
    if (!m) return { ok: false, message: 'Try a form like “John 3:16” or “1 Cor 13:4-7”.' };
    const [, num, name, chap, verseSpec] = m;
    const out = { ok: true };
    if (name) {
      const matches = matchBooks((num || '') + name);
      if (!matches.length) return { ok: false, message: `No book matches “${(num ? num + ' ' : '') + name}”.` };
      if (matches.length > 1) return { ok: false, matches, message: 'Which book?' };
      out.bookId = matches[0];
    } else if (num && !chap) {
      return { ok: false, message: 'Add a book name, e.g. “1 John 3”.' };
    }
    const chapter = chap ? Number(chap) : (!name && num ? Number(num) : undefined);
    if (chapter !== undefined) out.chapter = chapter;
    if (verseSpec) {
      out.verses = expandVerses(verseSpec);
      if (!out.verses.length) return { ok: false, message: 'Could not read the verse numbers.' };
    }
    if (!out.bookId && out.chapter === undefined) return { ok: false, message: 'Type a book name.' };
    return out;
  }

  function bookName(id) { return BOOK_NAME_BY_ID[id] || id; }

  // Every bundled version across all languages, synchronously (no file loads):
  // [{ id, label, langKey, langLabel }]. Used for the version dropdowns.
  function getVersionList() {
    const out = [];
    Object.keys(TRANSLATIONS).forEach(langKey => {
      TRANSLATIONS[langKey].forEach(t => out.push({
        id: t.id, label: t.label || t.id, langKey, langLabel: (LANGS[langKey] || {}).label || langKey
      }));
    });
    return out;
  }

  return { parseReference, bookName, getVersionList, LANGS, getTranslationsForLang, getBooks, getChapter, extractVerses, buildSlides };
})();
