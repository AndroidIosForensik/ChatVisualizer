/* WhatsApp (Android) direkt aus den Datenbanken lesen: msgstore.db, dazu
   wa.db und eine Kontaktliste für die Namen.

   Warum nicht über die ALEAPP-TSVs: Neuere WhatsApp-Versionen führen Chats und
   Absender unter einer anonymen Kennung („…@lid"). Welche Telefonnummer dahinter
   steht, weiß nur die Tabelle jid_map – die kommt in keinem ALEAPP-Bericht vor.
   Ohne sie zerfällt ein Gespräch in zwei Chats, und Gruppenereignisse nennen
   Kennungen statt Personen.

   Gelesen wird eine Kopie im Speicher (sql.js, SQLite als WebAssembly); die
   Dateien selbst bleiben unberührt. Liegt eine -wal daneben, werden ihre
   bestätigten Seiten in die Kopie eingespielt – dort stehen oft die neuesten
   Nachrichten.

   Namen, in dieser Rangfolge:
     1. wa.db, Tabelle wa_contacts (nur in einer Vollsicherung gefüllt;
        die wa.db aus dem Backup hat keine Kontakte)
     2. eine Kontaktliste (kontakte.csv vom Entschlüsselungs-Tool, per adb
        aus dem Adressbuch gelesen) – nur, wenn wa_contacts leer ist
     3. sonst die Nummer
   Ergebnis sind Zeilen im eigenen Spaltenformat (Aleapp.SPALTEN); den Rest
   erledigt der übliche Import. */
