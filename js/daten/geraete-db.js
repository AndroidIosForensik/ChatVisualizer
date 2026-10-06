/* SQL-Exporte direkt aus den Datenbanken der Geräte ins eigene Spaltenformat übersetzen.

   Gemeint sind CSV-Dateien, die mit einer SQL-Abfrage aus der Original-
   datenbank entstehen (DB Browser for SQLite, sqlite3 -csv, …), also mit den
   rohen Spaltennamen: ZTEXT, ZMESSAGEDATE, key_remote_jid, is_from_me …
   Erkannt werden die Tabellen, deren Aufbau seit Jahren stabil ist:

     WhatsApp iPhone   ChatStorage.sqlite  ZWAMESSAGE
     WhatsApp Android  msgstore.db         message (neu) und messages (alt)
     iMessage/SMS      sms.db              message
     SMS Android       mmssms.db           sms

   Verknüpfte Spalten aus einem JOIN (Chat-JID, Partnername, Anhangspfad,
   Kontakt) werden mitgenommen, wenn sie in der Abfrage stehen. Fehlen sie,
   bleiben die Zeilennummern der Datenbank als Kennung stehen – dann trennt
   die Anzeige die Chats trotzdem richtig, nur ohne Namen.

   Zeiten bleiben Zahlen; Model.parseTimestamp erkennt Apple-Sekunden,
   Apple-Nanosekunden und Unix-Millisekunden an der Stellenzahl. */
