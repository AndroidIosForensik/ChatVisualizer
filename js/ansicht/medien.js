/* Medien in der Sprechblase: Bild, Video, Ton, PDF, Dokument.

   Ablauf in zwei Schritten:
   1. Beim Zeichnen des Chats entsteht nur eine Platzhalter-Kachel
      (mediaHTML) – das geht schnell, auch bei tausenden Nachrichten.
   2. Kommt die Kachel ins Blickfeld, wird sie „belebt" (hydrateNode):
      erst dann werden Datei-URLs geholt, PDF-Vorschauen gerendert und
      Dokumente ausgelesen. Das spart Speicher und Rechenzeit.

   Kachel ohne auffindbare Datei bleibt als Pfadangabe stehen („unresolved"),
   damit nachvollziehbar ist, welche Datei fehlt. */
(function (global) {
  'use strict';

  const esc = Helfer.esc;
  const M = Model;
  const state = M.state;

  /* Symbole nach Nachrichtentyp bzw. nach erkannter Dateiart */
  const TYP_SYMBOL = {
    bild: '🖼️', video: '🎬', audio: '🎤', datei: '📎',
    standort: '📍', kontakt: '👤', umfrage: '📊', anruf: '📞'
  };
  const ART_SYMBOL = { bild: '🖼️', video: '🎬', audio: '🎤', datei: '📎', pdf: '📄', doc: '📝' };

  /** Dateiart einer Nachricht: Medienart oder – bei Dokumenten – 'pdf'/'doc'. */
  function artVon(m) {
    let art = Media.kindOf(m.type, m.media);
    if (window.Documents && Documents.isDocument(m.media)) {
      art = Documents.isPdf(m.media) ? 'pdf' : 'doc';
    }
    return art;
  }

  /** Innenleben der Platzhalter-Kachel (Symbol, Name, Pfad) – Werte bereits entschärft. */
  function kachelInhalt(art, name, pfad, m) {
    return '<span class="mf-icon">' + (ART_SYMBOL[art] || TYP_SYMBOL[m ? m.type : ''] || '📎') + '</span>' +
      '<span class="mf-body"><span class="mf-name">' + name + '</span>' +
      '<span class="mf-path" title="' + pfad + '">' + pfad + '</span></span>';
  }

  /** HTML der Medienkachel einer Nachricht (noch ohne Inhalt – siehe hydrateNode). */
  function medienHTML(m) {
    if (!m.media) return '';
    const art = artVon(m);
    const name = esc(Helfer.dateiname(m.media));
    const pfad = esc(m.media);
    return '<div class="media media-chip" data-media="' + pfad + '" data-kind="' + art + '" data-key="' + esc(m.key) + '">' +
      kachelInhalt(art, name, pfad, m) + '</div>';
  }

  /* Pfad → ladbare Adresse; liegt in kern/helfer.js, weil auch die
     Datenmodule sie brauchen. */
  const direkteURL = Helfer.direkteURL;

  /** Zurück zur Platzhalter-Kachel, wenn das Laden scheitert. */
  function zurueckZurKachel(el) {
    const pfad = el.dataset.media;
    el.className = 'media media-chip unresolved';
    el.innerHTML = kachelInhalt(el.dataset.kind, esc(Helfer.dateiname(pfad)), esc(pfad), null);
  }

  /* ---- PDF ----------------------------------------------------------- */

  /** Beschriftung unter dem PDF-Namen: „12 Seiten · durchsuchbar". */
  function seitenText(info) {
    const n = info.seiten || 0;
    const teile = [n + (n === 1 ? ' Seite' : ' Seiten')];
    if (info.t && info.t.length) teile.push('durchsuchbar');
    if (info.gekuerzt) teile.push('gekürzt');
    return teile.join(' · ');
  }

  /** PDF-Kachel: Vorschaubild der ersten Seite, Seitenzahl, Text für die Suche. */
  async function belebePdf(el, pfad) {
    const name = esc(Helfer.dateiname(pfad));
    const bekannt = Documents.get(pfad);

    const zeichne = (thumb, info) => {
      el.className = 'media media-pdf';
      el.innerHTML =
        '<span class="pdf-thumb">' +
          (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '<span class="pdf-icon">📄</span>') +
        '</span>' +
        '<span class="mf-body">' +
          '<span class="mf-name">' + name + '</span>' +
          '<span class="pdf-meta">' + esc(info) + '</span>' +
        '</span>';
    };

    zeichne(Documents.thumb(pfad), bekannt ? seitenText(bekannt) : 'wird gelesen…');

    try {
      const res = await Documents.prepare(pfad);
      zeichne(res.thumb, seitenText({ seiten: res.seiten, t: ' '.repeat(res.zeichen), gekuerzt: res.gekuerzt }));
      if (state.query) Chatliste.zeichne();        // Trefferzahlen aktualisieren
    } catch (e) {
      el.className = 'media media-chip unresolved';
      el.innerHTML = kachelInhalt('datei', name, esc(pfad), null);
    }
  }

  /* ---- Textdokumente (Office, JSON, XML, txt …) ---------------------- */

  const DOK_NAME = {
    docx: 'Word-Dokument', xlsx: 'Tabelle', pptx: 'Präsentation', odf: 'OpenDocument',
    json: 'JSON-Datei', xml: 'XML-Datei', html: 'HTML-Datei', htm: 'HTML-Datei',
    csv: 'CSV-Tabelle', tsv: 'Tabelle', md: 'Markdown', markdown: 'Markdown',
    rtf: 'RTF-Dokument', log: 'Protokoll', srt: 'Untertitel', vtt: 'Untertitel'
  };

  /** Lesbare Bezeichnung der Dateiart („Word-Dokument", „Tabelle" …). */
  function dokName(pfad) {
    const endung = String(pfad).toLowerCase().split('.').pop();
    return DOK_NAME[endung] || DOK_NAME[Documents.format(pfad)] || 'Textdatei';
  }

  /** Dokumentkachel mit Leseprobe der ersten Zeilen. */
  async function belebeDok(el, pfad) {
    const name = esc(Helfer.dateiname(pfad));
    const zeichne = (info, probe) => {
      const art = Documents.format(pfad);
      el.className = 'media media-doc';
      el.innerHTML =
        '<span class="mf-icon">' + (art === 'xlsx' ? '📊' : art === 'pptx' ? '📽️' : '📝') + '</span>' +
        '<span class="mf-body">' +
          '<span class="mf-name">' + name + '</span>' +
          '<span class="pdf-meta">' + esc(info) + '</span>' +
          (probe ? '<span class="doc-probe">' + esc(probe) + '</span>' : '') +
        '</span>';
    };

    const bekannt = Documents.get(pfad);
    zeichne(dokName(pfad) + (bekannt ? ' · durchsuchbar' : ' · wird gelesen…'),
            bekannt ? Textformat.leseprobe(bekannt.t) : '');
    if (bekannt) return;

    try {
      const info = await Documents.extract(pfad);
      zeichne(dokName(pfad) + (info.t ? ' · durchsuchbar' : '') + (info.gekuerzt ? ' · gekürzt' : ''),
              Textformat.leseprobe(info.t));
      if (state.query) Chatliste.zeichne();
    } catch (e) {
      el.className = 'media media-chip unresolved';
      el.innerHTML = kachelInhalt('datei', name, esc(pfad), null);
    }
  }

  /* ---- Beleben einzelner Kacheln ------------------------------------- */

  /** Eine Platzhalter-Kachel durch die echte Darstellung ersetzen. */
  async function belebe(el) {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = '1';
    const pfad = el.dataset.media;
    const art = el.dataset.kind;
    const name = esc(Helfer.dateiname(pfad));

    if (art === 'pdf' && window.Documents) { await belebePdf(el, pfad); return; }
    if (art === 'doc' && window.Documents) { await belebeDok(el, pfad); return; }

    // Erst im verbundenen Medienordner suchen, sonst den Pfad direkt versuchen
    let url = await Media.getURL(pfad);
    const ausOrdner = !!url;
    if (!url) url = direkteURL(pfad);
    if (!url) { el.classList.add('unresolved'); return; }

    const sicher = esc(url);
    if (art === 'bild') {
      el.className = 'media media-img';
      el.innerHTML = '<img src="' + sicher + '" alt="' + name + '" loading="lazy">';
      el.querySelector('img').addEventListener('error', () => zurueckZurKachel(el));
    } else if (art === 'video') {
      el.className = 'media media-video';
      el.innerHTML = '<video src="' + sicher + '" controls preload="metadata"></video>' +
        '<span class="mf-name small">' + name + '</span>';
      el.querySelector('video').addEventListener('error', () => zurueckZurKachel(el));
    } else if (art === 'audio') {
      el.className = 'media media-audio';
      el.innerHTML = '<span class="mf-name small">🎤 ' + name + '</span>' +
        '<audio src="' + sicher + '" controls preload="metadata"></audio>';
      el.querySelector('audio').addEventListener('error', () => zurueckZurKachel(el));
    } else {
      el.className = 'media media-chip file-open';
      el.innerHTML = '<a href="' + sicher + '" target="_blank" rel="noopener noreferrer"' +
        (ausOrdner ? ' download="' + name + '"' : '') + '>' + kachelInhalt(art, name, esc(pfad), null) + '</a>';
    }
  }

  /* ---- Sichtbarkeit -------------------------------------------------- */

  let beobachter = null;
  const RAND = 600;             // so viele Pixel vor dem Blickfeld wird vorgeladen

  /** Liegt das Element (grob) im sichtbaren Bereich? */
  function imBlick(el) {
    const h = window.innerHeight || 0;
    if (!h) return true;        // kein Layout (z. B. unsichtbarer Tab): alles laden
    const r = el.getBoundingClientRect();
    return r.bottom > -RAND && r.top < h + RAND;
  }

  /**
   * Alle noch unbelebten Kacheln unterhalb von `wurzel` versorgen:
   * was im Blick liegt, sofort – der Rest beim Scrollen.
   * (Der IntersectionObserver meldet sich in nicht gezeichneten Tabs nie,
   *  deshalb zusätzlich die direkte Sichtprüfung.)
   */
  function belebeAlle(wurzel) {
    const knoten = Array.from((wurzel || document).querySelectorAll('.media[data-media]:not([data-hydrated])'));
    if (!knoten.length) return;

    const hatIO = 'IntersectionObserver' in window;
    if (hatIO && !beobachter) {
      beobachter = new IntersectionObserver(liste => {
        for (const eintrag of liste) {
          if (!eintrag.isIntersecting) continue;
          beobachter.unobserve(eintrag.target);
          belebe(eintrag.target);
        }
      }, { rootMargin: RAND + 'px 0px' });
    }

    for (const n of knoten) {
      if (!hatIO || imBlick(n)) belebe(n);
      else beobachter.observe(n);
    }
  }

  /* ---- Vorschaubilder in der Detailspalte ---------------------------- */

  /** Eine Kachel der Mediengalerie mit Bild/Video/PDF-Vorschau füllen. */
  async function belebeVorschau(el) {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = '1';
    const pfad = el.dataset.thumb;
    const art = el.dataset.kind;

    if (art === 'pdf') {
      const bild = Documents.thumb(pfad) || (await Documents.prepare(pfad).then(r => r.thumb, () => null));
      if (bild) el.innerHTML = '<img src="' + esc(bild) + '" alt="">';
      return;
    }
    if (art !== 'bild' && art !== 'video') return;

    let url = await Media.getURL(pfad);
    if (!url) url = direkteURL(pfad);
    if (!url) return;

    // Erst einsetzen, dann prüfen: bei einem Fehler kommt das Symbol zurück
    const ersatz = el.innerHTML;
    el.innerHTML = art === 'bild'
      ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
      : '<video src="' + esc(url) + '" preload="metadata" muted></video>';
    el.firstChild.addEventListener('error', () => { el.innerHTML = ersatz; });
  }

  /** Alle Vorschaukacheln unterhalb von `wurzel` füllen. */
  function belebeVorschauen(wurzel) {
    (wurzel || document).querySelectorAll('.d-media-item[data-thumb]:not([data-hydrated])').forEach(belebeVorschau);
  }

  global.Medienansicht = {
    TYP_SYMBOL: TYP_SYMBOL, ART_SYMBOL: ART_SYMBOL,
    artVon: artVon, medienHTML: medienHTML, direkteURL: direkteURL,
    belebe: belebe, belebeAlle: belebeAlle, belebeVorschauen: belebeVorschauen,
    belebePdf: belebePdf, belebeDok: belebeDok
  };
})(window);
