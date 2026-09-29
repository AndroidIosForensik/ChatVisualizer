"""Erzeugt js/daten/emoji-namen.js aus gemoji (github/gemoji, MIT).

    curl -o emoji.json https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json
    python werkzeuge/erzeuge-emoji-namen.py emoji.json js/daten/emoji-namen.js

Die Schreibweise der Schlüssel (norm) muss zu Emoji.schluessel in js/daten/emoji.js passen.
"""
import json
import re
import sys

quelle, ziel = sys.argv[1], sys.argv[2]
d = json.load(open(quelle, encoding='utf-8'))


def norm(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower().replace('&', 'and')).strip('_')


m = {}
for e in d:
    for a in e['aliases']:
        m.setdefault(norm(a), e['emoji'])
for e in d:  # Beschreibungen („purple heart") nachrangig
    k = norm(e['description'])
    if k:
        m.setdefault(k, e['emoji'])

zeilen = [k + ' ' + v for k, v in sorted(m.items())]
body = '\n'.join(zeilen)
for zeichen in ('`', '\\', '${'):
    assert zeichen not in body, zeichen

kopf = '''/* Emoji-Kurznamen → Emoji. ERZEUGT – nicht von Hand bearbeiten.

   Quelle: github/gemoji, db/emoji.json (MIT-Lizenz, Copyright (c) 2019 GitHub, Inc.),
   Aliase („purple_heart", „+1") und Beschreibungen („purple heart") in der
   Schreibweise von Emoji.schluessel. Neu erzeugen: werkzeuge/erzeuge-emoji-namen.py */
(function (global) {
  'use strict';
  global.EmojiNamenDaten = `
'''
fuss = '''`;
})(window);
'''
open(ziel, 'w', encoding='utf-8', newline='\n').write(kopf + body + fuss)
print(len(m), 'Einträge,', len((kopf + body + fuss).encode('utf-8')), 'Bytes')
