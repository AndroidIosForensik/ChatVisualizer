/* Welche Geräte-Datenbank ist das – und lässt sie sich direkt lesen?

   Der Import-Assistent zeigt diesen Katalog und prüft gewählte Dateien vor dem
   Import: an den Tabellen (nicht am Dateinamen, der ist oft umbenannt), bei
   verschlüsselten Dateien am fehlenden SQLite-Kopf bzw. an der Endung.
   Status: 'direkt' = ChatVisualizer liest sie selbst, 'bericht' = über ALEAPP/
   iLEAPP oder eine SQL-Abfrage als CSV, 'verschluesselt' = erst entschlüsseln. */
(function (global) {
  'use strict';

  const SQLITE = 'SQLite format 3\u0000';

  const KATALOG = [
    { id: 'whatsapp-android', name: 'WhatsApp (Android)', dateien: 'msgstore.db, dazu wa.db und -wal',
      versionen: 'Schema ab 2022 (Tabelle message) bis heute; anonyme @lid-Kennungen (ab 2025) werden ihrer Nummer zugeordnet',
      status: 'direkt', hinweis: 'Wird direkt gelesen. Namen aus wa.db oder einer Kontaktliste (kontakte.csv).',
      erkennen: t => t.has('message') && t.has('jid') && t.has('chat') },
    { id: 'whatsapp-android-alt', name: 'WhatsApp (Android, vor 2022)', dateien: 'msgstore.db',
      versionen: 'altes Schema (Tabelle messages, key_remote_jid)', status: 'bericht',
      hinweis: 'Noch nicht direkt: mit ALEAPP auswerten und den Berichtsordner importieren.',
      erkennen: t => t.has('messages') && (t.has('chat_list') || t.has('chat_view') || t.has('jid')) && !t.has('message') },
    { id: 'whatsapp-kontakte', name: 'WhatsApp-Kontakte (Android)', dateien: 'wa.db',
      versionen: 'Tabelle wa_contacts – im Backup leer, in einer Vollsicherung gefüllt', status: 'direkt',
      hinweis: 'Liefert die Namen zur msgstore.db – zusammen mit ihr wählen.',
      erkennen: t => t.has('wa_contacts') },
    { id: 'whatsapp-ios', name: 'WhatsApp (iPhone)', dateien: 'ChatStorage.sqlite, ContactsV2.sqlite',
      versionen: 'Core-Data-Schema (ZWAMESSAGE, ZWACHATSESSION)', status: 'bericht',
      hinweis: 'Noch nicht direkt: mit iLEAPP auswerten – oder per SQL-Abfrage als CSV exportieren (die Spalten werden erkannt).',
      erkennen: t => t.has('ZWAMESSAGE') || t.has('ZWACHATSESSION') },
    { id: 'imessage', name: 'iMessage/SMS (iPhone)', dateien: 'sms.db', versionen: 'iOS 11 bis heute', status: 'bericht',
      hinweis: 'Noch nicht direkt: iLEAPP-Bericht oder SQL-Abfrage als CSV.',
      erkennen: t => t.has('handle') && t.has('chat_message_join') },
    { id: 'sms-android', name: 'SMS/MMS (Android)', dateien: 'mmssms.db', versionen: 'alle Android-Versionen', status: 'bericht',
      hinweis: 'Noch nicht direkt: ALEAPP-Bericht oder SQL-Abfrage auf die Tabelle sms als CSV.',
      erkennen: t => t.has('sms') && t.has('threads') },
    { id: 'google-messages', name: 'Google Messages (Android)', dateien: 'bugle_db', versionen: 'alle Versionen', status: 'bericht',
      hinweis: 'Noch nicht direkt: ALEAPP-Bericht importieren.',
      erkennen: t => t.has('conversations') && t.has('parts') && t.has('messages') },
    { id: 'telegram-android', name: 'Telegram (Android)', dateien: 'cache4.db', versionen: 'Nachrichten als Binärdaten (TL-Schema)',
      status: 'bericht', hinweis: 'Noch nicht direkt: mit ALEAPP auswerten und den Berichtsordner importieren.',
      erkennen: t => t.has('messages_v2') || (t.has('dialogs') && t.has('users') && t.has('messages')) },
    { id: 'signal-android', name: 'Signal (Android)', dateien: 'signal.db', versionen: 'SQLCipher, Schlüssel im Android-Keystore',
      status: 'verschluesselt', hinweis: 'Nur über einen ALEAPP-Bericht einer Vollsicherung (ALEAPP entschlüsselt mit dem Schlüssel aus dem Keystore).',
      datei: /^signal.*\.db$/i },
    { id: 'threema', name: 'Threema (Android)', dateien: 'threema4.db', versionen: 'SQLCipher (key.dat, ggf. Passphrase)',
      status: 'verschluesselt', hinweis: 'Nur über einen ALEAPP-Bericht einer Vollsicherung.', datei: /^threema.*\.db$/i },
    { id: 'whatsapp-backup', name: 'WhatsApp-Backup (verschlüsselt)', dateien: '*.crypt12, *.crypt14, *.crypt15',
      versionen: 'lokale Backups auf der Speicherkarte', status: 'verschluesselt',
      hinweis: 'Erst mit dem WhatsAppE2EDecryptor entschlüsseln (64-stelliger Schlüssel), dann dessen Fallordner importieren.',
      datei: /\.crypt\d+$/i }
  ];

  const STATUS_TEXT = { direkt: 'wird direkt gelesen', bericht: 'über ALEAPP/iLEAPP oder CSV', verschluesselt: 'verschlüsselt' };

  function eintrag(id) { return KATALOG.find(k => k.id === id) || null; }

  /** Sieht der Dateiname nach einer Datenbank aus? */
  function istDatenbankName(name) {
    return /\.(db|sqlite|sqlite3|sqlitedb|crypt\d+)$/i.test(name) || /^(bugle_db|cache4\.db|sms\.db)$/i.test(name);
  }

  /**
   * Datei prüfen.
   * @param {File} file
   * @returns {Promise<{eintrag: ?object, status: string, text: string, tabellen?: string[], details?: object}>}
   */
  async function pruefe(file) {
    const nachName = KATALOG.find(k => k.datei && k.datei.test(file.name));
    if (nachName && nachName.id === 'whatsapp-backup') return ergebnis(nachName);
    const kopf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (String.fromCharCode.apply(null, kopf) !== SQLITE) {
      if (nachName) return ergebnis(nachName);
      return { eintrag: null, status: 'verschluesselt',
        text: 'Keine lesbare SQLite-Datenbank – vermutlich verschlüsselt (SQLCipher) oder beschädigt.' };
    }
    if (file.size > 1.5e9) {
      return { eintrag: null, status: 'unbekannt', text: 'Sehr groß (' + Math.round(file.size / 1e9 * 10) / 10 +
        ' GB) – wird erst beim Import geprüft.' };
    }
    const SQL = await WhatsAppDB.ladeSql();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[18] === 2) { bytes[18] = 1; bytes[19] = 1; }        // WAL-Modus: im Speicher nicht nötig
    const db = new SQL.Database(bytes);
    try {
      const tabellen = alle(db, "SELECT name FROM sqlite_master WHERE type IN ('table','view')").map(r => r.name);
      const t = new Set(tabellen);
      const k = KATALOG.find(x => x.erkennen && x.erkennen(t));
      if (!k) {
        return { eintrag: null, status: 'unbekannt', tabellen,
          text: 'Unbekannte Datenbank (' + tabellen.length + ' Tabellen: ' + tabellen.slice(0, 6).join(', ') +
            (tabellen.length > 6 ? ' …' : '') + '). Gesuchte Nachrichten per SQL-Abfrage als CSV exportieren und importieren – ' +
            'die Spalten lassen sich zuordnen.' };
      }
      const r = ergebnis(k);
      r.tabellen = tabellen;
      r.details = details(db, k.id, t);
      return r;
    } finally {
      db.close();
    }
  }

  function ergebnis(k) {
    return { eintrag: k, status: k.status, text: k.hinweis };
  }

  function alle(db, sql) {
    const st = db.prepare(sql);
    const zeilen = [];
    try { while (st.step()) zeilen.push(st.getAsObject()); } finally { st.free(); }
    return zeilen;
  }

  const zahl = (db, sql) => { try { return alle(db, sql)[0].n || 0; } catch (e) { return null; } };

  /* Kennzahlen für die Anzeige im Assistenten */
  function details(db, id, t) {
    if (id === 'whatsapp-android') {
      const d = {
        // Wie beim Import: nur Nachrichten, deren Chat es gibt
        nachrichten: zahl(db, 'SELECT COUNT(*) AS n FROM message m JOIN chat c ON c._id = m.chat_row_id'),
        chats: zahl(db, 'SELECT COUNT(DISTINCT m.chat_row_id) AS n FROM message m JOIN chat c ON c._id = m.chat_row_id'),
        lid: t.has('jid_map') ? zahl(db, 'SELECT COUNT(*) AS n FROM jid_map') : 0
      };
      try {
        const r = alle(db, 'SELECT MIN(timestamp) AS a, MAX(timestamp) AS b FROM message WHERE timestamp > 0')[0];
        if (r && r.a) { d.von = r.a; d.bis = r.b; }
      } catch (e) { /* ohne Zeitraum */ }
      return d;
    }
    if (id === 'whatsapp-kontakte') return { kontakte: zahl(db, 'SELECT COUNT(*) AS n FROM wa_contacts WHERE jid IS NOT NULL') };
    return {};
  }

  /* Begleitdateien von Werkzeugen – Hashlisten, Protokolle, Rohausgaben – sind nie ein Chat.
     Der WhatsAppE2EDecryptor legt sie in jeden Fallordner. */
  const BEIWERK = /^(hashliste|hashes|protokoll|medien_fehlend|kontakte_roh)\.(csv|tsv|txt)$/i;

  function istBeiwerk(name, header) {
    if (BEIWERK.test(String(name || ''))) return true;
    return (header || []).some(h => /\b(sha-?256|sha-?1|md5)\b/i.test(String(h)));
  }

  global.Datenbanken = { KATALOG, STATUS_TEXT, eintrag, istDatenbankName, istBeiwerk, pruefe };
})(window);
