const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const blobs = new Map(), revoked = [], settings = new Map();
  let next = 0;
  const ctx = vm.createContext({ Blob, File, TextDecoder, console, setTimeout, clearTimeout,
    URL: { createObjectURL(blob) { const id = 'blob:test-' + next++; blobs.set(id, blob); return id; },
      revokeObjectURL(url) { revoked.push(url); } },
    Store: { settings: { get: (k, fallback) => settings.has(k) ? settings.get(k) : fallback,
      set: (k, v) => settings.set(k, v) } }
  });
  ctx.window = ctx;
  for (const name of ['kern/helfer', 'kern/model', 'daten/media', 'ansicht/medien']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name + '.js'), 'utf8'), ctx);
  }
  return { ctx, blobs, revoked };
}

test('GIF-Dateien, WhatsApp-GIF-Videos und expliziter CSV-Typ werden erkannt', () => {
  const { ctx } = setup();
  for (const [type, name] of [['video', 'bild.gif'], ['video', '00000123-GIF-2026-09-21.mp4'],
    ['', 'GIF-20260921-WA0001.mp4'], ['gif', 'clip.mp4']]) {
    assert.equal(ctx.Media.isAnimation(type, name), true, name);
    assert.equal(ctx.Medienansicht.artVon({ type, media: name }), 'animation');
  }
  assert.equal(ctx.Model.normalizeType('gif', 'clip.mp4'), 'gif');
  assert.equal(ctx.Media.isAnimation('video', 'VID-20260921-WA0001.mp4'), false);
  assert.equal(ctx.Media.isAnimation('video', 'gift.mp4'), false);
});

test('Animationsvideos starten stumm in Schleife ohne Play-Knopf; Videos behalten Steuerung', () => {
  const { ctx } = setup();
  const animation = ctx.Medienansicht.visualHTML('animation', 'GIF.mp4', 'blob:test', 'GIF');
  assert.match(animation, /autoplay loop muted playsinline/);
  assert.doesNotMatch(animation, /controls/);
  const video = ctx.Medienansicht.visualHTML('video', 'clip.mp4', 'blob:test', 'Video');
  assert.match(video, /controls playsinline/);
  assert.doesNotMatch(video, /autoplay|loop|muted/);
  const gif = ctx.Medienansicht.visualHTML('animation', 'bild.gif', 'blob:test', 'GIF');
  assert.match(gif, /^<img /);
  assert.match(gif, /loading="eager"/);
});

test('Relative Dateipfade maskieren #, %, ?, Umlaute und Leerzeichen korrekt', () => {
  const { ctx } = setup();
  assert.equal(ctx.Helfer.direkteURL('medien/Foto #1 [ä] 50%.png'), 'medien/Foto%20%231%20%5B%C3%A4%5D%2050%25.png');
  assert.equal(ctx.Helfer.direkteURL('medien/frage?.png'), 'medien/frage%3F.png');
  assert.equal(ctx.Helfer.direkteURL('https://example.com/bild.png'), null);
  assert.equal(ctx.Helfer.direkteURL(''), null);
});

test('Medien aus dem Internet: Endung trotz ?Parametern, erst nach Freigabe geladen, lokale Kopie geht vor', async () => {
  const { ctx } = setup();
  const url = 'https://static.klipy.com/ii/925f/45/75/S9NF3adi.gif';
  assert.equal(ctx.Helfer.externeURL(url), url);
  assert.equal(ctx.Helfer.externeURL('medien/bild.gif'), null);
  assert.equal(ctx.Media.extOf(url + '?w=200#x'), 'gif');
  assert.equal(ctx.Media.extOf('medien/frage?.png'), 'png');            // lokal gehört ? zum Namen
  assert.equal(ctx.Medienansicht.artVon({ type: 'bild', media: url }), 'animation');

  // Ohne Freigabe keine Anfrage ins Netz
  assert.equal(ctx.Media.istExtern(url), true);
  assert.equal(await ctx.Media.getDisplayURL(url), null);
  // Einzeln freigegeben
  ctx.Media.erlaubeExtern(url);
  assert.equal(await ctx.Media.getDisplayURL(url), url);
  // Dauerhaft freigegeben gilt auch für andere Links
  const andere = 'https://media.tenor.com/abc/kuss.gif';
  assert.equal(await ctx.Media.getDisplayURL(andere), null);
  ctx.Media.setzeExternImmer(true);
  assert.equal(await ctx.Media.getDisplayURL(andere), andere);
  ctx.Media.setzeExternImmer(false);
  assert.equal(await ctx.Media.getDisplayURL(andere), null);

  // Liegt die Datei im Medienordner, wird sie lokal gezeigt – ohne Netz
  ctx.Media.attachFileList([new File(['GIF89a'], 'kuss.gif', { type: 'image/gif' })]);
  assert.equal(ctx.Media.istExtern(andere), false);
  assert.match(await ctx.Media.getDisplayURL(andere), /^blob:test-/);
});

