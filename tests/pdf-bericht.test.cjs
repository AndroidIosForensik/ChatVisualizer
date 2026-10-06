// Ausführen: node --test tests/pdf-bericht.test.cjs (keine Installation nötig).
// Inhalt des PDF-Berichts: Auswahl, Deckblatt, Kennzeichnungen, Zeitzone, Entschärfung.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment() {
  const settings = new Map();
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Intl, Date, TextEncoder, crypto: globalThis.crypto,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    Store: {
      settings: { get: (k, f) => settings.has(k) ? JSON.parse(settings.get(k)) : f, set: (k, v) => settings.set(k, JSON.stringify(v)) },
      putTranslations: async () => true, getTranslations: async () => [],
      deleteTranslations: async () => true, clearTranslations: async () => true
    }
  });
  ctx.window = ctx;
  for (const file of ['kern/helfer', 'kern/model', 'daten/messengers', 'daten/emoji-namen', 'daten/emoji',
    'daten/media', 'daten/translate',
    'ansicht/text', 'ansicht/suche', 'bedienung/pdf-bericht']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), ctx);
  }
  return ctx;
}

function chat(ctx) {
  const M = ctx.Model;
  const map = M.buildMapping(['nachricht_id', 'chatname', 'absender_id', 'absender_name', 'von_mir', 'zeitstempel',
    'nachrichteninhalt', 'geloescht', 'quelle', 'antwort_auf_id']).map;
  const zeilen = [
    ['n1', 'Lena', '+4917', 'Lena M.', '0', '2026-09-03T23:30:00Z', 'Hallo <b>fett</b>', '0', 'msgstore.db, _id 1', ''],
    ['n2', 'Lena', '', '', '1', '2026-09-04T08:00:00Z', 'Antwort', '0', 'msgstore.db, _id 2', 'n1'],
    ['n3', 'Lena', '+4917', 'Lena M.', '0', '2026-09-05T09:00:00Z', 'Das war geheim', '1', 'msgstore.db, _id 3', '']
  ];
  const keys = map && Object.values(map);
  ctx.Model.state.messages = zeilen.map((z, i) => {
    const row = {};
    ['nachricht_id', 'chatname', 'absender_id', 'absender_name', 'von_mir', 'zeitstempel', 'nachrichteninhalt',
      'geloescht', 'quelle', 'antwort_auf_id'].forEach((k, j) => { row[k] = z[j]; });
    return M.rowToMessage(row, map, 'WhatsApp', i);
  });
  assert.ok(keys.length);
  M.rebuild();
  return M.state.conversations[0];
}

const OPT = { von: '', bis: '', bilder: false, uebersetzung: true, transkript: true, technik: false, nurTreffer: false, vermerk: '' };

test('Bericht: Deckblatt, Name mit Kennung, Löschvermerk, Zitat, Prüfsumme, Text entschärft', async () => {
  const ctx = environment();
  const conv = chat(ctx);
  const b = await ctx.PdfBericht.bericht(conv, { ...OPT, vermerk: 'Az. 1 Js 2/26' }, new Map());
  assert.equal(b.anzahl, 3);
  assert.match(b.html, /<h1>Chatverlauf: Lena<\/h1>/);
  assert.match(b.html, /Az\. 1 Js 2\/26/);
  assert.match(b.html, /<span class="wer"><b[^>]*>Lena M\.<\/b> <span class="kennung">\+4917<\/span><\/span>/);
  assert.match(b.html, /Hallo &lt;b&gt;fett&lt;\/b&gt;/);               // kein HTML aus den Daten
  assert.match(b.html, /gelöscht – Inhalt aus der Quelle wiederhergestellt/);
  assert.match(b.html, /class="zitat"><b>Lena M\.<\/b> Hallo/);
  assert.match(b.html, /SHA-256 [0-9a-f]{64}/);
  assert.match(b.html, /Quellen<\/th><td>msgstore\.db/);
  assert.match(b.title || b.titel, /^Chat Lena \d{4}-\d{2}-\d{2}$/);
  // Gleiche Daten → gleiche Prüfsumme
  const b2 = await ctx.PdfBericht.bericht(conv, OPT, new Map());
  assert.equal(b.html.match(/SHA-256 ([0-9a-f]{64})/)[1], b2.html.match(/SHA-256 ([0-9a-f]{64})/)[1]);
});

test('Bericht: Zeitraum gilt in der Anzeige-Zone, Zeiten mit Sekunden, Zone im Kopf', async () => {
  const ctx = environment();
  const conv = chat(ctx);
  ctx.Model.setzeAnzeigeZone('UTC');
  // 23:30 UTC am 3.9. gehört in UTC zum 3.9. …
  assert.equal(ctx.PdfBericht.auswahl(conv, { ...OPT, von: '2026-09-03', bis: '2026-09-03' }).length, 1);
  const b = await ctx.PdfBericht.bericht(conv, OPT, new Map());
  assert.match(b.html, /03\.09\.2026, 23:30:00/);
  assert.match(b.html, /Zeitangaben<\/th><td>UTC/);
  // … in Berlin (MESZ, +2) schon zum 4.9.
  ctx.Model.setzeAnzeigeZone('Europe/Berlin');
  const berlin = ctx.PdfBericht.auswahl(conv, { ...OPT, von: '2026-09-04', bis: '2026-09-04' });
  assert.deepEqual(Array.from(berlin, m => m.id), ['n1', 'n2']);
  const b2 = await ctx.PdfBericht.bericht(conv, OPT, new Map());
  assert.match(b2.html, /04\.09\.2026, 01:30:00/);
});

test('Bericht: technische Angaben nur auf Wunsch; Kopfzeilentext kann kein </style> einschleusen', async () => {
  const ctx = environment();
  const conv = chat(ctx);
  const ohne = await ctx.PdfBericht.bericht(conv, OPT, new Map());
  assert.doesNotMatch(ohne.html, /class="fuss"/);
  const mit = await ctx.PdfBericht.bericht(conv, { ...OPT, technik: true, vermerk: 'x</style><script>' }, new Map());
  assert.match(mit.html, /ID n1 · Rohwert 2026-09-03T23:30:00Z · Quelle msgstore\.db, _id 1/);
  const stil = mit.html.slice(mit.html.indexOf('<style>'), mit.html.indexOf('</style>'));
  assert.doesNotMatch(stil, /<script>/);
});
