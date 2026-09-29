/* Suche über Nachrichten – und über alles, was an ihnen hängt.

   Durchsucht werden:
     Nachrichtentext · Absender · Medienpfad
     🌐 Übersetzungen  (Translate)
     🎤 Transkripte    (Transcribe)
     📄 Dokumentinhalt (Documents: PDF, Office, Text, JSON, XML …)

   Damit findet die Suche auch Wörter, die nur im Anhang stehen, ohne dass
   man ihn geöffnet haben muss – die Inhalte werden beim Import im
   Hintergrund ausgelesen (siehe bedienung/dokumente.js). */
(function (global) {
  'use strict';

  const norm = Textformat.norm;

  /**
   * Passt die Nachricht zum Suchbegriff?
   * @param {object} m Nachricht
   * @param {string} q Suchbegriff, bereits kleingeschrieben
   */
  function passt(m, q) {
    if (!q) return false;
    if (norm(m.text).indexOf(q) !== -1 ||
        norm(m.sender).indexOf(q) !== -1 ||
        (m.senderName && norm(m.senderName).indexOf(q) !== -1) ||
        norm(m.media).indexOf(q) !== -1) return true;

    const tr = Translate.get(m.key);
    if (tr && tr.t && norm(tr.t).indexOf(q) !== -1) return true;

    const sc = window.Transcribe && Transcribe.text(m.key);
    if (sc && norm(sc).indexOf(q) !== -1) return true;

    const dok = m.media && window.Documents && Documents.text(m.media);
    return !!(dok && norm(dok).indexOf(q) !== -1);
  }

  /**
   * Umgebung des Treffers zeigen – damit sichtbar wird, dass er im Dokument
   * oder im Transkript steckt und nicht im Nachrichtentext.
   * @returns {?string} Auszug mit vorangestelltem Symbol, oder null, wenn der
   *                    Treffer im Nachrichtentext selbst liegt.
   */
  function auszug(m, q) {
    const kontext = (quelle, symbol) => {
      const i = norm(quelle).indexOf(q);
      if (i === -1) return null;
      const von = Math.max(0, i - 28);
      const bis = i + q.length + 60;
      const text = quelle.slice(von, bis).replace(/\s+/g, ' ').trim();
      return symbol + ' ' + (von > 0 ? '…' : '') + text + (bis < quelle.length ? '…' : '');
    };

    if (norm(m.text).indexOf(q) !== -1) return null;          // steht im Text selbst

    const tr = Translate.get(m.key);
    if (tr && tr.t && norm(tr.t).indexOf(q) !== -1) return kontext(tr.t, '🌐');

    const sc = window.Transcribe && Transcribe.text(m.key);
    if (sc) { const k = kontext(sc, '🎤'); if (k) return k; }

    const dok = m.media && window.Documents && Documents.text(m.media);
    if (dok) { const k = kontext(dok, '📄'); if (k) return k; }

    return null;
  }

  const TYP_SYMBOL = {
    bild: '🖼️ ', video: '🎬 ', audio: '🎤 ', datei: '📎 ',
    standort: '📍 ', kontakt: '👤 ', umfrage: '📊 ', anruf: '📞 '
  };
  const TYP_NAME = {
    bild: 'Bild', video: 'Video', audio: 'Sprachnachricht', datei: 'Datei',
    standort: 'Standort', kontakt: 'Kontakt', umfrage: 'Umfrage', anruf: 'Anruf'
  };

  /** Einzeilige Zusammenfassung einer Nachricht (Chatliste, Antwortzitat). */
  function vorschauText(m) {
    if (!m) return 'Keine Nachrichten';
    if (m.reactionTo && window.Emoji) return 'Reaktion ' + Emoji.reaktion(m.text);
    if (m.type === 'anruf') {
      const a = Model.anruf(m);
      return (m.video ? '🎥 ' : '📞 ') + a.art + ' ' + a.richtung + (a.info ? ' · ' + a.info : '');
    }
    const symbol = TYP_SYMBOL[m.type] || '';
    const transkript = window.Transcribe ? Transcribe.text(m.key) : '';
    const t = (m.text || transkript || '').replace(/\s+/g, ' ').trim();
    if (t) return symbol + t;
    if (symbol) return symbol + (TYP_NAME[m.type] || 'Anhang');
    if (m.deleted) return '🚫 Nachricht gelöscht';
    return m.type === 'system' ? 'Systemnachricht' : '(leer)';
  }

  global.Suchtreffer = { passt: passt, auszug: auszug, vorschauText: vorschauText };
})(window);
