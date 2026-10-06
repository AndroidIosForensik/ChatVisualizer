/* Reaktionen, die als Kurzname statt als Emoji exportiert wurden, wieder als Emoji zeigen.

   Je nach Werkzeug steht in der Reaktionsspalte nicht „💜", sondern
   „(purple_heart)", „:purple_heart:", „purple heart", „(like)" oder
   „:+1::skin-tone-3:". Emoji.ausName erkennt diese Schreibweisen und liefert
   das Emoji; der Rohwert bleibt in den Daten unverändert (Tooltip/Bericht).

   Tabelle: daten/emoji-namen.js (aus gemoji erzeugt). */
(function (global) {
  'use strict';

  /* Reaktionsnamen aus Teams, Skype und Facebook, die gemoji nicht kennt */
  const ZUSATZ = {
    like: '👍', dislike: '👎', yes: '👍', no: '👎', love: '❤️', care: '🥰',
    laugh: '😆', haha: '😆', lol: '😂', wow: '😮', surprised: '😮', sad: '😢',
    angry: '😠', kiss: '😘', happy: '😊', thanks: '🙏'
  };

  /* Hautfarben: gemoji „_tone1"…„_tone5", Slack „::skin-tone-2"…„::skin-tone-6" */
  const TOENE = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

  let tabelle = null;

  function laden() {
    if (tabelle) return tabelle;
    tabelle = new Map();
    for (const zeile of String(global.EmojiNamenDaten || '').split('\n')) {
      const i = zeile.indexOf(' ');
      if (i > 0) tabelle.set(zeile.slice(0, i), zeile.slice(i + 1));
    }
    for (const k of Object.keys(ZUSATZ)) if (!tabelle.has(k)) tabelle.set(k, ZUSATZ[k]);
    return tabelle;
  }

  /** Vergleichsform eines Namens – muss zu werkzeuge/erzeuge-emoji-namen.py passen. */
  function schluessel(name) {
    return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /**
   * Emoji zu einem Kurznamen, sonst null (dann ist der Text kein Kurzname).
   * @param {string} text z. B. „(purple_heart)", „:thumbsup_tone3:", „purple heart"
   */
  function ausName(text) {
    let s = String(text || '').trim();
    if (!s || s.length > 60 || /[^\x20-\x7E]/.test(s)) return null;    // schon Emoji o. Ä.
    // Klammern bzw. Doppelpunkte außen weg: „(x)", „:x:", „[x]"
    const m = s.match(/^[(:[]\s*(.+?)\s*[):\]]$/);
    if (m) s = m[1];
    let ton = -1;
    const t = s.match(/(?:::?|_|-|\s)(skin[_ -]?tone|tone)[_ -]?([1-6])$/i);
    if (t) {
      ton = /skin/i.test(t[1]) ? +t[2] - 2 : +t[2] - 1;
      s = s.slice(0, t.index);
    }
    const emoji = laden().get(schluessel(s));
    if (!emoji) return null;
    if (ton < 0 || ton > 4) return emoji;
    return emoji.replace(/️/g, '') + TOENE[ton];
  }

  /** Anzeigeform einer Reaktion: Emoji, wenn der Text ein Kurzname ist, sonst der Text. */
  function reaktion(text) {
    const roh = String(text || '').trim();
    return ausName(roh) || roh || '❤️';
  }

  global.Emoji = { ausName, reaktion, schluessel };
})(window);
