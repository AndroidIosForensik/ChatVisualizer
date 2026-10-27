/* Datenmodell: Zustand, Hilfsfunktionen, CSV-Abbildung, Indexaufbau */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Zustand
   * ------------------------------------------------------------------ */
  const state = {
    messages: [],          // alle Nachrichten (inkl. Reaktionszeilen)
    byKey: new Map(),      // key -> Nachricht
    conversations: [],     // Unterhaltungen, sortiert
    convByKey: new Map(),
    activeConv: null,
    messengerFilter: 'all',
    sortMode: Store.settings.get('sortMode', 'recent'),
    query: '',             // globale Suche (Seitenleiste)
    chatQuery: '',         // Suche im offenen Chat
    chatHits: [],
    chatHitIndex: 0,
    me: Store.settings.get('me', {}),      // convKey -> Absender-ID
    meGlobal: Store.settings.get('meGlobal', null),
    shown: 0,              // wie viele Nachrichten im offenen Chat gerendert sind
    detailsOpen: Store.settings.get('detailsOpen', false)
  };

  /* ------------------------------------------------------------------ *
   * Hilfsfunktionen
   * ------------------------------------------------------------------ */
  /* Liegt in kern/helfer.js; hier nur weitergereicht, damit `Model.esc`
     weiterhin funktioniert. */
  const esc = Helfer.esc;

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function senderColor(id) {
    const hues = [8, 32, 52, 96, 145, 172, 196, 218, 248, 275, 300, 330];
    return 'hsl(' + hues[hashCode(id) % hues.length] + ' 62% 45%)';
  }

  function initials(name) {
    const parts = String(name || '?').replace(/[^\p{L}\p{N} _.\-]/gu, '').split(/[\s_.\-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* ---- Anzeige-Zeitzone ---------------------------------------------- *
   * Alle Zeiten der Oberfläche laufen über diese Formate. Die Zone ist
   * umschaltbar: '' = Ortszeit dieses Rechners, 'UTC' (oder ein IANA-Name).
   * DT_DATE/DT_TIME/DT_FULL behalten ihre Form ({format(d)}), damit die
   * Aufrufer nichts von der Umschaltung wissen müssen. */
  let anzeigeZone = Store.settings.get('anzeigeZone', '');
  let formate = null;

  function baueFormate() {
    const z = anzeigeZone ? { timeZone: anzeigeZone } : {};
    try { new Intl.DateTimeFormat('de-DE', z); } catch (e) { anzeigeZone = ''; return baueFormate(); }
    formate = {
      date: new Intl.DateTimeFormat('de-DE', Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric' }, z)),
      time: new Intl.DateTimeFormat('de-DE', Object.assign({ hour: '2-digit', minute: '2-digit' }, z)),
      full: new Intl.DateTimeFormat('de-DE', Object.assign({ dateStyle: 'full', timeStyle: 'medium' }, z)),
      wtag: new Intl.DateTimeFormat('de-DE', Object.assign({ weekday: 'long' }, z)),
      wtagKurz: new Intl.DateTimeFormat('de-DE', Object.assign({ weekday: 'short' }, z)),
      tag: new Intl.DateTimeFormat('en-CA', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, z))
    };
  }
  baueFormate();

  const DT_DATE = { format: d => formate.date.format(d) };
  const DT_TIME = { format: d => formate.time.format(d) };
  const DT_FULL = { format: d => formate.full.format(d) + (anzeigeZone ? ' ' + anzeigeZone : '') };

  /** Anzeige-Zone setzen ('' = Ortszeit). */
  function setzeAnzeigeZone(zone) {
    anzeigeZone = zone || '';
    baueFormate();
    Store.settings.set('anzeigeZone', anzeigeZone);
  }

  function zeigeZone() { return anzeigeZone; }

  /** Lesbarer Name der Anzeige-Zone, z. B. „UTC" oder „Ortszeit (Europe/Berlin)". */
  function zonenName() {
    if (anzeigeZone) return anzeigeZone;
    let ort = '';
    try { ort = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* egal */ }
    return 'Ortszeit' + (ort ? ' (' + ort + ')' : '');
  }

  /** Kalendertag in der Anzeige-Zone als „JJJJ-MM-TT" – für Tagestrenner. */
  function tagSchluessel(ts) {
    return ts ? formate.tag.format(new Date(ts)) : 'none';
  }

  /** Abstand in Kalendertagen zwischen heute und ts, in der Anzeige-Zone. */
  function tageBisHeute(ts) {
    const tagNr = t => Date.parse(tagSchluessel(t) + 'T00:00:00Z') / 86400000;
    return Math.round(tagNr(Date.now()) - tagNr(ts));
  }

  function dayLabel(ts) {
    if (!ts) return 'Ohne Datum';
    const d = new Date(ts);
    const diff = tageBisHeute(ts);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    if (diff > 1 && diff < 7) return formate.wtag.format(d) + ', ' + DT_DATE.format(d);
    return DT_DATE.format(d);
  }

  function relative(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = tageBisHeute(ts);
    if (diff === 0) return DT_TIME.format(d);
    if (diff === 1) return 'Gestern';
    if (diff > 1 && diff < 7) return formate.wtagKurz.format(d);
    return DT_DATE.format(d);
  }

  /* Sekunden vom 1.1.1970 bis zum 1.1.2001 – dem Nullpunkt der Apple-Zeit */
  const APPLE_EPOCH = 978307200;

  /* Sekunden vom 1.1.1601 bis zum 1.1.1970 – Nullpunkt der WebKit-/Chrome-Zeit */
  const WEBKIT_EPOCH = 11644473600;

  /* ---- Zeitzonen ------------------------------------------------------ *
   * Eine Zone ist 'UTC', ein Versatz wie '+02:00' / 'UTC+2' oder ein
   * IANA-Name wie 'Europe/Berlin'. Leer = Ortszeit dieses Rechners. */
  const zonenFormate = new Map();

  /** Versatz einer IANA-Zone zum Zeitpunkt utcMs in Minuten (null = unbekannte Zone). */
  function ianaVersatz(zone, utcMs) {
    let dtf = zonenFormate.get(zone);
    if (dtf === undefined) {
      try {
        dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) { dtf = null; }
      zonenFormate.set(zone, dtf);
    }
    if (!dtf) return null;
    const t = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) t[p.type] = p.value;
    const alsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second);
    return Math.round((alsUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  }

  /**
   * Wanduhrzeit (als wäre sie UTC gerechnet) in echte UTC-Millisekunden umrechnen.
   * @returns {?number} null, wenn die Zone nicht verstanden wird
   */
  function wanduhrNachUtc(wandMs, zone) {
    const z = String(zone || '').trim();
    if (!z) return null;
    if (/^(utc|gmt|z)$/i.test(z)) return wandMs;
    const v = z.match(/^(?:utc|gmt)?\s*([+\-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
    if (v) return wandMs - (v[1] === '-' ? -1 : 1) * (+v[2] * 60 + +(v[3] || 0)) * 60000;
    // IANA: Versatz am Zielzeitpunkt bestimmen, zweimal wegen Sommerzeitwechsel
    let versatz = ianaVersatz(z, wandMs);
    if (versatz === null) return null;
    versatz = ianaVersatz(z, wandMs - versatz * 60000);
    return wandMs - versatz * 60000;
  }

  /** Versteht der Import diese Zonenangabe? (für den Zuordnungsdialog) */
  function zoneGueltig(zone) {
    return !String(zone || '').trim() || wanduhrNachUtc(0, zone) !== null;
  }

  /* Datum + Uhrzeit ohne Zonenangabe: Ortszeit oder – mit Zone – umgerechnet */
  function ausTeilen(zone, y, mo, d, h, mi, s, ms) {
    if (zone) {
      const utc = wanduhrNachUtc(Date.UTC(y, mo, d, h, mi, s, ms), zone);
      if (utc !== null) return utc;
    }
    return new Date(y, mo, d, h, mi, s, ms).getTime();
  }

  /* Nachkommastellen einer Sekundenangabe → Millisekunden */
  const bruchMs = f => f ? Math.round(parseFloat('0.' + f) * 1000) : 0;

  /**
   * Zeitstempel tolerant parsen: ISO, deutsch, Unix-, Apple- und WebKit-Zeit.
   * @param {*} raw
   * @param {string} [zone] gilt für Angaben ohne eigene Zone (leer = Ortszeit)
   */
  function parseTimestamp(raw, zone) {
    if (raw == null || raw === '') return 0;
    const s = String(raw).trim();
    // Zahlen nach Stellen vor dem Komma – so speichern die Datenbanken der Geräte:
    //  9 = Apple-Zeit in Sekunden seit 1.1.2001 (iPhone, deckt 2004–2032 ab)
    // 10 = Unix-Sekunden · 13 = Unix-Millisekunden (Android)
    // 16 = Unix-Mikrosekunden · 17 = WebKit-Mikrosekunden seit 1601 (Chrome)
    // 18 = Apple-Zeit in Nanosekunden (iOS sms.db) · 19 = Unix-Nanosekunden
    // Nachkommastellen mit Punkt oder Komma sind erlaubt. Zahlen tragen keine
    // Zone, eine Zonenangabe ändert an ihnen deshalb nichts.
    const zahl = s.match(/^(\d{9,10}|\d{13}|\d{16,19})(?:[.,](\d+))?$/);
    if (zahl) {
      const ganz = zahl[1], stellen = ganz.length;
      const wert = parseFloat(ganz + '.' + (zahl[2] || '0'));
      if (stellen === 9) return Math.round((wert + APPLE_EPOCH) * 1000);
      if (stellen === 10) return Math.round(wert * 1000);
      if (stellen === 13) return Math.round(wert);
      if (stellen === 16) return Math.round(wert / 1000);
      if (stellen === 17) return Math.round(wert / 1000 - WEBKIT_EPOCH * 1000);
      // Große Werte ohne Rundungsfehler: nur die Millisekunden-Stellen auswerten
      const ms = +ganz.slice(0, stellen - 6);
      return stellen === 18 ? ms + APPLE_EPOCH * 1000 : ms;
    }
    // Eine Zone am Ende („… UTC", „…Z", „… +02:00") geht der Voreinstellung vor
    const ZONE = '\\s*(Z|UTC|GMT|(?:UTC|GMT)?\\s*[+\\-]\\d{1,2}(?::?\\d{2})?)?';
    let m = s.match(new RegExp('^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})(?:[,\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d+))?)?)?' +
      '(?:\\s*uhr)?' + ZONE + '$', 'i'));
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      return ausTeilen(m[8] || zone, y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), bruchMs(m[7]));
    }
    m = s.match(new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T](\\d{2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d+))?)?)?' + ZONE + '$', 'i'));
    if (m) {
      return ausTeilen(m[8] || zone, +m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), bruchMs(m[7]));
    }
    // Andere reine Zahlen sind keine Zeitangabe (Date.parse läse sie als Jahr)
    if (/^\d+(?:[.,]\d+)?$/.test(s)) return 0;
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  /* ------------------------------------------------------------------ *
   * Spaltenabbildung (deutsche Namen + gängige Alternativen)
   * ------------------------------------------------------------------ */
  /* Verglichen wird in einer vereinfachten Schreibweise (siehe kopfNorm):
     „Message ID", „message-id" und „MESSAGE_ID" gelten als message_id.
     Neben den eigenen Namen stehen die Spalten roher Geräte-Datenbanken
     (WhatsApp ChatStorage/msgstore, iOS sms.db, Android mmssms.db), damit
     SQL-Exporte ohne Umbenennen passen. Reihenfolge = Vorrang. */
  const FIELDS = {
    id:         ['nachricht_id', 'nachrichten_id', 'message_id', 'msg_id', 'message_guid', 'guid', 'key_id', 'zstanzaid', 'id', '_id', 'rowid', 'z_pk'],
    ts:         ['zeitstempel', 'timestamp', 'message_timestamp', 'message_timestamp_utc', 'timestamp_utc', 'datum_zeit',
                 'datetime', 'date_time', 'message_date', 'zmessagedate', 'sent_timestamp',
                 'gesendet_am', 'gesendet', 'sent_at', 'send_time', 'created_at'],
    date:       ['datum', 'date'],
    time:       ['uhrzeit', 'zeit', 'time'],
    tz:         ['zeitzone', 'timezone', 'time_zone', 'tz', 'utc_offset'],
    sender:     ['absender_id', 'absender', 'sender_id', 'sender', 'von', 'from', 'from_id', 'author', 'author_id',
                 'address', 'zfromjid', 'remote_resource'],
    senderName: ['absender_name', 'absendername', 'sender_name', 'display_name', 'contact_name', 'author_name',
                 'push_name', 'zpushname', 'kontaktname'],
    conv:       ['unterhaltungs_id', 'unterhaltung_id', 'unterhaltung', 'conversation_id', 'chat_id', 'thread_id',
                 'chat_row_id', 'key_remote_jid', 'zchatsession', 'chat_identifier', 'chat'],
    convName:   ['chatname', 'chat_name', 'unterhaltungs_name', 'unterhaltung_name', 'gruppenname', 'conversation_name',
                 'chat_title', 'zpartnername',
                 'name'],                     // zuletzt: in SQL-JOINs meist der Name des Chats bzw. Partners
    fromMe:     ['von_mir', 'from_me', 'is_from_me', 'key_from_me', 'zisfromme', 'ausgehend', 'outgoing', 'richtung',
                 'direction', 'message_direction'],
    text:       ['nachrichteninhalt', 'nachrichten_inhalt', 'inhalt', 'nachricht', 'content', 'message', 'text',
                 'text_data', 'ztext', 'body', 'data'],
    type:       ['nachricht_typ', 'nachrichtentyp', 'typ', 'message_type', 'zmessagetype', 'type'],
    media:      ['medienpfad', 'medien_pfad', 'media_path', 'media', 'anhang', 'attachment', 'attachment_file',
                 'attachment_path', 'zmedialocalpath', 'datei', 'file'],
    replyTo:    ['antwort_auf_id', 'antwort_auf', 'reply_to_id', 'reply_to', 'in_reply_to'],
    reactionTo: ['reaktion_auf_id', 'reaktion_auf', 'reaction_to_id', 'reaction_to'],
    status:     ['status', 'zustand', 'state'],
    read:       ['gelesen', 'is_read', 'read'],   // 1/0 – ergibt den Status „gelesen"
    deleted:    ['geloescht', 'gelöscht', 'deleted', 'is_deleted', 'was_deleted', 'remotely_deleted', 'wiederhergestellt',
                 'recovered'],
    source:     ['quelle', 'quelldatei', 'source', 'source_file', 'quelle_datei', 'herkunft', 'source_path'],
    // Anrufe (nachricht_typ „anruf")
    duration:   ['dauer', 'anrufdauer', 'dauer_sekunden', 'duration', 'call_duration', 'duration_in_secs', 'duration_h_m_s'],
    video:      ['video', 'videoanruf', 'video_call', 'is_video'],
    callResult: ['anruf_ergebnis', 'ergebnis', 'call_result', 'call_outcome', 'outcome', 'disconnected_cause'],
    messenger:  ['messenger', 'plattform', 'platform', 'app', 'dienst', 'service']
  };

  /* Beschriftung je Feld für Meldungen und den Zuordnungsdialog */
  const FELD_NAMEN = {
    conv: 'Chat-Kennung', convName: 'Chatname', ts: 'Zeitstempel', date: 'Datum (ohne Uhrzeit)',
    time: 'Uhrzeit', tz: 'Zeitzone je Zeile', sender: 'Absender-Kennung', senderName: 'Absender-Name',
    fromMe: 'Von mir / Richtung', text: 'Nachrichtentext', type: 'Nachrichtentyp', media: 'Medienpfad',
    id: 'Nachrichten-ID', replyTo: 'Antwort auf (ID)', reactionTo: 'Reaktion auf (ID)', status: 'Status',
    deleted: 'Gelöscht', source: 'Quelle (Datei/Zeile)', messenger: 'Messenger', read: 'Gelesen (1/0)',
    duration: 'Anrufdauer', video: 'Videoanruf', callResult: 'Anruf-Ergebnis'
  };

  /** Spaltenname in Vergleichsform: klein, Umlaute ausgeschrieben, Trenner als „_". */
  function kopfNorm(h) {
    const s = String(h || '').replace(/^﻿/, '').trim().toLowerCase();
    // Ein führender Unterstrich gehört bei Datenbankspalten zum Namen (_id)
    return (s.charAt(0) === '_' ? '_' : '') + s
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /* Pflicht ist nur, zu welchem Chat eine Zeile gehört (Kennung oder Name).
     Alles andere hat einen Ersatz: ID aus dem Inhalt, Absender aus dem
     Chatnamen, Typ aus der Dateiendung. Gemeldet wird nur, was sichtbar fehlt. */
  const REQUIRED = ['conv'];
  const EMPFOHLEN = ['ts', 'text'];

  /**
   * Spalten den Feldern zuordnen.
   * @param {string[]} header Spaltennamen der Datei
   * @returns {{map: object, missing: string[], missingRequired: string[], utc: boolean}}
   *   map: Feld → Spaltenname wie in der Datei; utc: der Zeitstempel trägt „UTC" im Namen
   */
  function buildMapping(header) {
    const nachNorm = new Map();
    for (const h of header) { const n = kopfNorm(h); if (n && !nachNorm.has(n)) nachNorm.set(n, h); }
    const map = {}, vergeben = new Set();
    for (const field of Object.keys(FIELDS)) {
      const alias = FIELDS[field].map(kopfNorm).find(a => nachNorm.has(a) && !vergeben.has(nachNorm.get(a)));
      if (alias) { map[field] = nachNorm.get(alias); vergeben.add(map[field]); }
    }
    return pruefeMapping(map);
  }

  /** Fehlende Pflicht- und empfohlene Felder einer (auch von Hand gebauten) Zuordnung. */
  function pruefeMapping(map, festerChat) {
    const hatZeit = map.ts || map.date;
    const missingRequired = map.conv || map.convName || festerChat ? [] : REQUIRED;
    const missing = EMPFOHLEN.filter(f => f === 'ts' ? !hatZeit : !map[f]);
    return { map, missing, missingRequired, utc: /utc/.test(kopfNorm(map.ts || map.date || '')) };
  }

  /* Ohne Typspalte entscheidet die Endung; WhatsApp legt GIFs als .mp4 im
     Ordner „WhatsApp Animated Gifs" ab. */
  function typAusPfad(media) {
    const p = String(media).toLowerCase();
    if (/animated gifs?[\\/]/.test(p) || /\.gif$/.test(p)) return 'gif';
    if (/\.(jpe?g|png|webp|bmp|avif|svg|heic|heif)$/.test(p)) return 'bild';
    if (/\.(mp4|mov|webm|mkv|avi|m4v|3gp|mpe?g)$/.test(p)) return 'video';
    if (/\.(ogg|opus|oga|mp3|m4a|aac|wav|amr|flac|wma)$/.test(p)) return 'audio';
    return 'datei';
  }

  function normalizeType(raw, media) {
    const s = String(raw || '').trim().toLowerCase();
    // Leer oder eine Typnummer aus einer Datenbank: die Nummern bedeuten je App
    // und Version etwas anderes, deshalb entscheidet dann die Dateiendung.
    if (!s || /^-?\d+$/.test(s)) return media ? typAusPfad(media) : 'text';
    if (/^(gif|animation|animated[_ -]?gif)$/.test(s)) return 'gif';
    // Vor Bild/Video/Audio prüfen: „Videoanruf", „voice call" sind Anrufe
    if (/(anruf|call|telefonat)/.test(s)) return 'anruf';
    if (/(bild|image|photo|foto|jpe?g|png|gif|webp|sticker|aufkleber)/.test(s)) return 'bild';
    if (/(video|clip|mp4|mov)/.test(s)) return 'video';
    if (/(audio|sprach|voice|ptt|ogg|mp3)/.test(s)) return 'audio';
    if (/(system|info|hinweis|event)/.test(s)) return 'system';
    if (/(standort|location|gps|geo)/.test(s)) return 'standort';
    if (/(kontakt|contact|vcard)/.test(s)) return 'kontakt';
    if (/(umfrage|poll)/.test(s)) return 'umfrage';
    if (/(datei|file|dokument|document|pdf)/.test(s)) return 'datei';
    if (/(text|chat|nachricht|message)/.test(s)) return 'text';
    return s;
  }

  /* Ja/nein-Spalten: auch Richtungsangaben wie „Outgoing" zählen als ja */
  const JA = /^(1|true|wahr|ja|yes|y|x|outgoing|ausgehend|out|sent|gesendet)$/i;
  const istJa = wert => JA.test(String(wert || '').trim());

  /**
   * Eine CSV-Zeile in eine Nachricht übersetzen.
   * @param {object} row
   * @param {object} map Feld → Spaltenname
   * @param {string} fallbackMessenger
   * @param {number} seq laufende Nummer für Zeilen ohne ID
   * @param {{zone?: string, festerChat?: string}} [optionen]
   *   zone: gilt für Zeiten ohne eigene Zone (leer = Ortszeit);
   *   festerChat: Chatname für Dateien ohne Chatspalte (z. B. SQL-Export eines Chats)
   */
  function rowToMessage(row, map, fallbackMessenger, seq, optionen) {
    const opt = optionen || {};
    const g = f => (map[f] ? String(row[map[f]] == null ? '' : row[map[f]]) : '');
    const messenger = Messengers.normalize(g('messenger') || fallbackMessenger);
    const id = g('id').trim() || ('auto-' + seq);
    const media = g('media').trim();
    const convName = g('convName').trim() || (!map.conv ? String(opt.festerChat || '').trim() : '');
    const conv = g('conv').trim() || convName || '(ohne Unterhaltung)';
    const type = normalizeType(g('type'), media);
    const fromMe = istJa(g('fromMe'));
    const senderName = g('senderName').trim();
    // Ohne Absender: eigene Nachricht → „Ich", sonst der Name oder der Chat
    // selbst (im Einzelchat ist das der Gesprächspartner).
    const sender = g('sender').trim() || (fromMe ? 'Ich' : type === 'system' ? 'system' :
      senderName || convName || (map.sender ? 'Unbekannt' : conv));
    // Datum und Uhrzeit dürfen in getrennten Spalten stehen
    const tsRaw = g('ts').trim() || [g('date').trim(), g('time').trim()].filter(Boolean).join(' ');
    const zone = g('tz').trim() || opt.zone || '';
    const deleted = istJa(g('deleted')) || /(gelöscht|geloescht|deleted|zurückgezogen)/i.test(g('status'));
    const m = {
      key: messenger + '::' + id,
      id: id,
      messenger: messenger,
      conv: conv,
      convKey: messenger + '::' + conv,
      convName: convName,
      fromMe: fromMe,
      ts: parseTimestamp(tsRaw, zone),
      tsRaw: tsRaw,
      sender: sender,
      text: g('text'),
      type: type,
      media: media,
      replyTo: g('replyTo').trim(),
      reactionTo: g('reactionTo').trim(),
      status: g('status').trim() || (istJa(g('read')) ? 'gelesen' : '')
    };
    // Nur setzen, was vorkommt – das hält gespeicherte Daten schlank
    if (zone) m.tz = zone;
    if (senderName && senderName !== sender) m.senderName = senderName;
    if (deleted) m.deleted = true;
    if (g('source').trim()) m.source = g('source').trim();
    // Anrufe: Dauer in Sekunden, Video ja/nein, Ergebnis in einheitlicher Form
    const dauer = dauerSekunden(g('duration'));
    if (dauer !== null) m.duration = dauer;
    if (istJa(g('video')) || /^video/i.test(g('video').trim()) ||
        (type === 'anruf' && /video/i.test(g('type')))) m.video = true;
    const ergebnis = anrufErgebnis(g('callResult'));
    if (ergebnis) m.callResult = ergebnis;
    return m;
  }

  /* ---- Anrufe ---------------------------------------------------------- */

  /** „3:25", „01:03:25", „205" oder „205.0" → Sekunden; sonst null. */
  function dauerSekunden(wert) {
    const s = String(wert == null ? '' : wert).trim();
    if (!s) return null;
    if (/^\d+(?:[.,]\d+)?$/.test(s)) return Math.round(parseFloat(s.replace(',', '.')));
    const t = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/);
    return t ? (+(t[1] || 0)) * 3600 + (+t[2]) * 60 + (+t[3]) : null;
  }

  /** Ergebnis eines Anrufs aus den Schreibweisen der Werkzeuge vereinheitlichen. */
  function anrufErgebnis(wert) {
    const s = String(wert || '').replace(/<[^>]*>/g, '').trim();
    const k = s.toLowerCase();
    if (!k) return '';
    if (/missed or rejected/.test(k)) return 'verpasst oder abgelehnt';
    if (/(missed|verpasst|entgangen)/.test(k)) return 'verpasst';
    if (/(reject|declin|abgelehnt|abgewiesen)/.test(k)) return 'abgelehnt';
    if (/(voicemail|mailbox)/.test(k)) return 'Mailbox';
    if (/(block|gesperrt)/.test(k)) return 'blockiert';
    if (/(externally|anderswo|anderem gerät)/.test(k)) return 'anderswo angenommen';
    if (/(ended|beendet|answered|angenommen|completed|connected)/.test(k)) return 'angenommen';
    return /^\d+$/.test(k) ? '' : s;                  // reine Codes sagen ohne Tabelle nichts
  }

  /** „45 s", „3:25 min", „1:02:03 h" */
  function dauerText(sek) {
    if (sek == null) return '';
    const h = Math.floor(sek / 3600), m = Math.floor(sek % 3600 / 60), s = sek % 60;
    const zz = n => String(n).padStart(2, '0');
    if (h) return h + ':' + zz(m) + ':' + zz(s) + ' h';
    if (m) return m + ':' + zz(s) + ' min';
    return s + ' s';
  }

  /**
   * Beschreibung eines Anrufs für Sprechblase, Chatliste und PDF.
   * @param {object} m Nachricht vom Typ „anruf"
   * @param {boolean} [eigen] vom Gerät aus geführt (sonst m.fromMe)
   * @returns {{art: string, richtung: string, info: string, verpasst: boolean}}
   */
  function anruf(m, eigen) {
    const aus = eigen != null ? eigen : !!m.fromMe;
    const ergebnis = m.callResult || (m.duration === 0 ? 'keine Verbindung' : '');
    const verpasst = /(verpasst|abgelehnt|keine verbindung|blockiert|mailbox)/.test(ergebnis);
    const info = [m.duration ? dauerText(m.duration) : '', ergebnis].filter(Boolean).join(' · ');
    return { art: m.video ? 'Videoanruf' : 'Sprachanruf', richtung: aus ? 'ausgehend' : 'eingehend', info, verpasst };
  }

  /** Anzeigename einer Nachricht: Name, sonst Kennung. */
  function absenderName(m) {
    return (m && (m.senderName || m.sender)) || '';
  }

  /** Anzeigename einer Absender-Kennung innerhalb einer Unterhaltung. */
  function nameVon(conv, id) {
    return (conv && conv.names && conv.names.get(id)) || id;
  }

  /* ------------------------------------------------------------------ *
   * Index / Unterhaltungen
   * ------------------------------------------------------------------ */
  function whoAmI(convKey) {
    if (Object.prototype.hasOwnProperty.call(state.me, convKey)) return state.me[convKey];
    return state.meGlobal;
  }

  function conversationTitle(c) {
    if (c.name) return c.name;           // Spalte chatname
    const me = whoAmI(c.key);
    const others = Array.from(c.senders.keys()).filter(s => s !== me && s !== 'Unbekannt' && s !== 'system');
    if (!others.length) return c.conv;
    const namen = others.map(s => nameVon(c, s));
    if (namen.length <= 3) return namen.join(', ');
    return namen.slice(0, 2).join(', ') + ' +' + (namen.length - 2);
  }

  function sortConversations() {
    const mode = state.sortMode;
    state.conversations.sort((a, b) => {
      if (mode === 'oldest') return (a.first || 0) - (b.first || 0);
      if (mode === 'count') return b.count - a.count;
      if (mode === 'name') return a.title.localeCompare(b.title, 'de');
      return (b.last || 0) - (a.last || 0);
    });
  }

  function rebuild() {
    state.byKey = new Map();
    for (const m of state.messages) {
      m.reactions = null;
      state.byKey.set(m.key, m);
    }

    const convs = new Map();
    for (const m of state.messages) {
      let c = convs.get(m.convKey);
      if (!c) {
        c = {
          key: m.convKey, conv: m.conv, messenger: m.messenger,
          messages: [], reactionRows: [], senders: new Map(),
          media: [], first: Infinity, last: 0, name: '', mine: new Map(), names: new Map()
        };
        convs.set(m.convKey, c);
      }
      if (m.reactionTo) c.reactionRows.push(m);
      else c.messages.push(m);
      if (m.ts) { if (m.ts < c.first) c.first = m.ts; if (m.ts > c.last) c.last = m.ts; }
      c.senders.set(m.sender, (c.senders.get(m.sender) || 0) + 1);
      if (m.fromMe) c.mine.set(m.sender, (c.mine.get(m.sender) || 0) + 1);
      if (m.convName) c.name = m.convName;
      if (m.senderName) c.names.set(m.sender, m.senderName);
      if (m.media && !m.reactionTo) c.media.push(m);
    }

    const byIdWithinConv = new Map();
    for (const c of convs.values()) {
      const idx = new Map();
      for (const m of c.messages) idx.set(m.id, m);
      byIdWithinConv.set(c.key, idx);
    }

    for (const c of convs.values()) {
      const idx = byIdWithinConv.get(c.key);
      for (const r of c.reactionRows) {
        const target = idx.get(r.reactionTo) || state.byKey.get(r.messenger + '::' + r.reactionTo);
        if (target) (target.reactions || (target.reactions = [])).push(r);
        else c.messages.push(r); // Ziel unbekannt: als eigene Nachricht anzeigen
      }
      c.messages.sort((a, b) => (a.ts - b.ts) ||
        (Number.isInteger(a.sourceOrder) && Number.isInteger(b.sourceOrder) ? a.sourceOrder - b.sourceOrder : 0) ||
        String(a.id).localeCompare(String(b.id), 'de', { numeric: true }));
      for (let i = 0; i < c.messages.length; i++) c.messages[i]._i = i;
      if (c.first === Infinity) c.first = 0;
      c.count = c.messages.length;
      c.reactionCount = c.reactionRows.length;
      c.lastMessage = c.messages[c.messages.length - 1] || null;
      c.title = conversationTitle(c);
    }

    state.convByKey = convs;
    state.conversations = Array.from(convs.values());
    sortConversations();
  }

  /* Spalte von_mir: wer dort am häufigsten steht, ist in diesem Chat „ich".
     Eine Auswahl über „Ich:" in der Kopfzeile bleibt unangetastet. */
  function meFromColumn() {
    let changed = false;
    for (const c of state.conversations) {
      if (!c.mine.size || Object.prototype.hasOwnProperty.call(state.me, c.key)) continue;
      state.me[c.key] = Array.from(c.mine).sort((a, b) => b[1] - a[1])[0][0];
      c.title = conversationTitle(c);
      changed = true;
    }
    if (changed) Store.settings.set('me', state.me);
  }

  /* Heuristik: Wer in den meisten Unterhaltungen schreibt, ist vermutlich der Nutzer */
  function guessMe() {
    if (state.meGlobal) return;
    const counts = new Map();
    for (const c of state.conversations) {
      for (const s of c.senders.keys()) counts.set(s, (counts.get(s) || 0) + 1);
    }
    let best = null, bestN = 1;
    for (const [s, n] of counts) if (n > bestN) { best = s; bestN = n; }
    if (best) {
      state.meGlobal = best;
      Store.settings.set('meGlobal', best);
      for (const c of state.conversations) c.title = conversationTitle(c);
    }
  }

  global.Model = {
    state: state, esc: esc, hashCode: hashCode, senderColor: senderColor, initials: initials,
    DT_DATE: DT_DATE, DT_TIME: DT_TIME, DT_FULL: DT_FULL,
    dayLabel: dayLabel, relative: relative, parseTimestamp: parseTimestamp,
    setzeAnzeigeZone: setzeAnzeigeZone, zeigeZone: zeigeZone, zonenName: zonenName, tagSchluessel: tagSchluessel,
    buildMapping: buildMapping, rowToMessage: rowToMessage, normalizeType: normalizeType,
    rebuild: rebuild, sortConversations: sortConversations, whoAmI: whoAmI,
    conversationTitle: conversationTitle, guessMe: guessMe, meFromColumn: meFromColumn, FIELDS: FIELDS,
    FELD_NAMEN: FELD_NAMEN, kopfNorm: kopfNorm, pruefeMapping: pruefeMapping, zoneGueltig: zoneGueltig,
    absenderName: absenderName, nameVon: nameVon,
    anruf: anruf, dauerText: dauerText, dauerSekunden: dauerSekunden, anrufErgebnis: anrufErgebnis
  };
})(window);
