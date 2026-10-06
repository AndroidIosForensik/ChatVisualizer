/* WhatsApp aus einem ALEAPP-Bericht: bis zu zwölf Tabellen ergeben einen Verlauf.

   Die Nachrichtentabellen nennen den Chat beim Namen oder als Telefon-JID,
   Lesebestätigungen, Reaktionen und Systemereignisse dagegen als Chat-JID –
   bei neueren Versionen eine anonyme „…@lid". Eine Zuordnungstabelle gibt es
   im Bericht nicht. Die Brücke schlagen Zeitstempel und Text: Eine
   Lesebestätigung nennt Zeit und Inhalt ihrer Nachricht, darüber ist bekannt,
   in welchem Chat die Chat-JID steckt. Was sich nicht zuordnen lässt, bekommt
   einen eigenen Chat unter seiner Kennung, statt verloren zu gehen. */
(function () {
  'use strict';
  const A = Aleapp;

  const TYPEN = {
    'text': 'text', 'picture': 'bild', 'image': 'bild', 'sticker': 'sticker', 'gif': 'gif',
    'video': 'video', 'audio': 'audio', 'voice': 'audio', 'document': 'datei',
    'static location': 'standort', 'live location': 'standort', 'location': 'standort',
    'system message': 'system', 'contact': 'kontakt', 'vcard': 'kontakt', 'poll': 'umfrage', 'call': 'anruf'
  };

  /* WhatsApp-Typnamen; unbekannte Typnummern bleiben leer, dann entscheidet die Dateiendung */
  function typ(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (TYPEN[s]) return TYPEN[s];
    return /^\d+$/.test(s) ? '' : s;
  }

  /* Geteilter Standort ohne Text: die Koordinaten als Inhalt */
  function inhaltMitStandort(r) {
    const lat = r['shared latitude/starting latitude (live location)'];
    const lon = r['shared longitude/starting longitude (live location)'];
    return r['message'] || (lat && lon ? lat + ', ' + lon : '');
  }

  /* Text und Typ einer Nachrichtenzeile. Was weder Text noch Datei hat, bleibt
     als Hinweis sichtbar, statt beim Import still wegzufallen. */
  function inhalt(r, medium) {
    const text = inhaltMitStandort(r);
    const art = String(r['message type'] || '').trim();
    const t = typ(art);
    if (text || medium) return { text, typ: t };
    if (t === 'system') return { text: 'Systemmeldung', typ: 'system' };
    if (art === '90') return { text: '', typ: 'anruf' };              // Anruf im Chatverlauf
    if (/^\d+$/.test(art)) return { text: 'WhatsApp-Nachrichtentyp ' + art + ' (ohne Inhalt)', typ: 'system' };
    return { text: '', typ: t };
  }

  /* Kennung lesbar machen, wenn kein Name bekannt ist */
  function kurz(jid) {
    const [lokal, dienst] = String(jid).split('@');
    if (lokal === '0' && /^s\.whatsapp\.net$/i.test(dienst || '')) return 'WhatsApp';   // Systemkonto
    if (/^s\.whatsapp\.net$/i.test(dienst || '')) return '+' + lokal;
    if (/^lid$/i.test(dienst || '')) return 'LID ' + lokal;   // keine Telefonnummer
    if (/^g\.us$/i.test(dienst || '')) return 'Gruppe ' + lokal;
    return jid;
  }

  function liste(namen) {
    if (namen.length <= 1) return namen[0] || 'jemand';
    return namen.slice(0, -1).join(', ') + ' und ' + namen[namen.length - 1];
  }

  /* Systemereignis als Satz; Codes wie im WhatsApp-Chat-Exporter, unbelegte mit Nummer */
  function systemText(r, nameFuer) {
    const code = parseInt(r['action type (as stored)'], 10);
    const wer = String(r['affected participants'] || '').split(/\s*,\s*/).filter(Boolean).map(nameFuer);
    const mehrere = wer.length > 1;
    const text = r['text'] || '';
    const ich = r['is me joined (as stored)'] === '1';
    switch (code) {
      case 1: return 'Gruppenname geändert' + (text ? ' in „' + text + '“' : '');
      case 4: case 12: return ich ? 'Du wurdest hinzugefügt' : liste(wer) + (mehrere ? ' wurden' : ' wurde') + ' hinzugefügt';
      case 5: case 13: return liste(wer) + (mehrere ? ' haben' : ' hat') + ' die Gruppe verlassen';
      case 6: return 'Gruppenbild geändert';
      case 7: case 14: return liste(wer) + (mehrere ? ' wurden' : ' wurde') + ' entfernt';
      case 10: case 28: return 'Telefonnummer gewechselt' +
        (r['old jid'] || r['new jid'] ? ' (' + kurz(r['old jid'] || '?') + ' → ' + kurz(r['new jid'] || '?') + ')' : '');
      case 11: return 'Gruppe' + (text ? ' „' + text + '“' : '') + ' erstellt';
      case 15: return liste(wer) + (mehrere ? ' sind' : ' ist') + ' jetzt Admin';
      case 18: case 57: return 'Die Sicherheitsnummer hat sich geändert';
      case 19: case 67: return 'Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt';
      case 20: return ich ? 'Du bist über den Einladungslink beigetreten'
        : liste(wer) + (mehrere ? ' sind' : ' ist') + ' über den Einladungslink beigetreten';
      case 27: return 'Gruppenbeschreibung geändert';
      case 56: return 'Einstellung für selbstlöschende Nachrichten geändert';
      case 58: return 'Kontakt blockiert oder Blockierung aufgehoben';
      default: return 'Systemereignis (WhatsApp-Code ' + (isNaN(code) ? '?' : code) + ')' +
        (text ? ': ' + text : '') + (wer.length ? ' – betrifft: ' + liste(wer) : '');
    }
  }

  A.quelle({
    app: 'WhatsApp', messenger: 'WhatsApp',
    tabellen: {
      einzel:        ['other participant wa user name', 'message direction'],
      gruppe:        ['conversation name', 'sending party', 'message direction'],
      alt:           ['recipients', 'group sender', 'direction', 'message id'],
      kontakte:      ['jid', 'number', 'name'],
      anrufe:        ['call start timestamp', 'caller jid', 'call direction'],
      system:        ['event timestamp', 'action type (as stored)', 'chat jid'],
      quittungen:    ['receipt timestamp', 'recipient jid', 'key id'],
      reaktionen:    ['reaction timestamp', 'reacted-to message', 'chat jid'],
      bearbeitungen: ['last edit timestamp', 'original key id'],
      widerrufen:    ['revoke timestamp', 'revoked key id'],
      umfragen:      ['poll timestamp', 'question', 'option'],
      gruppen:       ['group creation timestamp', 'creator jid'],
      profil:        ['user status', 'mobile number', 'country code'],
      logs:          ['token', 'full line']
    },

    kombiniere(t) {
      /* -- Namen ------------------------------------------------------- */
      const kontakt = new Map();
      for (const r of t.kontakte) {
        const name = [r['name'], r['whatsapp name']].find(v => v && !A.istKennung(v));
        if (r['jid'] && name) kontakt.set(r['jid'], name);
      }
      const nameFuer = v => {
        const s = String(v || '').trim();
        if (!s || !A.istKennung(s)) return s;
        return kontakt.get(s) || (s.includes('@') ? kurz(s) : s);
      };

      /* -- Chats und Nachrichten aus den Nachrichtentabellen -------------- */
      const namen = A.namensliste();
      const jidZuChat = new Map();       // Chat-JID → Chat
      const nachrichten = [];
      const neu = (chat, felder) => {
        const m = Object.assign({ chat, quittungen: [], typ: '', medium: '', status: '', reaktionAuf: '' }, felder);
        nachrichten.push(m);
        return m;
      };

      for (const r of t.einzel) {
        const partner = r['other participant wa user name'] || r['sending party jid'];
        if (!partner) continue;
        const chat = '1:' + partner;
        namen.merke(chat, nameFuer(partner));
        if (partner.includes('@')) jidZuChat.set(partner, chat);
        const aus = A.ausgehend(r['message direction']) === true;
        if (!aus && r['sending party jid']) jidZuChat.set(r['sending party jid'], chat);
        const medium = A.medium(r['media']) || r['local path to media'] || '';
        neu(chat, Object.assign({ ts: A.utc(r['message timestamp']), aus, quelle: 'nachricht',
          tabelle: 'WhatsApp - One To One Messages', absender: aus ? 'Ich' : nameFuer(partner), medium }, inhalt(r, medium)));
      }
      for (const r of t.gruppe) {
        const gruppe = r['conversation name'];
        if (!gruppe) continue;
        const chat = 'g:' + gruppe;
        namen.merke(chat, gruppe);
        const partei = r['sending party'] === 'Self' ? '' : r['sending party'];
        const aus = A.ausgehend(r['message direction']) === true || r['sending party'] === 'Self';
        const medium = A.medium(r['media']) || r['local path to media'] || '';
        neu(chat, Object.assign({ ts: A.utc(r['message timestamp']), aus, quelle: 'nachricht',
          tabelle: 'WhatsApp - Group Messages',
          absender: aus ? 'Ich' : nameFuer(A.erster(partei, r['sending party jid'])), medium }, inhalt(r, medium)));
      }
      // Altes Schema (Tabelle „messages"): „Message ID" ist dort die Chat-JID
      for (const r of t.alt) {
        const jid = r['message id'] || '';
        const gruppe = /@g\.us$/.test(jid);
        const chat = (gruppe ? 'g:' : '1:') + jid;
        namen.merke(chat, nameFuer(jid));
        jidZuChat.set(jid, chat);
        const aus = A.ausgehend(r['direction']) === true;
        neu(chat, { ts: A.utc(r['message timestamp']), aus, quelle: 'nachricht', tabelle: 'WhatsApp - Messages',
          absender: aus ? 'Ich' : nameFuer(gruppe ? r['group sender'] : jid),
          text: r['message'] || '', medium: A.medium(r['attachment']) });
      }

      /* -- Brücke über Zeitstempel und Text -------------------------------- */
      const nachZeitText = new Map(), nachZeit = new Map();
      for (const m of nachrichten) {
        const a = m.ts + '\u0001' + m.text;
        if (!nachZeitText.has(a)) nachZeitText.set(a, []);
        nachZeitText.get(a).push(m);
        if (!nachZeit.has(m.ts)) nachZeit.set(m.ts, []);
        nachZeit.get(m.ts).push(m);
      }
      const finde = (ts, text, chat) => {
        let treffer = nachZeitText.get(ts + '\u0001' + (text || '')) || [];
        if (!treffer.length && !text) treffer = nachZeit.get(ts) || [];
        if (chat) treffer = treffer.filter(m => m.chat === chat);
        return treffer.length ? treffer[0] : null;
      };
      const gruppeMitNamen = name => name && namen.name('g:' + name, '') && nachrichten.some(m => m.chat === 'g:' + name)
        ? 'g:' + name : null;
      const chatFuer = (jid, name) => {
        if (jid && jidZuChat.has(jid)) return jidZuChat.get(jid);
        if (/@g\.us$/.test(jid || '') || !jid) { const g = gruppeMitNamen(name); if (g) return g; }
        if (jid && kontakt.has(jid) && nachrichten.some(m => m.chat === '1:' + kontakt.get(jid))) return '1:' + kontakt.get(jid);
        return null;
      };
      // Unbekannte Chat-JID: eigener Chat unter ihrer Kennung
      const chatOderNeu = (jid, name) => {
        const chat = chatFuer(jid, name);
        if (chat) return chat;
        if (!jid && !name) return null;
        const neuerChat = 'j:' + (jid || name);
        namen.merke(neuerChat, name || nameFuer(jid));
        if (jid) jidZuChat.set(jid, neuerChat);
        return neuerChat;
      };

      const nachSchluessel = new Map();   // Key-ID → Nachricht
      for (const r of t.quittungen) {
        const m = finde(A.utc(r['message timestamp']), r['message']);
        if (!m) continue;
        m.quittungen.push(r);
        if (r['key id']) nachSchluessel.set(r['key id'], m);
        if (r['chat jid'] && !jidZuChat.has(r['chat jid'])) jidZuChat.set(r['chat jid'], m.chat);
      }

      /* -- Weitere Tabellen in die Chats ------------------------------------ */
      for (const r of t.system) {
        const chat = chatOderNeu(r['chat jid'], r['chat name']);
        if (!chat) continue;
        neu(chat, { ts: A.utc(r['event timestamp']), aus: null, quelle: 'system', tabelle: 'WhatsApp - System Events',
          absender: 'system', text: systemText(r, nameFuer), typ: 'system' });
      }

      for (const r of t.anrufe) {
        const aus = A.ausgehend(r['call direction']) === true;
        const video = /video/i.test(r['call type'] || '') ? '1' : '';
        const d = r['call duration'] || '';
        // Steht der Anruf schon im Chatverlauf, bekommt er dort Art und Dauer –
        // so landet er auch ohne Gesprächspartner im richtigen Chat.
        const beginn = Model.parseTimestamp(A.utc(r['call start timestamp']));
        const imVerlauf = nachrichten.find(m => m.typ === 'anruf' && m.quelle === 'nachricht' && !m.anrufInfo &&
          Math.abs(Model.parseTimestamp(m.ts) - beginn) <= 60000);
        if (imVerlauf) {
          Object.assign(imVerlauf, { dauer: d, video, anrufInfo: true,
            tabelle: imVerlauf.tabelle + ' + WhatsApp - Call Logs' });
          continue;
        }
        const jid = r['caller jid'];
        const gruppe = gruppeMitNamen(r['group name']);
        // „Self" ohne Kennung: ALEAPP nennt bei eigenen Anrufen den Gesprächspartner nicht
        const caller = r['caller'] === 'Self' ? '' : r['caller'];
        let chat = gruppe || chatFuer(jid, '') ||
          (caller && nachrichten.some(m => m.chat === '1:' + caller) ? '1:' + caller : null);
        if (!chat && (jid || r['group name'] || caller)) chat = chatOderNeu(jid, r['group name'] || caller);
        if (!chat) { chat = 'anrufe'; namen.merke(chat, 'Anrufe ohne Gesprächspartner'); }
        neu(chat, { ts: A.utc(r['call start timestamp']), aus, quelle: 'anruf', tabelle: 'WhatsApp - Call Logs',
          absender: aus ? 'Ich' : (caller && !A.istKennung(caller) ? caller : nameFuer(A.erster(jid, caller))) || namen.name(chat),
          text: '', typ: 'anruf', dauer: d, video });
      }

      for (const r of t.reaktionen) {
        if (!r['reaction']) continue;           // leeres Emoji: Reaktion zurückgenommen
        const ts = A.utc(r['reaction timestamp']);
        const chat = chatFuer(r['chat jid'], r['chat name']);
        let ziel = nachSchluessel.get(r['key id']) || null;
        if (!ziel && chat) {
          const text = (r['reacted-to message'] || '').trim();
          const passend = nachrichten.filter(m => m.chat === chat && m.quelle === 'nachricht' && m.text.trim() === text);
          ziel = passend.filter(m => m.ts <= ts).pop() || passend[0] || null;
        }
        const aus = A.ausgehend(r['direction']) === true;
        const zielChat = ziel ? ziel.chat : chat;
        if (!zielChat) continue;
        const absender = aus ? 'Ich' : (nameFuer(A.erster(r['sender wa name'], r['sender jid'])) || namen.name(zielChat));
        if (ziel) neu(zielChat, { ts, aus, quelle: 'reaktion', tabelle: 'WhatsApp - Message Reactions', absender,
          text: r['reaction'], typ: 'reaktion', reaktionAuf: ziel });
        else neu(zielChat, { ts, aus, quelle: 'reaktion', tabelle: 'WhatsApp - Message Reactions', absender,
          text: r['reaction'] + ' zu „' + (r['reacted-to message'] || '…').slice(0, 80) + '“' });
      }

      for (const r of t.bearbeitungen) {
        const m = finde(A.utc(r['message timestamp']), r['message (as currently stored)']) ||
          finde(A.utc(r['message timestamp']), '');
        if (m) m.bearbeitet = true;
      }

      for (const r of t.widerrufen) {
        const chat = chatOderNeu(r['chat jid'], r['chat name']);
        if (!chat) continue;
        const ts = A.utc(r['message timestamp']);
        const m = (nachZeit.get(ts) || []).find(x => x.chat === chat);
        if (m) { m.geloescht = true; continue; }
        const aus = A.ausgehend(r['direction']) === true;
        neu(chat, { ts, aus, quelle: 'widerrufen', tabelle: 'WhatsApp - Revoked Messages', geloescht: true, text: '',
          absender: aus ? 'Ich' : nameFuer(A.erster(r['sender wa name'], r['sender jid'])) });
      }

      const umfragen = new Map();
      for (const r of t.umfragen) {
        const k = r['key id'] || r['poll timestamp'] + r['question'];
        if (!umfragen.has(k)) umfragen.set(k, { r, optionen: [] });
        if (r['option']) umfragen.get(k).optionen.push(r['option'] +
          (r['vote total (as stored)'] ? ' – ' + r['vote total (as stored)'] + ' Stimme(n)' : ''));
      }
      for (const { r, optionen } of umfragen.values()) {
        const chat = chatOderNeu(r['chat jid'], r['chat name']);
        if (!chat) continue;
        const aus = A.ausgehend(r['direction']) === true;
        neu(chat, { ts: A.utc(r['poll timestamp']), aus, quelle: 'umfrage', tabelle: 'WhatsApp - Polls', typ: 'umfrage',
          text: (r['question'] || 'Umfrage') + optionen.map(o => '\n• ' + o).join(''),
          absender: aus ? 'Ich' : nameFuer(A.erster(r['sender wa name'], r['sender jid'])) || namen.name(chat) });
      }

      /* -- Stabile IDs und Ausgabe ------------------------------------------- */
      const vorkommen = new Map();
      for (const m of nachrichten) {
        const basis = A.fp(m.chat, m.ts, m.quelle, m.aus, m.text, m.medium);
        const n = (vorkommen.get(basis) || 0) + 1;
        vorkommen.set(basis, n);
        m.id = 'wa-' + basis + '-' + n;
      }
      // Chat-Kennung für die Kopfzeile: JID bzw. Name, Gruppen mit „Gruppe"
      const kennung = chat => chat.startsWith('g:') ? 'Gruppe ' + chat.slice(2)
        : /^[1j]:/.test(chat) ? chat.slice(2) : chat === 'anrufe' ? 'Anrufe' : chat;
      return nachrichten.map(m => {
        let status = m.status;
        if (!status && m.aus && m.quittungen.length) {
          status = m.quittungen.some(q => q['read timestamp'] || q['played timestamp']) ? 'gelesen' : 'zugestellt';
        }
        return {
          nachricht_id: m.id,
          unterhaltungs_id: kennung(m.chat),
          chatname: namen.name(m.chat),
          absender_id: m.absender,
          von_mir: m.aus === null ? '' : (m.aus ? '1' : '0'),
          zeitstempel: m.ts,
          nachrichteninhalt: m.bearbeitet ? m.text + ' (bearbeitet)' : m.text,
          nachricht_typ: m.typ,
          medienpfad: m.medium,
          reaktion_auf_id: m.reaktionAuf ? m.reaktionAuf.id : '',
          status,
          geloescht: m.geloescht ? '1' : '',
          dauer: m.dauer || '',
          video: m.video || '',
          quelle: m.tabelle ? 'ALEAPP: ' + m.tabelle : ''
        };
      });
    }
  });
})();
