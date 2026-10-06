// Ausführen: node --test tests/uebersetzen.test.cjs (keine Installation nötig).
// Übersetzung mit fester oder erkannter Ausgangssprache und die Anzeige-Zeitzone.
// Die Übersetzung des Browsers (Translator-API) wird nachgebildet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment({ angeboten = () => true, fehler = null } = {}) {
  const settings = new Map();
  const erzeugt = [];
  const geprueft = [];
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Intl, Date,
    Store: {
      settings: {
        get: (k, f) => settings.has(k) ? JSON.parse(settings.get(k)) : f,
        set: (k, v) => settings.set(k, JSON.stringify(v))
      },
      putTranslations: async () => true, getTranslations: async () => [],
      deleteTranslations: async () => true, clearTranslations: async () => true
    },
    Translator: {
      availability: async ({ sourceLanguage, targetLanguage }) => {
        geprueft.push(sourceLanguage + '>' + targetLanguage);
        return angeboten(sourceLanguage, targetLanguage) ? 'available' : 'unavailable';
      },
      create: async ({ sourceLanguage, targetLanguage }) => {
        if (fehler) throw fehler;
        erzeugt.push(sourceLanguage + '>' + targetLanguage);
        return { translate: async t => '[' + sourceLanguage + '>' + targetLanguage + '] ' + t };
      }
    }
  });
  ctx.window = ctx;
  for (const file of ['kern/helfer', 'kern/model', 'daten/translate']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), ctx);
  }
  return { ctx, erzeugt, geprueft, settings };
}

const nachricht = (key, text) => ({ key, text, type: 'text', sender: 'A' });
const chat = (key, messages) => ({ key, messages });

test('Feste Ausgangssprache: kein Raten, das gewählte Paar wird benutzt und je Chat gemerkt', async () => {
  const { ctx, erzeugt, settings } = environment();
  const T = ctx.Translate;
  const m = nachricht('k1', 'Ok');               // zu kurz zum Erkennen
  const c = chat('whatsapp::ru', [m]);
  T.setSource(c.key, 'ru');
  const r = await T.translateMessage(m, c);
  assert.equal(r.t, '[ru>de] Ok');
  assert.equal(r.s, 'ru');
  assert.deepEqual(erzeugt, ['ru>de']);
  assert.equal(T.sourceFor(c.key), 'ru');
  assert.equal(T.sourceFor('anderer::chat'), '');
  assert.match(settings.get('trSourceByConv'), /"whatsapp::ru":"ru"/);
});

test('Feste Ausgangssprache mit „Zielsprache überspringen": eigene deutsche Antworten bleiben unübersetzt', async () => {
  const { ctx, erzeugt } = environment();
  const T = ctx.Translate;
  const de = nachricht('k2', 'Ich bin heute nicht da und morgen auch nicht');
  const c = chat('c', [de]);
  T.setSource(c.key, 'ru');
  const r = await T.translateMessage(de, c);
  assert.equal(r.b, 'skip');
  assert.equal(r.t, null);
  assert.deepEqual(erzeugt, []);
  // Ohne Überspringen wird auch sie als Russisch behandelt – so wie gewählt
  T.settings.skipTarget = false;
  T.clearFor(['k2']);
  const r2 = await T.translateMessage(de, c);
  assert.equal(r2.s, 'ru');
  assert.deepEqual(erzeugt, ['ru>de']);
});

test('Gleiche Ausgangs- und Zielsprache: übersprungen statt Fehler', async () => {
  const { ctx, erzeugt } = environment();
  const T = ctx.Translate;
  const c = chat('c', [nachricht('k3', 'Hallo zusammen')]);
  T.setSource(c.key, 'de');
  const r = await T.translateMessage(c.messages[0], c);
  assert.equal(r.b, 'skip');
  assert.deepEqual(erzeugt, []);
});

test('Automatisch: erkannte Sprache wird benutzt; ohne Erkennung ein Hinweis auf die feste Wahl', async () => {
  const { ctx, erzeugt } = environment();
  const T = ctx.Translate;
  const ru = nachricht('k4', 'Привет, как дела?');
  const r = await T.translateMessage(ru, chat('c', [ru]));
  assert.equal(r.s, 'ru');
  assert.deepEqual(erzeugt, ['ru>de']);

  const unklar = nachricht('k5', 'Xyzzy plugh');
  await assert.rejects(T.translateMessage(unklar, chat('d', [unklar])), /fest wählen/);
});

test('Verfügbarkeit wird für das gewählte Paar geprüft und nennt es im Fehler', async () => {
  const { ctx, geprueft } = environment({ angeboten: (s) => s !== 'sq' });
  const T = ctx.Translate;
  assert.equal(await T.check(true, 'ru'), true);
  assert.equal(geprueft.at(-1), 'ru>de');
  assert.equal(await T.check(true, 'sq'), false);
  assert.match(T.status.detail, /Albanisch → Deutsch/);
  // Ohne feste Quelle wie bisher über Englisch
  await T.check(true, '');
  assert.equal(geprueft.at(-1), 'en>de');
});

test('Fehlender Klick beim Laden des Sprachpakets wird verständlich gemeldet', async () => {
  const e = new Error('Requires a user gesture'); e.name = 'NotAllowedError';
  const { ctx } = environment({ fehler: e });
  const m = nachricht('k6', 'Привет, как дела?');
  await assert.rejects(ctx.Translate.translateMessage(m, chat('c', [m])), /per Klick/);
});

test('Anzeige-Zeitzone: Uhrzeit, Tageswechsel und Kennzeichnung folgen der Umschaltung', () => {
  const { ctx, settings } = environment();
  const M = ctx.Model;
  const ts = Date.UTC(2026, 0, 15, 23, 30);
  M.setzeAnzeigeZone('UTC');
  assert.equal(M.zeigeZone(), 'UTC');
  assert.equal(M.DT_TIME.format(new Date(ts)), '23:30');
  assert.equal(M.tagSchluessel(ts), '2026-01-15');
  assert.match(M.DT_FULL.format(new Date(ts)), /UTC$/);
  assert.equal(M.zonenName(), 'UTC');
  assert.equal(settings.get('anzeigeZone'), '"UTC"');
  // Eine Zone östlich von UTC: derselbe Zeitpunkt liegt schon am nächsten Tag
  M.setzeAnzeigeZone('Europe/Berlin');
  assert.equal(M.DT_TIME.format(new Date(ts)), '00:30');
  assert.equal(M.tagSchluessel(ts), '2026-01-16');
  M.setzeAnzeigeZone('');
  assert.match(M.zonenName(), /^Ortszeit/);
  assert.equal(M.dayLabel(Date.now()), 'Heute');
  assert.equal(M.dayLabel(Date.now() - 86400000), 'Gestern');
});
