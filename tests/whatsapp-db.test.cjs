// Ausführen: node --test tests/whatsapp-db.test.cjs (keine Installation nötig).
// WhatsApp-Datenbanken direkt lesen. Die Datenbanken baut der Test selbst mit
// sql.js nach dem Schema von WhatsApp (Android, 2026) – alle Inhalte sind erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const initSqlJs = require('../vendor/sqljs/sql-wasm.js');
const SQL_PFAD = path.join(__dirname, '../vendor/sqljs/') + path.sep;

function environment() {
  const settings = new Map();
  const stored = new Map();
  const messages = [];
  const element = () => ({ classList: { add() {}, remove() {}, toggle() {} } });
  const ctx = vm.createContext({ console, URL, Blob, File, TextDecoder, Response, DecompressionStream,
    setTimeout, clearTimeout,
    document: { querySelector: element, querySelectorAll: () => [] },
    Store: { settings: { get: (k, f) => settings.has(k) ? JSON.parse(settings.get(k)) : f,
      set: (k, v) => settings.set(k, JSON.stringify(v)) },
      putConversations: async rows => { for (const r of rows) stored.set(r.convKey, r); return true; },
      deleteConv: async k => { stored.delete(k); }, putTabelle: async () => true, getTabelle: async () => null },
    Render: { renderAll() {} }, Meldung: { zeige: t => messages.push(t) },
    App: { oeffneChat() {} }, Dokumentenlauf: { alleLesen() {} },
    Medienordner: { ansichtenAuffrischen() {}, dateienAnhaengen: async () => {} }
  });
  ctx.window = ctx;
  for (const f of ['kern/helfer', 'kern/csv', 'kern/model', 'daten/messengers', 'daten/media', 'daten/archive',
    'daten/whatsapp', 'daten/aleapp', 'daten/aleapp-whatsapp', 'daten/aleapp-apps', 'daten/ileapp', 'daten/geraete-db',
    'daten/whatsapp-db', 'daten/datenbanken', 'bedienung/whatsapp-import', 'bedienung/spaltenzuordnung', 'bedienung/import']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f + '.js'), 'utf8'), ctx);
  }
  ctx.initSqlJs = initSqlJs;
  ctx.WhatsAppDB.sqlPfad = SQL_PFAD;
  ctx.Helfer.leseTextdatei = f => f.text();
  ctx.Spaltenzuordnung.fragen = async () => null;
  return { ctx, messages, stored };
}

/* ---- Testdatenbanken ------------------------------------------------------ */

const ICH_TEL = '4915100000001', ICH_LID = '900000000000001';
const ANNA_TEL = '4917000000002', ANNA_LID = '900000000000002';
const BEN_TEL = '4917000000003', BEN_LID = '900000000000003';
const T0 = Date.UTC(2026, 8, 1, 10, 0);       // 1.9.2026 10:00 UTC

