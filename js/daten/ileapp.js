/* iLEAPP-Berichte (TSV-Dateien aus „_TSV Exports") ins eigene Spaltenformat übersetzen.

   Gegenstück zu aleapp.js für iPhone-Auswertungen. Wie dort wird ein
   Bericht an seinen Spalten erkannt, nicht am Dateinamen, und die Zeiten
   sind UTC ohne Zonenangabe. Die Spaltennamen folgen iLEAPP (Stand 2026);
   wo ältere Versionen anders hießen, steht der alte Name als Ersatz daneben. */
(function (global) {
  'use strict';

  const utc = Aleapp.utc;

  const ausgehend = r => /^(outgoing|ausgehend)$/i.test(String(r['direction'] || r['message direction'] || '').trim());
  const ja = wert => /^(1|yes|true|ja)$/i.test(String(wert || '').trim());

  /** Anhangsart aus dem MIME-Typ (image/jpeg → bild) */
  function typAusMime(wert) {
    const s = String(wert || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'image/gif') return 'gif';
    return { image: 'bild', video: 'video', audio: 'audio' }[s.split('/')[0]] || 'datei';
  }

  /** Koordinaten als Inhalt, wenn eine Standortnachricht keinen Text hat */
  function mitStandort(text, lat, lon) {
    return text || (lat && lon ? lat + ', ' + lon : '');
  }

  /* Je Bericht: woran er zu erkennen ist und wie eine Zeile übersetzt wird.
     Jede Übersetzung liefert für alle Zeilen dieselben Spalten. */
  const BERICHTE = [
    {
      // sms.db: SMS, iMessage und RCS. Apple legt je Dienst einen eigenen Chat an,
      // deshalb ist der Dienst hier der Messenger.
      name: 'iLEAPP SMS & iMessage',
      erkennt: h => h.has('chat contact id') && h.has('message') && (h.has('message direction') || h.has('from me')),
      zeile: r => {
        const aus = ausgehend(r) || ja(r['from me']);
        const kontakt = r['chat contact id'] || '';
        const gelesen = ja(r['message read']), zugestellt = ja(r['message delivered']), gesendet = ja(r['message sent']);
        return {
          messenger: r['service'] || 'iMessage',
          nachricht_id: r['message guid'] || r['message row id'] || '',
          unterhaltungs_id: r['chat id'] ? 'Chat ' + r['chat id'] : kontakt,
          chatname: r['chat name'] || kontakt,
          absender_id: aus ? '' : (r['sender'] || kontakt),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['message timestamp'] || r['message date']),
          nachrichteninhalt: r['message'] || '',
          medienpfad: r['attachment file'] || r['attachment path'] || r['attachment name'] || '',
          nachricht_typ: typAusMime(r['attachment mimetype'] || r['attachment type']),
          status: aus ? (gelesen ? 'gelesen' : zugestellt ? 'zugestellt' : gesendet ? 'gesendet' : '') : '',
          quelle: 'sms.db' + (r['message row id'] ? ', ROWID ' + r['message row id'] : '')
        };
      }
    },
    {
      // ChatStorage.sqlite. Ältere iLEAPP-Versionen haben keine Richtungsspalte,
      // dort steht bei eigenen Nachrichten „Local User" als Absender.
      name: 'iLEAPP WhatsApp - Messages',
      erkennt: h => h.has('from id') && h.has('to id') && h.has('receiver') && h.has('message'),
      zeile: r => {
        const aus = ausgehend(r) || r['sender name'] === 'Local User';
        const partner = aus ? r['to id'] : r['from id'];
        const lat = r['latitude'], lon = r['longitude'];
        return {
          messenger: 'WhatsApp',
          unterhaltungs_id: r['chat id'] || partner || '',
          chatname: r['chat name'] || (aus ? r['receiver'] : r['sender name']) || '',
          absender_id: aus ? '' : (r['from id'] || ''),
          absender_name: aus ? '' : (r['sender name'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['timestamp']),
          nachrichteninhalt: mitStandort(r['message'], lat, lon),
          medienpfad: r['attachment local path'] || r['attachment file'] || '',
          nachricht_typ: !r['message'] && lat && lon ? 'standort' : '',
          quelle: 'ChatStorage.sqlite'
        };
      }
    },
    {
      // CallHistory.sqlite. Die Kennung ist dieselbe JID wie „Chat ID" bei den
      // Nachrichten – so stehen Anrufe im selben Chat.
      name: 'iLEAPP WhatsApp - Call History',
      erkennt: h => h.has('duration h:m:s') && h.has('contact id') && h.has('disconnected cause'),
      zeile: r => {
        const gespeichert = String(r['incoming (as stored)'] || '').trim();
        const aus = ausgehend(r) || (!r['direction'] && gespeichert === '0');
        const partner = r['contact id'] || '';
        const gruppe = r['group jid'] || '';
        return {
          messenger: 'WhatsApp',
          unterhaltungs_id: gruppe || partner || 'WhatsApp-Anrufe',
          chatname: gruppe ? '' : (r['contact fullname'] || String(partner).replace(/@.*$/, '')),
          absender_id: aus ? '' : partner,
          absender_name: aus ? '' : (r['contact fullname'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['starting timestamp']),
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r['duration h:m:s'] || '',
          video: ja(r['video call']) ? '1' : '',
          anruf_ergebnis: ja(r['missed']) ? 'verpasst' : (r['disconnected cause'] || ''),
          quelle: 'CallHistory.sqlite' + (r['call id'] ? ', Call ID ' + r['call id'] : '')
        };
      }
    },
    {
      // CallHistory.storedata: Telefon, FaceTime und Anrufe anderer Apps (CallKit)
      name: 'iLEAPP Call History',
      erkennt: h => h.has('service provider') && h.has('call direction') && h.has('phone number') && h.has('answered'),
      zeile: r => {
        const aus = /^outgoing$/i.test(String(r['call direction'] || '').trim());
        const anbieter = String(r['service provider'] || '').toLowerCase();
        const typ = String(r['call type'] || '');
        const messenger = /whatsapp/.test(anbieter) ? 'WhatsApp' : /facetime/i.test(typ + anbieter) ? 'FaceTime'
          : /telephony|^n\/a$|^$/.test(anbieter) ? 'Telefon' : (r['service provider'] || 'Telefon');
        const nummer = r['phone number'] || '(unbekannt)';
        const nichtAngenommen = !aus && /^no$/i.test(String(r['answered'] || '').trim());
        return {
          messenger,
          unterhaltungs_id: nummer,
          chatname: nummer,
          absender_id: aus ? '' : nummer,
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['starting timestamp']),
          nachricht_typ: 'anruf',
          nachrichteninhalt: '',
          dauer: r['call duration'] || '',
          video: /video/i.test(typ) ? '1' : '',
          anruf_ergebnis: nichtAngenommen ? 'verpasst' : (/^n\/a$/i.test(r['disconnected cause'] || '') ? '' : (r['disconnected cause'] || '')),
          quelle: r['source file path'] || 'CallHistory.storedata'
        };
      }
    },
    {
      name: 'iLEAPP Threema - Chats',
      erkennt: h => h.has('chat-id') && h.has('message-id') && h.has('from me'),
      zeile: r => {
        const aus = ja(r['from me']);
        const typ = String(r['message type'] || '');
        return {
          messenger: 'Threema',
          nachricht_id: r['message-id'] || '',
          unterhaltungs_id: r['chat-id'] || r['chat'] || '',
          chatname: r['chat'] || '',
          absender_id: aus ? '' : (r['sender name'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['timestamp']),
          nachrichteninhalt: mitStandort(r['message'], r['latitude'], r['longitude']),
          medienpfad: r['attachment file'] || '',
          nachricht_typ: /ballot/i.test(typ) ? 'umfrage' : typ,
          quelle: 'ThreemaData.sqlite'
        };
      }
    },
    {
      name: 'iLEAPP Signal - Messages',
      erkennt: h => h.has('conversation with') && h.has('author') && h.has('thread id'),
      zeile: r => {
        const aus = ausgehend(r);
        return {
          messenger: 'Signal',
          nachricht_id: r['row id'] || '',
          unterhaltungs_id: r['thread id'] || r['conversation with'] || '',
          chatname: r['conversation with'] || '',
          absender_id: aus ? '' : (r['author'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['timestamp']),
          nachrichteninhalt: r['message'] || '',
          medienpfad: r['attachments'] || '',
          nachricht_typ: ja(r['voice message']) ? 'audio' : '',
          geloescht: ja(r['remotely deleted']) ? '1' : '',
          status: aus && ja(r['read']) ? 'gelesen' : '',
          quelle: 'signal.sqlite'
        };
      }
    },
    {
      name: 'iLEAPP Telegram Messages',
      erkennt: h => h.has('author id') && h.has('chat id') && h.has('text') && h.has('direction'),
      zeile: r => {
        const aus = ausgehend(r);
        const aktion = !r['text'] && r['action data'];
        return {
          messenger: 'Telegram',
          unterhaltungs_id: r['chat id'] || '',
          chatname: r['chat'] || '',
          absender_id: aus ? '' : (r['author id'] || r['author'] || ''),
          absender_name: aus ? '' : (r['author'] || ''),
          von_mir: aus ? '1' : '0',
          zeitstempel: utc(r['timestamp']),
          nachrichteninhalt: aktion ? r['action data'] : (r['text'] || ''),
          medienpfad: r['thumbnail'] || '',
          nachricht_typ: aktion ? 'system' : '',
          quelle: 'Telegram postbox'
        };
      }
    }
  ];

  /**
   * iLEAPP-Bericht erkennen und übersetzen.
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

  global.Ileapp = { umsetzen, typAusMime };
})(window);