(function (global) {
  'use strict';

  /* Leere Zellen schreiben manche Werkzeuge als NULL */
  const wert = v => (v == null || /^(null|\(null\))$/i.test(String(v).trim())) ? '' : String(v).trim();

  /** Zeile mit vereinfachten Spaltennamen (Model.kopfNorm), NULL als leer */
  function normZeile(r) {
    const n = {};
    for (const k of Object.keys(r)) {
      const nk = Model.kopfNorm(k);
      if (!(nk in n) || !n[nk]) n[nk] = wert(r[k]);
    }
    return n;
  }

  const ja = v => /^(1|true|yes)$/i.test(String(v || ''));
  const ohneDomain = jid => String(jid || '').replace(/@.*$/, '');

  /* Nachrichtentypen je Datenbank – nur die Nummern, deren Bedeutung sicher
     ist. Unbekannte bleiben leer, dann entscheidet die Dateiendung. */
  const TYP_WA_IOS = { 0: 'text', 1: 'bild', 2: 'video', 3: 'audio', 4: 'kontakt', 5: 'standort', 6: 'system', 8: 'datei', 15: 'bild' };
  const TYP_WA_ANDROID = { 0: 'text', 1: 'bild', 2: 'audio', 3: 'video', 4: 'kontakt', 5: 'standort', 7: 'system',
    9: 'datei', 13: 'gif', 16: 'standort', 20: 'bild' };
  const WA_ANDROID_GELOESCHT = '15';

  function standort(text, lat, lon) {
    return text || (lat && lon && (+lat || +lon) ? lat + ', ' + lon : '');
  }

  /* Je Tabelle: woran sie zu erkennen ist und wie eine Zeile übersetzt wird */
  const TABELLEN = [
    {
      name: 'WhatsApp iPhone (ChatStorage.sqlite, ZWAMESSAGE)',
      erkennt: h => h.has('zmessagedate') && h.has('zisfromme'),
      zeile: r => {
        const aus = ja(r.zisfromme);
        const chat = r.zcontactjid || (r.zchatsession ? 'ZCHATSESSION ' + r.zchatsession : '');
        const typ = TYP_WA_IOS[r.zmessagetype] || '';
        return {
          messenger: 'WhatsApp',
          nachricht_id: r.zstanzaid || r.z_pk || '',
          unterhaltungs_id: chat,
          chatname: r.zpartnername || ohneDomain(r.zcontactjid),
          // In Gruppen steht in ZFROMJID die Gruppe; das Mitglied kommt über ZGROUPMEMBER
          absender_id: aus ? '' : (r.zmemberjid || r.zfromjid || ''),
          absender_name: aus ? '' : (r.zpushname || r.zcontactname || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.zmessagedate,
          nachrichteninhalt: standort(r.ztext, r.zlatitude, r.zlongitude),
          medienpfad: r.zmedialocalpath || '',
          nachricht_typ: typ,
          quelle: 'ChatStorage.sqlite' + (r.z_pk ? ', ZWAMESSAGE Z_PK ' + r.z_pk : '')
        };
      }
    },
    {
      name: 'WhatsApp Android (msgstore.db, message)',
      erkennt: h => h.has('chat_row_id') && h.has('from_me') && (h.has('text_data') || h.has('message_type')),
      zeile: r => {
        const aus = ja(r.from_me);
        const chat = r.chat_jid || r.key_remote_jid || r.raw_string_jid || (r.chat_row_id ? 'chat_row_id ' + r.chat_row_id : '');
        const absender = r.sender_jid || r.sender_raw_string ||
          (r.sender_jid_row_id && r.sender_jid_row_id !== '0' ? 'jid_row_id ' + r.sender_jid_row_id : chat);
        return {
          messenger: 'WhatsApp',
          nachricht_id: r.key_id || r._id || r.id || '',
          unterhaltungs_id: chat,
          chatname: r.subject || r.chat_name || ohneDomain(r.chat_jid || r.key_remote_jid),
          absender_id: aus ? '' : absender,
          absender_name: aus ? '' : (r.display_name || r.sender_name || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.timestamp,
          nachrichteninhalt: standort(r.text_data, r.latitude, r.longitude),
          medienpfad: r.file_path || '',
          nachricht_typ: TYP_WA_ANDROID[r.message_type] || '',
          geloescht: r.message_type === WA_ANDROID_GELOESCHT ? '1' : '',
          quelle: 'msgstore.db' + (r._id ? ', message _id ' + r._id : '')
        };
      }
    },
    {
      name: 'WhatsApp Android, altes Schema (msgstore.db, messages)',
      erkennt: h => h.has('key_remote_jid') && h.has('key_from_me'),
      zeile: r => {
        const aus = ja(r.key_from_me);
        const jid = r.key_remote_jid || '';
        return {
          messenger: 'WhatsApp',
          nachricht_id: r.key_id || r._id || '',
          unterhaltungs_id: jid,
          chatname: r.subject || ohneDomain(jid),
          absender_id: aus ? '' : (r.remote_resource || jid),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.timestamp,
          nachrichteninhalt: standort(r.data, r.latitude, r.longitude),
          medienpfad: r.file_path || r.media_name || '',
          nachricht_typ: TYP_WA_ANDROID[r.media_wa_type] || Ileapp.typAusMime(r.media_mime_type),
          quelle: 'msgstore.db' + (r._id ? ', messages _id ' + r._id : '')
        };
      }
    },
    {
      // sms.db: date ist Apple-Zeit, seit iOS 11 in Nanosekunden
      name: 'iMessage/SMS iPhone (sms.db, message)',
      erkennt: h => h.has('guid') && h.has('is_from_me') && h.has('date'),
      zeile: r => {
        const aus = ja(r.is_from_me);
        const kontakt = r.handle || r.handle_id_text || (r.handle_id && r.handle_id !== '0' ? 'handle ' + r.handle_id : '');
        const chat = r.chat_identifier || (r.chat_id ? 'chat ' + r.chat_id : kontakt);
        return {
          messenger: r.service || r.service_name || 'iMessage',
          nachricht_id: r.guid,
          unterhaltungs_id: chat,
          chatname: r.display_name || r.chat_identifier || kontakt,
          absender_id: aus ? '' : (kontakt || chat),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.date,
          nachrichteninhalt: r.text || '',
          medienpfad: r.filename || r.transfer_name || '',
          nachricht_typ: Ileapp.typAusMime(r.mime_type),
          status: aus ? (ja(r.is_read) ? 'gelesen' : ja(r.is_delivered) ? 'zugestellt' : ja(r.is_sent) ? 'gesendet' : '') : '',
          quelle: 'sms.db' + (r.rowid ? ', message ROWID ' + r.rowid : '')
        };
      }
    },
    {
      // iPhone-Anrufliste CallHistory.storedata; ZDATE Apple-Sekunden, ZDURATION Sekunden.
      // ZCALLTYPE: 1 Telefon, 8 FaceTime Video, 16 FaceTime Audio, 0 andere App (CallKit)
      name: 'Anrufliste iPhone (CallHistory.storedata, ZCALLRECORD)',
      erkennt: h => h.has('zaddress') && h.has('zoriginated') && h.has('zdate') && h.has('zduration'),
      zeile: r => {
        const aus = ja(r.zoriginated);
        const anbieter = String(r.zservice_provider || '').toLowerCase();
        const messenger = /whatsapp/.test(anbieter) ? 'WhatsApp' : (r.zcalltype === '8' || r.zcalltype === '16' ||
          /facetime/.test(anbieter)) ? 'FaceTime' : 'Telefon';
        const nummer = r.zaddress || '(unbekannt)';
        return {
          messenger,
          nachricht_id: r.zunique_id || (r.z_pk ? 'ZCALLRECORD-' + r.z_pk : ''),
          unterhaltungs_id: nummer,
          chatname: r.zname || nummer,
          absender_id: aus ? '' : nummer,
          von_mir: aus ? '1' : '0',
          zeitstempel: r.zdate,
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r.zduration,
          video: r.zcalltype === '8' ? '1' : '',
          anruf_ergebnis: !aus && r.zanswered === '0' ? 'verpasst' : (ja(r.zanswered) ? 'angenommen' : ''),
          quelle: 'CallHistory.storedata' + (r.z_pk ? ', ZCALLRECORD Z_PK ' + r.z_pk : '')
        };
      }
    },
    {
      // WhatsApp iPhone CallHistory.sqlite (ZWACDCALLEVENT, mit ZWACDCALLEVENTPARTICIPANT verknüpft).
      // ZOUTCOME: 0 beendet, 1 verpasst, 4 abgelehnt. Die JID passt zu ZCONTACTJID der Nachrichten.
      name: 'WhatsApp iPhone Anrufe (CallHistory.sqlite, ZWACDCALLEVENT)',
      erkennt: h => h.has('zoutcome') && h.has('zduration') && h.has('zdate'),
      zeile: r => {
        const jid = r.zgroupjidstring || r.zjidstring || '';
        const aus = r.zincoming ? !ja(r.zincoming) : ja(r.zoriginated);
        return {
          messenger: 'WhatsApp',
          nachricht_id: r.zcallidstring || (r.z_pk ? 'ZWACDCALLEVENT-' + r.z_pk : ''),
          unterhaltungs_id: jid || 'WhatsApp-Anrufe',
          chatname: r.zgroupjidstring ? '' : ohneDomain(r.zjidstring),
          absender_id: aus ? '' : (r.zjidstring || jid),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.zdate,
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r.zduration,
          video: ja(r.zvideo) ? '1' : '',
          anruf_ergebnis: { 0: 'angenommen', 1: 'verpasst', 4: 'abgelehnt' }[r.zoutcome] || '',
          quelle: 'CallHistory.sqlite' + (r.z_pk ? ', ZWACDCALLEVENT Z_PK ' + r.z_pk : '')
        };
      }
    },
    {
      // WhatsApp Android msgstore.db call_log; timestamp ms, duration s. Die Chat-JID
      // (jid.raw_string) nur, wenn sie per JOIN in der Abfrage steht.
      name: 'WhatsApp Android Anrufe (msgstore.db, call_log)',
      erkennt: h => h.has('call_id') && h.has('video_call') && h.has('duration') && h.has('from_me'),
      zeile: r => {
        const aus = ja(r.from_me);
        const chat = r.chat_jid || r.raw_string || r.jid ||
          (r.group_jid_row_id && r.group_jid_row_id !== '0' ? 'group_jid_row_id ' + r.group_jid_row_id
            : r.jid_row_id ? 'jid_row_id ' + r.jid_row_id : 'WhatsApp-Anrufe');
        return {
          messenger: 'WhatsApp',
          nachricht_id: r.call_id || (r._id ? 'call-' + r._id : ''),
          unterhaltungs_id: chat,
          chatname: r.chat_name || ohneDomain(r.chat_jid || r.raw_string || r.jid),
          absender_id: aus ? '' : chat,
          von_mir: aus ? '1' : '0',
          zeitstempel: r.timestamp,
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r.duration,
          video: ja(r.video_call) ? '1' : '',
          quelle: 'msgstore.db' + (r._id ? ', call_log _id ' + r._id : '')
        };
      }
    },
    {
      // Android-Anrufliste calllog.db (calls). type: 1 eingehend, 2 ausgehend, 3 verpasst,
      // 4 Mailbox, 5 abgelehnt, 6 blockiert, 7 anderswo angenommen
      name: 'Anrufliste Android (calllog.db, calls)',
      erkennt: h => h.has('number') && h.has('duration') && h.has('type') && h.has('date') && !h.has('body'),
      zeile: r => {
        const aus = r.type === '2';
        const nummer = r.number || '(unbekannt)';
        return {
          messenger: 'Telefon',
          nachricht_id: r._id ? 'call-' + r._id : '',
          unterhaltungs_id: nummer,
          chatname: r.name || nummer,
          absender_id: aus ? '' : nummer,
          absender_name: aus ? '' : (r.name || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.date,
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r.duration,
          video: (+r.features & 1) ? '1' : '',                 // Bit FEATURES_VIDEO = 1
          anruf_ergebnis: { 3: 'verpasst', 4: 'Mailbox', 5: 'abgelehnt', 6: 'blockiert', 7: 'anderswo angenommen' }[r.type] || '',
          geloescht: ja(r.deleted) ? '1' : '',
          quelle: 'calllog.db' + (r._id ? ', calls _id ' + r._id : '')
        };
      }
    },
    {
      // mmssms.db: type 1 = empfangen, 2 = gesendet, 3 = Entwurf, 4 = Ausgang, 5 = fehlgeschlagen, 6 = wartend
      name: 'SMS Android (mmssms.db, sms)',
      erkennt: h => h.has('thread_id') && h.has('address') && h.has('body') && h.has('date') && h.has('type'),
      zeile: r => {
        const aus = /^[2-6]$/.test(r.type);
        return {
          messenger: 'SMS',
          nachricht_id: r._id ? 'sms-' + r._id : '',
          unterhaltungs_id: 'Thread ' + r.thread_id,
          chatname: r.address || '',
          absender_id: aus ? '' : (r.address || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: r.date,
          nachrichteninhalt: r.body || '',
          status: { 2: 'gesendet', 3: 'Entwurf', 4: 'ausstehend', 5: 'fehlgeschlagen', 6: 'ausstehend' }[r.type] || '',
          quelle: 'mmssms.db' + (r._id ? ', sms _id ' + r._id : '')
        };
      }
    }
  ];

  /**
   * Rohen Datenbank-Export erkennen und übersetzen.
   * @param {string[]} header Spaltennamen wie von CSV.toObjects
   * @param {object[]} data
   * @returns {{header: string[], data: object[], bericht: string} | null}
   */
  function umsetzen(header, data) {
    const h = new Set(header.map(Model.kopfNorm));
    const tabelle = TABELLEN.find(t => t.erkennt(h));
    if (!tabelle) return null;
    const zeilen = data.map(r => tabelle.zeile(normZeile(r)));
    const spalten = zeilen.length ? Object.keys(zeilen[0]) : Object.keys(tabelle.zeile({}));
    return { header: spalten, data: zeilen, bericht: tabelle.name };
  }

  global.GeraeteDB = { umsetzen };
})(window);
