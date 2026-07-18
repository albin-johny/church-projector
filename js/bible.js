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

  // One blessed translation per language — see data/bible/README.md.
  const TRANSLATIONS = {
    en: { id: 'eng_kjv', file: 'data/bible/en.json' },
    ml: { id: 'mal_fbf', file: 'data/bible/ml.json' },
    hi: { id: 'HINIRV', file: 'data/bible/hi.json' }
  };
  const FILE_BY_ID = {};
  Object.values(TRANSLATIONS).forEach(t => { FILE_BY_ID[t.id] = t.file; });

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
    const t = TRANSLATIONS[langKey];
    if (!t) return [];
    const data = await loadById(t.id);
    return [{
      id: data.translation.id,
      shortName: data.translation.shortName,
      englishName: data.translation.englishName,
      language: data.translation.language
    }];
  }

  async function getBooks(translationId) {
    const data = await loadById(translationId);
    return data.books.map(b => ({ id: b.id, name: b.name, commonName: b.commonName }));
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

  return { LANGS, getTranslationsForLang, getBooks, getChapter, extractVerses, buildSlides };
})();
