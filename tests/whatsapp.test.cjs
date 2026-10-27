// Ausführen: node --test tests/whatsapp.test.cjs (keine Installation nötig).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deflateRawSync } = require('node:zlib');

function environment() {
  const elements = new Map();
  const messages = [];
  const stored = new Map();
  const settings = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, { classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(key);
  };
  const ctx = vm.createContext({ console, URL, Blob, File, TextDecoder, Response, DecompressionStream,
    setTimeout, clearTimeout,
    document: { querySelector: element, querySelectorAll: () => [] },
    Store: { settings: { get: (key, fallback) => settings.has(key) ? JSON.parse(settings.get(key)) : fallback,
      set: (key, value) => settings.set(key, JSON.stringify(value)) },
      putConversations: async rows => { for (const row of rows) stored.set(row.convKey, row); return true; } },
    Render: { renderAll() {} }, Meldung: { zeige: text => messages.push(text) },
    App: { oeffneChat() {} }, Dokumentenlauf: { alleLesen() {} },
    Medienordner: { ansichtenAuffrischen() {}, dateienAnhaengen: async files => ctx.Media.attachFileList(files) }
  });
  ctx.window = ctx;
  for (const file of ['kern/helfer', 'kern/csv', 'kern/model', 'daten/messengers', 'daten/media',
    'daten/archive', 'daten/whatsapp', 'daten/aleapp', 'daten/aleapp-whatsapp', 'daten/aleapp-apps',
    'daten/ileapp', 'daten/geraete-db',
    'bedienung/whatsapp-import', 'bedienung/spaltenzuordnung', 'bedienung/import']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), ctx);
  }
  ctx.Helfer.leseTextdatei = file => file.text();
  ctx.WhatsAppImport.configure = async (info, source, suggested) => ({
    name: suggested || ctx.WhatsApp.chatName(source), dateOrder: info.dateOrder
  });
  // Zuordnungsdialog: Tests legen die Antwort fest; ohne Vorgabe wird übersprungen
  const dialoge = [];
  ctx.Spaltenzuordnung.antwort = null;
  ctx.Spaltenzuordnung.fragen = async a => {
    dialoge.push(a);
    const wahl = ctx.Spaltenzuordnung.antwort && ctx.Spaltenzuordnung.antwort(a);
    if (wahl) ctx.Spaltenzuordnung.merken(a.header, wahl);
    return wahl;
  };
  return { ctx, messages, stored, dialoge };
}

function parse(text, options = {}) {
  const { ctx } = environment();
  const info = ctx.WhatsApp.inspect(text);
  return ctx.WhatsApp.parse(info, { name: 'Familie', ...options });
}

test('Android: Systemmeldungen, Umlaute, mehrzeilige Nachrichten und Medien mit Beschriftung', () => {
  const rows = parse('21.09.26, 09:05 - Nachrichten sind verschlüsselt.\r\n' +
    '21.09.26, 09:06 - Jörg: Hallo 👋\r\nzweite Zeile\r\n\r\nvierter Absatz\r\n' +
    '21.09.26, 09:07 - Anna: IMG-20260921-WA0001.jpg (Datei angehängt)\r\nUnser Garten');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].type, 'system');
  assert.equal(rows[1].sender, 'Jörg');
  assert.equal(rows[1].text, 'Hallo 👋\nzweite Zeile\n\nvierter Absatz');
  assert.equal(rows[2].media, 'IMG-20260921-WA0001.jpg');
  assert.equal(rows[2].type, 'bild');
  assert.equal(rows[2].text, 'Unser Garten');
  assert.equal(new Date(rows[1].ts).getFullYear(), 2026);
});

test('iPhone: BOM, Richtungszeichen, schmale Leerzeichen, Sekunden, Anhang', () => {
  const rows = parse('\uFEFF\u200e[9/21/26, 9:06:07\u202fPM] Alice: Hello\n' +
    '[9/21/26, 9:07:00 PM] Bob: \u200e<attached: 00000002-AUDIO-2026-09-21.opus>', { dateOrder: 'mdy' });
  assert.equal(new Date(rows[0].ts).getHours(), 21);
  assert.equal(new Date(rows[0].ts).getSeconds(), 7);
  assert.equal(rows[1].type, 'audio');
  assert.equal(rows[1].media, '00000002-AUDIO-2026-09-21.opus');
});

test('12-Stunden-Uhr: Mitternacht, Mittag, a.m./p.m.', () => {
  const rows = parse('12/31/2025, 12:00 a.m. - A: Midnight\n12/31/2025, 12:00 p.m. - A: Noon', { dateOrder: 'mdy' });
  assert.equal(new Date(rows[0].ts).getHours(), 0);
  assert.equal(new Date(rows[1].ts).getHours(), 12);
});

test('Mehrdeutige Daten werden erkannt und explizite Monatsreihenfolge angewandt', () => {
  const { ctx } = environment();
  const info = ctx.WhatsApp.inspect('03/04/2026, 10:00 - A: Hallo');
  assert.equal(info.ambiguous, true);
  const dmy = ctx.WhatsApp.parse(info, { name: 'A', dateOrder: 'dmy' });
  const mdy = ctx.WhatsApp.parse(info, { name: 'A', dateOrder: 'mdy' });
  assert.equal(new Date(dmy[0].ts).getMonth(), 3);
  assert.equal(new Date(mdy[0].ts).getMonth(), 2);
});

test('Datumsreihenfolge wird aus dem gesamten Export ermittelt', () => {
  const { ctx } = environment();
  const info = ctx.WhatsApp.inspect('09/10/26, 10:00 - A: One\n09/21/26, 10:00 - A: Two');
  assert.equal(info.dateOrder, 'mdy');
  assert.equal(info.ambiguous, false);
  assert.throws(() => ctx.WhatsApp.inspect('21/09/26, 10:00 - A: One\n09/21/26, 10:00 - A: Two'), /Widersprüchliche/);
});

test('Ungültige Kalendertage und Uhrzeiten werden nicht still normalisiert', () => {
  assert.throws(() => parse('31.02.2026, 10:00 - A: Hallo'), /Ungültiges Datum/);
  assert.throws(() => parse('21.09.2026, 25:00 - A: Hallo'), /Ungültiges Datum/);
  assert.throws(() => parse('21.09.2026, 13:00 PM - A: Hallo'), /Ungültige Uhrzeit/);
});

test('ISO-Datum, englische/deutsche Anhangmarker und fehlende Medien', () => {
  const rows = parse('[2026-09-21, 12:00:00] A: <Anhang: Rechnung.pdf>\n' +
    '2026-09-21, 12:01 - A: Film.mp4 (file attached)\n' +
    '2026-09-21, 12:02 - A: <Medien ausgeschlossen>');
  assert.equal(rows[0].media, 'Rechnung.pdf');
  assert.equal(rows[1].type, 'video');
  assert.equal(rows[2].media, '');
  assert.equal(rows[2].text, '<Medien ausgeschlossen>');
});

test('Normale Textdateien und CSV werden nicht als WhatsApp erkannt', () => {
  const { ctx } = environment();
  assert.equal(ctx.WhatsApp.inspect('Ein Dokument\n21.09.26, 10:00 - A: zitiert'), null);
  assert.equal(ctx.WhatsApp.inspect('nachricht_id,absender_id,unterhaltungs_id\n1,A,C'), null);
  assert.equal(ctx.WhatsApp.inspect(''), null);
});

test('IDs bleiben bei wiederholtem/erweitertem Import stabil; identische Nachrichten bleiben getrennt', () => {
  const line = '21.09.26, 10:00 - A: Hallo';
  const first = parse(line + '\n' + line);
  const second = parse(line + '\n' + line + '\n21.09.26, 10:01 - A: Neu');
  assert.notEqual(first[0].key, first[1].key);
  assert.equal(first[0].key, second[0].key);
  assert.equal(first[1].key, second[1].key);
  assert.notEqual(first[0].key, parse(line, { name: 'Anderer Chat' })[0].key);
});

test('Chatnamen aus Android-Dateien, iPhone-Ordnern und ZIPs', () => {
  const { ctx } = environment();
  for (const source of ['WhatsApp Chat mit Familie.txt', 'WhatsApp Chat - Familie.zip', 'Familie/_chat.txt']) {
    assert.equal(ctx.WhatsApp.chatName(source), 'Familie');
  }
});

test('Nachrichten mit gleichem Zeitstempel behalten die Reihenfolge des Exports', async () => {
  const { ctx, stored } = environment();
  const texts = ['Erste Nachricht', 'Zweite Nachricht', 'Dritte Nachricht'];
  await ctx.Import.importiereDateien([new File([texts.map(text => '21.09.26, 10:00 - A: ' + text).join('\n')], 'Familie.txt')]);
  assert.deepEqual(Array.from(ctx.Model.state.conversations[0].messages, m => m.text), texts);
  ctx.Model.state.messages = Array.from(stored.values()).flatMap(r => r.messages).reverse();
  ctx.Model.rebuild();
  assert.deepEqual(Array.from(ctx.Model.state.conversations[0].messages, m => m.text), texts);
});

