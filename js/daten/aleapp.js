/* ALEAPP-Berichte (TSV-Dateien aus „_TSV Exports") ins eigene Spaltenformat übersetzen.

   ALEAPP benennt die Spalten je Bericht anders, gibt die Richtung als
   „Incoming"/„Outgoing" an und schreibt Zeiten in UTC ohne Zonenangabe.
   Das wird hier ausgeglichen; danach nimmt die Datei den üblichen Weg über
   Model.buildMapping und Model.rowToMessage. Erkannt wird ein Bericht an
   seinen Spalten, nicht am Dateinamen, weil sich die Namen zwischen den
   ALEAPP-Versionen ändern. */
(function (global) {
  'use strict';

  /* „2026-09-04 14:41:25" ist bei ALEAPP UTC. Ohne Zonenangabe würde es als
     Ortszeit gelesen und läge im Sommer zwei Stunden daneben. */
  function utc(wert) {
    const s = String(wert || '').trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+\-]\d{2}:?\d{2})?$/);
    return m ? m[1] + 'T' + m[2] + (m[3] || 'Z') : s;
  }

  const TYPEN = {
    'text': 'text', 'picture': 'bild', 'image': 'bild', 'sticker': 'bild', 'gif': 'gif',
    'video': 'video', 'audio': 'audio', 'voice': 'audio', 'document': 'datei',
    'static location': 'standort', 'live location': 'standort', 'location': 'standort',
    'system message': 'system', 'contact': 'kontakt', 'vcard': 'kontakt', 'poll': 'umfrage', 'call': 'anruf'
  };

  /* WhatsApp-Typnamen; unbekannte Typnummern (ALEAPP gibt dann die Zahl aus)
     bleiben leer, damit die Dateiendung entscheidet. */
  function typ(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (TYPEN[s]) return TYPEN[s];
    return /^\d+$/.test(s) ? '' : s;
  }

  function typAusMime(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'image/gif') return 'gif';
    const art = s.split('/')[0];
    return { image: 'bild', video: 'video', audio: 'audio', text: 'text' }[art] || 'datei';
  }

  const ausgehend = r => String(r['message direction'] || r['direction'] || '').trim().toLowerCase() === 'outgoing';

  /* Geteilter Standort ohne Text: die Koordinaten als Inhalt */
  function inhaltMitStandort(r) {
    const text = r['message'] || '';
    const lat = r['shared latitude/starting latitude (live location)'];
    const lon = r['shared longitude/starting longitude (live location)'];
    return text || (lat && lon ? lat + ', ' + lon : '');
  }

  /* Je Bericht: woran er zu erkennen ist und wie eine Zeile übersetzt wird.
     Jede Übersetzung liefert für alle Zeilen dieselben Spalten. */
  const BERICHTE = [
    {
      name: 'WhatsApp - Group Messages',
      erkennt: h => h.has('conversation name') && h.has('sending party') && h.has('message direction'),
      zeile: r => {
        const aus = ausgehend(r);
        const partei = r['sending party'] === 'Self' ? '' : r['sending party'];
        return {
          messenger: 'WhatsApp',
          unterhaltungs_id: 'Gruppe ' + r['conversation name'],
          chatname: r['conversation name'],
          absender_id: aus ? '' : (partei || r['sending party jid'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['message timestamp']),
          nachrichteninhalt: inhaltMitStandort(r),
          medienpfad: r['local path to media'] || '',
          nachricht_typ: typ(r['message type'])
        };
      }
    },
    {
      name: 'WhatsApp - One To One Messages',
      erkennt: h => h.has('other participant wa user name') && h.has('message direction'),
      zeile: r => {
        const aus = ausgehend(r);
        const partner = r['other participant wa user name'] || r['sending party jid'] || '';
        return {
          messenger: 'WhatsApp',
          unterhaltungs_id: 'Einzelchat ' + partner,
          chatname: partner,
          absender_id: aus ? '' : partner,
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['message timestamp']),
          nachrichteninhalt: inhaltMitStandort(r),
          medienpfad: r['local path to media'] || '',
          nachricht_typ: typ(r['message type'])
        };
      }
    },
    {
      // Altes WhatsApp-Schema (Tabelle „messages"): „Message ID" ist dort die Chat-JID
      name: 'WhatsApp - Messages',
      erkennt: h => h.has('recipients') && h.has('group sender') && h.has('direction'),
      zeile: r => {
        const aus = ausgehend(r);
        const jid = r['message id'] || '';
        const gruppe = /@g\.us$/.test(jid);
        return {
          messenger: 'WhatsApp',
          unterhaltungs_id: jid,
          chatname: jid.replace(/@.*$/, ''),
          absender_id: aus ? '' : (gruppe ? r['group sender'] : jid).replace(/@.*$/, ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['message timestamp']),
          nachrichteninhalt: r['message'] || '',
          medienpfad: '',
          nachricht_typ: ''
        };
      }
    },
    {
      name: 'sms messages',
      erkennt: h => h.has('address') && h.has('thread id') && h.has('body') && h.has('type'),
      zeile: r => {
        const art = String(r['type'] || '').trim().toLowerCase();
        const aus = /^(sent|outbox|failed|queued|draft)$/.test(art);
        return {
          messenger: 'SMS',
          nachricht_id: 'sms-' + r['msg id'],
          unterhaltungs_id: 'Thread ' + r['thread id'],
          chatname: r['address'],
          absender_id: aus ? '' : r['address'],
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['date']),
          nachrichteninhalt: r['body'] || '',
          status: art === 'failed' ? 'fehlgeschlagen' : art === 'sent' ? 'gesendet' : ''
        };
      }
    },
    {
      // MMS haben keine Richtungsspalte; „Ich:" in der Kopfzeile legt die eigene Nummer fest
      name: 'mms messages',
      erkennt: h => h.has('from') && h.has('to') && h.has('thread id') && h.has('body'),
      zeile: r => ({
        messenger: 'SMS',
        nachricht_id: 'mms-' + r['msg id'],
        unterhaltungs_id: 'Thread ' + r['thread id'],
        absender_id: r['from'] || '',
        zeitstempel: utc(r['date']),
        nachrichteninhalt: r['body'] || ''
      })
    },
    {
      // Datenbank der App Google Messages; überschneidet sich mit SMS/MMS, ist aber eine eigene Quelle
      name: 'Google Messages',
      erkennt: h => h.has('other participant/conversation name') && h.has('message sender'),
      zeile: r => ({
        messenger: 'Google Messages',
        unterhaltungs_id: r['other participant/conversation name'],
        chatname: r['other participant/conversation name'],
        absender_id: r['message sender'] || '',
        zeitstempel: utc(r['message timestamp (utc)'] || r['message timestamp']),
        nachrichteninhalt: r['message'] || '',
        medienpfad: r['attachment location'] || '',
        nachricht_typ: typAusMime(r['message type'])
      })
    }
  ];

  /**
   * ALEAPP-Bericht erkennen und übersetzen.
   * @param {string[]} header  Spaltennamen wie von CSV.toObjects (klein geschrieben)
   * @param {object[]} data
   * @returns {{header: string[], data: object[], bericht: string} | null}
   */
  function umsetzen(header, data) {
    const h = new Set(header);
    const bericht = BERICHTE.find(b => b.erkennt(h));
    if (!bericht) return null;
    const zeilen = data.map(bericht.zeile);
    const spalten = zeilen.length ? Object.keys(zeilen[0]) : Object.keys(bericht.zeile({}));
    return { header: spalten, data: zeilen, bericht: bericht.name };
  }

  /** Stammt die Datei aus einem ALEAPP-Bericht? Dort liegen auch viele Tabellen ohne Chats. */
  function istBericht(header, pfad) {
    return /(^|[\\/])_TSV Exports[\\/]/i.test(String(pfad || '')) || header.indexOf('source file') !== -1;
  }

  global.Aleapp = { umsetzen, istBericht, utc };
})(window);
