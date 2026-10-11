#!/usr/bin/env python3
"""Convert Bible sources into the same JSON shape as the helloao complete.json files that
js/bible.js reads. Supported sources:
  * SQLite .db files (tables `words` + `configuration`)
  * simple XML: <bible><testament><book number=N><chapter number=N><verse number=N>text

Usage: python3 scripts/convert_bible_db.py
Edit TARGETS to add another .db. Output goes next to the source in data/bible/.
"""
import json, re, sqlite3, os
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(__file__), '..', 'data', 'bible')

# Same USFM-style ids as the existing en/ml/hi JSON so book selection carries across versions.
BOOK_IDS = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV']

TARGETS = [
    # (source db, output json, translation id, short name, language code, language name)
    ('english_ukjv.db',  'en_ukjv.json',    'eng_ukjv',    'UKJV', 'eng', 'English'),
    ('municode_12.db',   'ml_bsi.json',     'mal_bsi',     'BSI',  'mal', 'Malayalam'),
    ('hindi_unicode.db', 'hi_unicode.json', 'hin_unicode', 'HBU',  'hin', 'Hindi'),
    ('EnglishNIVBible.xml', 'en_niv.json',  'eng_niv',     'NIV',  'eng', 'English'),
]


def book_names(raw):
    names = [n.strip().strip('"\'').strip() for n in raw.split(',')]
    names = [n for n in names if n]
    if len(names) != 66:
        raise SystemExit(f'expected 66 book names, got {len(names)}')
    return names


def english_book_names():
    with open(os.path.join(ROOT, 'en.json'), encoding='utf-8') as f:
        return [b['name'] for b in json.load(f)['books']]


def convert_xml(src, out, tid, short, lang, lang_name):
    root = ET.parse(os.path.join(ROOT, src)).getroot()
    title = root.get('translation') or short
    names = english_book_names()
    books = {}
    for book in root.iter('book'):
        b = int(book.get('number'))
        for ch in book.iter('chapter'):
            c = int(ch.get('number'))
            for v in ch.iter('verse'):
                text = ''.join(v.itertext()).strip()
                if text:
                    books.setdefault(b, {}).setdefault(c, []).append(
                        {'type': 'verse', 'number': int(v.get('number')), 'content': [text]})
    write_json(out, tid, title, short, lang, lang_name, '', '', names, books)


def write_json(out, tid, title, short, lang, lang_name, desc, copyright_, names, books):
    out_books = []
    total_verses = 0
    for b in sorted(books):
        chapters = []
        for c in sorted(books[b]):
            verses = sorted(books[b][c], key=lambda x: x['number'])
            total_verses += len(verses)
            chapters.append({'numberOfVerses': len(verses),
                             'chapter': {'number': c, 'content': verses}})
        out_books.append({'id': BOOK_IDS[b - 1], 'name': names[b - 1], 'commonName': names[b - 1],
                          'order': b, 'numberOfChapters': len(chapters),
                          'totalNumberOfVerses': sum(c['numberOfVerses'] for c in chapters),
                          'chapters': chapters})
    data = {
        'translation': {'id': tid, 'name': title, 'englishName': title, 'shortName': short,
                        'language': lang, 'languageEnglishName': lang_name,
                        'description': desc, 'copyright': copyright_, 'textDirection': 'ltr',
                        'numberOfBooks': len(out_books), 'totalNumberOfVerses': total_verses},
        'books': out_books,
    }
    path = os.path.join(ROOT, out)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{out}: {len(out_books)} books, {total_verses} verses, {os.path.getsize(path)//1024} KB')


def convert(src, out, tid, short, lang, lang_name):
    if src.lower().endswith('.xml'):
        return convert_xml(src, out, tid, short, lang, lang_name)
    con = sqlite3.connect(f'file:{os.path.join(ROOT, src)}?mode=ro', uri=True)
    title, desc, copyright_, booknames = con.execute(
        'select title, description, copyrights, booknames from configuration').fetchone()
    names = book_names(booknames)
    books = {}
    rows = con.execute(
        'select bookNum, chNum, verseNum, word from words order by bookNum, chNum, verseNum')
    for b, c, v, w in rows:
        text = (w or '').strip()
        if not text:
            continue
        books.setdefault(b, {}).setdefault(c, []).append({'type': 'verse', 'number': v, 'content': [text]})
    write_json(out, tid, title, short, lang, lang_name, desc, copyright_, names, books)


if __name__ == '__main__':
    for t in TARGETS:
        convert(*t)
