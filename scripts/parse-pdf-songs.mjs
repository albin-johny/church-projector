import fs from 'node:fs';
const raw = fs.readFileSync('all.txt','utf8').split('\n');
const SMALL = new Set(['a','an','the','of','to','in','on','and','or','for','my','your','you','i','is','be','with','at','by','from','as','am','are','we','our','his','he','it','all','no','not','up','me','us','what','who','how','that','this','than','into']);
const isTitle = (l) => {
  if (/[.,;:!?)"]$/.test(l) || l.length > 60 || /\(/.test(l)) return false;
  const w = l.split(/\s+/);
  if (w.length > 8) return false;
  return w.every((x, i) => /^[A-Z0-9'"(]/.test(x) || (i > 0 && SMALL.has(x.toLowerCase())) || /^[-\/&]$/.test(x)) && /^[A-Z]/.test(l);
};
// build blocks
const blocks = []; let cur = [];
const flush = () => { if (cur.length) blocks.push(cur); cur = []; };
for (const l0 of raw) {
  const l = l0.trim();
  if (/^=====PAGE/.test(l) || /^--col\d--$/.test(l)) { flush(); if (/^--col/.test(l)) blocks.push(['<<COL>>']); continue; }
  if (/^Worship Song Lyrics/.test(l) || /^2008-05\)?$/.test(l)) continue;
  if (!l) { flush(); continue; }
  cur.push(l);
}
flush();
const songs = []; let song = null;
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (b[0] === '<<COL>>') continue;
  let k = i + 1; while (blocks[k] && blocks[k][0] === '<<COL>>') k++;
  const next = blocks[k];
  // title can also be first line of a block followed by lyrics in the same block (no gap)
  if (b.length === 1 && isTitle(b[0]) && next) { song = { title: b[0], blocks: [] }; songs.push(song); continue; }
  if (b.length > 1 && isTitle(b[0]) && !/[.,;:!?]$/.test(b[0]) && song === null) { song = { title: b[0], blocks: [b.slice(1)] }; songs.push(song); continue; }
  if (song) song.blocks.push(b);
}
fs.writeFileSync('songs.json', JSON.stringify(songs, null, 1));
console.log(songs.length);
console.log(songs.map((s, i) => `${i + 1}. ${s.title} [${s.blocks.length}]`).join('\n'));

// ---- write import JSON ----
const FIX = { 'I AmAC': 'I Am a C', 'I am a C': null, 'Will Never Be The Same Again': 'I Will Never Be The Same Again', 'JOy': 'Joy' };
const out = []; const used = new Set();
for (const s of songs) {
  let title = s.title in FIX ? FIX[s.title] : s.title;
  if (!title) continue;
  const slides = s.blocks.filter((b) => b[0] !== '<<COL>>').map((b) => b.join('\n').trim()).filter(Boolean);
  if (!slides.length) continue;
  let id = 'pdf_' + title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  while (used.has(id)) id += '_2';
  used.add(id);
  out.push({ id, title, language: 'en', tags: [], slides, inSetlist: false, lyricist: null });
}
fs.mkdirSync('/Users/albin/Desktop/files/church-projector/import/en', { recursive: true });
fs.writeFileSync('/Users/albin/Desktop/files/church-projector/import/en/songs-import.json', JSON.stringify({ songs: out, exportedAt: new Date().toISOString() }, null, 1));
console.log('WROTE', out.length);
