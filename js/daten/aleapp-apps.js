/* Chat-Apps aus ALEAPP-Berichten außer WhatsApp (siehe aleapp-whatsapp.js).

   Spaltennamen wie in ALEAPP (scripts/artifacts/*.py), klein geschrieben.
   Signal, Telegram, Threema, SMS/MMS und Google Messages führen mehrere
   Tabellen zusammen; die übrigen Apps haben je eine Nachrichtentabelle und
   laufen über Aleapp.einfach. */
(function () {
  'use strict';
  const A = Aleapp;
  const ja = v => /^(yes|true|1|ja|y)$/i.test(String(v || '').trim());
  const ohneHtml = v => String(v || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const name = (...teile) => teile.filter(Boolean).join(' ').trim();

  /* ---- Signal ------------------------------------------------------- */
  A.quelle({
    app: 'Signal', messenger: 'Signal',
    tabellen: {
      nachrichten: ['thread id', 'quoted message id', 'recipient phone number'],
      anhaenge:    ['message date sent', 'stored file', 'detected content type'],
      kontakte:    ['recipient id', 'aci', 'pni'],
      gruppen:     ['group title', 'member count', 'group id'],
      anrufe:      ['call id', 'outcome', 'contact']
    },
    kombiniere(t) {
      const namen = A.namensliste();
      const anhaenge = new Map();
      for (const r of t.anhaenge) {
        if (!anhaenge.has(r['message id'])) anhaenge.set(r['message id'], []);
        anhaenge.get(r['message id']).push(r);
      }
      // Chatname: bei eigenen Nachrichten steht der Chat (Person oder Gruppe) im Empfänger
      const nummerZuChat = new Map(), nameZuChat = new Map();
      for (const r of t.nachrichten) {
        const aus = A.ausgehend(r['direction']) === true;
        if (aus) namen.merke(r['thread id'], A.erster(r['recipient'], r['recipient phone number']));
        const tel = aus ? r['recipient phone number'] : r['sender phone number'];
        const wer = aus ? r['recipient'] : r['sender'];
        if (tel) nummerZuChat.set(tel, r['thread id']);
        if (wer) nameZuChat.set(wer, r['thread id']);
      }
      for (const r of t.nachrichten) {
        if (A.ausgehend(r['direction']) !== true) namen.merke(r['thread id'], A.erster(r['sender'], r['sender phone number']));
      }

      const zeilen = [];
      for (const r of t.nachrichten) {
        const aus = A.ausgehend(r['direction']);
        const id = 'signal-' + r['message id'];
        const basis = {
          unterhaltungs_id: 'Thread ' + r['thread id'], _chat: r['thread id'],
          absender_id: aus ? 'Ich' : A.erster(r['sender'], r['sender phone number']),
          von_mir: aus === null ? '' : (aus ? '1' : '0'),
          zeitstempel: A.utc(A.erster(r['date sent'], r['date received']))
        };
        let status = aus ? A.statusWort(r['status']) : '';
        if (ja(r['remote deleted'])) status = 'gelöscht';
        // Anhänge: aus der Anhangtabelle, sonst die Pfade in der Nachricht selbst
        const liste = (anhaenge.get(r['message id']) || []).map(a => ({
          pfad: A.medium(a['attachment']) || A.medium(a['stored file']),
          typ: ja(a['voice note']) ? 'audio' : ja(a['video gif']) ? 'gif' :
            A.typAusMime(A.erster(a['detected content type'], a['recorded content type'])),
          beschriftung: a['caption'] || ''
        }));
        if (!liste.length) {
          for (const p of String(r['attachments'] || '').split(/[\n,;]+/).map(A.medium).filter(Boolean)) liste.push({ pfad: p, typ: '', beschriftung: '' });
        }
        const erster = liste.shift() || { pfad: '', typ: '', beschriftung: '' };
        zeilen.push(Object.assign({}, basis, {
          nachricht_id: id,
          nachrichteninhalt: A.erster(r['message'], erster.beschriftung) + (ja(r['view once']) ? ' (einmal ansehen)' : ''),
          medienpfad: erster.pfad, nachricht_typ: erster.typ,
          antwort_auf_id: r['quoted message id'] && !ja(r['quoted original missing']) ? 'signal-' + r['quoted message id'] : '',
          status
        }));
        liste.forEach((a, i) => zeilen.push(Object.assign({}, basis, {
          nachricht_id: id + '-anhang-' + (i + 2), nachrichteninhalt: a.beschriftung, medienpfad: a.pfad, nachricht_typ: a.typ
        })));
      }
      for (const r of t.anrufe) {
        const chat = nummerZuChat.get(r['phone number']) || nameZuChat.get(r['contact']) || 'anrufe-' + A.erster(r['phone number'], r['contact']);
        namen.merke(chat, A.erster(r['contact'], r['phone number']));
        const aus = A.ausgehend(r['direction']);
        zeilen.push({
          nachricht_id: 'signal-anruf-' + r['call id'], unterhaltungs_id: (/^anrufe-/.test(chat) ? '' : 'Thread ') + chat, _chat: chat,
          absender_id: aus ? 'Ich' : A.erster(r['contact'], r['phone number']),
          von_mir: aus === null ? '' : (aus ? '1' : '0'), zeitstempel: A.utc(r['timestamp']),
          nachrichteninhalt: (/video/i.test(r['call type'] || '') ? 'Videoanruf' : 'Sprachanruf') +
            (r['outcome'] ? ' · ' + r['outcome'] : ''),
          nachricht_typ: 'anruf'
        });
      }
      for (const z of zeilen) z.chatname = namen.name(z._chat, 'Signal-Chat ' + z._chat);
      return zeilen;
    }
  });

  /* ---- Telegram ----------------------------------------------------- */
  A.quelle({
    app: 'Telegram', messenger: 'Telegram',
    tabellen: {
      nachrichten: ['dialog id', 'chat', 'sender id', 'read state'],
      chats:       ['dialog id', 'messages stored', 'unread count'],
      konten:      ['account slot', 'passcode'],
      einstellungen: ['chat category', 'save photos']
    },
    kombiniere(t) {
      const namen = A.namensliste();
      for (const r of t.chats) namen.merke(r['dialog id'], r['chat']);
      return t.nachrichten.map(r => {
        const aus = A.ausgehend(r['direction']);
        namen.merke(r['dialog id'], r['chat']);
        return {
          nachricht_id: r['message id'] ? 'telegram-' + r['dialog id'] + '-' + r['message id'] : '',
          unterhaltungs_id: 'Dialog ' + r['dialog id'], _chat: r['dialog id'],
          absender_id: aus ? 'Ich' : A.erster(r['sender'], r['sender id']),
          von_mir: aus === null ? '' : (aus ? '1' : '0'), zeitstempel: A.utc(r['timestamp']),
          nachrichteninhalt: r['message'], medienpfad: A.medium(r['media file']) || A.medium(r['recorded media path']),
          status: aus ? (/unread/i.test(r['read state'] || '') ? 'zugestellt' : A.statusWort(r['read state'])) : ''
        };
      }).map(z => Object.assign(z, { chatname: namen.name(z._chat) }));
    }
  });

  /* ---- Threema ------------------------------------------------------ */
  A.quelle({
    app: 'Threema', messenger: 'Threema',
    tabellen: {
      nachrichten: ['contact', 'content type', 'text / filename / address', 'call status'],
      kontakte:    ['threema id', 'display name', 'verification level'],
      konto:       ['threema id', 'nickname', 'linked mobile number']
    },
    kombiniere(t) {
      const anzeige = new Map(t.kontakte.map(k => [k['threema id'], k['display name']]));
      return t.nachrichten.map(r => {
        const aus = A.ausgehend(r['direction']);
        const wer = anzeige.get(r['contact']) || r['contact'];
        const art = String(r['content type'] || '').toLowerCase();
        const wert = r['text / filename / address'] || '';
        let text = wert, medium = '', typ = A.typAusMime(r['mime type']);
        if (/location|standort/.test(art)) {
          typ = 'standort';
          text = A.erster(wert, r['latitude'] && r['longitude'] ? r['latitude'] + ', ' + r['longitude'] : '');
        } else if (/call|voip/.test(art) || r['call status']) {
          typ = 'anruf';
          text = 'Anruf' + (r['call status'] ? ' · ' + r['call status'] : '') + (r['call duration (s)'] ? ' · ' + r['call duration (s)'] + ' s' : '');
        } else if (!/^text/.test(art) && wert) {
          medium = wert; text = '';             // Dateiname; mit Medienordner wird er gefunden
        }
        let status = '';
        if (aus) status = ja(r['read']) || r['read at'] ? 'gelesen' : ja(r['delivered']) ? 'zugestellt' : A.statusWort(r['state']);
        return {
          unterhaltungs_id: r['contact'], chatname: wer,
          absender_id: aus ? 'Ich' : wer, von_mir: aus === null ? '' : (aus ? '1' : '0'),
          zeitstempel: A.utc(r['created']), nachrichteninhalt: text, medienpfad: medium,
          nachricht_typ: typ, status
        };
      });
    }
  });

  /* ---- SMS und MMS (Systemdatenbank mmssms.db) ----------------------- */
  const smsAusgehend = v => {
    const s = String(v || '').trim().toLowerCase();
    if (/^(sent|outbox|failed|queued|draft|outgoing)$/.test(s)) return true;
    if (/^(inbox|received|incoming)$/.test(s)) return false;
    return null;
  };
  const smsStatus = v => {
    const s = String(v || '').trim().toLowerCase();
    return s === 'failed' ? 'fehlgeschlagen' : s === 'sent' ? 'gesendet' : /^(queued|outbox|draft)$/.test(s) ? 'ausstehend' : '';
  };
  A.quelle({
    app: 'SMS', messenger: 'SMS',
    tabellen: {
      kombiniert: ['source table', 'address', 'body', 'thread id'],
      sms:        ['address', 'thread id', 'body', 'type'],
      mms:        ['from address', 'to address', 'thread id', 'body'],
      mmsAlt:     ['from', 'to', 'thread id', 'body'],
      anhaenge:   ['part id', 'msg id', 'file name', 'stored path']
    },
    kombiniere(t) {
      const namen = A.namensliste();
      const anhang = new Map();
      for (const r of t.anhaenge) {
        const pfad = A.medium(r['media']) || A.medium(r['file path']);
        if (r['msg id'] && pfad && !anhang.has(r['msg id'])) anhang.set(r['msg id'], pfad);
      }
      const zeile = (r, quelle, aus, art, gegenueber, absender) => {
        namen.merke(r['thread id'], gegenueber);
        return {
          nachricht_id: quelle + '-' + r['msg id'], unterhaltungs_id: 'Thread ' + r['thread id'], _chat: r['thread id'],
          absender_id: aus ? '' : absender, von_mir: aus === null ? '' : (aus ? '1' : '0'),
          zeitstempel: A.utc(r['date']), nachrichteninhalt: r['body'] || '',
          medienpfad: A.medium(r['media']) || (quelle === 'mms' ? anhang.get(r['msg id']) || '' : ''),
          status: aus ? smsStatus(art) : ''
        };
      };
      const zeilen = [];
      // Die kombinierte Tabelle enthält SMS und MMS schon – sonst doppelt
      if (t.kombiniert.length) {
        for (const r of t.kombiniert) {
          const quelle = /^(pdu|mms)/i.test(r['source table']) ? 'mms' : 'sms';   // MMS stehen in der Tabelle „pdu“
          const aus = smsAusgehend(r['direction']);
          zeilen.push(zeile(r, quelle, aus, r['direction'], r['address'], r['address']));
        }
      } else {
        for (const r of t.sms) {
          const aus = smsAusgehend(r['type']);
          zeilen.push(zeile(r, 'sms', aus, r['type'], r['address'], r['address']));
        }
        for (const r of t.mms) {
          const aus = smsAusgehend(r['direction']);
          zeilen.push(zeile(r, 'mms', aus, r['direction'], aus ? r['to address'] : r['from address'], r['from address']));
        }
        // Ältere Spaltenfolge ohne Richtung: „Ich:" in der Kopfzeile legt die eigene Nummer fest
        for (const r of t.mmsAlt) zeilen.push(zeile(r, 'mms', null, '', '', r['from']));
      }
      for (const z of zeilen) z.chatname = namen.name(z._chat);
      return zeilen;
    }
  });

  /* ---- Google Messages (App-Datenbank bugle_db) ----------------------
     Dieselben SMS/MMS stehen auch in mmssms.db. Liegen beide Tabellen vor,
     gleicht der Kern sie ab (doppeltMit): die Nachrichten aus SMS, die
     Kontaktnamen aus Google Messages, nur hier vorhandene (RCS) kommen dazu. */
  A.einfach({
    app: 'Google Messages', doppeltMit: 'SMS', spalten: ['other participant/conversation name', 'message sender'],
    zeit: r => A.erster(r['message timestamp'], r['message timestamp (utc)']),
    aus: r => A.ausgehend(r['direction']),
    chat: r => [A.erster(r['conversation id'], r['other participant/conversation name']), r['other participant/conversation name']],
    absender: r => r['message sender'], text: r => r['message'],
    typ: r => A.typAusMime(r['message type']), medium: r => A.medium(r['attachment location'])
  });

  /* ---- Weitere Chat-Apps: je eine Nachrichtentabelle ------------------ */
  const richtung = spalte => r => A.ausgehend(r[spalte]);
  const gegenueber = (aus, an, von) => (aus ? an : von);
  const weitere = [
    { app: 'Messenger', spalten: ['thread key', 'sender id', 'is admin message', 'message id'], zeit: 'message timestamp',
      aus: richtung('direction'), chat: (r, aus) => [r['thread key'], aus ? '' : r['sender']], absender: r => r['sender'],
      text: r => A.erster(r['message'], r['call/location information'], r['attachment name'] && '📎 ' + r['attachment name'], r['snippet']),
      id: r => r['message id'] },
    { app: 'Messenger', spalten: ['thread key', 'sender name', 'share link', 'message reaction'], zeit: 'timestamp',
      chat: r => [r['thread key'], r['sender name']], absender: r => r['sender name'],
      text: r => A.erster(r['message'], r['share link'], r['attachment name'] && '📎 ' + r['attachment name'], r['snippet']),
      id: r => r['message id'] },
    { app: 'Instagram', spalten: ['thread id', 'sender username', 'item id', 'thread'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [r['thread id'], r['thread']], absender: r => r['sender username'],
      text: r => A.erster(r['message'], r['media url'] && '📎 Medium'), id: r => r['item id'] },
    { app: 'Discord', spalten: ['channel id', 'username', 'content', 'attachment filename'], zeit: 'timestamp',
      aus: richtung('direction'), chat: (r, aus) => [r['channel id'], aus ? '' : r['username']], absender: r => r['username'],
      text: r => A.erster(r['content'], r['attachment filename'] && '📎 ' + r['attachment filename']), id: r => r['id'] },
    { app: 'Viber', spalten: ['from phone number', 'recipients', 'thread id', 'file attachment'], zeit: 'message date',
      aus: richtung('direction'), chat: (r, aus) => [r['thread id'], gegenueber(aus, r['recipients'], r['from phone number'])],
      absender: r => r['from phone number'], text: r => r['message'], medium: r => A.medium(r['file attachment']) },
    { app: 'Skype', spalten: ['send time', 'from id', 'to id', 'thread id'], zeit: 'send time',
      aus: richtung('direction'), chat: (r, aus) => [r['thread id'], gegenueber(aus, r['to id'], r['from id'])],
      absender: r => r['from id'], text: r => ohneHtml(r['content']), medium: r => A.medium(r['attachment']) },
    { app: 'Teams', spalten: ['user display name', 'topic name', 'conversation id', 'delete time'], zeit: 'timestamp',
      chat: r => [r['conversation id'], r['topic name']], absender: r => r['user display name'],
      text: r => ohneHtml(r['content']), id: r => r['message id'] },
    { app: 'LINE', spalten: ['from id', 'to id', 'thread id', 'android user'], zeit: 'start time',
      aus: richtung('direction'), chat: (r, aus) => [r['thread id'], gegenueber(aus, r['to id'], r['from id'])],
      absender: r => r['from id'], text: r => r['message'], medium: r => A.medium(r['attachment file']) },
    { app: 'Kik', spalten: ['partner jid', 'partner display name', 'chat id', 'message uid'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [A.erster(r['chat id'], r['partner jid']), r['partner display name']],
      absender: r => r['sender'], text: r => A.erster(r['body'], r['system message'], r['status message']),
      medium: r => A.medium(r['attachment']), id: r => r['message uid'] },
    { app: 'WeChat', spalten: ['talker', 'is send', 'content element'], zeit: 'message time',
      aus: r => A.ausgehend(r['is send']) ?? A.ausgehend(r['direction']), chat: r => [r['talker'], r['talker']],
      absender: r => r['talker'], text: r => r['message'],
      medium: r => A.medium(r['attachment file']) || A.medium(r['image path (as stored)']), id: r => r['message id'] },
    { app: 'Snapchat', spalten: ['client message id', 'server message id', 'conversation participants', 'message direction'],
      zeit: 'creation timestamp', aus: richtung('message direction'),
      chat: r => [r['conversation id'], r['conversation participants']],
      absender: r => A.erster(r['sender display name'], r['sender username']), text: r => r['message text'],
      medium: r => A.medium(r['media']), id: r => r['client message id'] },
    { app: 'Snapchat', spalten: ['seen timestamp', 'sender username', 'sender display name', 'text'], zeit: 'creation timestamp',
      chat: r => [r['sender username'], A.erster(r['sender display name'], r['sender username'])],
      absender: r => A.erster(r['sender display name'], r['sender username']), text: r => r['text'] },
    { app: 'TikTok', spalten: ['nickname', 'unique id', 'conversation id', 'link gif url'], zeit: 'timestamp',
      aus: richtung('direction'), chat: (r, aus) => [r['conversation id'], aus ? '' : r['nickname']],
      absender: r => r['nickname'], text: r => A.erster(r['message'], r['link gif name']) },
    { app: 'Tinder', spalten: ['matched person', 'match id', 'gif description (as stored)'], zeit: 'sent timestamp',
      aus: richtung('direction'), chat: r => [r['match id'], r['matched person']], absender: r => r['sender name'],
      text: r => A.erster(r['message'], r['gif description (as stored)']), id: r => r['message id'] },
    { app: 'Bumble', spalten: ['message text', 'recipient name', 'conversation id', 'message url'], zeit: 'created timestamp',
      aus: richtung('message direction'), chat: (r, aus) => [r['conversation id'], gegenueber(aus, r['recipient name'], r['sender name'])],
      absender: r => r['sender name'], text: r => A.erster(r['message text'], r['message url']), id: r => r['message id'] },
    { app: 'Badoo', spalten: ['conversation with', 'sender id', 'recipient id'], zeit: 'timestamp',
      chat: r => [r['conversation with'], r['conversation with']], absender: r => r['sender id'], text: r => r['message'] },
    { app: 'Zangi', spalten: ['from me', 'chat-id', 'message-id'], zeit: 'timestamp',
      aus: richtung('from me'), chat: r => [r['chat-id'], r['chat']], absender: r => r['sender name'],
      text: r => r['message'], medium: r => A.medium(r['attachment file']), id: r => r['message-id'] },
    { app: 'TextNow', spalten: ['send timestamp', 'from id', 'to id', 'thread id'], zeit: 'send timestamp',
      aus: richtung('direction'), chat: (r, aus) => [r['thread id'], gegenueber(aus, r['to id'], r['from id'])],
      absender: r => r['from id'], text: r => r['message'], medium: r => A.medium(r['attachment']) },
    { app: 'Google Chat', spalten: ['group name', 'meeting code', 'group id'], zeit: 'message timestamp',
      aus: richtung('direction'), chat: r => [r['group id'], r['group name']], absender: r => r['sender'],
      text: r => A.erster(r['message'], r['filename'] && '📎 ' + r['filename'], r['meeting url']) },
    { app: 'Google Voice', spalten: ['account number', 'conversation id', 'recipient(s)'], zeit: 'timestamp',
      aus: richtung('direction'), chat: (r, aus) => [r['conversation id'], gegenueber(aus, r['recipient(s)'], r['sender'])],
      absender: r => r['sender'], text: r => r['message'], medium: r => A.medium(r['image']) },
    { app: 'imo', spalten: ['chat partner', 'last message', 'from id', 'to id'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [r['chat partner'], r['chat partner']], absender: r => r['chat partner'],
      text: r => r['last message'], medium: r => A.medium(r['attachment']) },
    { app: 'MeWe', spalten: ['thread name', 'thread id', 'chat type', 'attachment name'], zeit: 'timestamp',
      aus: richtung('message direction'), chat: r => [r['thread id'], r['thread name']], absender: r => r['user name'],
      text: r => A.erster(r['message text'], r['attachment name'] && '📎 ' + r['attachment name']) },
    { app: 'Wire', spalten: ['date / time sent', 'message content', 'asset name'], zeit: 'date / time sent',
      chat: () => ['wire', 'Wire'], absender: r => r['user name'],
      text: r => A.erster(r['message content'], r['asset name'] && '📎 ' + r['asset name']), id: r => r['message id'] },
    { app: 'SimpleX', spalten: ['chat item id', 'quoted content (as stored)'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [A.erster(r['group id'] && 'gruppe-' + r['group id'], r['contact']), r['contact']],
      absender: r => r['sender'], text: r => r['message'], id: r => r['chat item id'] },
    { app: 'Bluesky', spalten: ['timestamp sent', 'handle', 'display name', 'message id'], zeit: 'timestamp sent',
      chat: () => ['bluesky', 'Bluesky'], absender: r => A.erster(r['display name'], r['handle']),
      text: r => r['message'], id: r => r['message id'] },
    { app: 'Burner', spalten: ['contact', 'message text', 'read status'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [r['contact'], r['contact']], absender: r => r['contact'], text: r => r['message text'] },
    { app: 'MeetMe', spalten: ['sent by', 'message text', 'attachment path', 'thread id'], zeit: 'timestamp',
      chat: r => [r['thread id'], name(r['first name'], r['last name'])], absender: r => r['sent by'],
      text: r => r['message text'], medium: r => A.medium(r['attachment path']) },
    { app: 'RandoChat', spalten: ['contact username', 'sent?', 'media file', 'conversation id'], zeit: 'timestamp',
      aus: richtung('sent?'), chat: r => [r['conversation id'], r['contact username']], absender: r => r['contact username'],
      text: r => r['content'], medium: r => A.medium(r['media file']), id: r => r['message id'] },
    { app: 'Tango', spalten: ['create time', 'direction', 'message'], zeit: 'create time',
      aus: richtung('direction'), chat: () => ['tango', 'Tango'], text: r => r['message'] },
    { app: 'Kijiji', spalten: ['ad title', 'ad id', 'sender name', 'recipient name'], zeit: 'date sent',
      chat: r => [r['conversation id'], r['ad title']], absender: r => r['sender name'], text: r => r['message'], id: r => r['message id'] },
    { app: 'RCS (LG)', spalten: ['is file?', 'thumb file path', 'file xml path'], zeit: 'date',
      chat: r => [r['thread id'], r['address']], absender: r => r['address'], text: r => r['body'], medium: r => A.medium(r['file path']) },
    { app: 'SMS', spalten: ['backup file', 'contact name (as stored)', 'readable date (as stored)'], zeit: 'timestamp',
      aus: richtung('direction'), chat: r => [r['number'], A.erster(r['contact name (as stored)'], r['number'])],
      absender: r => A.erster(r['contact name (as stored)'], r['number']), text: r => r['message'] },
    { app: 'SMS', spalten: ['date sent', 'direction', 'address', 'body', 'recipients', 'status'], zeit: 'date',
      aus: r => smsAusgehend(r['direction']) ?? smsAusgehend(r['type']), chat: r => [r['address'], r['address']],
      absender: r => r['address'], text: r => r['body'] },
    { app: 'SMS', spalten: ['message box', 'mms addresses', 'transaction id'], zeit: 'date',
      aus: r => (r['message box'] === '2' ? true : r['message box'] === '1' ? false : null),
      chat: r => [r['recipients'], r['recipients']], absender: r => r['recipients'], text: r => A.erster(r['body'], r['subject']) },
    { app: 'Sideline', spalten: ['first name', 'last name', 'method', 'duration'], zeit: 'timestamp (utc)',
      chat: r => [r['phone number'], name(r['first name'], r['last name'])], absender: r => name(r['first name'], r['last name']),
      text: r => A.erster(r['message text'], r['method'] && r['method'] + (r['duration'] ? ' · ' + r['duration'] : '')) },
    { app: 'Slack', spalten: ['thread parent timestamp', 'conversation kind', 'sender user id'], zeit: 'timestamp',
      chat: r => [r['conversation id'], r['conversation']], absender: r => A.erster(r['sender name'], r['sender user id']),
      text: r => A.erster(r['message'], r['attachment names'] && '📎 ' + r['attachment names']), medium: r => A.medium(r['attachment']) },
    { app: 'Chess.com', spalten: ['sent', 'conversation', 'sender', 'message'], zeit: 'sent',
      chat: r => [r['conversation'], r['conversation']], absender: r => r['sender'], text: r => r['message'] },
    { app: 'DeepSeek', spalten: ['chat table', 'role', 'message content'], zeit: 'timestamp',
      aus: r => (/^user$/i.test(r['role']) ? true : /^(assistant|system)$/i.test(r['role']) ? false : null),
      chat: r => [r['chat table'], 'DeepSeek ' + r['chat table']], absender: () => 'DeepSeek', text: r => r['message content'] }
  ];
  for (const d of weitere) A.einfach(d);
})();