// Minimales gültiges ZIP für reproduzierbare Tests, sowohl stored als auch deflate.
function zip(files, compressed = false) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(content);
    const packed = compressed ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compressed ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(compressed ? 8 : 0, 10);
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); central.push(cen, n);
    offset += local.length + n.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...locals, directory, end])], 'Familie.zip');
}

for (const compressed of [false, true]) {
  test('ZIP-Import mit Medien und leerem Anhang, komprimiert=' + compressed, async () => {
    const { ctx, stored } = environment();
    const file = zip({ '_chat.txt': '[21.09.26, 10:00:00] A: <Anhang: Foto.jpg>', 'Foto.jpg': 'image-bytes', 'leer.txt': '' }, compressed);
    await ctx.Import.importiereDateien([file]);
    assert.equal(ctx.Model.state.messages.length, 1);
    const m = ctx.Model.state.messages[0];
    assert.equal(m.conv, 'WhatsApp-Export: Familie');
    const media = ctx.Media.lookup(m.media);
    assert.ok(media);
    const image = await ctx.Media.getFile(media);
    assert.equal(image.type, 'image/jpeg');
    assert.equal(await image.text(), 'image-bytes');
    assert.equal((await ctx.Media.getFile(ctx.Media.lookup('leer.txt'))).size, 0);
    await ctx.Import.importiereDateien([file]);
    assert.equal(ctx.Model.state.messages.length, 1);
    assert.equal(ctx.Media.count(), 3);
    assert.equal(stored.size, 1);
  });
}

test('ZIP: Pfade außerhalb des Archivs und Archive ohne Chat werden abgelehnt', async () => {
  const { ctx } = environment();
  await assert.rejects(ctx.WhatsAppImport.unzip(zip({ '../_chat.txt': '21.09.26, 10:00 - A: Hallo' })), /Ungültiger Pfad/);
  await assert.rejects(ctx.WhatsAppImport.unzip(zip({ 'notizen.txt': 'Kein Chat' })), /Kein unterstützter/);
});

test('ZIP: entpackte Größe wird auch bei falschen Metadaten begrenzt', async () => {
  const { ctx } = environment();
  const bytes = new Uint8Array(await zip({ 'test.txt': 'a'.repeat(2000) }, true).arrayBuffer());
  const entry = ctx.Archive.list(bytes)[0];
  entry.size = 10;
  await assert.rejects(ctx.Archive.read(bytes, entry, 100), /zu groß/);
});

test('TXT und lose Anhänge werden zusammen importiert; Wiederholung aktualisiert statt zu duplizieren', async () => {
  const { ctx } = environment();
  const chat = new File(['21.09.26, 10:00 - A: Foto.jpg (Datei angehängt)'], 'WhatsApp Chat mit Familie.txt');
  const image = new File(['first'], 'Foto.jpg', { type: 'image/jpeg' });
  const note = new File(['Notizen zum Bild'], 'Notizen.txt');
  await ctx.Import.importiereDateien([chat, image, note]);
  assert.equal(ctx.Model.state.messages.length, 1);
  assert.equal(await (await ctx.Media.getFile(ctx.Media.lookup('Foto.jpg'))).text(), 'first');
  await ctx.Import.importiereDateien([chat, new File(['updated'], 'Foto.jpg')]);
  assert.equal(ctx.Model.state.messages.length, 1);
  assert.equal(await (await ctx.Media.getFile(ctx.Media.lookup('Foto.jpg'))).text(), 'updated');
});

test('Abbrechen übernimmt weder Chat noch ZIP-Medien', async () => {
  const { ctx } = environment();
  ctx.WhatsAppImport.configure = async () => null;
  await ctx.Import.importiereDateien([zip({ '_chat.txt': '21.09.26, 10:00 - A: Hallo', 'Foto.jpg': 'image' })]);
  assert.equal(ctx.Model.state.messages.length, 0);
  assert.equal(ctx.Media.count(), 0);
});

test('Ordnerpfade halten gleichnamige Anhänge verschiedener Chats auseinander', async () => {
  const { ctx } = environment();
  const a = new File(['21.09.26, 10:00 - A: Foto.jpg (file attached)'], '_chat.txt');
  const b = new File(['21.09.26, 10:00 - B: Foto.jpg (file attached)'], '_chat.txt');
  ctx.Media.attachSources([
    { path: 'Alice/Foto.jpg', file: new File(['Alice'], 'Foto.jpg') },
    { path: 'Bob/Foto.jpg', file: new File(['Bob'], 'Foto.jpg') }
  ], 'Exports');
  await ctx.Import.importiereDateien([a, b], { fromFolder: true, paths: new Map([[a, 'Alice/_chat.txt'], [b, 'Bob/_chat.txt']]) });
  assert.equal(ctx.Model.state.conversations.length, 2);
  for (const m of ctx.Model.state.messages) {
    assert.equal(await (await ctx.Media.getFile(ctx.Media.lookup(m.media))).text(), m.conv.split(': ')[1]);
  }
});

test('Alle sechs bisherigen CSV-Beispiele importieren und deduplizieren weiterhin', async () => {
  const { ctx } = environment();
  const dir = path.join(__dirname, '../beispiel-daten');
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.csv')).map(n => new File([fs.readFileSync(path.join(dir, n))], n));
  await ctx.Import.importiereDateien(files);
  assert.equal(ctx.Model.state.messages.length, 114);
  assert.equal(ctx.Model.state.conversations.length, 10);
  await ctx.Import.importiereDateien(files);
  assert.equal(ctx.Model.state.messages.length, 114);
});

// Werte aus dem vm-Kontext haben fremde Prototypen
const plain = value => JSON.parse(JSON.stringify(value));

test('Kurze CSV: Chatname, von_mir, Typ aus Endung, stabile IDs ohne ID-Spalte', async () => {
  const { ctx } = environment();
  const csv = 'chatname;absender_id;von_mir;zeitstempel;nachrichteninhalt;medienpfad\n' +
    'Lauftreff;Anna;0;1767261600508;Hallo zusammen;\n' +
    'Lauftreff;+49 170 123;1;1767261606000;Hi!;\n' +
    'Lauftreff;;1;1767261606000;gleiche Sekunde;\n' +
    'Carl;;0;1767261706000;;Media/WhatsApp Images/IMG-20260101-WA0001.jpg\n' +
    'Carl;;0;1767261716000;;Media/WhatsApp Animated Gifs/VID-20260101-WA0002.mp4\n' +
    'Carl;;0;1767261726000;;Media/WhatsApp Video/VID-20260101-WA0003.mp4\n';
  const file = () => new File([csv], 'abfrage-ergebnis.csv');
  await ctx.Import.importiereDateien([file()]);
  const { state } = ctx.Model;
  assert.equal(state.messages.length, 6);
  const gruppe = state.conversations.find(c => c.conv === 'Lauftreff');
  const carl = state.conversations.find(c => c.conv === 'Carl');
  assert.equal(gruppe.title, 'Lauftreff');
  assert.equal(carl.title, 'Carl');
  // Eigene Nachrichten: mit und ohne Absendername
  assert.deepEqual(plain(gruppe.messages.map(m => [m.sender, m.fromMe])),
    [['Anna', false], ['+49 170 123', true], ['Ich', true]]);
  assert.equal(state.me[gruppe.key], '+49 170 123');
  // Einzelchat ohne Absender: der Chat selbst ist der Gesprächspartner
  assert.deepEqual(plain(carl.messages.map(m => [m.sender, m.type])),
    [['Carl', 'bild'], ['Carl', 'gif'], ['Carl', 'video']]);
  await ctx.Import.importiereDateien([file()]);
  assert.equal(state.messages.length, 6);
});

test('Kurze CSV: unterhaltungs_id trennt gleichnamige Chats, ohne Chatspalte wird abgelehnt', async () => {
  const { ctx, messages } = environment();
  await ctx.Import.importiereDateien([new File([
    'unterhaltungs_id,chatname,nachrichteninhalt\n1@lid,Carl,eins\n2@lid,Carl,zwei\n'], 'whatsapp.csv')]);
  const { state } = ctx.Model;
  assert.equal(state.conversations.length, 2);
  assert.deepEqual(plain(state.conversations.map(c => [c.title, c.messenger])),
    [['Carl', 'whatsapp'], ['Carl', 'whatsapp']]);
  await ctx.Import.importiereDateien([new File(['absender_id,nachrichteninhalt\nAnna,Hallo\n'], 'ohne-chat.csv')]);
  assert.equal(state.messages.length, 2);
  assert.match(messages.at(-1), /Pflichtspalten fehlen \(unterhaltungs_id\)/);
});

