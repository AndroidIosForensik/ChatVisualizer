/* Einen Chat als PDF-Bericht ausgeben.

   Ein eigener PDF-Erzeuger müsste Schriften für Kyrillisch, Arabisch, Chinesisch
   und Emoji mitbringen. Stattdessen entsteht ein druckfertiges HTML-Dokument
   (A4, Kopf- und Fußzeile mit Seitenzahlen, eingebettete Bilder), das der
   Browser über „Als PDF speichern" zu einem echten PDF macht – mit allen
   Schriften, die das System hat. Nichts verlässt dabei den Rechner.

   Aufbau des Berichts:
     Deckblatt   Chat, Messenger, Kennung, Teilnehmer, Zeitraum, Zeitzone,
                 Filter, Vermerk, Erstellzeit, Prüfsumme
     Verlauf     Sprechblasen mit Absender (Name und Kennung), Datum und
                 Uhrzeit mit Sekunden, Zitat, Bild, Text, Löschvermerk,
                 Transkript, Übersetzung, Reaktionen, Status
   Maschinelle Übersetzungen und Transkripte sind als solche gekennzeichnet;
   der Originaltext steht immer an erster Stelle. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;
  const M = Model;
  const state = M.state;

  const BILD_KANTE = 1000;     // längste Bildkante im Bericht (Pixel)
  const BILD_GRENZE = 500;     // mehr Bilder werden nur als Dateiname genannt
  const PARALLEL = 4;          // gleichzeitig geladene Bilder

  /* ---- Formate (folgen dem Schalter Ortszeit/UTC) ------------------------ */

  function formate() {
    const z = M.zeigeZone() ? { timeZone: M.zeigeZone() } : {};
    const f = o => new Intl.DateTimeFormat('de-DE', Object.assign(o, z));
    return {
      zeit: f({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tag: f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      datum: f({ day: '2-digit', month: '2-digit', year: 'numeric' })
    };
  }

  /* ---- Auswahl ----------------------------------------------------------- */

  /**
   * Nachrichten des Berichts.
   * @param {object} conv
   * @param {{von?: string, bis?: string, nurTreffer?: boolean}} opt  von/bis als JJJJ-MM-TT
   */
  function auswahl(conv, opt) {
    const q = opt.nurTreffer ? Textformat.norm(state.chatQuery) : '';
    return conv.messages.filter(m => {
      if (opt.von || opt.bis) {
        if (!m.ts) return false;
        const tag = M.tagSchluessel(m.ts);           // Kalendertag in der Anzeige-Zone
        if (opt.von && tag < opt.von) return false;
        if (opt.bis && tag > opt.bis) return false;
      }
      return !q || Suchtreffer.passt(m, q);
    });
  }

  const istBild = m => !!m.media && Media.kindOf(m.type, m.media) === 'bild';

  /* ---- Bilder: verkleinert als data:-URL einbetten ----------------------- */

  async function bildDaten(pfad) {
    try {
      const url = await Media.getDisplayURL(pfad);
      if (!url) return null;
      const img = new Image();
      img.src = url;
      await Helfer.withTimeout(img.decode(), 15000, 'Bild laden');
      const f = Math.min(1, BILD_KANTE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * f)), h = Math.max(1, Math.round(img.naturalHeight * f));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff';                           // Transparenz nicht schwarz werden lassen
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.86);
    } catch (e) {
      return null;                                    // z. B. HEIC, das der Browser nicht lesen kann
    }
  }

  /** Alle Bilder der Auswahl laden, mit Fortschritt und Abbruch. */
  async function ladeBilder(nachrichten, abbruch) {
    const liste = nachrichten.filter(istBild).slice(0, BILD_GRENZE);
    const bilder = new Map();
    let i = 0, fertig = 0;
    async function arbeiter() {
      while (i < liste.length && !abbruch.ja) {
        const m = liste[i++];
        const daten = await bildDaten(m.media);
        if (daten) bilder.set(m.key, daten);
        fertig++;
        Fortschritt.zeige({ icon: '📄', titel: 'PDF: Bilder werden eingebettet', pct: Math.round(fertig / liste.length * 100),
          zaehler: fertig + ' / ' + liste.length, abbruch: () => { abbruch.ja = true; } });
      }
    }
    const arbeiterListe = [];
    for (let n = 0; n < PARALLEL; n++) arbeiterListe.push(arbeiter());
    await Promise.all(arbeiterListe);
    return bilder;
  }

  /* ---- Prüfsumme --------------------------------------------------------- */

  /**
   * SHA-256 über die Kerndaten der enthaltenen Nachrichten. Wer denselben Chat mit
   * denselben Einstellungen erneut ausgibt, erhält denselben Wert – so lässt sich
   * zeigen, dass zwei Ausdrucke auf demselben Datenstand beruhen.
   */
  async function pruefsumme(nachrichten) {
    try {
      const kern = nachrichten.map(m => [m.key, m.ts, m.tsRaw, m.sender, m.text, m.media, m.deleted ? 1 : 0]);
      const bytes = new TextEncoder().encode(JSON.stringify(kern));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return '';                                      // ohne sichere Umgebung (file://) nicht verfügbar
    }
  }

  /* ---- HTML des Berichts ------------------------------------------------- */

  /** Text für CSS content: "…" (Kopf-/Fußzeile) */
  function cssText(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')
      .replace(/</g, '\\3C ') + '"';
  }

  const mehrzeilig = t => esc(t);                     // Umbrüche erhält white-space: pre-wrap

  function absenderHTML(m) {
    const name = M.absenderName(m);
    return '<span class="wer"><b style="color:' + M.senderColor(m.sender) + '">' + esc(name) + '</b>' +
      (name !== m.sender ? ' <span class="kennung">' + esc(m.sender) + '</span>' : '') + '</span>';
  }

  const TYP_SYMBOL = { bild: '🖼️', gif: '🖼️', video: '🎬', audio: '🎤', datei: '📎', standort: '📍', kontakt: '👤', umfrage: '📊', anruf: '📞' };

  function nachrichtHTML(m, k) {
    const f = k.f;
    const zeit = m.ts ? f.zeit.format(new Date(m.ts)) : (m.tsRaw || 'ohne Zeit');

    if (m.type === 'system') {
      return '<div class="system"><span>' + mehrzeilig(m.text || 'Systemnachricht') + '</span>' +
        '<small>' + esc(zeit) + '</small></div>';
    }

    const eigen = m.fromMe || (k.ich != null && m.sender === k.ich);
    const geloescht = m.deleted || /(gelöscht|geloescht|deleted|zurückgezogen)/i.test(m.status || '');
    let html = '<div class="m ' + (eigen ? 'aus' : 'ein') + (geloescht ? ' geloescht' : '') + '">' +
      '<div class="kopf">' + absenderHTML(m) + '<span class="zeit">' + esc(zeit) + '</span></div>';

    // Zitierte Nachricht
    if (m.replyTo) {
      const ziel = state.byKey.get(m.messenger + '::' + m.replyTo) || k.conv.messages.find(x => x.id === m.replyTo);
      html += ziel
        ? '<div class="zitat"><b>' + esc(M.absenderName(ziel)) + '</b> ' +
          esc(((ziel.text || Suchtreffer.vorschauText(ziel)).replace(/\s+/g, ' ')).slice(0, 200)) + '</div>'
        : '<div class="zitat fehlt">Antwort auf unbekannte Nachricht (' + esc(m.replyTo) + ')</div>';
    }

    // Anruf: Art, Richtung, Dauer, Ergebnis
    if (m.type === 'anruf') {
      const a = M.anruf(m, eigen);
      html += '<div class="anruf' + (a.verpasst ? ' verpasst' : '') + '">' + (m.video ? '🎥' : '📞') + ' <b>' +
        esc(a.art) + '</b> ' + esc(a.richtung) + (a.info ? ' · ' + esc(a.info) : '') + '</div>';
    }

    // Anhang: Bild eingebettet, sonst Dateiname mit Symbol
    if (m.media) {
      const name = esc(Helfer.dateiname(m.media));
      const bild = k.bilder.get(m.key);
      if (bild) {
        html += '<figure><img src="' + bild + '" alt=""><figcaption>' + name + '</figcaption></figure>';
      } else {
        html += '<div class="anhang">' + (TYP_SYMBOL[m.type] || '📎') + ' ' + name +
          '<span class="pfad">' + esc(m.media) + '</span></div>';
      }
    }

    if (geloescht) {
      html += m.text || m.media
        ? '<div class="marke">🗑 gelöscht – Inhalt aus der Quelle wiederhergestellt</div>'
        : '<div class="text leer">🚫 Diese Nachricht wurde gelöscht</div>';
    }
    if (m.text) html += '<div class="text">' + mehrzeilig(m.text) + '</div>';

    // Automatische Transkription
    if (k.opt.transkript && global.Transcribe) {
      const sk = Transcribe.get(m.key);
      if (sk && sk.t) {
        html += '<div class="zusatz"><span class="etikett">Automatische Transkription' +
          (sk.l ? ' · ' + esc(Translate.sprachName(sk.l)) : '') + '</span>' + mehrzeilig(sk.t) + '</div>';
      }
    }

    // Maschinelle Übersetzung – immer nach dem Original
    if (k.opt.uebersetzung) {
      const tr = Translate.get(m.key);
      if (tr && tr.t) {
        html += '<div class="zusatz"><span class="etikett">Maschinelle Übersetzung · ' +
          esc(Translate.sprachName(tr.s) || '?') + ' → ' + esc(Translate.sprachName(Translate.settings.target)) +
          '</span>' + mehrzeilig(tr.t) + '</div>';
      }
    }

    if (m.reactions && m.reactions.length) {
      html += '<div class="reakt">' + m.reactions.map(r =>
        esc((r.text || '❤️').trim()) + ' ' + esc(M.absenderName(r))).join(' · ') + '</div>';
    }

    const fuss = [];
    if (eigen && m.status && !geloescht) fuss.push(esc(m.status));
    if (k.opt.technik) {
      if (!/^auto-/.test(m.id)) fuss.push('ID ' + esc(m.id));
      if (m.tsRaw) fuss.push('Rohwert ' + esc(m.tsRaw) + (m.tz ? ' (' + esc(m.tz) + ')' : ''));
      if (m.source) fuss.push('Quelle ' + esc(m.source));
    }
    if (fuss.length) html += '<div class="fuss">' + fuss.join(' · ') + '</div>';

    return html + '</div>';
  }

  function deckblattHTML(conv, nachrichten, k, hash) {
    const f = k.f;
    const b = Messengers.brand(conv.messenger);
    const mitZeit = nachrichten.filter(m => m.ts);
    const erste = mitZeit.length ? f.zeit.format(new Date(mitZeit[0].ts)) : '–';
    const letzte = mitZeit.length ? f.zeit.format(new Date(mitZeit[mitZeit.length - 1].ts)) : '–';

    // Teilnehmer mit Anzahl Nachrichten im Bericht
    const anzahl = new Map();
    for (const m of nachrichten) if (m.type !== 'system') anzahl.set(m.sender, (anzahl.get(m.sender) || 0) + 1);
    const teilnehmer = Array.from(anzahl).sort((a, c) => c[1] - a[1]).map(([s, n]) => {
      const name = M.nameVon(conv, s);
      return '<li>' + esc(name) + (name !== s ? ' <span class="kennung">' + esc(s) + '</span>' : '') +
        (s === k.ich ? ' <em>(Gerät)</em>' : '') + ' – ' + n + '</li>';
    }).join('');

    const anrufe = nachrichten.filter(m => m.type === 'anruf').length;
    const quellen = Array.from(new Set(nachrichten.map(m => m.source ? m.source.split(',')[0].trim() : '').filter(Boolean)));

    const filter = [];
    if (k.opt.von || k.opt.bis) filter.push('Zeitraum ' + (k.opt.von || '…') + ' bis ' + (k.opt.bis || '…'));
    if (k.opt.nurTreffer) filter.push('nur Nachrichten mit „' + state.chatQuery + '“');

    const zeile = (t, w) => '<tr><th>' + t + '</th><td>' + w + '</td></tr>';
    return '<section class="deckblatt">' +
      '<h1>Chatverlauf: ' + esc(conv.title) + '</h1>' +
      (k.opt.vermerk ? '<p class="vermerk">' + esc(k.opt.vermerk) + '</p>' : '') +
      '<table>' +
        zeile('Messenger', esc(b.label)) +
        zeile('Chat-Kennung', esc(conv.conv)) +
        zeile('Teilnehmer', '<ul>' + teilnehmer + '</ul>') +
        zeile('Zeitraum', esc(erste) + ' bis ' + esc(letzte)) +
        zeile('Nachrichten', nachrichten.length + (nachrichten.length !== conv.messages.length
          ? ' von ' + conv.messages.length + ' im Chat' : '') +
          (anrufe ? ', davon ' + anrufe + (anrufe === 1 ? ' Anruf' : ' Anrufe') : '')) +
        zeile('Zeitangaben', esc(M.zonenName())) +
        (filter.length ? zeile('Filter', esc(filter.join('; '))) : '') +
        (quellen.length ? zeile('Quellen', esc(quellen.slice(0, 8).join(', ')) + (quellen.length > 8 ? ' …' : '')) : '') +
        zeile('Erstellt', esc(f.zeit.format(new Date())) + ' mit ChatVisualizer') +
        (hash ? zeile('Prüfsumme', '<code>SHA-256 ' + hash + '</code><br><small>über ID, Zeit, Rohwert, Absender, Text, ' +
          'Anhang und Löschvermerk jeder enthaltenen Nachricht</small>') : '') +
      '</table>' +
      '<p class="hinweis">Übersetzungen und Transkripte sind maschinell erstellt und nicht geprüft; ' +
        'maßgeblich ist der Originaltext, der jeweils zuerst steht.</p>' +
      '</section>';
  }

  /**
   * Vollständiges HTML-Dokument des Berichts.
   * @returns {Promise<{html: string, titel: string, anzahl: number}>}
   */
  async function bericht(conv, opt, bilder) {
    const nachrichten = auswahl(conv, opt);
    const k = { conv, opt, bilder: bilder || new Map(), ich: M.whoAmI(conv.key), f: formate() };
    const hash = await pruefsumme(nachrichten);

    let verlauf = '', letzterTag = null;
    for (const m of nachrichten) {
      const tag = M.tagSchluessel(m.ts);
      if (tag !== letzterTag) {
        verlauf += '<div class="tag"><span>' + esc(m.ts ? k.f.tag.format(new Date(m.ts)) : 'Ohne Datum') + '</span></div>';
        letzterTag = tag;
      }
      verlauf += nachrichtHTML(m, k);
    }

    const heute = k.f.datum.format(new Date());
    const titel = ('Chat ' + conv.title + ' ' + new Date().toISOString().slice(0, 10))
      .replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);

    const html = '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
      '<title>' + esc(titel) + '</title><style>' + STIL +
      '@page { @top-left { content: ' + cssText('Chatverlauf · ' + conv.title) + '; } ' +
      '@top-right { content: ' + cssText(opt.vermerk || M.zonenName()) + '; } ' +
      '@bottom-left { content: ' + cssText('ChatVisualizer · erstellt ' + heute + ' · Zeiten: ' + M.zonenName()) + '; } }' +
      '</style></head><body>' +
      deckblattHTML(conv, nachrichten, k, hash) +
      '<section class="verlauf">' + (verlauf || '<p class="hinweis">Keine Nachrichten in der Auswahl.</p>') + '</section>' +
      '</body></html>';
    return { html, titel, anzahl: nachrichten.length };
  }

  const STIL = [
    '@page { size: A4; margin: 17mm 14mm 17mm 14mm;',
    '  @top-left { font: 8pt system-ui, sans-serif; color: #667; }',
    '  @top-right { font: 8pt system-ui, sans-serif; color: #667; }',
    '  @bottom-left { font: 8pt system-ui, sans-serif; color: #667; }',
    '  @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 8pt system-ui, sans-serif; color: #667; } }',
    '* { box-sizing: border-box; }',
    'html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    'body { margin: 0; font: 9.5pt/1.42 "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif; color: #16202e; background: #fff; }',
    'h1 { font-size: 17pt; margin: 0 0 6mm; }',
    '.deckblatt { break-after: page; }',
    '.deckblatt table { width: 100%; border-collapse: collapse; }',
    '.deckblatt th { text-align: left; vertical-align: top; width: 32mm; padding: 2.2mm 3mm 2.2mm 0; color: #5b6979; font-weight: 600; }',
    '.deckblatt td { padding: 2.2mm 0; border-bottom: 0.3mm solid #e3e8ef; overflow-wrap: anywhere; }',
    '.deckblatt ul { margin: 0; padding-left: 4mm; }',
    '.deckblatt code { font: 8pt Consolas, "Cascadia Mono", monospace; overflow-wrap: anywhere; }',
    '.vermerk { font-size: 11pt; font-weight: 600; margin: -3mm 0 5mm; }',
    '.hinweis { color: #5b6979; font-size: 8.5pt; margin-top: 6mm; }',
    '.kennung { color: #6e7b8d; font-weight: 400; font-size: 8pt; }',
    '.tag { text-align: center; margin: 5mm 0 3mm; break-after: avoid; }',
    '.tag span { display: inline-block; background: #eef1f6; border-radius: 99px; padding: 0.8mm 4mm; font-size: 8.5pt; font-weight: 600; color: #3d4a5c; }',
    '.m { width: fit-content; max-width: 80%; min-width: 45mm; margin: 0 0 2.6mm; padding: 2mm 3mm 1.6mm;',
    '  border-radius: 3mm; border: 0.3mm solid #dde3ec; background: #f7f9fc; break-inside: avoid; }',
    '.m.aus { margin-left: auto; background: #e3eeff; border-color: #c9dcfb; }',
    '.m.geloescht { border-style: dashed; border-color: #e2585d; }',
    '.kopf { display: flex; justify-content: space-between; gap: 4mm; font-size: 8.5pt; margin-bottom: 0.8mm; }',
    '.zeit { color: #6e7b8d; white-space: nowrap; font-variant-numeric: tabular-nums; }',
    '.text { white-space: pre-wrap; overflow-wrap: anywhere; }',
    '.text.leer { font-style: italic; color: #6e7b8d; }',
    '.marke { color: #c0393e; font-size: 8pt; font-weight: 700; margin-bottom: 0.6mm; }',
    '.zitat { border-left: 0.8mm solid #9aa7b8; background: rgba(0,0,0,.04); padding: 0.8mm 2mm; margin-bottom: 1.2mm; font-size: 8.5pt; color: #3d4a5c; overflow-wrap: anywhere; }',
    '.zitat.fehlt { font-style: italic; }',
    'figure { margin: 0.5mm 0 1.2mm; }',
    'figure img { display: block; max-width: 100%; max-height: 95mm; border-radius: 1.5mm; }',
    'figcaption, .pfad { font-size: 7.5pt; color: #6e7b8d; overflow-wrap: anywhere; }',
    '.anhang { font-weight: 600; margin-bottom: 1mm; overflow-wrap: anywhere; }',
    '.anruf { margin: 0.4mm 0 0.6mm; }',
    '.anruf.verpasst { color: #c0393e; }',
    '.pfad { display: block; font-weight: 400; }',
    '.zusatz { margin-top: 1.4mm; padding-top: 1.2mm; border-top: 0.3mm dashed #b7c1ce; white-space: pre-wrap; overflow-wrap: anywhere; }',
    '.etikett { display: block; font-size: 7pt; font-weight: 700; letter-spacing: .3pt; text-transform: uppercase; color: #6e7b8d; margin-bottom: 0.4mm; }',
    '.reakt { font-size: 8pt; color: #3d4a5c; margin-top: 1mm; }',
    '.fuss { font-size: 7.5pt; color: #6e7b8d; margin-top: 0.8mm; text-align: right; overflow-wrap: anywhere; }',
    '.system { text-align: center; margin: 2mm 0; break-inside: avoid; }',
    '.system span { display: inline-block; background: #eef1f6; border-radius: 2mm; padding: 1mm 3mm; font-size: 8.5pt; color: #3d4a5c; max-width: 80%; white-space: pre-wrap; }',
    '.system small { display: block; font-size: 7pt; color: #8a97a8; }'
  ].join('\n');

  /* ---- Drucken ----------------------------------------------------------- */

  /** Bericht in einem unsichtbaren Rahmen öffnen und den Druckdialog zeigen. */
  async function drucken(b) {
    const alt = document.getElementById('pdfRahmen');
    if (alt) alt.remove();
    const rahmen = document.createElement('iframe');
    rahmen.id = 'pdfRahmen';
    rahmen.setAttribute('aria-hidden', 'true');
    rahmen.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(rahmen);
    const doc = rahmen.contentDocument;
    doc.open(); doc.write(b.html); doc.close();
    // Warten, bis Bilder und Schriften bereit sind – aber nie unbegrenzt
    const bereit = Promise.all(Array.from(doc.images).map(i => i.decode().catch(() => {})))
      .then(() => doc.fonts && doc.fonts.ready);
    await Helfer.withTimeout(bereit, 20000, 'Bericht aufbauen').catch(() => {});

    // Chrome schlägt den Seitentitel als Dateinamen vor
    const alterTitel = document.title;
    document.title = b.titel;
    const zurueck = () => { document.title = alterTitel; };
    rahmen.contentWindow.addEventListener('afterprint', zurueck, { once: true });
    setTimeout(zurueck, 120000);
    rahmen.contentWindow.focus();
    rahmen.contentWindow.print();
  }

  /* ---- Dialog ------------------------------------------------------------ */

  function leseOptionen() {
    return {
      von: $('#pdfVon').value, bis: $('#pdfBis').value,
      bilder: $('#pdfBilder').checked, uebersetzung: $('#pdfUebersetzung').checked,
      transkript: $('#pdfTranskript').checked, technik: $('#pdfTechnik').checked,
      nurTreffer: $('#pdfTreffer').checked, vermerk: $('#pdfVermerk').value.trim()
    };
  }

  /** Zahl der ausgewählten Nachrichten und Bilder live anzeigen. */
  function zaehle(conv) {
    const opt = leseOptionen();
    const liste = auswahl(conv, opt);
    const bilder = liste.filter(istBild).length;
    const verbunden = liste.some(m => istBild(m) && Media.lookup(m.media));
    $('#pdfInfo').textContent = liste.length.toLocaleString('de-DE') + ' Nachrichten' +
      (bilder ? ', ' + bilder + (bilder === 1 ? ' Bild' : ' Bilder') + (verbunden ? '' : ' (Medienordner nicht verbunden – nur Dateinamen)') : '') +
      ' · Zeiten in ' + M.zonenName() + (liste.length > 3000 ? ' · großer Bericht, das Erstellen dauert etwas' : '');
    $('#pdfStart').disabled = !liste.length;
  }

  function dialogFuellen(conv) {
    const mitZeit = conv.messages.filter(m => m.ts);
    const erster = mitZeit.length ? M.tagSchluessel(mitZeit[0].ts) : '';
    const letzter = mitZeit.length ? M.tagSchluessel(mitZeit[mitZeit.length - 1].ts) : '';
    $('#pdfChat').textContent = conv.title + ' · ' + Messengers.brand(conv.messenger).label;
    for (const id of ['#pdfVon', '#pdfBis']) { $(id).min = erster; $(id).max = letzter; }
    $('#pdfVon').value = erster;
    $('#pdfBis').value = letzter;
    $('#pdfBilder').checked = true;
    $('#pdfUebersetzung').checked = conv.messages.some(m => { const t = Translate.get(m.key); return t && t.t; });
    $('#pdfTranskript').checked = true;
    $('#pdfTechnik').checked = false;
    $('#pdfTreffer').checked = false;
    $('#pdfTrefferZeile').hidden = !state.chatQuery;
    $('#pdfTrefferText').textContent = state.chatQuery;
    zaehle(conv);
  }

  /** Dialog öffnen; „PDF erstellen" baut den Bericht und öffnet den Druckdialog. */
  function oeffnen() {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    const dialog = $('#pdfDialog');
    dialogFuellen(conv);
    dialog.oninput = dialog.onchange = () => zaehle(conv);
    dialog.returnValue = '';
    dialog.addEventListener('close', async () => {
      dialog.oninput = dialog.onchange = null;
      if (dialog.returnValue !== 'pdf') return;
      await erstellen(conv, leseOptionen());
    }, { once: true });
    dialog.showModal();
  }

  /** Bericht bauen und drucken – auch ohne Dialog nutzbar (Konsole, Tests). */
  async function erstellen(conv, opt) {
    const abbruch = { ja: false };
    try {
      Fortschritt.zeige({ icon: '📄', titel: 'PDF wird vorbereitet', pct: -1, zaehler: '', abbruch: () => { abbruch.ja = true; } });
      const liste = auswahl(conv, opt);
      const bilder = opt.bilder ? await ladeBilder(liste, abbruch) : new Map();
      if (abbruch.ja) { Fortschritt.fertig('PDF abgebrochen'); return null; }
      Fortschritt.zeige({ icon: '📄', titel: 'PDF wird gesetzt', pct: -1, zaehler: liste.length + ' Nachrichten', abbruch: null });
      const b = await bericht(conv, opt, bilder);
      Fortschritt.fertig('Druckdialog geöffnet – „Als PDF speichern" wählen');
      await drucken(b);
      return b;
    } catch (e) {
      Fortschritt.fertig('PDF fehlgeschlagen');
      Meldung.zeige('PDF konnte nicht erstellt werden: ' + esc(e.message || e), 'error');
      return null;
    }
  }

  function verdrahten() {
    $('#exportChat').addEventListener('click', oeffnen);
  }

  global.PdfBericht = { oeffnen, erstellen, bericht, auswahl, ladeBilder, verdrahten };
})(window);
