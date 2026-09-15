/* Kleine Helfer, die überall gebraucht werden.
   Bewusst ohne Abhängigkeiten – dieses Modul wird als erstes geladen. */
(function (global) {
  'use strict';

  /* ---- DOM ---------------------------------------------------------- */

  /** Erstes passendes Element (wie querySelector, nur kürzer). */
  function $(auswahl, wurzel) { return (wurzel || document).querySelector(auswahl); }

  /** Alle passenden Elemente als echtes Array. */
  function $$(auswahl, wurzel) { return Array.from((wurzel || document).querySelectorAll(auswahl)); }

  /** Text so entschärfen, dass er gefahrlos in HTML eingesetzt werden kann. */
  function esc(wert) {
    return String(wert == null ? '' : wert)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Wert für ein Attribut-Suchmuster wie [data-key="…"] absichern. */
  function cssAttr(wert) { return String(wert).replace(/"/g, '\\"'); }

  /** Aus einem Pfad nur den Dateinamen. */
  function dateiname(pfad) { return String(pfad || '').split(/[\\/]/).pop(); }

  /* ---- Zeit und Ablauf ---------------------------------------------- */

  /** Funktion erst ausführen, wenn eine Weile Ruhe war (z. B. Sucheingaben). */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  /**
   * Versprechen mit Zeitlimit. Hängende Browser-Schnittstellen sollen die
   * Oberfläche nicht blockieren – lieber eine klare Fehlermeldung.
   */
  function withTimeout(promise, ms, bezeichnung) {
    let t;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(t)),
      new Promise((_, ablehnen) => {
        t = setTimeout(() => ablehnen(new Error('Zeitüberschreitung: ' + bezeichnung)), ms);
      })
    ]);
  }

  /* ---- Dateien ------------------------------------------------------ */

  /** Inhalt als Datei herunterladen (rein im Browser, ohne Server). */
  function download(name, inhalt, mime) {
    const blob = new Blob([inhalt], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Textdatei einlesen (FileReader als Versprechen). */
  function leseTextdatei(file) {
    return new Promise((erfuellen, ablehnen) => {
      const fr = new FileReader();
      fr.onload = () => erfuellen(String(fr.result || ''));
      fr.onerror = () => ablehnen(fr.error);
      fr.readAsText(file, 'utf-8');
    });
  }

  /**
   * Pfad aus der CSV in eine ladbare Adresse verwandeln.
   * Nur relative Pfade lassen sich direkt vom lokalen Server holen;
   * absolute Pfade (C:\…, /…, http://…) brauchen den Medienordner.
   * @returns {?string} URL oder null
   */
  function direkteURL(pfad) {
    const p = String(pfad || '').replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(p) || p.startsWith('/') || /^[a-z]+:/i.test(p)) return null;
    return encodeURI(p);
  }

  /** Bytes lesbar machen: 1.234.567 → „1,2 MB". */
  function mengeMB(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0); }

  global.Helfer = {
    $: $, $$: $$, esc: esc, cssAttr: cssAttr, dateiname: dateiname,
    debounce: debounce, withTimeout: withTimeout,
    download: download, leseTextdatei: leseTextdatei, mengeMB: mengeMB,
    direkteURL: direkteURL
  };
})(window);