test('Zeitstempel: Unix-Millisekunden, Unix-Sekunden und Apple-Zeit (iPhone) ohne Umrechnung in SQL', () => {
  const { ctx } = environment();
  const p = ctx.Model.parseTimestamp;
  // Apple-Zeit: Sekunden seit 1.1.2001 UTC, mit und ohne Nachkommastellen
  assert.equal(p('788954400'), Date.UTC(2026, 0, 1, 10, 0, 0));
  assert.equal(p('788954400.0557225'), 1767261600056);
  assert.equal(p('788954400,0557225'), 1767261600056);
  // Unix-Zeit wie bisher, jetzt auch mit Nachkommastellen
  assert.equal(p('1767261600508'), 1767261600508);
  assert.equal(p('1767261600'), 1767261600000);
  assert.equal(p('1767261600.508'), 1767261600508);
  // Andere Längen sind keine Zeitstempel
  assert.equal(p('12345678'), 0);
});

// ALEAPP-Berichte: Spaltenköpfe wie in den Dateien aus „_TSV Exports", Inhalte erfunden
const tsv = zeilen => '﻿' + zeilen.map(z => z.join('\t')).join('\r\n') + '\r\n';

test('ALEAPP: Gruppennachrichten (ältere Spaltenfolge) mit UTC-Zeit, Richtung, Typ und Medium', async () => {
  const { ctx } = environment();
  const datei = new File([tsv([
    ['Message Timestamp', 'Received Timestamp', 'Conversation Name', 'Sending Party', 'Sending Party JID',
      'Message Direction', 'Message Type', 'Message', 'Media', 'Local Path to Media', 'source file'],
    ['2026-09-04 14:41:25', '', 'Lauftreff', 'Self', '', 'Outgoing', 'System Message', 'Lauftreff', '', '', 'msgstore.db'],
    ['2026-09-04 15:03:51', '', 'Lauftreff', 'Self', '', 'Outgoing', 'Text', 'Morgen um sieben?', '', '', 'msgstore.db'],
    ['2026-09-04 15:04:04', '', 'Lauftreff', 'Bea', '4917000000@s.whatsapp.net', 'Incoming', 'Text', 'Bin dabei', '', '', 'msgstore.db'],
    ['2026-09-04 15:04:30', '', 'Lauftreff', 'Bea', '4917000000@s.whatsapp.net', 'Incoming', 'Picture', '',
      '<a href=".\WhatsApp\WhatsApp Images\IMG-20260904-WA0001.jpg">x</a>', 'Media/WhatsApp Images/IMG-20260904-WA0001.jpg', 'msgstore.db']
  ])], 'WhatsApp - Group Messages.tsv');
  await ctx.Import.importiereDateien([datei]);
  const { state } = ctx.Model;
  assert.equal(state.conversations.length, 1);
  const c = state.conversations[0];
  assert.equal(c.messenger, 'whatsapp');
  assert.equal(c.title, 'Lauftreff');
  assert.deepEqual(plain(c.messages.map(m => [m.sender, m.fromMe, m.type])),
    [['Ich', true, 'system'], ['Ich', true, 'text'], ['Bea', false, 'text'], ['Bea', false, 'bild']]);
  // ALEAPP schreibt UTC: 15:03:51 UTC, nicht Ortszeit
  assert.equal(c.messages[1].ts, Date.UTC(2026, 8, 4, 15, 3, 51));
  assert.equal(c.messages[3].media, 'Media/WhatsApp Images/IMG-20260904-WA0001.jpg');
  await ctx.Import.importiereDateien([datei]);
  assert.equal(state.messages.length, 4);
});

test('ALEAPP: Einzelchats (aktuelle Spaltenfolge) mit Standort und Partner als Chatname', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([tsv([
    ['Message Timestamp', 'Received Timestamp', 'Final Location Timestamp', 'Message Direction',
      'Other Participant WA User Name', 'Message', 'Media', 'Sending Party JID', 'Message Type',
      'Local Path To Media', 'Media File Size', 'Shared Latitude/Starting Latitude (Live Location)',
      'Shared Longitude/Starting Longitude (Live Location)', 'Duration Live Location Shared (Seconds)',
      'Final Live Latitude', 'Final Live Longitude'],
    ['2026-09-05 08:00:00', '', '', 'Incoming', 'Carl', 'Hallo', '', '4916000000@s.whatsapp.net', 'Text', '', '', '', '', '', '', ''],
    ['2026-09-05 08:01:00', '', '', 'Outgoing', 'Carl', '', '', '', 'Static Location', '', '', '52.52', '13.405', '', '', ''],
    ['2026-09-05 08:02:00', '', '', 'Outgoing', 'Carl', '', '', '', '2', 'Media/WhatsApp Voice Notes/PTT-1.opus', '', '', '', '', '', '']
  ])], 'WhatsApp - One To One Messages.tsv')]);
  const c = ctx.Model.state.conversations[0];
  assert.equal(c.title, 'Carl');
  assert.deepEqual(plain(c.messages.map(m => [m.sender, m.fromMe, m.type, m.text])),
    [['Carl', false, 'text', 'Hallo'], ['Ich', true, 'standort', '52.52, 13.405'], ['Ich', true, 'audio', '']]);
});

test('ALEAPP-Ordner: SMS und MMS landen im selben Thread, andere Tabellen werden still übergangen', async () => {
  const { ctx, messages } = environment();
  const ordner = 'ALEAPP_Reports/_TSV Exports/';
  const dateien = [
    new File([tsv([
      ['Date', 'MSG ID', 'Thread ID', 'Address', 'Contact ID', 'Date sent', 'Read', 'Type', 'Body', 'Service Center', 'Error code', 'source file'],
      ['2026-09-25 10:03:04', '11', '2', '+4917100000', '', '', '1', 'Failed', 'Rückruf?', '', '', 'mmssms.db'],
      ['2026-09-25 10:05:00', '12', '2', '+4917100000', '', '', '1', 'Received', 'Gleich', '', '', 'mmssms.db']
    ])], 'sms messages.tsv'),
    new File([tsv([
      ['Date', 'MSG ID', 'Thread ID', 'Date sent', 'Read', 'From', 'To', 'Cc', 'Bcc', 'Body', 'source file'],
      ['2026-09-25 10:04:00', '7', '2', '', '1', '+4917100000', '+4916200000', '', '', 'Bild folgt', 'mmssms.db']
    ])], 'mms messages.tsv'),
    new File([tsv([['Name', 'Value', 'source file'], ['ssid', 'Heimnetz', 'wifi.xml']])], 'Wifi Profiles.tsv')
  ];
  const paths = new Map(dateien.map(f => [f, ordner + f.name]));
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  const { state } = ctx.Model;
  assert.equal(state.conversations.length, 1);
  const c = state.conversations[0];
  assert.equal(c.messenger, 'sms');
  assert.equal(c.title, '+4917100000');
  assert.deepEqual(plain(c.messages.map(m => [m.id, m.fromMe, m.status])),
    [['sms-11', true, 'fehlgeschlagen'], ['mms-7', false, ''], ['sms-12', false, '']]);
  assert.doesNotMatch(messages.at(-1), /Pflichtspalten|Wifi/);
});

test('ALEAPP: Zeiten mit und ohne Zonenangabe, andere Formate bleiben unverändert', () => {
  const { ctx } = environment();
  const u = ctx.Aleapp.utc;
  assert.equal(u('2026-09-04 14:41:25'), '2026-09-04T14:41:25Z');
  assert.equal(u('2026-09-04 14:41:25+00:00'), '2026-09-04T14:41:25+00:00');
  assert.equal(u('2026-09-04T14:41:25.123'), '2026-09-04T14:41:25.123Z');
  assert.equal(u(''), '');
  assert.equal(u('04.09.2026 14:41'), '04.09.2026 14:41');
  assert.equal(ctx.Model.parseTimestamp(u('2026-09-04 14:41:25+00:00')), Date.UTC(2026, 8, 4, 14, 41, 25));
});

/* ---- Spaltenerkennung, Zeitzonen, Zuordnungsdialog --------------------- */

test('Spaltennamen mit Leerzeichen/Großschrift, getrenntes Datum und Uhrzeit, Name, gelöscht, Quelle', async () => {
  const { ctx, dialoge } = environment();
  await ctx.Import.importiereDateien([new File([
    'Chat ID;Datum;Uhrzeit;Absender ID;Absender Name;Nachricht;Gelöscht;Quelle\n' +
    '5;30.08.2026;18:12:04;+491701;Anna;Hallo;0;msgstore.db _id 1\n' +
    '5;30.08.2026;18:13;+491701;Anna;wieder da;ja;msgstore.db _id 2\n'], 'abfrage.csv')]);
  assert.equal(dialoge.length, 0);                 // alles erkannt: keine Rückfrage
  const { state } = ctx.Model;
  const c = state.conversations[0];
  assert.equal(c.title, 'Anna');                    // Name statt Nummer
  const [a, b] = c.messages;
  assert.equal(a.ts, new Date(2026, 7, 30, 18, 12, 4).getTime());
  assert.equal(a.tsRaw, '30.08.2026 18:12:04');
  assert.equal(a.sender, '+491701');
  assert.equal(a.senderName, 'Anna');
  assert.equal(a.source, 'msgstore.db _id 1');
  assert.equal(a.deleted, undefined);
  assert.equal(b.deleted, true);
  assert.equal(b.text, 'wieder da');                // Inhalt bleibt erhalten
  assert.equal(ctx.Model.absenderName(a), 'Anna');
});

