/* Kurze Rückmeldungen am unteren Bildschirmrand („Toast").
   Eine Meldung nach der anderen; eine neue löst die vorherige ab. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  let timer = null;

  /**
   * Meldung anzeigen.
   * @param {string} html  Text (HTML erlaubt, Inhalte vorher mit Helfer.esc entschärfen)
   * @param {string} [art] 'ok' | 'warn' | 'error' – färbt den Balken links
   */
  function zeige(html, art) {
    const el = $('#toast');
    if (!el) return;
    el.className = 'toast show' + (art ? ' ' + art : '');
    el.innerHTML = html;
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  /** Meldung sofort ausblenden. */
  function verbergen() {
    const el = $('#toast');
    if (el) el.classList.remove('show');
    clearTimeout(timer);
  }

  global.Meldung = { zeige: zeige, verbergen: verbergen };
})(window);