test('Dateizuordnung gleicht Unicode-Schreibweisen und geschützte Leerzeichen ab', () => {
  const { ctx } = setup();
  const file = new File(['image'], 'Cafe\u0301\u202fBild.png');
  ctx.Media.attachFileList([file]);
  assert.equal(ctx.Media.lookup('Backup/Café Bild.png').file, file);
});

test('Gleichzeitiges Laden erstellt nur eine URL und korrigiert generische Medientypen', async () => {
  const { ctx, blobs } = setup();
  let loads = 0;
  ctx.Media.attachSources([{ path: 'voice.opus', handle: { async getFile() {
    loads++; return new File(['OggS'], 'voice.opus', { type: 'application/octet-stream' });
  } } }]);
  const urls = await Promise.all([ctx.Media.getURL('voice.opus'), ctx.Media.getURL('voice.opus')]);
  assert.equal(loads, 1);
  assert.equal(urls[0], urls[1]);
  assert.equal(blobs.get(urls[0]).type, 'audio/ogg');
});

test('Trennen während des Ladens gibt keine veraltete URL frei', async () => {
  const { ctx, revoked } = setup();
  let release;
  ctx.Media.attachSources([{ path: 'foto.png', handle: { getFile: () => new Promise(r => { release = r; }) } }]);
  const first = ctx.Media.getURL('foto.png'), second = ctx.Media.getURL('foto.png');
  ctx.Media.clear();
  release(new File(['image'], 'foto.png'));
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(revoked.length, 1);
});

test('Fehlgeschlagenes Lesen kann beim nächsten Versuch erneut gestartet werden', async () => {
  const { ctx } = setup();
  let count = 0;
  ctx.Media.attachSources([{ path: 'foto.png', handle: { async getFile() {
    if (++count === 1) throw new Error('temporärer Lesefehler');
    return new File(['image'], 'foto.png');
  } } }]);
  assert.equal(await ctx.Media.getURL('foto.png'), null);
  assert.match(await ctx.Media.getURL('foto.png'), /^blob:/);
});

const onePixel = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
const loop = Buffer.from('21ff0b4e45545343415045322e300301020000', 'hex');

test('GIF ohne Loop-Eintrag erhält Endlosschleife; vorhandene Anzahl wird auf unendlich gesetzt', async () => {
  const { ctx } = setup();
  for (const source of [onePixel, Buffer.concat([onePixel.subarray(0, 19), loop, onePixel.subarray(19)])]) {
    const output = Buffer.from(await (await ctx.Media.loopingGif(new Blob([source]))).arrayBuffer());
    const index = output.indexOf('NETSCAPE2.0');
    assert.ok(index >= 0);
    assert.equal(output[index + 13], 0);
    assert.equal(output[index + 14], 0);
    assert.equal(output.subarray(-15).toString('hex'), onePixel.subarray(-15).toString('hex'));
  }
});

test('Ungültige GIF-Daten bleiben unverändert', async () => {
  const { ctx } = setup();
  const blob = new Blob(['not-a-gif']);
  assert.equal(await ctx.Media.loopingGif(blob), blob);
});