test('Zeitzonen: Voreinstellung, Zone im Wert, Zone je Zeile, Zahlen bleiben unberührt', () => {
  const { ctx } = environment();
  const p = ctx.Model.parseTimestamp;
  assert.equal(p('2026-01-15 12:00:00', 'UTC'), Date.UTC(2026, 0, 15, 12));
  assert.equal(p('2026-01-15 12:00', 'Europe/Berlin'), Date.UTC(2026, 0, 15, 11));
  assert.equal(p('2026-07-15 12:00', 'Europe/Berlin'), Date.UTC(2026, 6, 15, 10));   // Sommerzeit
  assert.equal(p('15.01.2026 12:00', '+03:00'), Date.UTC(2026, 0, 15, 9));
  assert.equal(p('15.01.2026 12:00', 'UTC-5'), Date.UTC(2026, 0, 15, 17));
  assert.equal(p('2026-01-15 12:00:00 UTC'), Date.UTC(2026, 0, 15, 12));
  assert.equal(p('2026-01-15T12:00:00+02:00', 'UTC'), Date.UTC(2026, 0, 15, 10));   // Wert geht vor
  assert.equal(p('2026-01-15 12:00:00.250', 'UTC'), Date.UTC(2026, 0, 15, 12, 0, 0, 250));
  assert.equal(p('1767261600', 'Europe/Berlin'), 1767261600000);
  assert.equal(p('2026-01-15 12:00'), new Date(2026, 0, 15, 12).getTime());          // ohne Zone: Ortszeit
  assert.equal(ctx.Model.zoneGueltig('Europe/Berlin'), true);
  assert.equal(ctx.Model.zoneGueltig('+05:30'), true);
  assert.equal(ctx.Model.zoneGueltig('Mars/Olympus'), false);

  const { map } = ctx.Model.buildMapping(['chat', 'zeitstempel', 'zeitzone', 'text']);
  const m = ctx.Model.rowToMessage({ chat: 'x', zeitstempel: '2026-01-15 12:00', zeitzone: 'UTC', text: 'a' }, map, 'SMS', 1);
  assert.equal(m.ts, Date.UTC(2026, 0, 15, 12));
  assert.equal(m.tz, 'UTC');
  // „UTC" im Spaltennamen gilt als Hinweis
  assert.equal(ctx.Model.buildMapping(['chat', 'Message Timestamp (UTC)']).utc, true);
});

test('Zahlen aus Geräte-Datenbanken: Mikro-, Nanosekunden, Apple-Nanosekunden, WebKit', () => {
  const { ctx } = environment();
  const p = ctx.Model.parseTimestamp;
  assert.equal(p('788954400055722500'), 1767261600055);       // iOS sms.db ab iOS 11
  assert.equal(p('1767261600508123'), 1767261600508);         // Unix-Mikrosekunden
  assert.equal(p('1767261600508123456'), 1767261600508);      // Unix-Nanosekunden
  assert.equal(p('13411735200508000'), 1767261600508);        // WebKit/Chrome
  assert.equal(p('12345678901'), 0);                          // 11 Stellen: kein Zeitstempel
  // Typnummern aus Datenbanken werden nicht als Etikett angezeigt
  assert.equal(ctx.Model.normalizeType('9', 'Media/doc.pdf'), 'datei');
  assert.equal(ctx.Model.normalizeType('0', ''), 'text');
});

test('Zuordnungsdialog: fremde Spalten, fester Chat, UTC, Antwort wird gemerkt', async () => {
  const { ctx, dialoge } = environment();
  ctx.Spaltenzuordnung.antwort = a => ({
    map: { text: 'msg', sender: 'who', ts: 'when' }, zone: 'UTC', festerChat: 'Anna', messenger: 'Signal'
  });
  const datei = () => new File(['msg,who,when,extra\nHallo,+4917,2026-01-15 12:00,x\n'], 'query-result.csv');
  await ctx.Import.importiereDateien([datei()]);
  assert.equal(dialoge.length, 1);
  assert.deepEqual(plain(dialoge[0].header), ['msg', 'who', 'when', 'extra']);
  const { state } = ctx.Model;
  assert.equal(state.messages.length, 1);
  const m = state.messages[0];
  assert.equal(m.conv, 'Anna');
  assert.equal(m.messenger, 'signal');
  assert.equal(m.ts, Date.UTC(2026, 0, 15, 12));
  // Zweite Datei mit denselben Spalten (andere Reihenfolge, andere Schreibweise): keine Rückfrage
  await ctx.Import.importiereDateien([new File(['WHO,Msg,When,Extra\n+4917,Tschüss,2026-01-15 12:05,y\n'], 'b.csv')]);
  assert.equal(dialoge.length, 1);
  assert.equal(state.messages.length, 2);
});

test('Zuordnungsdialog: eigenes Format fragt nicht, Überspringen meldet die fehlende Chatspalte', async () => {
  const { ctx, dialoge, messages } = environment();
  await ctx.Import.importiereDateien([new File(['chatname,nachrichteninhalt\nA,eins\n'], 'a.csv')]);
  assert.equal(dialoge.length, 0);
  await ctx.Import.importiereDateien([new File(['foo,bar\n1,2\n'], 'b.csv')]);
  assert.equal(dialoge.length, 1);
  assert.equal(ctx.Model.state.messages.length, 1);
  assert.match(messages.at(-1), /Pflichtspalten fehlen/);
});

/* ---- iLEAPP ------------------------------------------------------------ */

test('iLEAPP WhatsApp: Richtung, Partner, Name, UTC, Standort, ältere Version mit „Local User"', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([tsv([
    ['Timestamp', 'Direction', 'Sender Name', 'Chat Name', 'Message', 'Attachment File', 'From ID', 'Receiver', 'To ID',
      'Thumb', 'Starred?', 'Latitude', 'Longitude', 'Chat ID'],
    ['2026-09-04 14:41:25', 'Incoming', 'Lena', 'Lena', 'Hallo', '', '4917100@s.whatsapp.net', 'Local User', '', '', '0', '', '', '4917100@s.whatsapp.net'],
    ['2026-09-04 14:42:00', 'Outgoing', 'Local User', 'Lena', '', '', '', 'Lena', '4917100@s.whatsapp.net', '', '0', '52.5', '13.4', '4917100@s.whatsapp.net']
  ])], 'WhatsApp - Messages.tsv')]);
  const c = ctx.Model.state.conversations[0];
  assert.equal(c.messenger, 'whatsapp');
  assert.equal(c.title, 'Lena');
  const [ein, aus] = c.messages;
  assert.equal(ein.ts, Date.UTC(2026, 8, 4, 14, 41, 25));
  assert.equal(ein.sender, '4917100@s.whatsapp.net');
  assert.equal(ein.senderName, 'Lena');
  assert.equal(aus.fromMe, true);
  assert.equal(aus.type, 'standort');
  assert.equal(aus.text, '52.5, 13.4');

  const alt = environment();
  await alt.ctx.Import.importiereDateien([new File([tsv([
    ['Timestamp', 'Sender Name', 'From ID', 'Receiver', 'To ID', 'Message', 'Attachment File'],
    ['2026-09-04 14:43:00', 'Local User', '', 'Lena', '4917100@s.whatsapp.net', 'Bis gleich', '']
  ])], 'whatsapp.tsv')]);
  const m = alt.ctx.Model.state.messages[0];
  assert.equal(m.fromMe, true);
  assert.equal(m.conv, '4917100@s.whatsapp.net');
});

