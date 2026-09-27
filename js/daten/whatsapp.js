/* WhatsApp-Textexporte von Android und iPhone, ohne Netz und ohne Bibliothek.
   Der Export enthält keine Nachrichten-IDs: Inhalt + Zeitpunkt + Vorkommen
   ergeben deshalb stabile IDs innerhalb eines vom Nutzer benannten Chats. */
(function (global) {
  'use strict';

  const DATUM = '(\\d{1,4}[./-]\\d{1,2}[./-]\\d{2,4})';
  const ZEIT = '(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[ap]\\.?\\s*m\\.?)?)';
  const IOS = new RegExp('^\\[' + DATUM + ',?\\s+' + ZEIT + '\\]\\s*(.*)$', 'i');
  const ANDROID = new RegExp('^' + DATUM + ',?\\s+' + ZEIT + '\\s+[-–]\\s+(.*)$', 'i');

  function sauber(text) {
    return String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[\u00a0\u202f]/g, ' ');
  }

  function kopf(line) { return line.match(IOS) || line.match(ANDROID); }

  function inspect(text) {
    const lines = sauber(text).split('\n');
    const first = lines.find(line => line.trim());
    if (!first || !kopf(first)) return null;
    const records = [];
    for (const line of lines) {
      const hit = kopf(line);
      if (hit) records.push({ date: hit[1], time: hit[2], body: hit[3] });
      else if (records.length) records[records.length - 1].body += '\n' + line;
    }
    let dmy = false, mdy = false;
    for (const r of records) {
      const p = r.date.split(/[./-]/);
      if (p[0].length === 4) continue;
      if (+p[0] > 12 || r.date.includes('.')) dmy = true;
      if (+p[1] > 12) mdy = true;
    }
    if (dmy && mdy) throw new Error('Widersprüchliche Datumsformate im WhatsApp-Export.');
    const onlyISO = records.every(r => /^\d{4}[./-]/.test(r.date));
    return { records, dateOrder: mdy ? 'mdy' : 'dmy', ambiguous: !dmy && !mdy && !onlyISO };
  }

  function timestamp(date, time, order) {
    const parts = date.split(/[./-]/);
    let year, month, day;
    if (parts[0].length === 4) [year, month, day] = parts.map(Number);
    else {
      year = +parts[2];
      if (year < 100) year += year < 70 ? 2000 : 1900;
      [day, month] = order === 'mdy' ? [+parts[1], +parts[0]] : [+parts[0], +parts[1]];
    }
    const t = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?/i);
    let hour = +t[1];
    const minute = +t[2], second = +(t[3] || 0);
    if (t[4]) {
      if (hour < 1 || hour > 12) throw new Error('Ungültige Uhrzeit: ' + time);
      hour = hour % 12 + (t[4].toLowerCase() === 'p' ? 12 : 0);
    }
    const value = new Date(year, month - 1, day, hour, minute, second);
    if (hour > 23 || minute > 59 || second > 59 || value.getFullYear() !== year ||
        value.getMonth() !== month - 1 || value.getDate() !== day) {
      throw new Error('Ungültiges Datum: ' + date + ' ' + time + ' – Datumsformat prüfen.');
    }
    return value.getTime();
  }

  // Zwei unabhängige 32-Bit-Akkumulatoren; nur ASCII in den erzeugten DOM-IDs.
  function fingerprint(value) {
    let a = 2166136261, b = 3339675911;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  function chatName(path) {
    const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    let name = (parts.pop() || '').replace(/\.(txt|zip)$/i, '');
    if (/^_?chat$/i.test(name)) name = parts.pop() || 'WhatsApp-Chat';
    return name.replace(/^WhatsApp[ -]+Chat(?:\s+(?:mit|with))?\s*[-:]?\s*/i, '').trim() || 'WhatsApp-Chat';
  }

  function attachment(body) {
    const lines = body.split('\n');
    const first = lines[0].trim();
    const ios = first.match(/^<(?:attached|Anhang|angehängt):\s*(.+?)>\s*(.*)$/i);
    const android = first.match(/^(.+?)\s*\((?:file attached|Datei angehängt|Datei im Anhang|attached)\)\s*(.*)$/i);
    const hit = ios || android;
    if (!hit) return { text: body, media: '', type: 'text' };
    const media = hit[1].trim();
    return { media, text: [hit[2], ...lines.slice(1)].join('\n').trim(), type: Media.kindOf('', media) };
  }

  function parse(info, options) {
    const name = options.name.trim();
    if (!name) throw new Error('Bitte einen Chatnamen angeben.');
    const conv = 'WhatsApp-Export: ' + name;
    const convKey = 'whatsapp::' + conv;
    const namespace = fingerprint(conv);
    const occurrences = new Map();
    return info.records.map((r, sourceOrder) => {
      const ts = timestamp(r.date, r.time, options.dateOrder || info.dateOrder);
      const split = r.body.indexOf(': ');
      const sender = split >= 0 && !r.body.slice(0, split).includes('\n')
        ? r.body.slice(0, split).trim() : '';
      const body = (sender ? r.body.slice(split + 2) : r.body).trimEnd();
      const data = sender ? attachment(body) : { text: body, media: '', type: 'system' };
      const signature = fingerprint(JSON.stringify([ts, sender, body]));
      const occurrence = (occurrences.get(signature) || 0) + 1;
      occurrences.set(signature, occurrence);
      const id = 'wa-export-' + namespace + '-' + signature + '-' + occurrence;
      const media = data.media && options.directory ? options.directory + '/' + data.media : data.media;
      return { key: 'whatsapp::' + id, id, messenger: 'whatsapp', conv, convKey, ts, sourceOrder,
        tsRaw: r.date + ' ' + r.time, sender: sender || 'system', text: data.text,
        type: data.type, media, replyTo: '', reactionTo: '', status: '' };
    });
  }

  global.WhatsApp = { inspect, parse, chatName, fingerprint };
})(window);
