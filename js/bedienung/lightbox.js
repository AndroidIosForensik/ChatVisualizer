/* Großansicht: Bilder, Videos, PDF-Seiten und Textdokumente.

   Drei Betriebsarten im selben Fenster:
     Galerie  – Bilder/Videos des Chats, ← → blättert zwischen ihnen
     PDF      – seitenweise, ← → blättert Seiten
     Text     – ausgelesener Inhalt eines Dokuments zum Lesen */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;
  const M = Model;
  const state = M.state;

  /* Aktueller Inhalt: Galerieliste mit Position, oder ein PDF mit Seitenstand */
  const stand = { liste: [], i: 0, pdf: null };
  let galerieVersion = 0;

  function oeffneRahmen() { $('#lightbox').classList.add('show'); }

  /* ---- Galerie -------------------------------------------------------- */

  /** Alle anzeigbaren Bilder und Videos einer Unterhaltung. */
  function galerie(conv) {
    return conv.media.filter(m => {
      const art = Medienansicht.artVon(m);
      return (art === 'bild' || art === 'animation' || art === 'video') &&
             (Media.lookup(Media.ref(m)) || Medienansicht.direkteURL(m.media));
    });
  }

  /** Das aktuelle Element der Galerie anzeigen. */
  async function zeigeGalerie() {
    const m = stand.liste[stand.i];
    if (!m) return;
    const version = ++galerieVersion;

    const art = Medienansicht.artVon(m);
    const url = await Media.getDisplayURL(Media.ref(m));
    if (version !== galerieVersion) return;
    const name = Helfer.dateiname(m.media);

    $('#lbStage').innerHTML = url ? Medienansicht.visualHTML(art, m.media, url, name)
      : '<p class="lb-laden">Datei nicht gefunden – Medienordner verbinden.</p>';
    Medienansicht.startAnimation($('#lbStage'));

    $('#lbCaption').innerHTML = '<b>' + esc(name) + '</b> · ' + esc(M.absenderName(m)) +
      (m.ts ? ' · ' + esc(M.DT_FULL.format(new Date(m.ts))) : '') +
      '<span class="lb-count">' + (stand.i + 1) + ' / ' + stand.liste.length + '</span>';

    oeffneRahmen();
  }

  /** Galerie beim angeklickten Bild öffnen. */
  function oeffnen(key) {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    stand.pdf = null;
    stand.liste = galerie(conv);
    if (!stand.liste.length) return;
    stand.i = Math.max(0, stand.liste.findIndex(m => m.key === key));
    zeigeGalerie();
  }

  /* ---- PDF ------------------------------------------------------------ */

  /** Die eingestellte Seite des geöffneten PDFs zeichnen. */
  async function zeigePdfSeite() {
    if (!stand.pdf) return;
    const buehne = $('#lbStage');
    const breite = Math.min(900, Math.round(window.innerWidth * 0.8));
    const name = Helfer.dateiname(pfadText(stand.pdf.pfad));

    try {
      const { canvas, seiten } = await Documents.renderPage(stand.pdf.pfad, stand.pdf.seite, breite);
      stand.pdf.seiten = seiten;
      canvas.className = 'lb-pdf';
      buehne.innerHTML = '';
      buehne.appendChild(canvas);
      $('#lbCaption').innerHTML = '<b>' + esc(name) + '</b>' +
        '<span class="lb-count">Seite ' + stand.pdf.seite + ' von ' + seiten + '</span>';
    } catch (e) {
      buehne.innerHTML = '';
      $('#lbCaption').innerHTML = '<b>' + esc(name) + '</b><span class="lb-count">' +
        esc(e.message || 'PDF konnte nicht angezeigt werden') + '</span>';
    }
  }

  /* Pfad oder Referenz {media, quelle} → Pfad für die Anzeige */
  const pfadText = x => (x && typeof x === 'object' ? x.media : x) || '';

  /** Ein PDF in der Großansicht öffnen. */
  async function pdfOeffnen(pfad) {
    galerieVersion++;
    stand.pdf = { pfad: pfad, seite: 1, seiten: 0 };
    stand.liste = [];
    oeffneRahmen();
    $('#lbStage').innerHTML = '<div class="lb-laden">Seite wird aufgebaut…</div>';
    await zeigePdfSeite();
  }

  /* ---- Textdokument --------------------------------------------------- */

  /** Den ausgelesenen Text eines Dokuments im Großformat lesen. */
  async function textOeffnen(pfad) {
    galerieVersion++;
    stand.pdf = null;
    stand.liste = [];
    oeffneRahmen();
    const buehne = $('#lbStage');
    buehne.innerHTML = '<div class="lb-laden">Wird gelesen…</div>';
    const name = Helfer.dateiname(pfadText(pfad));

    try {
      const info = await Documents.extract(pfad);
      buehne.innerHTML = '<pre class="lb-text"></pre>';
      $('.lb-text', buehne).textContent = info.t || '(kein Text gefunden)';
      $('#lbCaption').innerHTML = '<b>' + esc(name) + '</b><span class="lb-count">' +
        (info.t ? info.t.length.toLocaleString('de-DE') + ' Zeichen' : 'kein Text') +
        (info.gekuerzt ? ' · gekürzt' : '') + '</span>';
    } catch (e) {
      buehne.innerHTML = '';
      $('#lbCaption').innerHTML = '<b>' + esc(name) + '</b><span class="lb-count">' +
        esc(e.message || 'Datei konnte nicht gelesen werden') + '</span>';
    }
  }

  /* ---- Steuerung ------------------------------------------------------ */

  function schliessen() {
    galerieVersion++;
    $('#lightbox').classList.remove('show');
    $('#lbStage').innerHTML = '';     // Video anhalten, Speicher freigeben
    stand.pdf = null;
  }

  function istOffen() { return $('#lightbox').classList.contains('show'); }

  /** Einen Schritt weiter: im PDF eine Seite, sonst das nächste Bild. */
  function blaettern(richtung) {
    if (stand.pdf) {
      const neu = stand.pdf.seite + richtung;
      if (neu < 1 || (stand.pdf.seiten && neu > stand.pdf.seiten)) return;
      stand.pdf.seite = neu;
      zeigePdfSeite();
      return;
    }
    if (!stand.liste.length) return;
    stand.i = (stand.i + richtung + stand.liste.length) % stand.liste.length;
    zeigeGalerie();
  }

  function verdrahten() {
    $('#lightbox').addEventListener('click', e => {
      if (e.target.closest('[data-lb-close]') || e.target.id === 'lightbox') { schliessen(); return; }
      if (e.target.closest('[data-lb-prev]')) blaettern(-1);
      if (e.target.closest('[data-lb-next]')) blaettern(1);
    });
  }

  global.Lightbox = {
    oeffnen: oeffnen, pdfOeffnen: pdfOeffnen, textOeffnen: textOeffnen,
    schliessen: schliessen, blaettern: blaettern, istOffen: istOffen,
    verdrahten: verdrahten
  };
})(window);
