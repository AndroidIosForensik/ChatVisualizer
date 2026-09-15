/* Dokumente lesbar und durchsuchbar machen – vollständig lokal.
   PDF:            Vorschau der ersten Seite und Text über PDF.js
   Office/OpenDoc: docx, xlsx, pptx, odt, ods, odp – ZIP auspacken, XML auslesen
   Text:           txt, md, json, xml, html, csv, srt, log, ini, yaml, rtf
   Der ausgelesene Text wird gespeichert und von der Suche mitgelesen. */
(function (global) {
  'use strict';

  const MAX_SEITEN = 60;            // mehr Seiten werden nicht ausgelesen
  const MAX_ZEICHEN = 400000;
  const MAX_TEXT_BYTES = 8 * 1024 * 1024;
  const THUMB_BREITE = 190;

  const TEXT_ENDUNGEN = ['txt', 'md', 'markdown', 'json', 'xml', 'html', 'htm', 'csv', 'tsv',
                         'log', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'srt', 'vtt', 'rtf', 'sql'];
  const ZIP_FORMATE = { docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', odt: 'odf', ods: 'odf', odp: 'odf' };

  /* ------------------------------------------------------------------ *
   * PDF.js nachladen (nur wenn wirklich ein PDF kommt)
   * ------------------------------------------------------------------ */
  let libPromise = null;

  async function lib() {
    if (!libPromise) {
      libPromise = (async () => {
        const url = new URL('vendor/pdfjs/pdf.min.mjs', location.href).href;
        const m = await import(url);
        m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
        return m;
      })().catch(e => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  /* ------------------------------------------------------------------ *
   * Zwischenspeicher: je Dateipfad ein Eintrag
   * ------------------------------------------------------------------ */
  const cache = new Map();          // pfad -> { t, seiten, gekuerzt, art }
  const thumbs = new Map();         // pfad -> dataURL
  let pending = [];
  let saveTimer = null;

  function key(pfad) { return String(pfad || '').replace(/\\/g, '/').toLowerCase(); }

  function get(pfad) { return cache.get(key(pfad)) || null; }
  function text(pfad) { const e = get(pfad); return e && e.t ? e.t : ''; }
  function thumb(pfad) { return thumbs.get(key(pfad)) || null; }

  function put(pfad, entry) {
    const k = key(pfad);
    cache.set(k, entry);
    pending.push({
      key: k, t: entry.t, seiten: entry.seiten, gekuerzt: entry.gekuerzt,
      art: entry.art || '', thumb: thumbs.get(k) || ''
    });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 800);
  }

  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await Store.putDocuments(batch);
  }

  async function load() {
    const rows = await Store.getDocuments();
    for (const r of rows) {
      cache.set(r.key, { t: r.t, seiten: r.seiten, gekuerzt: r.gekuerzt, art: r.art || '' });
      if (r.thumb) thumbs.set(r.key, r.thumb);
    }
    return cache.size;
  }

  async function clearAll() {
    cache.clear();
    thumbs.clear();
    pending = [];
    await Store.clearDocuments();
  }

  /* ------------------------------------------------------------------ *
   * Welches Format liegt vor?
   * ------------------------------------------------------------------ */
  function pfadVon(x) {
    return String((typeof x === 'string' ? x : (x && x.media)) || '');
  }

  function endung(x) {
    const m = pfadVon(x).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function isPdf(x) { return endung(x) === 'pdf'; }

  function format(x) {
    const e = endung(x);
    if (e === 'pdf') return 'pdf';
    if (ZIP_FORMATE[e]) return ZIP_FORMATE[e];
    if (TEXT_ENDUNGEN.indexOf(e) !== -1) return 'text';
    return null;
  }

  function isDocument(x) { return !!format(x); }

  /* ------------------------------------------------------------------ *
   * Datei besorgen
   * ------------------------------------------------------------------ */
  async function daten(pfad) {
    const entry = Media.lookup(pfad);
    if (entry) {
      const file = await Media.getFile(entry);
      if (file) return new Uint8Array(await file.arrayBuffer());
    }
    const url = Helfer.direkteURL(pfad);
    if (!url) throw new Error('Datei nicht gefunden – Medienordner verbinden');
    const r = await fetch(url);
    if (!r.ok) throw new Error('Datei nicht erreichbar (HTTP ' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  }

  /* ------------------------------------------------------------------ *
   * PDF: Seiten zeichnen und Text lesen
   * ------------------------------------------------------------------ */
  const offen = new Map();          // zuletzt geöffnete Dokumente vorhalten

  async function dokument(pfad) {
    const k = key(pfad);
    if (offen.has(k)) return offen.get(k);
    const p = (async () => {
      const pdfjs = await lib();
      return pdfjs.getDocument({
        data: await daten(pfad),
        standardFontDataUrl: new URL('vendor/pdfjs/standard_fonts/', location.href).href,
        wasmUrl: new URL('vendor/pdfjs/wasm/', location.href).href,
        iccUrl: new URL('vendor/pdfjs/iccs/', location.href).href,
        isEvalSupported: false
      }).promise;
    })();
    offen.set(k, p);
    p.catch(() => offen.delete(k));
    if (offen.size > 3) {
      const aeltester = offen.keys().next().value;
      const doc = offen.get(aeltester);
      offen.delete(aeltester);
      Promise.resolve(doc).then(d => { try { d.destroy(); } catch (e) {} }, () => {});
    }
    return p;
  }

  async function renderPage(pfad, nummer, breite, canvas) {
    const doc = await dokument(pfad);
    const page = await doc.getPage(Math.min(Math.max(1, nummer), doc.numPages));
    const roh = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: breite / roh.width });
    const cv = canvas || document.createElement('canvas');
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.width = Math.round(viewport.width * dpr);
    cv.height = Math.round(viewport.height * dpr);
    cv.style.width = Math.round(viewport.width) + 'px';
    cv.style.height = Math.round(viewport.height) + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return { canvas: cv, seiten: doc.numPages };
  }

  async function makeThumb(pfad) {
    const k = key(pfad);
    if (thumbs.has(k)) return thumbs.get(k);
    const ergebnis = await renderPage(pfad, 1, THUMB_BREITE);
    const bild = ergebnis.canvas.toDataURL('image/webp', 0.75);
    thumbs.set(k, bild);
    return bild;
  }

  async function pdfText(pfad) {
    const doc = await dokument(pfad);
    const bis = Math.min(doc.numPages, MAX_SEITEN);
    const teile = [];
    let zeichen = 0;
    for (let i = 1; i <= bis; i++) {
      const page = await doc.getPage(i);
      const inhalt = await page.getTextContent();
      const seite = inhalt.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join(' ')
        .replace(/[ \t]{2,}/g, ' ').trim();
      if (seite) { teile.push(seite); zeichen += seite.length; }
      if (zeichen > MAX_ZEICHEN) break;
    }
    return {
      t: teile.join('\n\n'),
      seiten: doc.numPages,
      gekuerzt: doc.numPages > bis || zeichen > MAX_ZEICHEN,
      art: 'pdf'
    };
  }

  /* ------------------------------------------------------------------ *
   * Text aus XML, Office-Dateien und einfachen Textdateien
   * ------------------------------------------------------------------ */
  const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function entschluesseln(s) {
    return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (ganz, code) {
      if (code[0] === '#') {
        const n = (code[1] === 'x' || code[1] === 'X')
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return isNaN(n) ? ganz : String.fromCodePoint(n);
      }
      const e = ENTITAETEN[code.toLowerCase()];
      return e === undefined ? ganz : e;
    });
  }

  /* Auszeichnungen entfernen; die genannten Tags gelten als Absatzende */
  function xmlText(xml, absatzTags) {
    let s = String(xml)
      .replace(/<\?[\s\S]*?\?>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');

    if (absatzTags && absatzTags.length) {
      const namen = absatzTags.join('|');
      s = s.replace(new RegExp('</(' + namen + ')>', 'gi'), '\n');
      s = s.replace(new RegExp('<(' + namen + ')[^>]*/>', 'gi'), '\n');
    }

    s = s.replace(/<[^>]*>/g, ' ');
    return entschluesseln(s)
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function dekodieren(bytes) {
    // UTF-8 bevorzugt; schlägt das fehl, Windows-1252 versuchen
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  function rtfText(s) {
    return String(s)
      .replace(/\\'([0-9a-f]{2})/gi, function (g, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  async function textAusDatei(pfad) {
    const bytes = await daten(pfad);
    if (bytes.length > MAX_TEXT_BYTES) throw new Error('Datei ist zu groß zum Auslesen');
    const e = endung(pfad);
    const roh = dekodieren(bytes);
    if (e === 'rtf') return rtfText(roh);
    if (e === 'xml' || e === 'html' || e === 'htm') {
      return xmlText(roh, ['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4']);
    }
    return roh.replace(/\r\n?/g, '\n').trim();
  }

  async function textAusZip(pfad, art) {
    const bytes = await daten(pfad);
    const teile = [];

    if (art === 'docx') {
      const dateien = await Archive.readMatching(bytes, function (n) {
        return /^word\/(document|header\d*|footer\d*)\.xml$/.test(n);
      });
      for (const f of dateien) teile.push(xmlText(dekodieren(f.daten), ['w:p', 'w:br']));

    } else if (art === 'xlsx') {
      const geteilt = await Archive.readMatching(bytes, function (n) { return n === 'xl/sharedStrings.xml'; });
      for (const f of geteilt) teile.push(xmlText(dekodieren(f.daten), ['si']));
      const blaetter = await Archive.readMatching(bytes, function (n) {
        return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
      });
      for (const f of blaetter) {
        const ohneFormeln = dekodieren(f.daten).replace(/<f>[\s\S]*?<\/f>/g, ' ');
        teile.push(xmlText(ohneFormeln, ['row']));
      }

    } else if (art === 'pptx') {
      const folien = await Archive.readMatching(bytes, function (n) {
        return /^ppt\/(slides|notesSlides)\/\w+\d+\.xml$/.test(n);
      });
      folien.sort(function (a, b) { return a.name.localeCompare(b.name, 'de', { numeric: true }); });
      for (const f of folien) teile.push(xmlText(dekodieren(f.daten), ['a:p']));

    } else {   // OpenDocument
      const dateien = await Archive.readMatching(bytes, function (n) { return n === 'content.xml'; });
      for (const f of dateien) {
        teile.push(xmlText(dekodieren(f.daten), ['text:p', 'text:h', 'table:table-row']));
      }
    }

    const ergebnis = teile.filter(Boolean).join('\n\n').trim();
    if (!ergebnis) throw new Error('Keine lesbaren Texte in der Datei');
    return ergebnis;
  }

  /* ------------------------------------------------------------------ *
   * Auslesen – je nach Format
   * ------------------------------------------------------------------ */
  async function extract(pfad) {
    const vorhanden = get(pfad);
    if (vorhanden) return vorhanden;

    const art = format(pfad);
    if (!art) throw new Error('Dieses Dateiformat wird nicht gelesen');

    let entry;
    if (art === 'pdf') {
      entry = await pdfText(pfad);
    } else {
      const roh = (art === 'text') ? await textAusDatei(pfad) : await textAusZip(pfad, art);
      const gekuerzt = roh.length > MAX_ZEICHEN;
      entry = { t: gekuerzt ? roh.slice(0, MAX_ZEICHEN) : roh, seiten: 0, gekuerzt: gekuerzt, art: art };
    }
    put(pfad, entry);
    return entry;
  }

  /* Vorschau (nur PDF) und Text in einem Rutsch */
  async function prepare(pfad) {
    const bild = isPdf(pfad) ? await makeThumb(pfad) : null;
    const info = await extract(pfad);
    return {
      thumb: bild, seiten: info.seiten, zeichen: (info.t || '').length,
      gekuerzt: info.gekuerzt, art: info.art
    };
  }

  /* ------------------------------------------------------------------ *
   * Alle Dokumente eines Bestands im Hintergrund lesen – sonst findet die
   * Suche nur, was man zufällig schon einmal angesehen hat.
   * ------------------------------------------------------------------ */
  const job = { active: false, done: 0, total: 0, failed: 0, cancel: false, error: '' };

  function pendingDocs(messages) {
    const gesehen = new Set();
    const out = [];
    for (const m of messages) {
      if (!m.media || !isDocument(m.media)) continue;
      const k = key(m.media);
      if (gesehen.has(k) || cache.has(k)) continue;
      if (!Media.lookup(m.media) && !Helfer.direkteURL(m.media)) continue;   // Datei nicht greifbar
      gesehen.add(k);
      out.push(m.media);
    }
    return out;
  }

  async function extractAll(messages, onUpdate) {
    if (job.active) return job;
    const liste = pendingDocs(messages);
    job.active = true; job.cancel = false; job.done = 0; job.failed = 0; job.error = '';
    job.total = liste.length;
    if (!liste.length) { job.active = false; return job; }
    if (onUpdate) onUpdate(job);

    for (const pfad of liste) {
      if (job.cancel) break;
      try {
        await prepare(pfad);
      } catch (e) {
        job.failed++;
        if (!job.error) job.error = e.message || String(e);
      }
      job.done++;
      if (onUpdate) onUpdate(job);
    }

    await flush();
    job.active = false;
    if (onUpdate) onUpdate(job);
    return job;
  }

  function cancel() { job.cancel = true; }

  global.Documents = {
    isPdf: isPdf, isDocument: isDocument, format: format,
    load: load, get: get, text: text, thumb: thumb, flush: flush, clearAll: clearAll,
    prepare: prepare, extract: extract, makeThumb: makeThumb, renderPage: renderPage,
    dokument: dokument, xmlText: xmlText,
    pendingDocs: pendingDocs, extractAll: extractAll, cancel: cancel, job: job,
    MAX_SEITEN: MAX_SEITEN
  };
})(window);
