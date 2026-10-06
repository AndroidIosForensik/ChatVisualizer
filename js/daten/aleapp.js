/* ALEAPP-Berichte zusammenführen: alle TSV-Dateien aus „_TSV Exports" gemeinsam.

   ALEAPP legt je App mehrere Tabellen an – Nachrichten, Kontakte, Anhänge,
   Anrufe, Systemereignisse … Jede bekannte Tabelle wird an ihren Spalten
   erkannt (nicht am Dateinamen, der ändert sich zwischen ALEAPP-Versionen).
   Die Tabellen einer App werden gemeinsam ausgewertet und als Zeilen im
   eigenen Spaltenformat zurückgegeben; danach nehmen sie den üblichen Weg über
   Model.buildMapping und Model.rowToMessage.

   Die Apps melden sich über Aleapp.quelle() an: aleapp-whatsapp.js und
   aleapp-apps.js. Dieses Modul kennt keine einzelne App. */
(function (global) {
  'use strict';

  /* Zielspalten, die jede Quelle liefert (siehe README, Abschnitt „CSV format“ bzw. „CSV-Format“) */
  const SPALTEN = ['nachricht_id', 'unterhaltungs_id', 'chatname', 'absender_id', 'von_mir', 'zeitstempel',
    'nachrichteninhalt', 'nachricht_typ', 'medienpfad', 'antwort_auf_id', 'reaktion_auf_id', 'status', 'messenger'];

  const QUELLEN = [];

  /**
   * Eine App anmelden.
   * @param {{app: string, messenger?: string,
   *          tabellen: Object<string, string[]>,
   *          kombiniere: function(Object<string, object[]>): object[]}} def
   *   tabellen: Rolle → Spalten, die alle vorhanden sein müssen (klein geschrieben).
   *   Reihenfolge zählt: die erste passende Rolle gewinnt.
   *   kombiniere bekommt je Rolle alle Zeilen (auch aus mehreren Dateien) und
   *   liefert Zeilen mit den Schlüsseln aus SPALTEN.
   */
  function quelle(def) { QUELLEN.push(def); }

  /** Welche Quelle (App) und Rolle hat diese Tabelle? null, wenn unbekannt.
      Mehrere Quellen dürfen dieselbe App nennen (SMS aus mmssms.db und aus einem Backup). */
  function erkenne(header) {
    const h = new Set(header);
    for (const q of QUELLEN) {
      for (const rolle of Object.keys(q.tabellen)) {
        if (q.tabellen[rolle].every(s => h.has(s))) return { app: q.app, rolle, quelle: q };
      }
    }
    return null;
  }

  /**
   * Erkannte Tabellen eines Imports je Quelle zusammenführen.
   * @param {{name: string, quelle: object, rolle: string, data: object[]}[]} tabellen
   * @returns {{app: string, header: string[], data: object[], dateien: string[], rollen: string[]}[]}
   */
  function kombiniere(tabellen) {
    const ergebnis = [];
    for (const q of QUELLEN) {
      const eigene = tabellen.filter(t => t.quelle === q);
      if (!eigene.length) continue;
      const t = {};
      for (const rolle of Object.keys(q.tabellen)) t[rolle] = [];
      for (const tab of eigene) t[tab.rolle].push(...tab.data);
      const zeilen = q.kombiniere(t).map(z => {
        const voll = {};
        for (const s of SPALTEN) voll[s] = z[s] === undefined || z[s] === null ? '' : String(z[s]);
        if (!voll.messenger) voll.messenger = q.messenger || q.app;
        return voll;
      });
      ergebnis.push({ app: q.app, header: SPALTEN.slice(), data: zeilen, doppeltMit: q.doppeltMit,
        dateien: eigene.map(e => e.name), rollen: [...new Set(eigene.map(e => e.rolle))] });
    }
    for (const satz of ergebnis) {
      const ziel = satz.doppeltMit && ergebnis.find(e => e.app === satz.doppeltMit && e !== satz);
      if (ziel) abgleichen(satz, ziel);
    }
    return ergebnis;
  }

  /* Dieselbe Nachricht aus zwei Datenbanken (SMS in mmssms.db und bugle_db):
     gleich ist, was in derselben Sekunde mit demselben Text steht. Die Zeile aus
     „ziel" bleibt, Namen aus „satz" ersetzen dort Telefonnummern; übrige Zeilen
     aus „satz" wandern in den Chat, in dem ihre Unterhaltung schon steht. */
  function abgleichen(satz, ziel) {
    const schluessel = z => Math.round(Model.parseTimestamp(z.zeitstempel) / 1000) + '\u0001' + z.nachrichteninhalt.trim();
    const zielNach = new Map(ziel.data.map(z => [schluessel(z), z]));
    const chatZuZiel = new Map();
    const bleiben = [];
    for (const z of satz.data) {
      const gleich = zielNach.get(schluessel(z));
      if (!gleich) { bleiben.push(z); continue; }
      chatZuZiel.set(z.unterhaltungs_id, gleich);
      if (gleich.von_mir !== '1' && istKennung(gleich.absender_id) && !istKennung(z.absender_id)) gleich.absender_id = z.absender_id;
      if (istKennung(gleich.chatname) && !istKennung(z.chatname)) {
        for (const y of ziel.data) if (y.unterhaltungs_id === gleich.unterhaltungs_id) y.chatname = z.chatname;
      }
    }
    satz.abgeglichen = satz.data.length - bleiben.length;
    for (const z of bleiben) {
      const vorbild = chatZuZiel.get(z.unterhaltungs_id);
      if (vorbild) Object.assign(z, { unterhaltungs_id: vorbild.unterhaltungs_id, chatname: vorbild.chatname, messenger: vorbild.messenger });
    }
    satz.data = bleiben;
  }

  /** Stammt die Datei aus einem ALEAPP-Bericht? Dort liegen auch viele Tabellen ohne Chats. */
  function istBericht(header, pfad) {
    return /(^|[\\/])_TSV Exports[\\/]/i.test(String(pfad || '')) || header.indexOf('source file') !== -1;
  }

  /* ---- Hilfen für die Quellen --------------------------------------- */

  /* „2026-09-04 14:41:25" ist bei ALEAPP UTC. Ohne Zonenangabe würde es als
     Ortszeit gelesen und läge im Sommer zwei Stunden daneben. */
  function utc(wert) {
    const s = String(wert || '').trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+\-]\d{2}:?\d{2})?$/);
    return m ? m[1] + 'T' + m[2] + (m[3] || 'Z') : s;
  }

  /* Richtung: true = eigene Nachricht, false = empfangen, null = unbekannt */
  function ausgehend(wert) {
    const s = String(wert === undefined || wert === null ? '' : wert).trim().toLowerCase();
    if (!s) return null;
    if (/^(outgoing|sent|send|outbox|out|from me|ausgehend|gesendet|1|true|yes|ja|y)$/.test(s)) return true;
    if (/^(incoming|received|receive|inbox|in|eingehend|empfangen|0|false|no|nein|n)$/.test(s)) return false;
    return null;
  }

  /* Kennungen statt Namen: WhatsApp-JIDs, UUIDs, reine Ziffernfolgen */
  function istKennung(wert) {
    const s = String(wert || '').trim();
    return !s || /@[a-z.]+$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^\+?[\d\s-]{6,}$/.test(s);
  }

  /* Medienzelle: ältere ALEAPP-Versionen schreiben HTML in die TSV, neuere
     einen Pfad relativ zum Berichtsordner (media/…). HTML liefert '' –
     dann soll die aufrufende Quelle den Gerätepfad nehmen. */
  function medium(wert) {
    const s = String(wert || '').trim();
    if (!s || /^</.test(s) || /https?:\/\//i.test(s)) return '';
    return s.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  function typAusMime(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'image/gif') return 'gif';
    const art = s.split('/')[0];
    return { image: 'bild', video: 'video', audio: 'audio', text: 'text' }[art] || 'datei';
  }

  /* Zustellzustand in Worten → Häkchen des ChatVisualizers */
  function statusWort(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (!s) return '';
    if (/(read|gelesen|seen|played|viewed|opened)/.test(s)) return 'gelesen';
    if (/(deliver|zugestellt|received)/.test(s)) return 'zugestellt';
    if (/(fail|error|fehl)/.test(s)) return 'fehlgeschlagen';
    if (/(pend|queue|sending|outbox|draft|wait)/.test(s)) return 'ausstehend';
    if (/(sent|gesendet|server)/.test(s)) return 'gesendet';
    return '';
  }

  /** Erster nicht leerer Wert */
  function erster(...werte) {
    for (const w of werte) if (w !== undefined && w !== null && String(w).trim() !== '') return String(w).trim();
    return '';
  }

  /** Stabile Kennung aus beliebigen Werten (gleiche Eingabe → gleiche ID) */
  function fp(...werte) { return WhatsApp.fingerprint(JSON.stringify(werte)); }

  /* Chatnamen sammeln: ein echter Name schlägt eine Kennung */
  function namensliste() {
    const namen = new Map();
    return {
      merke(id, name) {
        const n = String(name || '').trim();
        if (!n) return;
        const alt = namen.get(id);
        if (!alt || (istKennung(alt) && !istKennung(n))) namen.set(id, n);
      },
      name(id, ersatz) { return namen.get(id) || ersatz || id; }
    };
  }

  /**
   * Häufiger Fall: eine Nachrichtentabelle, je Zeile Chat, Richtung, Absender, Text.
   * @param {object} d  app, messenger?, spalten (Erkennung), zeit, aus(r), chat(r, aus) → [id, name],
   *                    absender(r), text(r), medium?(r), typ?(r), id?(r), antwort?(r), status?(r)
   */
  function einfach(d) {
    quelle({
      app: d.app, messenger: d.messenger, doppeltMit: d.doppeltMit,
      tabellen: { nachrichten: d.spalten },
      kombiniere(t) {
        const namen = namensliste();
        const zeilen = t.nachrichten.map(r => {
          const aus = d.aus ? d.aus(r) : null;
          const [rohId, chatName] = d.chat(r, aus);
          // Fehlt die Kennung (optionale Spalte leer), hält der Name den Chat zusammen
          const chatId = erster(rohId, chatName) || 'ohne Zuordnung';
          namen.merke(chatId, chatName);
          return {
            nachricht_id: d.id && d.id(r) ? d.app.toLowerCase().replace(/\W+/g, '-') + '-' + d.id(r) : '',
            unterhaltungs_id: String(chatId),
            _chat: chatId,
            absender_id: aus ? 'Ich' : (d.absender ? d.absender(r) : ''),
            von_mir: aus === null ? '' : (aus ? '1' : '0'),
            zeitstempel: utc(typeof d.zeit === 'function' ? d.zeit(r) : r[d.zeit]),
            nachrichteninhalt: d.text(r),
            nachricht_typ: d.typ ? d.typ(r) : '',
            medienpfad: d.medium ? d.medium(r) : '',
            antwort_auf_id: d.antwort ? d.antwort(r) : '',
            status: aus && d.status ? d.status(r) : ''
          };
        });
        for (const z of zeilen) z.chatname = namen.name(z._chat);
        return zeilen;
      }
    });
  }

  global.Aleapp = {
    SPALTEN, quelle, einfach, erkenne, kombiniere, istBericht, quellen: () => QUELLEN.slice(),
    utc, ausgehend, istKennung, medium, typAusMime, statusWort, erster, fp, namensliste
  };
})(window);
