/* Textaufbereitung für die Darstellung: entschärfen, hervorheben, verlinken.

   Reine Textfunktionen ohne Zugriff auf Daten oder DOM – dadurch überall
   gefahrlos einsetzbar und leicht zu testen. */
(function (global) {
  'use strict';

  const esc = Helfer.esc;

  /** Kleinschreibung für Vergleiche (null-sicher). */
  function norm(s) { return String(s || '').toLowerCase(); }

  /** Sonderzeichen für einen regulären Ausdruck maskieren. */
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * Suchbegriff im bereits entschärften HTML markieren.
   * @param {string} entschaerft Ergebnis von Helfer.esc
   * @param {string} q           Suchbegriff (Rohtext)
   */
  function hervorheben(entschaerft, q) {
    if (!q) return entschaerft;
    const nadel = escRegex(esc(q));
    try {
      return entschaerft.replace(new RegExp(nadel, 'gi'), t => '<mark>' + t + '</mark>');
    } catch (e) {
      return entschaerft;    // unglücklicher Begriff – dann eben ohne Markierung
    }
  }

  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}"'])/gi;

  /** Webadressen im Text anklickbar machen. */
  function verlinken(entschaerft) {
    return entschaerft.replace(URL_RE, url => {
      const ziel = url.toLowerCase().indexOf('http') === 0 ? url : 'https://' + url;
      return '<a href="' + ziel + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }

  /**
   * Nachrichtentext für die Sprechblase aufbereiten.
   * Mit Suchbegriff wird markiert, ohne Suchbegriff werden Links gesetzt –
   * beides zusammen würde sich ins Gehege kommen.
   */
  function formatiere(text, q) {
    let out = esc(text);
    out = q ? hervorheben(out, q) : verlinken(out);
    return out.replace(/\n/g, '<br>');
  }

  /* Nur Emoji (und Verbinder/Leerzeichen): wird größer dargestellt. */
  const NUR_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+$/u;

  /** Besteht die Nachricht ausschließlich aus ein paar Emoji? */
  function istNurEmoji(text) {
    const t = String(text || '').trim();
    return !!t && t.length <= 12 && NUR_EMOJI.test(t);
  }

  /** Kurze Leseprobe aus einem längeren Text (eine Zeile). */
  function leseprobe(text, laenge) {
    const max = laenge || 110;
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  /** Beliebigen Schlüssel in eine gültige HTML-id verwandeln. */
  function cssId(key) { return String(key).replace(/[^a-zA-Z0-9_-]/g, '_'); }

  global.Textformat = {
    norm: norm, hervorheben: hervorheben, verlinken: verlinken,
    formatiere: formatiere, istNurEmoji: istNurEmoji,
    leseprobe: leseprobe, cssId: cssId
  };
})(window);