test('iLEAPP SMS & iMessage: Dienst als Messenger, Chat-ID, Lesestatus, Quelle mit ROWID', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([tsv([
    ['Message Timestamp', 'Read Timestamp', 'Delivered Timestamp', 'Attachment Timestamp', 'From Me', 'Sender',
      'Chat Contact ID', 'Message', 'Attachment File', 'Chat Name', 'Chat Participants', 'Service', 'Message Direction',
      'Message Sent', 'Message Delivered', 'Message Read', 'Account', 'Account Login', 'Destination Caller ID',
      'Attachment Name', 'Attachment Mimetype', 'Attachment Size (Bytes)', 'Message Row ID', 'Message GUID', 'Chat ID'],
    ['2026-09-04 10:00:00', '', '', '', '0', '+4917100', '+4917100', 'Hi', '', '', '+4917100', 'iMessage', 'Incoming',
      '', '', '', '', '', '', '', '', '', '11', 'AAA-1', '3'],
    ['2026-09-04 10:01:00', '', '', '', '1', '', '+4917100', 'Hallo zurück', '', '', '+4917100', 'iMessage', 'Outgoing',
      'Yes', 'Yes', 'Yes', '', '', '', 'IMG_1.heic', 'image/heic', '', '12', 'AAA-2', '3']
  ])], 'SMS - Messages.tsv')]);
  const c = ctx.Model.state.conversations[0];
  assert.equal(c.messenger, 'imessage');
  assert.equal(c.conv, 'Chat 3');
  assert.equal(c.title, '+4917100');
  const [ein, aus] = c.messages;
  assert.equal(ein.id, 'AAA-1');
  assert.equal(ein.source, 'sms.db, ROWID 11');
  assert.equal(aus.fromMe, true);
  assert.equal(aus.status, 'gelesen');
  assert.equal(aus.type, 'bild');
});

test('iLEAPP Signal und Threema: Richtung, gelöscht, Typ', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([
    new File([tsv([
      ['Timestamp', 'Received Timestamp', 'Server Timestamp', 'Direction', 'Author', 'Conversation With', 'Message',
        'Attachments', 'Attachment Count', 'Read', 'Voice Message', 'View Once', 'Remotely Deleted',
        'Disappearing Timer (Seconds)', 'Thread ID', 'Row ID'],
      ['2026-09-04 10:00:00', '', '', 'Incoming', '+4917100', '+4917100', 'geheim', '', '0', 'Yes', 'No', 'No', 'Yes', '', 'T1', '7']
    ])], 'Signal - Messages.tsv'),
    new File([tsv([
      ['Timestamp', 'From Me', 'Sender Name', 'Chat', 'Message', 'Attachment File', 'Chat-ID', 'Message-ID', 'Receiver',
        'Message Type', 'Latitude', 'Longitude', 'Accuracy'],
      ['2026-09-04 11:00:00', '1', 'ich', 'Team', 'Abstimmung', '', 'C9', 'M1', 'Team', 'BallotMessage', '', '', '']
    ])], 'Threema - Chats.tsv')
  ]);
  const signal = ctx.Model.state.messages.find(m => m.messenger === 'signal');
  assert.equal(signal.deleted, true);
  assert.equal(signal.text, 'geheim');
  assert.equal(signal.conv, 'T1');
  const threema = ctx.Model.state.messages.find(m => m.messenger === 'threema');
  assert.equal(threema.fromMe, true);
  assert.equal(threema.type, 'umfrage');
});

/* ---- SQL-Exporte aus Geräte-Datenbanken -------------------------------- */

test('SQL-Export WhatsApp iPhone (ZWAMESSAGE): Apple-Zeit, Richtung, Chat, Typ, Quelle', async () => {
  const { ctx, dialoge } = environment();
  await ctx.Import.importiereDateien([new File([
    'Z_PK,ZISFROMME,ZMESSAGEDATE,ZTEXT,ZFROMJID,ZTOJID,ZCHATSESSION,ZMESSAGETYPE,ZSTANZAID,ZPARTNERNAME,ZMEDIALOCALPATH\n' +
    '101,0,788954400.5,Hallo,4917100@s.whatsapp.net,NULL,3,0,3EB0A,Lena,NULL\n' +
    '102,1,788954434,,NULL,4917100@s.whatsapp.net,3,1,3EB0B,Lena,Media/4917100@s.whatsapp.net/a.jpg\n'], 'zwamessage.csv')]);
  assert.equal(dialoge.length, 0);
  const c = ctx.Model.state.conversations[0];
  assert.equal(c.messenger, 'whatsapp');
  assert.equal(c.conv, 'ZCHATSESSION 3');
  assert.equal(c.title, 'Lena');
  const [a, b] = c.messages;
  assert.equal(a.ts, 1767261600500);
  assert.equal(a.sender, '4917100@s.whatsapp.net');
  assert.equal(a.id, '3EB0A');
  assert.equal(a.source, 'ChatStorage.sqlite, ZWAMESSAGE Z_PK 101');
  assert.equal(b.fromMe, true);
  assert.equal(b.type, 'bild');
  assert.equal(b.media, 'Media/4917100@s.whatsapp.net/a.jpg');
});

test('SQL-Export WhatsApp Android (message, alt: messages): Millisekunden, gelöscht, Gruppe', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([
    '_id,chat_row_id,from_me,key_id,sender_jid_row_id,timestamp,message_type,text_data\n' +
    '1,2,0,K1,0,1767261600508,0,Moin\n' +
    '2,2,0,K2,0,1767261606000,15,\n'], 'message.csv')]);
  const [a, b] = ctx.Model.state.conversations[0].messages;
  assert.equal(a.conv, 'chat_row_id 2');
  assert.equal(a.ts, 1767261600508);
  assert.equal(b.deleted, true);

  const alt = environment();
  await alt.ctx.Import.importiereDateien([new File([
    '_id,key_remote_jid,key_from_me,key_id,remote_resource,data,timestamp,media_wa_type,media_mime_type,media_name\n' +
    '5,123-456@g.us,0,X1,4917100@s.whatsapp.net,Gruppengruß,1767261600508,0,,\n' +
    '6,123-456@g.us,1,X2,,,1767261601000,2,audio/ogg,PTT-1.opus\n'], 'messages.csv')]);
  const [g1, g2] = alt.ctx.Model.state.conversations[0].messages;
  assert.equal(g1.sender, '4917100@s.whatsapp.net');
  assert.equal(g1.conv, '123-456@g.us');
  assert.equal(g2.fromMe, true);
  assert.equal(g2.type, 'audio');
});

test('SQL-Export iOS sms.db und Android mmssms.db', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([
    new File(['ROWID,guid,text,handle_id,date,is_from_me,service,is_read,is_delivered,chat_identifier\n' +
      '1,G-1,Hallo,4,788954400055722500,0,SMS,1,0,+4917100\n' +
      '2,G-2,Hi,0,788954434000000000,1,SMS,0,1,+4917100\n'], 'sms-db.csv'),
    new File(['_id,thread_id,address,date,type,body,read\n' +
      '9,4,+4916200,1767261600508,1,Eingang,1\n' +
      '10,4,+4916200,1767261606000,2,Ausgang,1\n'], 'mmssms.csv')
  ]);
  const { state } = ctx.Model;
  const ios = state.conversations.find(c => c.conv === '+4917100');
  assert.equal(ios.messages[0].ts, 1767261600055);
  assert.equal(ios.messages[1].fromMe, true);
  assert.equal(ios.messages[1].status, 'zugestellt');
  const android = state.conversations.find(c => c.conv === 'Thread 4');
  assert.deepEqual(plain(android.messages.map(m => [m.fromMe, m.status])), [[false, ''], [true, 'gesendet']]);
});

/* ---- Anrufe ------------------------------------------------------------- */

test('ALEAPP-Ordner: WhatsApp-Anrufe landen im Einzel- bzw. Gruppenchat, ausgehende Einzelanrufe gesammelt', async () => {
  const { ctx } = environment();
  const ordner = 'ALEAPP_Reports/_TSV Exports/';
  const dateien = [
    new File([tsv([
      ['Message Timestamp', 'Received Timestamp', 'Final Location Timestamp', 'Message Direction',
        'Other Participant WA User Name', 'Message', 'Media', 'Sending Party JID', 'Message Type', 'Local Path To Media'],
      ['2026-09-05 08:00:00', '', '', 'Incoming', 'Carl', 'Ruf mal an', '', '4916000000@s.whatsapp.net', 'Text', '']
    ])], 'WhatsApp - One To One Messages.tsv'),
    new File([tsv([
      ['Message Timestamp', 'Received Timestamp', 'Conversation Name', 'Sending Party', 'Sending Party JID',
        'Message Direction', 'Message Type', 'Message', 'Media', 'Local Path to Media'],
      ['2026-09-05 09:00:00', '', 'Lauftreff', 'Bea', '4917000000@s.whatsapp.net', 'Incoming', 'Text', 'Wer läuft?', '', '']
    ])], 'WhatsApp - Group Messages.tsv'),
    new File([tsv([
      ['Call Start Timestamp', 'Call End Timestamp', 'Call Duration', 'Group Name', 'Call Direction', 'Caller', 'Caller JID', 'Call Type'],
      ['2026-09-05 08:05:00', '2026-09-05 08:08:25', '00:03:25', '', 'Incoming', 'Carl', '4916000000@s.whatsapp.net', 'Audio'],
      ['2026-09-05 08:30:00', '2026-09-05 08:30:00', '00:00:00', '', 'Outgoing', 'Self', '', 'Video'],
      ['2026-09-05 09:10:00', '2026-09-05 09:20:00', '00:10:00', 'Lauftreff', 'Outgoing', 'Self', '', 'Video']
    ])], 'WhatsApp - Call Logs.tsv')
  ];
  const paths = new Map(dateien.map(f => [f, ordner + f.name]));
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  const { state } = ctx.Model;
  const carl = state.conversations.find(c => c.conv === 'Carl');
  assert.deepEqual(plain(carl.messages.map(m => [m.type, m.sender, m.duration ?? null])),
    [['text', 'Carl', null], ['anruf', 'Carl', 205]]);
  const gruppe = state.conversations.find(c => c.conv === 'Gruppe Lauftreff');
  const gruppenAnruf = gruppe.messages.find(m => m.type === 'anruf');
  assert.equal(gruppenAnruf.fromMe, true);
  assert.equal(gruppenAnruf.video, true);
  const ohnePartner = state.conversations.find(c => c.conv === 'Anrufe');
  assert.equal(ohnePartner.title, 'Anrufe ohne Gesprächspartner');
  assert.equal(ohnePartner.messages.length, 1);
  assert.equal(ohnePartner.messages[0].duration, 0);
  assert.equal(ctx.Model.anruf(ohnePartner.messages[0]).info, 'keine Verbindung');
  assert.equal(state.conversations.length, 3);          // alles WhatsApp, drei Chats
});

