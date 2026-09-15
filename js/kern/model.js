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

  /* Zeitstempel tolerant parsen: ISO, deutsch, Unix-Epoch */
  function parseTimestamp(raw) {
    if (raw == null || raw === '') return 0;
    const s = String(raw).trim();
    if (/^\d{13}$/.test(s)) return parseInt(s, 10);
    if (/^\d{10}$/.test(s)) return parseInt(s, 10) * 1000;
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
    text:       ['nachrichteninhalt', 'nachrichten_inhalt', 'inhalt', 'nachricht', 'content', 'message', 'text', 'body'],
    type:       ['nachricht_typ', 'nachrichtentyp', 'typ', 'message_type', 'type'],
    media:      ['medienpfad', 'medien_pfad', 'media_path', 'media', 'anhang', 'attachment', 'datei', 'file'],
    replyTo:    ['antwort_auf_id', 'antwort_auf', 'reply_to_id', 'reply_to', 'in_reply_to'],
    reactionTo: ['reaktion_auf_id', 'reaktion_auf', 'reaction_to_id', 'reaction_to'],
    status:     ['status', 'zustand', 'state'],
    messenger:  ['messenger', 'plattform', 'platform', 'app', 'quelle', 'source', 'dienst']
  };

  const REQUIRED = ['id', 'sender', 'conv'];

  function buildMapping(header) {
    const map = {};
    const missing = [];
    for (const field of Object.keys(FIELDS)) {
      const col = FIELDS[field].find(c => header.indexOf(c) !== -1);
      if (col) map[field] = col; else missing.push(field);
    }
    return { map, missing, missingRequired: REQUIRED.filter(f => !map[f]) };
  }

  function normalizeType(raw, media) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return media ? 'datei' : 'text';
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
    const conv = String(g('conv') || '').trim() || '(ohne Unterhaltung)';
    return {
      key: messenger + '::' + id,
      id: id,
      messenger: messenger,
      conv: conv,
      convKey: messenger + '::' + conv,
      ts: parseTimestamp(g('ts')),
      tsRaw: g('ts'),
      sender: String(g('sender') || '').trim() || 'Unbekannt',
      text: g('text'),
      type: normalizeType(g('type'), media),
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
          media: [], first: Infinity, last: 0
        };
        convs.set(m.convKey, c);
      }
      if (m.reactionTo) c.reactionRows.push(m);
      else c.messages.push(m);
      if (m.ts) { if (m.ts < c.first) c.first = m.ts; if (m.ts > c.last) c.last = m.ts; }
      c.senders.set(m.sender, (c.senders.get(m.sender) || 0) + 1);
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
      c.messages.sort((a, b) => (a.ts - b.ts) || String(a.id).localeCompare(String(b.id), 'de', { numeric: true }));
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
    conversationTitle: conversationTitle, guessMe: guessMe, FIELDS: FIELDS
  };
})(window);
