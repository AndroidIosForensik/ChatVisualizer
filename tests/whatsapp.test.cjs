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
  const element = key => {
    if (!elements.has(key)) elements.set(key, { classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(key);
  };
  const ctx = vm.createContext({ console, URL, Blob, File, TextDecoder, Response, DecompressionStream,
    setTimeout, clearTimeout,
    document: { querySelector: element, querySelectorAll: () => [] },
    Store: { settings: { get: (_, fallback) => fallback, set() {} },
      putConversations: async rows => { for (const row of rows) stored.set(row.convKey, row); return true; } },
    Render: { renderAll() {} }, Meldung: { zeige: text => messages.push(text) },
    App: { oeffneChat() {} }, Dokumentenlauf: { alleLesen() {} },
    Medienordner: { ansichtenAuffrischen() {}, dateienAnhaengen: async files => ctx.Media.attachFileList(files) }
  });
  ctx.window = ctx;
  for (const file of ['kern/helfer', 'kern/csv', 'kern/model', 'daten/messengers', 'daten/media',
    'daten/archive', 'daten/whatsapp', 'daten/aleapp', 'daten/aleapp-whatsapp', 'daten/aleapp-apps', 'bedienung/whatsapp-import', 'bedienung/import']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), ctx);
  }
  ctx.Helfer.leseTextdatei = file => file.text();
  ctx.WhatsAppImport.configure = async (info, source, suggested) => ({
    name: suggested || ctx.WhatsApp.chatName(source), dateOrder: info.dateOrder
  });
  return { ctx, messages, stored };
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
    'Lauftreff;Anna;0;1767261594508;Hallo zusammen;\n' +
    'Lauftreff;+49 170 123;1;1767261600000;Hi!;\n' +
    'Lauftreff;;1;1767261600000;gleiche Sekunde;\n' +
    'Carl;;0;1767261700000;;Media/WhatsApp Images/IMG-20260101-WA0001.jpg\n' +
    'Carl;;0;1767261710000;;Media/WhatsApp Animated Gifs/VID-20260101-WA0002.mp4\n' +
    'Carl;;0;1767261720000;;Media/WhatsApp Video/VID-20260101-WA0003.mp4\n';
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
    ['Ich', 'anruf', 'Sprachanruf · 2:13 min', '']]);
  assert.deepEqual(plain(anna.messages[2].reactions.map(r => [r.sender, r.text])), [['Anna', '👍']]);
  // Kopie im Berichtsordner vor dem Gerätepfad
  assert.deepEqual(plain(chat('Carl').messages.map(m => [m.type, m.media])), [['bild', 'media/abc.jpg']]);
  assert.deepEqual(plain(chat('Lauftreff').messages.map(m => [m.sender, m.text])),
    [['system', 'Gruppe „Lauftreff“ erstellt'], ['Ich', 'Morgen?'], ['Bea', 'Ja']]);
  assert.deepEqual(plain(chat('Anrufe ohne Gesprächspartner').messages.map(m => m.text)), ['Videoanruf · nicht angenommen']);
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
  assert.deepEqual(plain(gruppe.messages.map(m => [m.sender, m.status])), [['Ich', 'gelesen'], ['Bea', 'gelöscht']]);
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
});