test('ALEAPP-Anrufliste (calllog.db): HTML im Typ, verpasst, Dauer, gelöscht', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([tsv([
    ['Call Date', 'Phone Account Address', 'Partner', 'Type', 'Duration in Secs', 'Partner Location', 'Country ISO',
      'Data', 'Mime Type', 'Transcription', 'Deleted'],
    ['2026-09-05 10:00:00', ' ', '+4917100', 'Missed <i data-feather="phone-missed" stroke="red"></i>', '0', ' ', 'DE', ' ', ' ', ' ', '0'],
    ['2026-09-05 10:05:00', ' ', '+4917100', 'Outgoing <i data-feather="phone-outgoing" stroke="green"></i>', '185', ' ', 'DE', ' ', ' ', ' ', '1']
  ])], 'Call logs.tsv')]);
  const c = ctx.Model.state.conversations[0];
  assert.equal(c.messenger, 'telefon');
  assert.equal(c.conv, '+4917100');
  const [verpasst, raus] = c.messages;
  assert.equal(verpasst.callResult, 'verpasst');
  assert.equal(ctx.Model.anruf(verpasst).verpasst, true);
  assert.equal(raus.fromMe, true);
  assert.equal(raus.duration, 185);
  assert.equal(raus.deleted, true);
  assert.equal(ctx.Model.anruf(raus).info, '3:05 min');
});

test('iLEAPP: WhatsApp-Anrufe teilen den Chat mit den Nachrichten (gleiche JID)', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([
    new File([tsv([
      ['Timestamp', 'Direction', 'Sender Name', 'Chat Name', 'Message', 'Attachment File', 'From ID', 'Receiver', 'To ID', 'Chat ID'],
      ['2026-09-04 14:41:25', 'Incoming', 'Lena', 'Lena', 'Hallo', '', '4917100@s.whatsapp.net', 'Local User', '', '4917100@s.whatsapp.net']
    ])], 'WhatsApp - Messages.tsv'),
    new File([tsv([
      ['Starting Timestamp', 'Ending Timestamp', 'Duration H:M:S', 'Direction', 'Disconnected cause', 'Contact ID',
        'Incoming (as stored)', 'Video Call', 'Missed', 'Missed Reason (as stored)', 'Bytes Sent', 'Bytes Received',
        'Call ID', 'Group JID', 'Aggregate Event ID'],
      ['2026-09-04 14:50:00', '', '00:00:00', 'Incoming', 'Missed', '4917100@s.whatsapp.net', '1', 'No', 'Yes', '', '', '', 'C1', '', '']
    ])], 'WhatsApp - Call History.tsv')
  ]);
  const { state } = ctx.Model;
  assert.equal(state.conversations.length, 1);
  const [text, anruf] = state.conversations[0].messages;
  assert.equal(text.type, 'text');
  assert.equal(anruf.type, 'anruf');
  assert.equal(anruf.callResult, 'verpasst');
  assert.equal(anruf.sender, text.sender);
});

test('iLEAPP-Anrufliste: Telefon, FaceTime-Video und WhatsApp über CallKit', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([new File([tsv([
    ['Starting Timestamp', 'Ending Timestamp', 'Service Provider', 'Call Type', 'Call Direction', 'Phone Number',
      'Answered', 'Call Duration', 'FaceTime Data', 'Disconnected Cause', 'ISO Country Code', 'Location'],
    ['2026-09-04 10:00:00', '', 'com.apple.Telephony', 'Phone Call', 'Incoming', '+4917100', 'No', '00:00:00', '', 'Ended', 'DE', ''],
    ['2026-09-04 11:00:00', '', 'com.apple.FaceTime', 'FaceTime Video', 'Outgoing', 'anna@example.org', 'Yes', '00:12:01', '', 'Ended', '', ''],
    ['2026-09-04 12:00:00', '', 'net.whatsapp.WhatsApp', 'Third-Party App', 'Outgoing', '+4917100', 'Yes', '00:01:00', '', 'Ended', '', '']
  ])], 'Call History.tsv')]);
  const { state } = ctx.Model;
  const tel = state.messages.find(m => m.messenger === 'telefon');
  assert.equal(tel.callResult, 'verpasst');
  const ft = state.messages.find(m => m.messenger === 'facetime');
  assert.equal(ft.video, true);
  assert.equal(ft.duration, 721);
  assert.ok(state.messages.find(m => m.messenger === 'whatsapp' && m.type === 'anruf'));
});

test('SQL-Exporte: Android calllog.db, iPhone ZCALLRECORD und eigene CSV mit Anrufen', async () => {
  const { ctx } = environment();
  await ctx.Import.importiereDateien([
    new File(['_id,number,date,duration,type,name,features\n' +
      '1,+4917100,1767261600508,65,1,Lena,0\n2,+4917100,1767261706000,0,5,Lena,1\n'], 'calls.csv'),
    new File(['Z_PK,ZADDRESS,ZDATE,ZDURATION,ZORIGINATED,ZANSWERED,ZCALLTYPE,ZSERVICE_PROVIDER\n' +
      '7,+4916200,788954400.5,30.0,1,1,1,com.apple.Telephony\n'], 'zcallrecord.csv'),
    new File(['chatname;von_mir;zeitstempel;nachricht_typ;dauer;anruf_ergebnis\n' +
      'Papa;0;2026-09-01 18:00;Videoanruf;0:42;\nPapa;1;2026-09-01 19:00;anruf;;verpasst\n'], 'eigen.csv')
  ]);
  const { state } = ctx.Model;
  const lena = state.conversations.find(c => c.conv === '+4917100');
  assert.equal(lena.title, 'Lena');
  assert.deepEqual(plain(lena.messages.map(m => [m.duration, m.callResult || '', m.video || false])),
    [[65, '', false], [0, 'abgelehnt', true]]);
  const ios = state.conversations.find(c => c.conv === '+4916200');
  assert.equal(ios.messages[0].fromMe, true);
  assert.equal(ios.messages[0].ts, 1767261600500);
  const papa = state.conversations.find(c => c.conv === 'Papa');
  assert.deepEqual(plain(papa.messages.map(m => [m.type, m.video || false, m.duration ?? null, m.callResult || ''])),
    [['anruf', true, 42, ''], ['anruf', false, null, 'verpasst']]);
  assert.equal(ctx.Model.dauerText(3723), '1:02:03 h');
});

// ALEAPP-Bericht als Ganzes: Spaltenköpfe wie in echten Berichten (ALEAPP 2026), Inhalte erfunden
const oneToOneKopf = ['Message Timestamp', 'Received Timestamp', 'Final Location Timestamp', 'Message Direction',
  'Other Participant WA User Name', 'Message', 'Media', 'Sending Party JID', 'Message Type', 'Local Path To Media',
  'Media File Size', 'Shared Latitude/Starting Latitude (Live Location)', 'Shared Longitude/Starting Longitude (Live Location)',
  'Duration Live Location Shared (Seconds)', 'Final Live Latitude', 'Final Live Longitude'];
const einzel = (ts, richtung, partner, text, jid, typ, media = '', lokal = '') =>
  [ts, '', '', richtung, partner, text, media, jid, typ, lokal, '', '', '', '', '', ''];
const berichtDateien = (liste) => {
  const dateien = liste.map(([name, zeilen]) => new File([tsv(zeilen)], name));
  return { dateien, paths: new Map(dateien.map(f => [f, 'ALEAPP_Reports/_TSV Exports/' + f.name])) };
};

