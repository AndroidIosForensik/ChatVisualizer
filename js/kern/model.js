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

  const DT_DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const DT_TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
  const DT_FULL = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'medium' });

  function dayLabel(ts) {
    if (!ts) return 'Ohne Datum';
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(d) + ', ' + DT_DATE.format(d);
    return DT_DATE.format(d);
  }

  function relative(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return DT_TIME.format(d);
    if (diff === 1) return 'Gestern';
    if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(d);
    return DT_DATE.format(d);
  }

  /* Sekunden vom 1.1.1970 bis zum 1.1.2001 – dem Nullpunkt der Apple-Zeit */
  const APPLE_EPOCH = 978307200;

  /* Zeitstempel tolerant parsen: ISO, deutsch, Unix-Epoch, Apple-Zeit */
  function parseTimestamp(raw) {
    if (raw == null || raw === '') return 0;
    const s = String(raw).trim();
    // Zahlen nach Stellen vor dem Komma: 13 = Unix-Millisekunden (Android),
    // 10 = Unix-Sekunden, 9 = Apple-Zeit in Sekunden seit 1.1.2001 (iPhone,
    // deckt 2004–2032 ab). Nachkommastellen mit Punkt oder Komma sind erlaubt.
    const zahl = s.match(/^(\d{9}|\d{10}|\d{13})(?:[.,](\d+))?$/);
    if (zahl) {
      const wert = parseFloat(zahl[1] + '.' + (zahl[2] || '0'));
      if (zahl[1].length === 13) return Math.round(wert);
      if (zahl[1].length === 10) return Math.round(wert * 1000);
      return Math.round((wert + APPLE_EPOCH) * 1000);
    }
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m && !/([zZ]|[+\-]\d{2}:?\d{2})$/.test(s)) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    }
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  /* ------------------------------------------------------------------ *
   * Spaltenabbildung (deutsche Namen + gängige Alternativen)
   * ------------------------------------------------------------------ */
  const FIELDS = {
    id:         ['nachricht_id', 'nachrichten_id', 'message_id', 'msg_id', 'id'],
    ts:         ['zeitstempel', 'timestamp', 'datum_zeit', 'datum', 'date', 'datetime', 'zeit', 'time'],
    sender:     ['absender_id', 'absender', 'sender_id', 'sender', 'von', 'from', 'author'],
    conv:       ['unterhaltungs_id', 'unterhaltung_id', 'unterhaltung', 'conversation_id', 'chat_id', 'thread_id', 'chat'],
    convName:   ['chatname', 'chat_name', 'unterhaltungs_name', 'unterhaltung_name', 'gruppenname', 'conversation_name', 'chat_title'],
    fromMe:     ['von_mir', 'from_me', 'is_from_me', 'ausgehend', 'outgoing'],
    text:       ['nachrichteninhalt', 'nachrichten_inhalt', 'inhalt', 'nachricht', 'content', 'message', 'text', 'body'],
    type:       ['nachricht_typ', 'nachrichtentyp', 'typ', 'message_type', 'type'],
    media:      ['medienpfad', 'medien_pfad', 'media_path', 'media', 'anhang', 'attachment', 'datei', 'file'],
    replyTo:    ['antwort_auf_id', 'antwort_auf', 'reply_to_id', 'reply_to', 'in_reply_to'],
    reactionTo: ['reaktion_auf_id', 'reaktion_auf', 'reaction_to_id', 'reaction_to'],
    status:     ['status', 'zustand', 'state'],
    messenger:  ['messenger', 'plattform', 'platform', 'app', 'quelle', 'source', 'dienst']
  };

  /* Pflicht ist nur, zu welchem Chat eine Zeile gehört (Kennung oder Name).
     Alles andere hat einen Ersatz: ID aus dem Inhalt, Absender aus dem
     Chatnamen, Typ aus der Dateiendung. Gemeldet wird nur, was sichtbar fehlt. */
  const REQUIRED = ['conv'];
  const EMPFOHLEN = ['ts', 'text'];

  function buildMapping(header) {
    const map = {};
    for (const field of Object.keys(FIELDS)) {
      const col = FIELDS[field].find(c => header.indexOf(c) !== -1);
      if (col) map[field] = col;
    }
    const missingRequired = map.conv || map.convName ? [] : REQUIRED;
    return { map, missing: EMPFOHLEN.filter(f => !map[f]), missingRequired };
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
    if (!s) return media ? typAusPfad(media) : 'text';
    if (/^(gif|animation|animated[_ -]?gif)$/.test(s)) return 'gif';
    if (/(bild|image|photo|foto|jpe?g|png|gif|webp|sticker|aufkleber)/.test(s)) return 'bild';
    if (/(video|clip|mp4|mov)/.test(s)) return 'video';
    if (/(audio|sprach|voice|ptt|ogg|mp3)/.test(s)) return 'audio';
    if (/(system|info|hinweis|event)/.test(s)) return 'system';
    if (/(standort|location|gps|geo)/.test(s)) return 'standort';
    if (/(kontakt|contact|vcard)/.test(s)) return 'kontakt';
    if (/(umfrage|poll)/.test(s)) return 'umfrage';
    if (/(anruf|call)/.test(s)) return 'anruf';
    if (/(datei|file|dokument|document|pdf)/.test(s)) return 'datei';
    if (/(text|chat|nachricht|message)/.test(s)) return 'text';
    return s;
  }

  function rowToMessage(row, map, fallbackMessenger, seq) {
    const g = f => (map[f] ? (row[map[f]] || '') : '');
    const messenger = Messengers.normalize(g('messenger') || fallbackMessenger);
    const id = String(g('id') || '').trim() || ('auto-' + seq);
    const media = g('media').trim();
    const convName = String(g('convName') || '').trim();
    const conv = String(g('conv') || '').trim() || convName || '(ohne Unterhaltung)';
    const type = normalizeType(g('type'), media);
    const fromMe = /^(1|true|wahr|ja|yes|x)$/i.test(String(g('fromMe')).trim());
    // Ohne Absender: eigene Nachricht → „Ich", sonst der Chat selbst (im
    // Einzelchat ist das der Gesprächspartner).
    const sender = String(g('sender') || '').trim() ||
      (fromMe ? 'Ich' : type === 'system' ? 'system' : convName || (map.sender ? 'Unbekannt' : conv));
    return {
      key: messenger + '::' + id,
      id: id,
      messenger: messenger,
      conv: conv,
      convKey: messenger + '::' + conv,
      convName: convName,
      fromMe: fromMe,
      ts: parseTimestamp(g('ts')),
      tsRaw: g('ts'),
      sender: sender,
      text: g('text'),
      type: type,
      media: media,
      replyTo: g('replyTo').trim(),
      reactionTo: g('reactionTo').trim(),
      status: g('status').trim()
    };
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
    if (others.length <= 3) return others.join(', ');
    return others.slice(0, 2).join(', ') + ' +' + (others.length - 2);
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
          media: [], first: Infinity, last: 0, name: '', mine: new Map()
        };
        convs.set(m.convKey, c);
      }
      if (m.reactionTo) c.reactionRows.push(m);
      else c.messages.push(m);
      if (m.ts) { if (m.ts < c.first) c.first = m.ts; if (m.ts > c.last) c.last = m.ts; }
      c.senders.set(m.sender, (c.senders.get(m.sender) || 0) + 1);
      if (m.fromMe) c.mine.set(m.sender, (c.mine.get(m.sender) || 0) + 1);
      if (m.convName) c.name = m.convName;
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
    buildMapping: buildMapping, rowToMessage: rowToMessage, normalizeType: normalizeType,
    rebuild: rebuild, sortConversations: sortConversations, whoAmI: whoAmI,
    conversationTitle: conversationTitle, guessMe: guessMe, meFromColumn: meFromColumn, FIELDS: FIELDS
  };
})(window);