async function msgstore(zusatz) {
  const SQL = await initSqlJs({ locateFile: f => SQL_PFAD + f });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE jid (_id INTEGER PRIMARY KEY, user TEXT, server TEXT, agent INTEGER, device INTEGER, type INTEGER, raw_string TEXT);
    CREATE TABLE jid_map (lid_row_id INTEGER PRIMARY KEY, jid_row_id INTEGER, sort_id INTEGER);
    CREATE TABLE chat (_id INTEGER PRIMARY KEY, jid_row_id INTEGER, subject TEXT, hidden INTEGER);
    CREATE TABLE message (_id INTEGER PRIMARY KEY, chat_row_id INTEGER, from_me INTEGER, key_id TEXT,
      sender_jid_row_id INTEGER, status INTEGER, timestamp INTEGER, message_type INTEGER, text_data TEXT);
    CREATE TABLE message_media (message_row_id INTEGER PRIMARY KEY, chat_row_id INTEGER, file_path TEXT,
      mime_type TEXT, media_caption TEXT, media_duration INTEGER);
    CREATE TABLE message_details (message_row_id INTEGER PRIMARY KEY, author_device_jid INTEGER);
    CREATE TABLE message_system (message_row_id INTEGER PRIMARY KEY, action_type INTEGER);
    CREATE TABLE message_system_chat_participant (message_row_id INTEGER, user_jid_row_id INTEGER);
    CREATE TABLE message_system_group (message_row_id INTEGER PRIMARY KEY, is_me_joined INTEGER);
    CREATE TABLE message_system_block_contact (message_row_id INTEGER PRIMARY KEY, is_blocked INTEGER);
    CREATE TABLE message_quoted (message_row_id INTEGER PRIMARY KEY, chat_row_id INTEGER, parent_message_chat_row_id INTEGER,
      from_me INTEGER, sender_jid_row_id INTEGER, key_id TEXT, timestamp INTEGER, message_type INTEGER, text_data TEXT);
    CREATE TABLE message_add_on (_id INTEGER PRIMARY KEY, chat_row_id INTEGER, from_me INTEGER, key_id TEXT,
      sender_jid_row_id INTEGER, parent_message_row_id INTEGER, timestamp INTEGER, status INTEGER, message_add_on_type INTEGER);
    CREATE TABLE message_add_on_reaction (message_add_on_row_id INTEGER PRIMARY KEY, reaction TEXT, sender_timestamp INTEGER);
    CREATE TABLE receipt_user (_id INTEGER PRIMARY KEY, message_row_id INTEGER, receipt_user_jid_row_id INTEGER,
      receipt_timestamp INTEGER, read_timestamp INTEGER, played_timestamp INTEGER);
    CREATE TABLE call_log (_id INTEGER PRIMARY KEY, jid_row_id INTEGER, from_me INTEGER, call_id TEXT, timestamp INTEGER,
      video_call INTEGER, duration INTEGER, call_result INTEGER, group_jid_row_id INTEGER);
    CREATE TABLE message_edit_info (message_row_id INTEGER PRIMARY KEY, original_key_id TEXT, edited_timestamp INTEGER);

    INSERT INTO jid VALUES (1, '${ICH_TEL}', 's.whatsapp.net', 0, 0, 17, '${ICH_TEL}.0:0@s.whatsapp.net');
    INSERT INTO jid VALUES (2, '${ICH_LID}', 'lid', 1, 0, 19, '${ICH_LID}.1:0@lid');
    INSERT INTO jid VALUES (10, '${ANNA_LID}', 'lid', 0, 0, 18, '${ANNA_LID}@lid');
    INSERT INTO jid VALUES (11, '${ANNA_TEL}', 's.whatsapp.net', 0, 0, 0, '${ANNA_TEL}@s.whatsapp.net');
    INSERT INTO jid VALUES (12, '${ANNA_LID}', 'lid', 1, 0, 19, '${ANNA_LID}.1:0@lid');
    INSERT INTO jid VALUES (20, '${BEN_LID}', 'lid', 0, 0, 18, '${BEN_LID}@lid');
    INSERT INTO jid VALUES (21, '${BEN_TEL}', 's.whatsapp.net', 0, 0, 0, '${BEN_TEL}@s.whatsapp.net');
    INSERT INTO jid VALUES (30, '120363000000000001', 'g.us', 0, 0, 1, '120363000000000001@g.us');
    INSERT INTO jid_map VALUES (10, 11, 1);
    INSERT INTO jid_map VALUES (20, 21, 2);

    INSERT INTO chat VALUES (1, 10, NULL, 0);                 -- Anna, unter ihrer LID
    INSERT INTO chat VALUES (2, 30, 'Planung', 0);            -- Gruppe

    -- Chat mit Anna
    INSERT INTO message VALUES (1, 1, 0, 'K1', 0, 0, ${T0}, 0, 'Hallo, hier Anna');
    INSERT INTO message VALUES (2, 1, 1, 'K2', 0, 13, ${T0 + 60000}, 0, 'Hallo Anna');
    INSERT INTO message_details VALUES (2, 1);
    INSERT INTO receipt_user VALUES (1, 2, 10, ${T0 + 61000}, ${T0 + 62000}, NULL);
    INSERT INTO message VALUES (3, 1, 0, 'K3', 0, 0, ${T0 + 120000}, 1, 'Das Foto');
    INSERT INTO message_media VALUES (3, 1, 'Media/WhatsApp Images/IMG-20260901-WA0001.jpg', 'image/jpeg', NULL, 0);
    INSERT INTO message VALUES (4, 1, 1, 'K4', 0, 5, ${T0 + 180000}, 0, 'Schön!');
    INSERT INTO message_quoted VALUES (4, 1, 1, 0, 0, 'K3', ${T0 + 120000}, 1, 'Das Foto');
    INSERT INTO message_details VALUES (4, 1);
    INSERT INTO message_add_on VALUES (1, 1, 0, 'R1', -1, 4, ${T0 + 200000}, 0, 56);
    INSERT INTO message_add_on_reaction VALUES (1, '❤️', ${T0 + 200000});
    INSERT INTO message VALUES (5, 1, 0, 'K5', 0, 0, ${T0 + 240000}, 0, 'Korrigiert');
    INSERT INTO message_edit_info VALUES (5, 'K5', ${T0 + 250000});
    INSERT INTO message VALUES (6, 1, 0, 'K6', 0, 0, ${T0 + 300000}, 15, NULL);
    INSERT INTO message VALUES (7, 1, 1, 'K7', 0, 6, ${T0 + 400000}, 7, 'true');
    INSERT INTO message_system VALUES (7, 58);
    INSERT INTO message_system_block_contact VALUES (7, 1);
    INSERT INTO call_log VALUES (1, 11, 0, 'C1', ${T0 + 500000}, 1, 0, 2, 0);
    INSERT INTO message VALUES (8, 1, 0, 'K8', 0, 0, ${T0 + 500500}, 90, NULL);

    -- Gruppe: Ben erstellt sie und fügt mich hinzu, Anna tritt über eine Einladung bei
    INSERT INTO message VALUES (20, 2, 1, 'G1', 20, 6, ${T0 + 1000000}, 7, 'Planung');
    INSERT INTO message_system VALUES (20, 11);
    INSERT INTO message VALUES (21, 2, 1, 'G2', 20, 6, ${T0 + 1000001}, 7, NULL);
    INSERT INTO message_system VALUES (21, 12);
    INSERT INTO message_system_group VALUES (21, 1);
    INSERT INTO message_system_chat_participant VALUES (21, 2);
    INSERT INTO message VALUES (22, 2, 1, 'G3', 2, 6, ${T0 + 1000500}, 7, NULL);
    INSERT INTO message_system VALUES (22, 52);
    INSERT INTO message_system_chat_participant VALUES (22, 10);
    INSERT INTO message VALUES (23, 2, 0, 'G4', 20, 0, ${T0 + 1100000}, 0, 'Moin zusammen');
    INSERT INTO message VALUES (24, 2, 1, 'G5', 0, 13, ${T0 + 1200000}, 0, 'Moin Ben');
    INSERT INTO message_details VALUES (24, 2);
    INSERT INTO message VALUES (25, 2, 0, 'G6', 12, 0, ${T0 + 1300000}, 0, 'Hallo Gruppe');
    INSERT INTO message VALUES (99, 77, 0, 'X1', 0, 0, ${T0}, 0, 'Chat gibt es nicht mehr');
  `);
  if (zusatz) db.run(zusatz);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function waDb(kontakte) {
  const SQL = await initSqlJs({ locateFile: f => SQL_PFAD + f });
  const db = new SQL.Database();
  db.run('CREATE TABLE wa_contacts (_id INTEGER PRIMARY KEY, jid TEXT, display_name TEXT, wa_name TEXT, number TEXT)');
  for (const [jid, anzeige, profil] of kontakte) {
    db.run('INSERT INTO wa_contacts (jid, display_name, wa_name) VALUES (?, ?, ?)', [jid, anzeige, profil]);
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

const nachChat = (data, id) => data.filter(z => z.unterhaltungs_id === id);

/* ---- Tests ------------------------------------------------------------------ */

test('LID-Chat wird unter der Telefonnummer geführt, eigene Kennungen werden erkannt', async () => {
  const { ctx } = environment();
  const r = await ctx.WhatsAppDB.lies({ msgstore: await msgstore() });
  const anna = nachChat(r.data, ANNA_TEL + '@s.whatsapp.net');
  assert.ok(anna.length >= 6);
  assert.equal(r.data.filter(z => /@lid$/.test(z.unterhaltungs_id)).length, 0);
  assert.equal(anna[0].chatname, '+' + ANNA_TEL);
  assert.equal(anna[0].absender_id, '+' + ANNA_TEL);
  assert.equal(r.info.lidZuordnungen, 2);
  // Nachricht aus einem Chat, den es nicht mehr gibt, fällt weg
  assert.ok(!r.data.some(z => z.nachrichteninhalt === 'Chat gibt es nicht mehr'));
  // Eigene Gruppennachricht (Absender = eigene LID über message_details)
  const gruppe = nachChat(r.data, '120363000000000001@g.us');
  assert.equal(gruppe.find(z => z.nachrichteninhalt === 'Moin Ben').von_mir, '1');
  assert.equal(gruppe[0].chatname, 'Planung');
});

test('Inhalte: Medien, Antwort, Reaktion, Lesestatus, bearbeitet, gelöscht, blockiert, Anruf', async () => {
  const { ctx } = environment();
  const r = await ctx.WhatsAppDB.lies({ msgstore: await msgstore() });
  const anna = nachChat(r.data, ANNA_TEL + '@s.whatsapp.net');
  const finde = text => anna.find(z => z.nachrichteninhalt === text);
  assert.equal(finde('Hallo Anna').status, 'gelesen');
  assert.equal(finde('Schön!').status, 'gesendet');
  const foto = finde('Das Foto');
  assert.equal(foto.medienpfad, 'Media/WhatsApp Images/IMG-20260901-WA0001.jpg');
  assert.equal(foto.nachricht_typ, 'bild');
  assert.equal(finde('Schön!').antwort_auf_id, foto.nachricht_id);
  const reaktion = anna.find(z => z.nachricht_typ === 'reaktion');
  assert.equal(reaktion.nachrichteninhalt, '❤️');
  assert.equal(reaktion.reaktion_auf_id, finde('Schön!').nachricht_id);
  assert.ok(finde('Korrigiert (bearbeitet)'));
  assert.equal(anna.filter(z => z.geloescht === '1').length, 1);
  assert.ok(finde('Du hast den Kontakt blockiert'));
  // Anruf aus call_log; die doppelte Zeile vom Typ 90 im Verlauf entfällt
  const anrufe = anna.filter(z => z.nachricht_typ === 'anruf');
  assert.equal(anrufe.length, 1);
  assert.equal(anrufe[0].video, '1');
  assert.equal(anrufe[0].anruf_ergebnis, 'verpasst');
  assert.match(anrufe[0].quelle, /call_log\._id 1/);
  assert.match(foto.quelle, /msgstore\.db · message\._id 3/);
  // Jede Zeile hat alle Spalten
  for (const z of r.data) for (const s of ctx.Aleapp.SPALTEN) assert.notEqual(z[s], undefined, s);
});

test('Systemmeldungen der Gruppe nennen, wer gehandelt hat – from_me gilt dort nicht', async () => {
  const { ctx } = environment();
  const r = await ctx.WhatsAppDB.lies({ msgstore: await msgstore(),
    kontakte: [{ name: 'Ben Beispiel', nummer: '+' + BEN_TEL }] });
  const texte = nachChat(r.data, '120363000000000001@g.us').filter(z => z.nachricht_typ === 'system')
    .map(z => z.nachrichteninhalt);
  assert.deepEqual(Array.from(texte), [
    'Ben Beispiel hat die Gruppe „Planung“ erstellt',
    'Ben Beispiel hat dich hinzugefügt',
    '+' + ANNA_TEL + ' ist der Gruppe über eine Einladung beigetreten'
  ]);
});

test('Namen: Kontaktliste nur ohne Kontakte in der wa.db; deren Adressbuchname vor Profilname', async () => {
  const { ctx } = environment();
  const liste = [{ name: 'Anna (adb)', nummer: '0170 00000002' }, { name: 'Ben (adb)', nummer: '+49 170 00000003' }];
  // wa.db aus dem Backup: leer → Kontaktliste
  let r = await ctx.WhatsAppDB.lies({ msgstore: await msgstore(), wa: await waDb([]), kontakte: liste });
  assert.equal(nachChat(r.data, ANNA_TEL + '@s.whatsapp.net')[0].chatname, 'Anna (adb)');   // über die letzten 9 Ziffern
  assert.equal(r.info.listeVerwendet, true);
  assert.equal(r.info.benannt, 2);
  // wa.db aus einer Vollsicherung: hat Vorrang, die Liste wird übergangen
  r = await ctx.WhatsAppDB.lies({ msgstore: await msgstore(), kontakte: liste,
    wa: await waDb([[ANNA_LID + '@lid', 'Anna Adressbuch', 'Anni'], [BEN_TEL + '@s.whatsapp.net', null, 'Benny']]) });
  assert.equal(nachChat(r.data, ANNA_TEL + '@s.whatsapp.net')[0].chatname, 'Anna Adressbuch');
  const ben = nachChat(r.data, '120363000000000001@g.us').find(z => z.nachrichteninhalt === 'Moin zusammen');
  assert.equal(ben.absender_name, '~ Benny');                       // nur Profilname: mit Tilde
  assert.equal(r.info.waKontakte, 2);
  assert.equal(r.info.listeUebergangen, true);
});

test('Kontaktlisten erkennen: Name + Nummer, aber keine Anruf- oder Nachrichtentabelle', () => {
  const { ctx } = environment();
  const W = ctx.WhatsAppDB;
  assert.equal(W.istKontaktliste(['name', 'nummer', 'nummer_e164', 'typ', 'konto', 'quelle']), true);
  assert.equal(W.istKontaktliste(['Name', 'Phone']), true);
  assert.equal(W.istKontaktliste(['_id', 'number', 'date', 'duration', 'type', 'name']), false);
  assert.equal(W.istKontaktliste(['chatname', 'nachrichteninhalt', 'name', 'nummer']), false);
  const buch = W.nummernbuch(W.kontakteAus(['name', 'nummer'], [{ name: 'Anna', nummer: '+49 170 1234567' },
    { name: 'Doppelt A', nummer: '0151 111222333' }, { name: 'Doppelt B', nummer: '+44 151 111222333' }]));
  assert.equal(buch('491701234567'), 'Anna');
  assert.equal(buch('00491701234567'), 'Anna');
  assert.equal(buch('44151111222333'), 'Doppelt B');               // genau vor Endziffern
  assert.equal(buch('49151111222333'), '');                         // Endziffern mehrdeutig
});

test('-wal: bestätigte Seiten werden eingespielt, die Datei selbst bleibt unverändert', async () => {
  const { ctx } = environment();
  const ordner = path.join(__dirname, 'daten/wal');
  const db = fs.readFileSync(path.join(ordner, 'notiz.db'));
  const wal = fs.readFileSync(path.join(ordner, 'notiz.db-wal'));
  const vorher = Buffer.from(db);
  const { db: neu, rahmen } = ctx.WhatsAppDB.walEinspielen(new Uint8Array(db).slice(), new Uint8Array(wal));
  assert.ok(rahmen >= 3);
  const SQL = await initSqlJs({ locateFile: f => SQL_PFAD + f });
  neu[18] = 1; neu[19] = 1;
  const d = new SQL.Database(neu);
  const zeilen = d.exec('SELECT text FROM notiz ORDER BY _id')[0].values.map(v => v[0]);
  d.close();
  assert.deepEqual(zeilen, ['geändert in der wal', 'nur in der wal 1', 'nur in der wal 2']);
  assert.ok(db.equals(vorher));
  // Beschädigte -wal: nichts einspielen statt Unsinn
  const kaputt = new Uint8Array(wal).slice();
  kaputt[40] ^= 0xff;
  assert.equal(ctx.WhatsAppDB.walEinspielen(new Uint8Array(db), kaputt).rahmen, 0);
});

test('Import: Datenbank ersetzt die WhatsApp-TSVs, Kontaktliste wird kein Chat', async () => {
  const { ctx, messages } = environment();
  const tsv = 'Message Timestamp\tReceived Timestamp\tMessage Direction\tOther Participant WA User Name\tMessage\t' +
    'Media\tSending Party JID\tMessage Type\n2026-09-01 10:00:00\t\tIncoming\t' + ANNA_TEL + '@s.whatsapp.net\t' +
    'Hallo, hier Anna\t\t\tText\n';
  const files = [
    new File([await msgstore()], 'msgstore.db'),
    new File([await waDb([])], 'wa.db'),
    new File([''], 'wa.db-wal'),
    new File(['﻿name;nummer;nummer_e164;typ;konto;contact_id;raw_contact_id;quelle\n' +
      'Anna Test;+' + ANNA_TEL + ';+' + ANNA_TEL + ';mobil;;1;1;Adressbuch (adb)\n'], 'kontakte.csv'),
    new File([tsv], 'WhatsApp - One To One Messages.tsv')
  ];
  const paths = new Map([[files[0], 'extraktion/data/data/com.whatsapp/databases/msgstore.db'],
    [files[1], 'extraktion/data/data/com.whatsapp/databases/wa.db'], [files[2], 'extraktion/data/data/com.whatsapp/databases/wa.db-wal'],
    [files[3], 'geraet/kontakte.csv'], [files[4], '_TSV Exports/WhatsApp - One To One Messages.tsv']]);
  await ctx.Import.importiereDateien(files, { fromFolder: true, paths });
  const { state } = ctx.Model;
  const titel = Array.from(state.conversations, c => c.title).sort();
  assert.deepEqual(titel, ['Anna Test', 'Planung']);
  // Die TSV-Zeile ist nicht zusätzlich da
  assert.equal(state.messages.filter(m => m.text === 'Hallo, hier Anna').length, 1);
  const meldung = messages.at(-1);
  assert.match(meldung, /WhatsApp-Datenbank<\/b> gelesen/);
  assert.match(meldung, /2 LID-Kennungen/);
  assert.match(meldung, /über kontakte\.csv benannt/);
  assert.match(meldung, /1 WhatsApp-Tabellen des ALEAPP-Berichts dadurch ersetzt/);
});

test('Import: altes Schema meldet sich verständlich, die TSVs bleiben dann im Spiel', async () => {
  const { ctx, messages } = environment();
  const SQL = await initSqlJs({ locateFile: f => SQL_PFAD + f });
  const alt = new SQL.Database();
  alt.run('CREATE TABLE messages (_id INTEGER PRIMARY KEY, key_remote_jid TEXT, data TEXT)');
  const bytes = alt.export();
  alt.close();
  const tsv = 'Message Timestamp\tReceived Timestamp\tMessage Direction\tOther Participant WA User Name\tMessage\t' +
    'Media\tSending Party JID\tMessage Type\n2026-09-01 10:00:00\t\tIncoming\t' + ANNA_TEL + '@s.whatsapp.net\tAus der TSV\t\t\tText\n';
  await ctx.Import.importiereDateien([new File([bytes], 'msgstore.db'), new File([tsv], 'WhatsApp - One To One Messages.tsv')],
    { fromFolder: true });
  assert.equal(ctx.Model.state.messages.filter(m => m.text === 'Aus der TSV').length, 1);
  assert.match(messages.at(-1), /alte Schema/);
  assert.match(messages.at(-1), /WhatsApp-Tabellen des ALEAPP-Berichts verwendet/);
});