test('ALEAPP-Bericht WhatsApp: Namen, LID-Chats, Lesebestätigung, Reaktion, Systemereignis und Anruf werden verbunden', async () => {
  const { ctx, messages } = environment();
  const { dateien, paths } = berichtDateien([
    ['WhatsApp - One To One Messages.tsv', [oneToOneKopf,
      einzel('2026-09-01 10:00:00+00:00', 'Incoming', '4917011111@s.whatsapp.net', 'Hallo', '4917011111@s.whatsapp.net', 'Text'),
      einzel('2026-09-01 10:01:00+00:00', 'Outgoing', '4917011111@s.whatsapp.net', 'Hi zurück', '', 'Text'),
      einzel('2026-09-01 10:05:00+00:00', 'Outgoing', '4917011111@s.whatsapp.net', '', '', '90'),
      einzel('2026-09-01 11:00:00+00:00', 'Outgoing', 'Carl', '', '', 'Picture', 'media/abc.jpg', 'Media/WhatsApp Images/IMG-1.jpg')]],
    ['WhatsApp - Contacts.tsv', [['Name', 'JID', 'Number'],
      ['Anna', '4917011111@s.whatsapp.net', '+4917011111'], ['333@lid', '333@lid', '333@lid']]],
    ['WhatsApp - Group Messages.tsv', [['Message Timestamp', 'Received Timestamp', 'Final Location Timestamp', 'Message Direction',
      'Sending Party', 'Message', 'Media', 'Conversation Name', 'Sending Party JID', 'Message Type', 'Local Path To Media', 'Media File Size'],
      ['2026-09-01 12:00:00+00:00', '', '', 'Outgoing', 'Self', 'Morgen?', '', 'Lauftreff', '', 'Text', '', ''],
      ['2026-09-01 12:01:00+00:00', '', '', 'Incoming', 'Bea', 'Ja', '', 'Lauftreff', '4916022222@s.whatsapp.net', 'Text', '', '']]],
    ['WhatsApp - Message Receipts Per Recipient.tsv', [['Receipt Timestamp', 'Read Timestamp', 'Played Timestamp', 'Message Timestamp',
      'Recipient JID', 'Recipient WA Name', 'Chat JID', 'Chat Name', 'Message', 'Message Type (as stored)', 'Key ID'],
      ['2026-09-01 10:01:05+00:00', '2026-09-01 10:02:00+00:00', '', '2026-09-01 10:01:00+00:00', '222@lid', '', '222@lid', '', 'Hi zurück', '0', 'K1']]],
    ['WhatsApp - Message Reactions.tsv', [['Reaction Timestamp', 'Sender Timestamp', 'Reaction', 'Direction', 'Sender JID',
      'Sender WA Name', 'Chat JID', 'Chat Name', 'Reacted-To Message', 'Reacted-To Message Type (as stored)', 'Add-On Type (as stored)', 'Key ID'],
      ['2026-09-01 10:03:00+00:00', '2026-09-01 10:03:00+00:00', '👍', 'Incoming', '', '', '222@lid', '', 'Hi zurück', '0', '56', 'K2']]],
    ['WhatsApp - System Events.tsv', [['Event Timestamp', 'Action Type (as stored)', 'Chat JID', 'Chat Name', 'Text',
      'Affected Participants', 'Old JID', 'New JID', 'Prior Value', 'Is Me Joined (as stored)'],
      ['2026-09-01 09:59:00+00:00', '67', '222@lid', '', '', '', '', '', '', ''],
      ['2026-09-01 11:59:00+00:00', '11', '120363000@g.us', 'Lauftreff', 'Lauftreff', '', '', '', '', ''],
      ['2026-09-01 08:00:00+00:00', '67', '333@lid', '', '', '', '', '', '', '']]],
    ['WhatsApp - Call Logs.tsv', [['Call Start Timestamp', 'Call End Timestamp', 'Call Duration', 'Group Name', 'Call Direction',
      'Caller', 'Caller JID', 'Call Type'],
      ['2026-09-01 10:05:20+00:00', '2026-09-01 10:07:33+00:00', '00:02:13', '', 'Outgoing', 'Self', '', 'Audio'],
      ['2026-09-01 15:00:00+00:00', '2026-09-01 15:00:00+00:00', '00:00:00', '', 'Outgoing', 'Self', '', 'Video']]],
    ['WhatsApp Log Files.tsv', [['Timestamp', 'Token', 'Description', 'Full Line', 'Source File'], ['x', 'y', 'z', 'w', 'v']]],
    ['Wifi Profiles.tsv', [['Name', 'Value', 'source file'], ['ssid', 'Heimnetz', 'wifi.xml']]]
  ]);
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  const { state } = ctx.Model;
  const chat = titel => state.conversations.find(c => c.title === titel);
  assert.deepEqual(plain(state.conversations.map(c => c.title).sort()),
    ['Anna', 'Anrufe ohne Gesprächspartner', 'Carl', 'LID 333', 'Lauftreff']);
  // Kennung über die Kontakte zum Namen; Lesebestätigung → gelesen; Reaktion per Text im LID-Chat
  const anna = chat('Anna');
  assert.deepEqual(plain(anna.messages.map(m => [m.sender, m.type, m.text, m.status])), [
    ['system', 'system', 'Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt', ''],
    ['Anna', 'text', 'Hallo', ''],
    ['Ich', 'text', 'Hi zurück', 'gelesen'],
    ['Ich', 'anruf', '', '']]);
  // Anrufliste und Anruf im Chatverlauf werden eins: Dauer aus der Anrufliste
  assert.deepEqual(plain([anna.messages[3].duration, !!anna.messages[3].video]), [133, false]);
  assert.deepEqual(plain(anna.messages[2].reactions.map(r => [r.sender, r.text])), [['Anna', '👍']]);
  // Kopie im Berichtsordner vor dem Gerätepfad
  assert.deepEqual(plain(chat('Carl').messages.map(m => [m.type, m.media])), [['bild', 'media/abc.jpg']]);
  assert.deepEqual(plain(chat('Lauftreff').messages.map(m => [m.sender, m.text])),
    [['system', 'Gruppe „Lauftreff“ erstellt'], ['Ich', 'Morgen?'], ['Bea', 'Ja']]);
  assert.deepEqual(plain(chat('Anrufe ohne Gesprächspartner').messages.map(m => [m.type, m.duration, !!m.video])), [['anruf', 0, true]]);
  assert.match(anna.messages[1].source, /^ALEAPP: WhatsApp - One To One Messages$/);
  assert.match(messages.at(-1), /ALEAPP-Bericht zusammengeführt: <b>WhatsApp<\/b> \(8 Tabellen/);
  assert.match(messages.at(-1), /1 weitere Tabellen ohne Chats übergangen/);
  assert.doesNotMatch(messages.at(-1), /Pflichtspalten|empfohlene/);
  const anzahl = state.messages.length;
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  assert.equal(state.messages.length, anzahl);
});

test('ALEAPP-Bericht Signal: Chatnamen, Anhänge mit Typ und Beschriftung, Zitat, gelesen, gelöscht', async () => {
  const { ctx } = environment();
  const kopf = ['Date Sent', 'Date Received', 'Thread ID', 'Direction', 'Status', 'Sender', 'Sender Phone Number', 'Recipient',
    'Recipient Phone Number', 'Message', 'Attachments', 'Attachment Count', 'Read', 'Remote Deleted', 'View Once', 'Quoted Message',
    'Quoted Author', 'Quoted Message Sent', 'Quoted Message ID', 'Quoted Original Missing', 'Disappearing Timer (Seconds)', 'Message ID'];
  const n = (id, ts, thread, richtung, status, sender, empf, text, anh, geloescht, zitat) =>
    [ts, ts, thread, richtung, status, sender, '', empf, '', text, anh, anh ? '1' : '0', 'Yes', geloescht, 'No', '', '', '', zitat, 'No', '', id];
  const { dateien, paths } = berichtDateien([
    ['Signal - Messages.tsv', [kopf,
      n('1', '2026-09-02 08:00:00+00:00', '1', 'Incoming', '', 'Anna Beispiel', 'Ich', 'Hallo', '', 'No', ''),
      n('2', '2026-09-02 08:01:00+00:00', '1', 'Outgoing', 'Delivered', 'Ich', 'Anna Beispiel', '', 'media/a1.jpg', 'No', ''),
      n('3', '2026-09-02 08:02:00+00:00', '1', 'Incoming', '', 'Anna Beispiel', 'Ich', 'Schön!', '', 'No', '2'),
      n('4', '2026-09-02 09:00:00+00:00', '2', 'Outgoing', 'Read', 'Ich', 'Lauftreff', 'Morgen?', '', 'No', ''),
      n('5', '2026-09-02 09:01:00+00:00', '2', 'Incoming', '', 'Bea', 'Lauftreff', 'weg', '', 'Yes', '')]],
    ['Signal - Attachments.tsv', [['Message Date Sent', 'Attachment', 'Thumbnail', 'File Name', 'Recorded Content Type',
      'Detected Content Type', 'Size (Bytes)', 'Stored File', 'Transfer State', 'Voice Note', 'Video GIF', 'Dimensions', 'Caption',
      'Upload Timestamp', 'Sender', 'Direction', 'Thread ID', 'Message ID'],
      ['2026-09-02 08:01:00+00:00', 'media/a1.jpg', '', 'foto.jpg', 'image/jpeg', 'image/jpeg', '1000', '/data/x', '0', 'No', 'No',
        '10x10', 'Foto vom Lauf', '', 'Ich', 'Outgoing', '1', '2']]],
    ['Signal - Contacts.tsv', [['Name', 'Phone Number', 'Username', 'Recipient Type', 'ACI', 'PNI', 'Blocked', 'Hidden', 'About',
      'Note', 'Last Profile Fetch', 'Recipient ID'], ['Anna Beispiel', '+4917011111', '', 'Individual', 'a-1', '', 'No', 'No', '', '', '', '3']]]
  ]);
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  const { state } = ctx.Model;
  assert.deepEqual(plain(state.conversations.map(c => [c.messenger, c.title]).sort()), [['signal', 'Anna Beispiel'], ['signal', 'Lauftreff']]);
  const anna = state.conversations.find(c => c.title === 'Anna Beispiel');
  assert.deepEqual(plain(anna.messages.map(m => [m.id, m.sender, m.type, m.text, m.media, m.replyTo, m.status])), [
    ['signal-1', 'Anna Beispiel', 'text', 'Hallo', '', '', ''],
    ['signal-2', 'Ich', 'bild', 'Foto vom Lauf', 'media/a1.jpg', '', 'zugestellt'],
    ['signal-3', 'Anna Beispiel', 'text', 'Schön!', '', 'signal-2', '']]);
  const gruppe = state.conversations.find(c => c.title === 'Lauftreff');
  assert.deepEqual(plain(gruppe.messages.map(m => [m.sender, m.status, !!m.deleted])), [['Ich', 'gelesen', false], ['Bea', '', true]]);
});

test('ALEAPP-Bericht SMS/MMS: MMS aus „pdu“ kollidieren nicht, Google Messages liefert Namen statt Doppelungen', async () => {
  const { ctx, messages } = environment();
  const kombi = ['Date', 'Date Sent', 'Direction', 'Address', 'Body', 'Media', 'Message Type', 'MSG ID', 'Thread ID', 'Read',
    'To Address', 'Cc', 'Bcc', 'Contact ID', 'Service Center', 'Error Code', 'Source Table'];
  const k = (ts, richtung, adresse, text, id, thread, quelle) => [ts, '', richtung, adresse, text, '', 'sms', id, thread, '1', '', '', '', '', '', '', quelle];
  const gm = ['Message Timestamp', 'Direction', 'Message Sender', 'Other Participant/Conversation Name', 'Message', 'Message Type',
    'Attachment Byte Size', 'Attachment Location', 'Conversation ID'];
  const { dateien, paths } = berichtDateien([
    ['SMS and MMS Messages.tsv', [kombi,
      k('2026-09-03 07:00:00+00:00', 'Received', '+4930123', 'Ihr Code: 123', '1', '4', 'sms'),
      k('2026-09-03 08:00:00+00:00', 'Received', '+4917011111', 'Bild folgt', '1', '2', 'pdu'),
      k('2026-09-03 08:05:00.250000+00:00', 'Failed', '+4917011111', 'Rückruf?', '2', '2', 'sms')]],
    ['GoogleMessages.tsv', [gm,
      ['2026-09-03 07:00:00+00:00', 'Incoming', 'Bank', 'Bank', 'Ihr Code: 123', 'text/plain', 'n/a', '', '7'],
      ['2026-09-03 08:00:00+00:00', 'Incoming', 'Anna', 'Anna', 'Bild folgt', 'text/plain', 'n/a', '', '8'],
      ['2026-09-03 08:05:00.250000+00:00', 'Outgoing', 'Ich', 'Anna', 'Rückruf?', 'text/plain', 'n/a', '', '8'],
      ['2026-09-03 08:10:00+00:00', 'Incoming', 'Anna', 'Anna', 'Per RCS', 'text/plain', 'n/a', '', '8']]]
  ]);
  await ctx.Import.importiereDateien(dateien, { paths, fromFolder: true });
  const { state } = ctx.Model;
  assert.deepEqual(plain(state.conversations.map(c => [c.messenger, c.title, c.count]).sort()), [['sms', 'Anna', 3], ['sms', 'Bank', 1]]);
  const anna = state.conversations.find(c => c.title === 'Anna');
  assert.deepEqual(plain(anna.messages.map(m => [m.id.replace(/^auto-.*/, 'auto'), m.sender, m.text, m.status])), [
    ['mms-1', 'Anna', 'Bild folgt', ''], ['sms-2', 'Ich', 'Rückruf?', 'fehlgeschlagen'], ['auto', 'Anna', 'Per RCS', '']]);
  assert.match(messages.at(-1), /Google Messages<\/b> \(1 Tabelle, 1 Einträge, 3 schon in SMS enthalten\)/);
});

test('ALEAPP: jede bekannte Tabelle wird eindeutig ihrer App zugeordnet und lässt sich auswerten', () => {
  const { ctx } = environment();
  const A = ctx.Aleapp;
  for (const q of A.quellen()) {
    for (const [rolle, spalten] of Object.entries(q.tabellen)) {
      const erkannt = A.erkenne(spalten);
      assert.ok(erkannt && erkannt.quelle === q && erkannt.rolle === rolle, q.app + ' / ' + rolle + ' wird als ' +
        (erkannt ? erkannt.app + ' / ' + erkannt.rolle : 'nichts') + ' erkannt');
      // Eine Zeile mit Werten in allen Erkennungsspalten darf nicht abstürzen
      const zeile = Object.fromEntries(spalten.map(s => [s, 'Wert']));
      zeile.timestamp = zeile['message timestamp'] = '2026-09-01 10:00:00';
      const ergebnis = A.kombiniere([{ name: 'x.tsv', quelle: q, rolle, data: [zeile] }]);
      for (const satz of ergebnis) for (const z of satz.data) assert.ok(z.unterhaltungs_id, q.app + ': Zeile ohne Chat');
    }
  }
  assert.ok(A.quellen().length >= 40);
  // iLEAPP-Tabellen mit ähnlichen Spalten gehören nicht zu ALEAPP (sie laufen über Ileapp)
  assert.equal(A.erkenne(['timestamp', 'from me', 'sender name', 'chat', 'message', 'attachment file', 'chat-id',
    'message-id', 'receiver', 'message type', 'latitude', 'longitude', 'accuracy']), null);
});

test('SQL-JOIN mit doppelten Spaltennamen: jede Nachricht bleibt erhalten, Chatname aus „name“', async () => {
  const { ctx, dialoge } = environment();
  ctx.Spaltenzuordnung.antwort = a => ({ map: a.map, zone: '', festerChat: '', messenger: '' });
  // id/kontakt_id/name kommen mehrfach vor (nachrichten JOIN chats JOIN nutzer)
  const csv = 'id;chat_id;kontakt_id;richtung;text;gesendet_am;gelesen;id;name;kontakt_id;erstellt_am;id;name;stadt\n' +
    '1;1;2;1;Hallo Lina;2026-05-04 08:00;1;1;Lina;2;2026-05-04;2;Lina;Hamburg\n' +
    '2;1;2;0;Danke!;2026-05-04 09:10;1;1;Lina;2;2026-05-04;2;Lina;Hamburg\n' +
    '3;2;3;0;Frage von Mehmet;2026-05-05 12:00;1;2;Mehmet;3;2026-05-05;3;Mehmet;München\n';
  await ctx.Import.importiereDateien([new File([csv], 'abfrage-ergebnis.csv')]);
  assert.deepEqual(plain(dialoge[0].header.slice(7, 10)), ['id (2)', 'name', 'kontakt_id (2)']);
  const { state } = ctx.Model;
  assert.equal(state.messages.length, 3);                 // vorher: eine Nachricht je Partner
  const lina = state.conversations.find(c => c.title === 'Lina');
  assert.deepEqual(plain(lina.messages.map(m => [m.id, m.fromMe, m.status])), [['1', true, 'gelesen'], ['2', false, 'gelesen']]);
  assert.equal(lina.messages[1].sender, 'Lina');
  assert.equal(lina.messages[0].ts, new Date(2026, 4, 4, 8, 0).getTime());
});

test('Spalte mit doppelten IDs wird nicht als Schlüssel benutzt, Zeilen gehen nicht verloren', async () => {
  const { ctx, messages } = environment();
  const csv = 'chatname,nachricht_id,nachrichteninhalt\nA,7,eins\nA,7,zwei\nB,7,drei\n';
  await ctx.Import.importiereDateien([new File([csv], 'ids.csv')]);
  assert.equal(ctx.Model.state.messages.length, 3);
  assert.match(messages.at(-1), /enthält doppelte Werte/);
});