(function (global) {
  'use strict';

  /* ---- SQLite (sql.js) bei Bedarf laden ---------------------------------- */

  const api = { sqlPfad: 'vendor/sqljs/' };
  let sqlBereit = null;

  function ladeSql() {
    if (sqlBereit) return sqlBereit;
    sqlBereit = (async () => {
      if (typeof global.initSqlJs !== 'function') {
        await new Promise((ok, fehler) => {
          const s = document.createElement('script');
          s.src = api.sqlPfad + 'sql-wasm.js';
          s.onload = ok;
          s.onerror = () => fehler(new Error(api.sqlPfad + 'sql-wasm.js fehlt'));
          document.head.appendChild(s);
        });
      }
      return global.initSqlJs({ locateFile: f => api.sqlPfad + f });
    })();
    sqlBereit.catch(() => { sqlBereit = null; });
    return sqlBereit;
  }

  /* ---- Write-Ahead-Log in die Kopie einspielen --------------------------- */

  /* Prüfsumme nach SQLite: je zwei 32-Bit-Wörter, Byte-Reihenfolge laut Magic */
  function pruefsumme(daten, start, laenge, s0, s1, bigEndian) {
    const dv = new DataView(daten.buffer, daten.byteOffset + start, laenge);
    for (let i = 0; i < laenge; i += 8) {
      s0 = (s0 + dv.getUint32(i, !bigEndian) + s1) >>> 0;
      s1 = (s1 + dv.getUint32(i + 4, !bigEndian) + s0) >>> 0;
    }
    return [s0, s1];
  }

  /**
   * Bestätigte Seiten einer -wal auf die Datenbank anwenden.
   * Gültig ist, was zum Salz passt, die fortlaufende Prüfsumme besteht und mit
   * einem Commit-Rahmen abgeschlossen ist – genau wie SQLite selbst es liest.
   * @returns {{db: Uint8Array, rahmen: number}}
   */
  function walEinspielen(db, wal) {
    if (!wal || wal.length < 32) return { db, rahmen: 0 };
    const dv = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
    const magic = dv.getUint32(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) return { db, rahmen: 0 };
    const be = magic === 0x377f0683;
    const seite = dv.getUint32(8);
    const salz1 = dv.getUint32(16), salz2 = dv.getUint32(20);
    let [s0, s1] = pruefsumme(wal, 0, 24, 0, 0, be);
    if (s0 !== dv.getUint32(24) || s1 !== dv.getUint32(28)) return { db, rahmen: 0 };

    const bestaetigt = [];
    let offen = [], seiten = 0;
    for (let pos = 32; pos + 24 + seite <= wal.length; pos += 24 + seite) {
      if (dv.getUint32(pos + 8) !== salz1 || dv.getUint32(pos + 12) !== salz2) break;
      [s0, s1] = pruefsumme(wal, pos, 8, s0, s1, be);
      [s0, s1] = pruefsumme(wal, pos + 24, seite, s0, s1, be);
      if (s0 !== dv.getUint32(pos + 16) || s1 !== dv.getUint32(pos + 20)) break;
      offen.push({ nr: dv.getUint32(pos), daten: pos + 24 });
      const commit = dv.getUint32(pos + 4);
      if (commit) { bestaetigt.push(...offen); offen = []; seiten = commit; }
    }
    if (!bestaetigt.length) return { db, rahmen: 0 };
    const neu = new Uint8Array(seiten * seite);
    neu.set(db.subarray(0, Math.min(db.length, neu.length)));
    for (const r of bestaetigt) neu.set(wal.subarray(r.daten, r.daten + seite), (r.nr - 1) * seite);
    return { db: neu, rahmen: bestaetigt.length };
  }

  /** Datenbank im Speicher öffnen (mit eingespielter -wal) */
  function oeffne(SQL, bytes, wal) {
    // Eigene Kopie: die Kopfbytes werden gleich geändert
    const { db, rahmen } = walEinspielen(new Uint8Array(bytes).slice(), wal ? new Uint8Array(wal) : null);
    // WAL-Modus abschalten: im Speicher gibt es keine -wal/-shm
    if (db.length > 19 && db[18] === 2) { db[18] = 1; db[19] = 1; }
    return { db: new SQL.Database(db), rahmen };
  }

  function alle(db, sql, werte) {
    const st = db.prepare(sql);
    try {
      if (werte) st.bind(werte);
      const zeilen = [];
      while (st.step()) zeilen.push(st.getAsObject());
      return zeilen;
    } finally { st.free(); }
  }

  function hatTabelle(db, name) {
    return alle(db, "SELECT 1 AS x FROM sqlite_master WHERE type IN ('table','view') AND name = ?", [name]).length > 0;
  }

  function spalten(db, tabelle) {
    return new Set(alle(db, 'PRAGMA table_info(' + JSON.stringify(tabelle) + ')').map(r => r.name));
  }

  /* ---- Kontaktlisten ----------------------------------------------------- */

  const NAME_SPALTEN = ['name', 'anzeigename', 'display_name', 'display name', 'kontakt', 'contact'];
  const NUMMER_SPALTEN = ['nummer_e164', 'nummer', 'telefon', 'telefonnummer', 'rufnummer', 'number', 'phone',
    'phone number', 'mobile', 'mobil'];
  // Spalten, die eine Tabelle zu Nachrichten oder Anrufen machen – dann ist sie keine Kontaktliste
  const NACHRICHT_SPALTEN = ['nachrichteninhalt', 'message', 'text', 'body', 'nachricht', 'date', 'datum',
    'zeitstempel', 'timestamp', 'time', 'zeit', 'duration', 'dauer', 'chatname', 'unterhaltungs_id', 'zdate'];

  /** Ist diese Tabelle eine Kontaktliste (Name + Nummer, keine Nachrichten)? */
  function istKontaktliste(header) {
    const h = new Set(header.map(x => String(x).trim().toLowerCase()));
    return NAME_SPALTEN.some(s => h.has(s)) && NUMMER_SPALTEN.some(s => h.has(s)) &&
      !NACHRICHT_SPALTEN.some(s => h.has(s));
  }

  /** Zeilen einer Kontaktliste → [{name, nummer}] */
  function kontakteAus(header, data) {
    const h = header.map(x => String(x).trim().toLowerCase());
    const nameSp = header[h.findIndex(x => NAME_SPALTEN.includes(x))];
    const nummerSp = NUMMER_SPALTEN.map(s => header[h.indexOf(s)]).filter(Boolean);
    const liste = [];
    for (const r of data) {
      const name = String(r[nameSp] || '').trim();
      const nummer = nummerSp.map(s => String(r[s] || '').trim()).find(Boolean) || '';
      if (name && nummer) liste.push({ name, nummer });
    }
    return liste;
  }

  /* Nur Ziffern; „00" als Auslandsvorwahl entfällt */
  function ziffern(nummer) {
    return String(nummer || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  }

  /** Nummer → Name; ohne Ländervorwahl (0172 …) über die letzten neun Ziffern, wenn eindeutig */
  function nummernbuch(kontakte) {
    const genau = new Map(), ende = new Map();
    for (const k of kontakte || []) {
      const z = ziffern(k.nummer);
      if (z.length < 6) continue;
      if (!z.startsWith('0')) genau.set(z, k.name);
      const e = z.slice(-9);
      ende.set(e, ende.has(e) && ende.get(e) !== k.name ? null : k.name);
    }
    return nummer => {
      const z = ziffern(nummer);
      if (!z) return '';
      return genau.get(z) || (z.length >= 9 && ende.get(z.slice(-9))) || '';
    };
  }

  /* ---- Auswerten ----------------------------------------------------------- */

  /* message_type → eigener Typ; Unbekanntes entscheidet die Dateiendung */
  const TYPEN = { 0: 'text', 1: 'bild', 2: 'audio', 3: 'video', 4: 'kontakt', 5: 'standort', 7: 'system',
    9: 'datei', 13: 'gif', 14: 'kontakt', 15: 'text', 16: 'standort', 20: 'sticker', 24: 'text', 42: 'bild', 43: 'video',
    66: 'umfrage', 90: 'anruf' };

  /**
   * Die Datenbanken auswerten.
   * @param {object} q  msgstore, msgstoreWal?, wa?, waWal? (ArrayBuffer/Uint8Array), kontakte? ([{name, nummer}]),
   *                    kontaktQuelle? (Bezeichnung für Meldungen)
   * @returns {Promise<{data: object[], info: object}>}
   */
  async function lies(q) {
    const SQL = await ladeSql();
    const m = oeffne(SQL, q.msgstore, q.msgstoreWal);
    const w = q.wa ? oeffne(SQL, q.wa, q.waWal) : null;
    try {
      return auswerten(m.db, w && w.db, q, { walMsgstore: m.rahmen, walWa: w ? w.rahmen : 0 });
    } finally {
      m.db.close();
      if (w) w.db.close();
    }
  }

  function auswerten(db, wa, q, info) {
    if (!hatTabelle(db, 'message') || !hatTabelle(db, 'jid') || !hatTabelle(db, 'chat')) {
      if (hatTabelle(db, 'messages')) {
        throw new Error('Diese msgstore.db hat das alte Schema (Tabelle „messages", WhatsApp vor 2022). ' +
          'Bitte über den ALEAPP-Bericht importieren.');
      }
      throw new Error('Keine WhatsApp-Datenbank (msgstore.db) – Tabellen message, jid und chat fehlen.');
    }
    const W = Aleapp.whatsapp;
    const hat = name => hatTabelle(db, name);

    /* -- Kennungen: LID → Telefonnummer ------------------------------------ */
    const jids = new Map();
    for (const r of alle(db, 'SELECT _id, user, server, raw_string FROM jid')) jids.set(r._id, r);
    const lidZuTel = new Map();          // LID-Nutzer → Telefon-Nutzer
    if (hat('jid_map')) {
      for (const r of alle(db, 'SELECT lid_row_id, jid_row_id FROM jid_map')) {
        const lid = jids.get(r.lid_row_id), tel = jids.get(r.jid_row_id);
        if (lid && tel && tel.user) lidZuTel.set(lid.user, tel.user);
      }
    }
    /* Kennung einer jid-Zeile als „nutzer@dienst" – Geräteteil (.0:1) weg, LID wenn möglich als Nummer */
    function kennung(id) {
      const j = jids.get(id);
      if (!j) return '';
      if (!j.user) return j.raw_string || '';
      if (j.server === 'lid' && lidZuTel.has(j.user)) return lidZuTel.get(j.user) + '@s.whatsapp.net';
      return j.user + '@' + j.server;
    }

    /* Eigene Kennungen (Nummer und LID): das Gerät, von dem eigene Nachrichten stammen,
       und wer bei „Du wurdest hinzugefügt" als Einziger betroffen ist. Nicht from_me
       allein – das ist bei Systemmeldungen immer gesetzt, auch wenn andere handeln. */
    const ich = new Set();
    if (hat('message_details')) {
      for (const r of alle(db, 'SELECT DISTINCT d.author_device_jid AS j FROM message_details d ' +
          'JOIN message m ON m._id = d.message_row_id WHERE m.from_me = 1 AND m.message_type <> 7')) {
        const k = kennung(r.j);
        if (k) ich.add(k);
      }
    }
    if (hat('message_system_group') && hat('message_system_chat_participant')) {
      for (const r of alle(db, 'SELECT p.user_jid_row_id AS j FROM message_system_group g ' +
          'JOIN message_system_chat_participant p ON p.message_row_id = g.message_row_id WHERE g.is_me_joined = 1 ' +
          'AND (SELECT COUNT(*) FROM message_system_chat_participant x WHERE x.message_row_id = g.message_row_id) = 1')) {
        const k = kennung(r.j);
        if (k) ich.add(k);
      }
    }

    /* -- Namen ---------------------------------------------------------------- */
    const waNamen = new Map();
    let waKontakte = 0;
    if (wa && hatTabelle(wa, 'wa_contacts')) {
      const sp = spalten(wa, 'wa_contacts');
      const felder = ['jid', 'display_name', 'wa_name'].filter(f => sp.has(f));
      if (sp.has('jid')) {
        for (const r of alle(wa, 'SELECT ' + felder.join(', ') + ' FROM wa_contacts')) {
          if (!r.jid) continue;
          waKontakte++;
          const name = String(r.display_name || '').trim() || (r.wa_name ? '~ ' + String(r.wa_name).trim() : '');
          if (!name) continue;
          // Die wa.db kennt Telefon- und LID-Kennungen; beide auf die Nummer bringen
          const [nutzer, dienst] = String(r.jid).split('@');
          const k = dienst === 'lid' && lidZuTel.has(nutzer) ? lidZuTel.get(nutzer) + '@s.whatsapp.net' : r.jid;
          if (!waNamen.has(k) || (waNamen.get(k).startsWith('~') && !name.startsWith('~'))) waNamen.set(k, name);
        }
      }
    }
    const listeVerwenden = !waKontakte && q.kontakte && q.kontakte.length > 0;
    const ausListe = listeVerwenden ? nummernbuch(q.kontakte) : () => '';
    const benannt = new Set();
    function name(k) {
      if (!k) return '';
      if (ich.has(k)) return 'Ich';
      let n = waNamen.get(k) || '';
      if (!n && /@s\.whatsapp\.net$/.test(k)) n = ausListe(k.split('@')[0]);
      if (n) benannt.add(k);
      return n;
    }
    const zeige = k => name(k) || (k === 'status@broadcast' ? 'Status' : W.kurz(k));
    // Absender: Kennung als Nummer, der Name daneben
    const kurzId = k => (ich.has(k) ? 'Ich' : W.kurz(k));

    /* -- Chats ------------------------------------------------------------------ */
    const chats = new Map();
    for (const r of alle(db, 'SELECT _id, jid_row_id, subject FROM chat')) {
      const k = kennung(r.jid_row_id);
      if (!k) continue;
      const gruppe = /@g\.us$/.test(k);
      chats.set(r._id, { id: r._id, kennung: k, gruppe,
        name: gruppe ? (String(r.subject || '').trim() || W.kurz(k)) : zeige(k) });
    }

    /* -- Zusatztabellen je Nachricht -------------------------------------------- */
    const jeNachricht = (tabelle, sql) => {
      const map = new Map();
      if (!hat(tabelle)) return map;
      for (const r of alle(db, sql)) {
        if (!map.has(r.message_row_id)) map.set(r.message_row_id, []);
        map.get(r.message_row_id).push(r);
      }
      return map;
    };
    const erstes = map => id => (map.get(id) || [])[0] || null;
    const medien = erstes(jeNachricht('message_media',
      'SELECT message_row_id, file_path, mime_type, media_caption, media_duration FROM message_media'));
    const systeme = erstes(jeNachricht('message_system', 'SELECT message_row_id, action_type FROM message_system'));
    const beteiligte = jeNachricht('message_system_chat_participant',
      'SELECT message_row_id, user_jid_row_id FROM message_system_chat_participant');
    const gruppenEreignis = erstes(jeNachricht('message_system_group',
      'SELECT message_row_id, is_me_joined FROM message_system_group'));
    const blockiert = erstes(jeNachricht('message_system_block_contact',
      'SELECT message_row_id, is_blocked FROM message_system_block_contact'));
    const wertAlt = erstes(jeNachricht('message_system_value_change',
      'SELECT message_row_id, old_data FROM message_system_value_change'));
    const nummernwechsel = erstes(jeNachricht('message_system_number_change',
      'SELECT message_row_id, old_jid_row_id, new_jid_row_id FROM message_system_number_change'));
    const zitate = erstes(jeNachricht('message_quoted',
      'SELECT message_row_id, chat_row_id, parent_message_chat_row_id, from_me, key_id FROM message_quoted'));
    const bearbeitet = erstes(jeNachricht('message_edit_info', 'SELECT message_row_id FROM message_edit_info'));
    const orte = erstes(jeNachricht('message_location',
      'SELECT message_row_id, latitude, longitude, place_name, place_address FROM message_location'));
    const vcards = jeNachricht('message_vcard', 'SELECT message_row_id, vcard FROM message_vcard');
    const optionen = jeNachricht('message_poll_option',
      'SELECT message_row_id, option_name, vote_total FROM message_poll_option ORDER BY _id');
    const einladungen = erstes(jeNachricht('message_group_invite',
      'SELECT message_row_id, group_name FROM message_group_invite'));
    const quittungen = jeNachricht('receipt_user',
      'SELECT message_row_id, receipt_timestamp, read_timestamp, played_timestamp FROM receipt_user');

    /* -- Nachrichten --------------------------------------------------------------- */
    const zeilen = [];
    const idNachZeile = new Map();       // message._id → nachricht_id
    const idNachSchluessel = new Map();  // chat|key_id → nachricht_id
    const iso = ms => (ms > 0 ? new Date(ms).toISOString() : '');
    const nachrichtenId = (chat, vonMir, schluessel) => 'wa:' + chat.kennung + ':' + (vonMir ? 1 : 0) + ':' + schluessel;

    const nachrichten = alle(db, 'SELECT _id, chat_row_id, from_me, key_id, sender_jid_row_id, status, timestamp, ' +
      'message_type, text_data FROM message WHERE chat_row_id > 0 ORDER BY timestamp, _id');
    let systemZahl = 0;
    for (const r of nachrichten) {
      const chat = chats.get(r.chat_row_id);
      if (!chat) continue;
      const vonMir = r.from_me === 1;
      const art = r.message_type;
      const medium = medien(r._id);
      let text = String(r.text_data || (medium && medium.media_caption) || '');
      let typ = TYPEN[art] !== undefined ? TYPEN[art] : (medium ? Aleapp.typAusMime(medium.mime_type) : '');
      let absenderK = vonMir ? '' : chat.gruppe ? kennung(r.sender_jid_row_id) : chat.kennung;
      let geloescht = '';

      if (art === 7) {
        text = systemText(r, chat, vonMir);
        systemZahl++;
      } else if (art === 15) {
        text = ''; geloescht = '1';
      } else if (art === 5 || art === 16) {
        const o = orte(r._id);
        if (o) text = [o.latitude + ', ' + o.longitude, o.place_name, o.place_address, text]
          .filter(Boolean).join(' – ');
      } else if (art === 4 || art === 14) {
        const karten = (vcards.get(r._id) || []).map(v => vcardText(v.vcard)).filter(Boolean);
        if (karten.length) text = (text ? text + '\n' : '') + karten.join('\n');
      } else if (art === 66) {
        const opt = (optionen.get(r._id) || []).map(o => '\n• ' + o.option_name +
          (o.vote_total ? ' – ' + o.vote_total + ' Stimme(n)' : ''));
        text = (text || 'Umfrage') + opt.join('');
      } else if (art === 24) {
        const e = einladungen(r._id);
        if (e && e.group_name) text = (text ? text + ' – ' : '') + 'Einladung zur Gruppe „' + e.group_name + '“';
      } else if (art === 42 || art === 43) {
        text = (text ? text + ' ' : '') + '(Einmalansicht)';
      }
      if (bearbeitet(r._id) && text) text += ' (bearbeitet)';

      let status = '';
      if (vonMir && art !== 7) {
        const qs = quittungen.get(r._id) || [];
        if (qs.some(x => x.read_timestamp > 0 || x.played_timestamp > 0) || r.status === 13 || r.status === 8) status = 'gelesen';
        else if (qs.some(x => x.receipt_timestamp > 0)) status = 'zugestellt';
        else if (r.status === 4 || r.status === 5) status = 'gesendet';
      }

      const id = nachrichtenId(chat, vonMir, r.key_id || 'z' + r._id);
      idNachZeile.set(r._id, id);
      if (r.key_id) idNachSchluessel.set(chat.id + '|' + r.key_id, id);
      const absName = absenderK ? name(absenderK) : '';
      zeilen.push({
        nachricht_id: id,
        unterhaltungs_id: chat.kennung,
        chatname: chat.name,
        absender_id: art === 7 ? 'system' : vonMir ? 'Ich' : kurzId(absenderK) || chat.name,
        absender_name: art === 7 || vonMir || absName === 'Ich' ? '' : absName,
        von_mir: art === 7 ? '' : vonMir ? '1' : '0',
        zeitstempel: iso(r.timestamp),
        nachrichteninhalt: text,
        nachricht_typ: typ,
        medienpfad: medium && medium.file_path ? medium.file_path : '',
        antwort_auf_id: '',
        reaktion_auf_id: '',
        status,
        geloescht,
        dauer: '', video: '', anruf_ergebnis: '',
        quelle: 'msgstore.db · message._id ' + r._id,
        messenger: 'WhatsApp',
        _zeile: r._id
      });
    }

    // Antworten: das Zitat nennt die Schlüssel-ID der zitierten Nachricht
    for (const z of zeilen) {
      const zi = zitate(z._zeile);
      if (!zi || !zi.key_id) continue;
      const chatId = zi.parent_message_chat_row_id > 0 ? zi.parent_message_chat_row_id : zi.chat_row_id;
      z.antwort_auf_id = idNachSchluessel.get(chatId + '|' + zi.key_id) || '';
    }

    /* -- Reaktionen ----------------------------------------------------------------- */
    let reaktionen = 0;
    if (hat('message_add_on') && hat('message_add_on_reaction')) {
      const sql = 'SELECT a._id, a.chat_row_id, a.from_me, a.key_id, a.sender_jid_row_id, a.parent_message_row_id, ' +
        'a.timestamp, r.reaction FROM message_add_on a JOIN message_add_on_reaction r ON r.message_add_on_row_id = a._id';
      for (const r of alle(db, sql)) {
        const ziel = idNachZeile.get(r.parent_message_row_id);
        const chat = chats.get(r.chat_row_id);
        if (!r.reaction || !ziel || !chat) continue;        // leeres Emoji: zurückgenommen
        const vonMir = r.from_me === 1;
        const k = vonMir ? '' : chat.gruppe && r.sender_jid_row_id > 0 ? kennung(r.sender_jid_row_id) : chat.kennung;
        const n = k ? name(k) : '';
        reaktionen++;
        zeilen.push({ nachricht_id: nachrichtenId(chat, vonMir, 'r' + (r.key_id || r._id)),
          unterhaltungs_id: chat.kennung, chatname: chat.name,
          absender_id: vonMir ? 'Ich' : kurzId(k), absender_name: vonMir || n === 'Ich' ? '' : n,
          von_mir: vonMir ? '1' : '0', zeitstempel: iso(r.timestamp), nachrichteninhalt: r.reaction,
          nachricht_typ: 'reaktion', reaktion_auf_id: ziel, messenger: 'WhatsApp',
          quelle: 'msgstore.db · message_add_on._id ' + r._id });
      }
    }

    /* -- Anrufe ----------------------------------------------------------------------- */
    let anrufe = 0;
    if (hat('call_log')) {
      const nachKennung = new Map(Array.from(chats.values()).map(c => [c.kennung, c]));
      const sp = spalten(db, 'call_log');
      const gruppe = sp.has('group_jid_row_id') ? ', group_jid_row_id' : '';
      for (const r of alle(db, 'SELECT _id, jid_row_id, from_me, call_id, timestamp, video_call, duration, call_result' +
          gruppe + ' FROM call_log ORDER BY timestamp')) {
        const partner = kennung(r.jid_row_id);
        const gk = r.group_jid_row_id > 0 ? kennung(r.group_jid_row_id) : '';
        const chat = nachKennung.get(gk) || nachKennung.get(partner) ||
          { kennung: partner || 'anrufe', name: partner ? zeige(partner) : 'Anrufe ohne Gesprächspartner' };
        const vonMir = r.from_me === 1;
        const n = !vonMir && partner ? name(partner) : '';
        anrufe++;
        zeilen.push({ nachricht_id: 'wa:anruf:' + (r.call_id || r._id), unterhaltungs_id: chat.kennung,
          chatname: chat.name, absender_id: vonMir ? 'Ich' : kurzId(partner), absender_name: n === 'Ich' ? '' : n,
          von_mir: vonMir ? '1' : '0', zeitstempel: iso(r.timestamp), nachrichteninhalt: '',
          nachricht_typ: 'anruf', dauer: String(r.duration || 0), video: r.video_call ? '1' : '',
          anruf_ergebnis: r.duration > 0 ? 'angenommen' : vonMir ? 'nicht angenommen' : 'verpasst',
          messenger: 'WhatsApp', quelle: 'msgstore.db · call_log._id ' + r._id +
            (r.call_result !== null && r.call_result !== undefined ? ' (call_result ' + r.call_result + ')' : '') });
      }
      // Anrufe stehen zusätzlich als Nachricht (Typ 90) im Chat – die Zeile aus call_log hat Dauer und Ergebnis
      if (anrufe) {
        for (let i = zeilen.length - 1; i >= 0; i--) {
          const z = zeilen[i];
          if (z.nachricht_typ === 'anruf' && z._zeile && zeilen.some(a => a.nachricht_id.startsWith('wa:anruf:') &&
              a.unterhaltungs_id === z.unterhaltungs_id &&
              Math.abs(Date.parse(a.zeitstempel) - Date.parse(z.zeitstempel)) <= 60000)) zeilen.splice(i, 1);
        }
      }
    }

    /* -- Systemmeldungen ----------------------------------------------------------------- */
    function systemText(r, chat, vonMir) {
      const s = systeme(r._id);
      const code = s ? s.action_type : null;
      const wer = (beteiligte.get(r._id) || []).map(b => kennung(b.user_jid_row_id));
      const ichDabei = wer.some(k => ich.has(k)) || (gruppenEreignis(r._id) || {}).is_me_joined === 1;
      // Bei Systemmeldungen ist from_me immer 1 – wer gehandelt hat, steht im Absender
      const handelnd = r.sender_jid_row_id > 0 ? kennung(r.sender_jid_row_id) : '';
      vonMir = handelnd ? ich.has(handelnd) : vonMir;
      const urheber = vonMir ? 'Du' : handelnd ? zeige(handelnd) : '';
      const betreff = String(r.text_data || '').trim();
      switch (code) {
        case 11: return (urheber ? urheber + (vonMir ? ' hast die Gruppe' : ' hat die Gruppe') : 'Gruppe') +
          (betreff ? ' „' + betreff + '“' : '') + ' erstellt';
        case 12: case 4:
          if (ichDabei && !vonMir) return (urheber ? urheber + ' hat dich' : 'Du wurdest') + ' hinzugefügt';
          return (vonMir ? 'Du hast ' : urheber ? urheber + ' hat ' : '') + W.liste(wer.map(zeige)) +
            (vonMir || urheber ? ' hinzugefügt' : wer.length > 1 ? ' wurden hinzugefügt' : ' wurde hinzugefügt');
        case 14: case 7:
          return (vonMir ? 'Du hast ' : urheber ? urheber + ' hat ' : '') + W.liste(wer.map(zeige)) +
            (vonMir || urheber ? ' entfernt' : wer.length > 1 ? ' wurden entfernt' : ' wurde entfernt');
        case 52: return W.liste(wer.map(zeige)) + (wer.length > 1 ? ' sind' : ' ist') +
          ' der Gruppe über eine Einladung beigetreten';
        case 58: {
          const b = blockiert(r._id);
          return b && b.is_blocked === 0 ? 'Du hast die Blockierung aufgehoben' : 'Du hast den Kontakt blockiert';
        }
        case 129: return 'Hinweis von WhatsApp zum Beginn des Chats (Code 129)';
        case 1: {
          const alt = wertAlt(r._id);
          return (urheber ? urheber + (vonMir ? ' hast' : ' hat') + ' den Gruppennamen' : 'Gruppenname') +
            (alt && alt.old_data ? ' von „' + alt.old_data + '“' : '') + (betreff ? ' in „' + betreff + '“' : '') + ' geändert';
        }
        default: {
          const nw = nummernwechsel(r._id);
          return W.systemText({
            'action type (as stored)': code === null ? '' : String(code),
            'affected participants': wer.join(','),
            'text': code === 67 || code === 19 ? '' : betreff,
            'is me joined (as stored)': ichDabei ? '1' : '0',
            'old jid': nw ? kennung(nw.old_jid_row_id) : '', 'new jid': nw ? kennung(nw.new_jid_row_id) : ''
          }, zeige);
        }
      }
    }

    // Alle Spalten belegen, wie es der übliche Import erwartet
    for (const z of zeilen) {
      delete z._zeile;
      for (const sp of Aleapp.SPALTEN) if (z[sp] === undefined || z[sp] === null) z[sp] = '';
    }
    const chatZahl = new Set(zeilen.map(z => z.unterhaltungs_id)).size;
    return {
      data: zeilen,
      info: Object.assign(info, {
        nachrichten: zeilen.length - reaktionen - anrufe, chats: chatZahl, reaktionen, anrufe, system: systemZahl,
        lidZuordnungen: lidZuTel.size, waKontakte, listeVerwendet: listeVerwenden,
        listeUebergangen: !!(waKontakte && q.kontakte && q.kontakte.length),
        benannt: benannt.size, kontaktQuelle: q.kontaktQuelle || ''
      })
    };
  }

  /* vCard → „Name (Nummer)" */
  function vcardText(vcard) {
    const s = String(vcard || '');
    const fn = (s.match(/^FN[^:]*:(.*)$/mi) || [])[1] || '';
    const tel = Array.from(s.matchAll(/^(?:item\d+\.)?TEL[^:]*:(.*)$/gmi)).map(t => t[1].trim());
    const name = fn.trim();
    return name || tel.length ? 'Kontakt: ' + (name || tel[0]) + (name && tel.length ? ' (' + tel.join(', ') + ')' : '') : '';
  }

  /* ---- Dateien eines Imports erkennen ------------------------------------------------- */

  /** msgstore.db, wa.db und ihre -wal unter den Dateien finden. Bevorzugt die aus …/com.whatsapp/databases. */
  function findeDateien(dateien, pfadVon) {
    const pfad = f => String((pfadVon && pfadVon(f)) || f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const wahl = name => {
      const passend = dateien.filter(f => f.name.toLowerCase() === name);
      passend.sort((a, b) => Number(/com\.whatsapp\/databases\//i.test(pfad(b))) - Number(/com\.whatsapp\/databases\//i.test(pfad(a))));
      return passend;
    };
    const ms = wahl('msgstore.db');
    if (!ms.length) return null;
    const ordner = f => pfad(f).replace(/[^/]*$/, '');
    const msgstore = ms[0];
    // -wal und wa.db aus demselben Ordner wie die msgstore.db
    const imOrdner = name => dateien.find(f => f.name.toLowerCase() === name && ordner(f) === ordner(msgstore)) ||
      (name === 'wa.db' ? wahl('wa.db')[0] : null) || null;
    const wa = imOrdner('wa.db');
    return {
      msgstore, msgstoreWal: imOrdner('msgstore.db-wal'),
      wa, waWal: wa ? dateien.find(f => f.name.toLowerCase() === 'wa.db-wal' && ordner(f) === ordner(wa)) || null : null,
      pfad: pfad(msgstore), weitere: ms.length - 1
    };
  }

  Object.assign(api, { lies, ladeSql, walEinspielen, istKontaktliste, kontakteAus, nummernbuch, findeDateien, vcardText });
  global.WhatsAppDB = api;
})(window);
