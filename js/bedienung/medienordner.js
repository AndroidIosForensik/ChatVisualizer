/* Medienquellen: welcher Ordner gehört zu welchem Import?

   Jeder Import ist eine Quelle (Media.neueQuelle) und sucht seine Medien nur in
   seinen eigenen Ordnern – sonst zeigt bei zwei Geräten mit gleichen
   Dateinamen (IMG-…-WA0000.jpg) ein Chat das Bild des anderen Geräts.
   Wer einen Berichts- oder Fallordner hineinzieht, muss nichts tun: Der Ordner
   ist Medienordner genau dieses Imports. Für Imports ohne Ordner (CSV, TSV,
   Datenbank allein) und für Ordner, die nur Medien enthalten, gibt es die
   Übersicht „Medienquellen“ (Dialog #medienDialog).

   Die Ordner selbst werden nie kopiert – gemerkt wird je Quelle nur ein Verweis
   (File System Access API, Store-Handle „medien:<Quelle>“). Beim nächsten Start
   fragt der Browser gegebenenfalls nach der Freigabe; bis dahin steht
   „wieder verbinden“ in der Seitenleiste. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;
  const state = Model.state;

  /* Gemerkte Ordner, denen noch die Freigabe des Nutzers fehlt: Quelle → [Handles] */
  const wartend = new Map();
  /* Gerade verbundener Ordner ohne Chats darin – wartet auf die Zuordnung zu einem Import */
  let offenerOrdner = null;
  /* Ziel des klassischen Ordnerdialogs (Browser ohne File System Access API) */
  let dirZiel = null;

  /* Wo die Medien eines Messengers üblicherweise liegen – als Hilfe in der Übersicht */
  const ERWARTET = {
    whatsapp: 'Android: Ordner <code>com.whatsapp</code> bzw. <code>WhatsApp</code> (darin <code>Media</code>); ' +
      'iPhone: <code>Message/Media</code> aus dem App-Container. Im ALEAPP-Bericht liegen die Dateien unter <code>data/…</code>.',
    telegram: 'Android: <code>Android/data/org.telegram.messenger/files/Telegram</code> bzw. <code>Telegram</code> auf der Speicherkarte.',
    signal: 'Signal speichert Anhänge verschlüsselt im App-Ordner – entschlüsselt liegen sie nur im ALEAPP-Bericht.',
    threema: 'Threema speichert Anhänge verschlüsselt – entschlüsselt liegen sie nur im ALEAPP-Bericht.'
  };

  /* ---- Zahlen ----------------------------------------------------------- */

  /** Je Quelle: Nachrichten mit Medien, gefunden, mehrdeutig, Messenger */
  function uebersicht() {
    const zahlen = Media.stats(state.messages);
    const messenger = new Map();
    for (const m of state.messages) {
      if (!m.media) continue;
      const q = m.medienQuelle || '';
      if (!messenger.has(q)) messenger.set(q, new Set());
      messenger.get(q).add(m.messenger);
    }
    const zeilen = [];
    for (const [q, z] of zahlen.jeQuelle) zeilen.push(Object.assign({ messenger: Array.from(messenger.get(q) || []) }, z));
    // Ordner unter „ohne Zuordnung“ auch zeigen, wenn keine Nachricht ohne Quelle da ist
    if (Media.hatOrdner(Media.ALLGEMEIN) && !zeilen.some(z => !z.quelle)) {
      zeilen.push({ quelle: '', withMedia: 0, matched: 0, mehrdeutig: 0, fehlend: [], messenger: [] });
    }
    return { zahlen, zeilen };
  }

  const ordnerId = q => q || Media.ALLGEMEIN;
  const mehr = (n, eins, viele) => n.toLocaleString('de-DE') + ' ' + (n === 1 ? eins : viele);

  /* ---- Anzeige -------------------------------------------------------- */

  /** Zeile unter der Kopfleiste: Dateien, Quellen, wartende Ordner, fehlende Medien. */
  function zeigeStatus() {
    const el = $('#mediaStatus');
    const anzahlWartend = Array.from(wartend.values()).reduce((n, l) => n + l.length, 0);
    const ordner = Media.ordner();
    const { zahlen } = uebersicht();
    const teile = [];
    if (Media.count()) {
      teile.push('<span class="ms-icon">🖼️</span><span class="ms-text"><b>' + Media.count().toLocaleString('de-DE') +
        '</b> ' + (Media.count() === 1 ? 'Mediendatei' : 'Mediendateien') + ' · <button class="ms-link" data-media-panel>' +
        (ordner.length === 1 ? '1 Medienquelle' : ordner.length + ' Medienquellen') + '</button>' +
        (zahlen.withMedia && zahlen.matched < zahlen.withMedia
          ? ' · <span class="ms-fehlt">' + (zahlen.withMedia - zahlen.matched) + ' fehlen</span>' : '') + '</span>');
    } else if (zahlen.withMedia && !anzahlWartend) {
      teile.push('<span class="ms-icon">🖼️</span><span class="ms-text">' + mehr(zahlen.withMedia, 'Nachricht', 'Nachrichten') +
        ' mit Medien · <button class="ms-link" data-media-panel>Medienordner verbinden</button></span>');
    }
    if (anzahlWartend) {
      teile.push((teile.length ? '' : '<span class="ms-icon">🔌</span>') +
        '<button class="ms-link" data-media-reconnect>' + (anzahlWartend === 1
          ? 'Medienordner „' + esc(Array.from(wartend.values())[0][0].name) + '“ wieder verbinden'
          : anzahlWartend + ' Medienordner wieder verbinden') + '</button>');
    }
    el.className = 'media-status' + (Media.count() ? ' connected' : anzahlWartend ? ' pending' : '');
    el.innerHTML = teile.join(' ');
  }

  /** Chat und Detailspalte neu zeichnen, damit Medien erscheinen. */
  function ansichtenAuffrischen() {
    if (state.activeConv) {
      Render.renderChat('keep');
      Render.renderDetails();
    }
    zeigeStatus();
    if ($('#medienDialog') && $('#medienDialog').open) zeichneDialog();
  }

  /* ---- Übersicht „Medienquellen“ ---------------------------------------- */

  function zeichneDialog() {
    const { zeilen } = uebersicht();
    const ordner = new Map(Media.ordner().map(o => [o.id, o]));
    const aktiv = state.activeConv && state.conversations.find(c => c.key === state.activeConv);
    const aktivQuelle = aktiv && (aktiv.messages.find(m => m.medienQuelle) || {}).medienQuelle;

    $('#medienOffen').hidden = !offenerOrdner;
    if (offenerOrdner) {
      $('#medienOffen').innerHTML = '<b>„' + esc(offenerOrdner.label) + '“</b> enthält nur Medien (' +
        mehr(offenerOrdner.n, 'Datei', 'Dateien') + '), keine Chats. Zu welchem Import gehört der Ordner?';
    }
    // Der Import des offenen Chats zuerst
    zeilen.sort((a, b) => (b.quelle === aktivQuelle) - (a.quelle === aktivQuelle) || b.withMedia - a.withMedia);
    $('#medienListe').innerHTML = zeilen.length ? zeilen.map(z => {
      const id = ordnerId(z.quelle);
      const o = ordner.get(id);
      const warten = wartend.get(id);
      const quote = z.withMedia ? Math.round(100 * z.matched / z.withMedia) : 100;
      const zustand = !z.withMedia ? '' : z.matched === z.withMedia ? 'ok' : z.matched ? 'teil' : 'fehlt';
      const hilfe = z.messenger.map(x => ERWARTET[String(x).toLowerCase()]).filter(Boolean)[0] || '';
      return '<div class="mq-zeile ' + zustand + '">' +
        '<div class="mq-kopf"><b>' + esc(z.quelle ? Media.quelleName(z.quelle) : 'Ohne Zuordnung (ältere Importe, Ordner von Hand)') + '</b>' +
          (z.quelle === aktivQuelle ? ' <span class="mq-marke">offener Chat</span>' : '') +
          (z.messenger.length ? ' <span class="mq-messenger">' + esc(z.messenger.map(x => Messengers.brand(x).label).join(', ')) + '</span>' : '') +
        '</div>' +
        (z.withMedia ? '<div class="mq-zahl"><span class="mq-balken"><span style="width:' + quote + '%"></span></span>' +
          z.matched.toLocaleString('de-DE') + ' von ' + z.withMedia.toLocaleString('de-DE') + ' Medien gefunden' +
          (z.mehrdeutig ? ' · <span class="mq-warn">' + z.mehrdeutig + ' mehrdeutig</span>' : '') + '</div>' : '') +
        '<div class="mq-ordner">' + (o ? '📁 ' + esc(o.label) + ' · ' + mehr(o.n, 'Datei', 'Dateien')
          : warten ? '🔌 „' + esc(warten[0].name) + '“ wartet auf Freigabe' : 'kein Medienordner verbunden') + '</div>' +
        (zustand === 'fehlt' || zustand === 'teil' ? '<details class="mq-fehlend"><summary>Fehlende Dateien</summary><ul>' +
          z.fehlend.slice(0, 30).map(f => '<li><code>' + esc(f) + '</code></li>').join('') +
          (z.withMedia - z.matched > 30 ? '<li>…</li>' : '') + '</ul>' +
          (hilfe ? '<p class="mq-hilfe">Üblicher Ort: ' + hilfe + '</p>' : '') + '</details>' : '') +
        '<div class="mq-knoepfe">' +
          (offenerOrdner ? '<button class="btn primary" data-mq-zuordnen="' + esc(id) + '">Diesem Import zuordnen</button>' :
            (warten ? '<button class="btn primary" data-mq-freigeben="' + esc(id) + '">Wieder verbinden</button>' : '') +
            '<button class="btn' + (!o && !warten && z.withMedia ? ' primary' : '') + '" data-mq-verbinden="' + esc(id) + '">' +
              (o ? 'Weiteren Ordner hinzufügen…' : 'Medienordner wählen…') + '</button>' +
            (o || warten ? '<button class="btn" data-mq-trennen="' + esc(id) + '">Trennen</button>' : '')) +
        '</div></div>';
    }).join('') : '<p class="wa-import-hint">Noch nichts importiert. Medienordner gehören zu einem Import – erst Chats importieren.</p>';
  }

  function dialogOeffnen() {
    zeichneDialog();
    const d = $('#medienDialog');
    if (!d.open) d.showModal();
  }

  /* ---- Anbinden -------------------------------------------------------- */

  async function handlesSpeichern(quelle) {
    const o = Media.ordner().find(x => x.id === quelle);
    if (o && o.handles.length) await Store.saveHandle('medien:' + quelle, o.handles);
    else await Store.deleteHandle('medien:' + quelle);
  }

  /** Meldung mit den Zahlen einer Quelle nach dem Verbinden */
  function meldeQuelle(quelle, dateien) {
    const z = Media.stats(state.messages).jeQuelle.get(quelle === Media.ALLGEMEIN ? '' : quelle);
    let text = '<b>' + mehr(dateien, 'Datei', 'Dateien') + '</b> verbunden';
    if (z && z.withMedia) text += ' – ' + z.matched + ' von ' + z.withMedia + ' Medien von „' + esc(Media.quelleName(quelle)) + '“ gefunden';
    Meldung.zeige(text, z && z.withMedia && !z.matched ? 'warn' : 'ok');
  }

  /**
   * Nach dem Anbinden eines neuen Ordners: enthaltene Tabellen und Datenbanken
   * importieren (als dieselbe Quelle). Liegen nur Medien darin, wird gefragt,
   * zu welchem Import sie gehören.
   * @param {number} anzahl          gefundene Dateien
   * @param {boolean} csvImportieren Tabellen aus dem Ordner übernehmen?
   * @param {string} quelle          Quelle, unter der der Ordner verbunden wurde
   */
  async function nachAnbindung(anzahl, csvImportieren, quelle) {
    $('#importBusy').classList.remove('show');
    let importiert = false;
    if (csvImportieren) {
      // Tabellen, dazu WhatsApp-Datenbanken (andere .db im Ordner bleiben unangetastet)
      const csvDateien = Media.listByExt(['csv', 'tsv', 'txt', 'db', 'db-wal'], quelle)
        .filter(e => !/\.db(-wal)?$/i.test(e.name) || /^(msgstore|wa)\.db(-wal)?$/i.test(e.name));
      const dateien = [];
      const paths = new Map();
      for (const e of csvDateien) {
        const f = await Media.getFile(e);
        if (f) { dateien.push(f); paths.set(f, e.originalPath || e.path); }
      }
      if (dateien.length) {
        const vorher = state.messages.length;
        await Import.importiereDateien(dateien, { paths, fromFolder: true, quelle });
        importiert = state.messages.some(m => m.medienQuelle === quelle) || state.messages.length !== vorher;
      }
    }
    if (!importiert) {
      if (state.messages.length && anzahl) {
        // Nur Medien: zu welchem Import gehören sie?
        offenerOrdner = { quelle, label: (Media.ordner().find(o => o.id === quelle) || {}).label || 'Ordner', n: anzahl };
        dialogOeffnen();
      } else if (anzahl) {
        Meldung.zeige('In „' + esc(Media.quelleName(quelle)) + '“ wurden keine Chats gefunden. Erst Chats importieren, ' +
          'dann den Ordner als Medienordner verbinden.', 'warn');
        Media.clear(quelle);
        Media.vergissQuelle(quelle);
        await Store.deleteHandle('medien:' + quelle);
      }
    }
    ansichtenAuffrischen();
    Dokumentenlauf.alleLesen();     // Anhänge im Hintergrund durchsuchbar machen
  }

  /** Den offenen Medienordner einem Import zuschlagen. */
  async function zuordnen(ziel) {
    if (!offenerOrdner) return;
    const von = offenerOrdner.quelle;
    const n = Media.umhaengen(von, ziel);
    Media.vergissQuelle(von);
    await Store.deleteHandle('medien:' + von);
    await handlesSpeichern(ziel);
    offenerOrdner = null;
    ansichtenAuffrischen();
    meldeQuelle(ziel, n);
  }

  /**
   * Einen neu gewählten Ordner übernehmen: als eigene Quelle, Inhalt importieren.
   * @param {FileSystemDirectoryHandle} handle
   * @param {boolean} merken         für den nächsten Start speichern
   * @param {boolean} csvImportieren enthaltene Tabellen importieren
   */
  async function handleVerwenden(handle, merken, csvImportieren) {
    $('#importBusy').classList.add('show');
    const quelle = Media.neueQuelle(handle.name, 'ordner');
    let anzahl = 0;
    try {
      anzahl = await Media.attachDirectoryHandle(handle, { quelle });
    } catch (e) {
      $('#importBusy').classList.remove('show');
      Meldung.zeige('Ordner konnte nicht gelesen werden.', 'error');
      return;
    }
    if (merken) await handlesSpeichern(quelle);
    await nachAnbindung(anzahl, csvImportieren, quelle);
  }

  async function ordnerHandle() {
    try {
      return await window.showDirectoryPicker({ id: 'chatvisualizer-media', mode: 'read' });
    } catch (e) {
      return null;                  // vom Nutzer abgebrochen
    }
  }

  /** Einen Medienordner für einen bestimmten Import verbinden (Übersicht). */
  async function ordnerFuerQuelle(quelle) {
    if (!Media.supportsPicker()) { dirZiel = quelle; $('#dirInput').click(); return; }
    const handle = await ordnerHandle();
    if (!handle) return;
    $('#importBusy').classList.add('show');
    try {
      const n = await Media.attachDirectoryHandle(handle, { quelle });
      await handlesSpeichern(quelle);
      ansichtenAuffrischen();
      meldeQuelle(quelle, n);
      Dokumentenlauf.alleLesen();
    } catch (e) {
      Meldung.zeige('Ordner konnte nicht gelesen werden.', 'error');
    } finally {
      $('#importBusy').classList.remove('show');
    }
  }

  /** Knopf 🖼: ohne Chats einen Ordner importieren, sonst die Übersicht öffnen. */
  async function ordnerWaehlen() {
    if (state.messages.length) { dialogOeffnen(); return; }
    if (Media.supportsPicker()) {
      const handle = await ordnerHandle();
      if (handle) await handleVerwenden(handle, true, true);
    } else {
      dirZiel = null;
      $('#dirInput').click();
    }
  }

  /** Eine fertige Dateiliste anbinden (Ordner-Dialog ohne File System Access API, lose Medien). */
  async function dateienAnhaengen(files, csvImportieren, ziel) {
    if (ziel) {
      const n = Media.attachFileList(files, ziel);
      ansichtenAuffrischen();
      meldeQuelle(ziel, n);
      return n;
    }
    const erste = files[0] || {};
    const quelle = Media.neueQuelle((erste.webkitRelativePath || '').split('/')[0] || erste.name || 'Dateien', 'dateien');
    const anzahl = Media.attachFileList(files, quelle);
    await nachAnbindung(anzahl, !!csvImportieren, quelle);
    return anzahl;
  }

  /** Verbindung einer Quelle lösen – ohne Angabe: alle (die Dateien selbst bleiben unangetastet). */
  async function trennen(quelle) {
    const ids = quelle ? [quelle] : Media.ordner().map(o => o.id).concat(Array.from(wartend.keys()));
    for (const id of ids) {
      Media.clear(id);
      wartend.delete(id);
      await Store.deleteHandle('medien:' + id);
    }
    ansichtenAuffrischen();
    Meldung.zeige(quelle ? 'Medienordner von „' + esc(Media.quelleName(quelle)) + '“ getrennt.' : 'Medienordner getrennt.', 'warn');
  }

  /* ---- Wiederherstellen ------------------------------------------------ */

  /**
   * Beim Start die gemerkten Ordner aller Quellen wieder anbinden. Ohne
   * erteilte Freigabe werden sie nur vorgemerkt – das Nachfragen muss vom
   * Nutzer ausgehen, sonst blockt der Browser.
   */
  async function wiederherstellen() {
    try {
      // Früher gab es genau einen Medienordner („mediaRoot“): er gilt für alles ohne Quelle
      const alt = await Store.getHandle('mediaRoot');
      if (alt) {
        await Store.saveHandle('medien:' + Media.ALLGEMEIN, [alt]);
        await Store.deleteHandle('mediaRoot');
      }
      const ids = [Media.ALLGEMEIN].concat(Media.quellen().map(q => q.id));
      let verbunden = 0;
      for (const id of ids) {
        const gemerkt = await Store.getHandle('medien:' + id);
        const handles = (Array.isArray(gemerkt) ? gemerkt : gemerkt ? [gemerkt] : [])
          .filter(h => h && typeof h.queryPermission === 'function');
        for (const h of handles) {
          if (await h.queryPermission({ mode: 'read' }) === 'granted') {
            verbunden += await Media.attachDirectoryHandle(h, { quelle: id });
          } else {
            if (!wartend.has(id)) wartend.set(id, []);
            wartend.get(id).push(h);
          }
        }
      }
      ansichtenAuffrischen();
      if (verbunden) {
        Meldung.zeige('Medienordner verbunden – ' + verbunden.toLocaleString('de-DE') + ' Dateien', 'ok');
        Dokumentenlauf.alleLesen();
      }
    } catch (e) {
      /* Browser ohne File System Access API – dann eben ohne gemerkte Ordner */
    }
  }

  /** Wartende Ordner freigeben lassen (muss aus einem Klick kommen). */
  async function freigeben(nurQuelle) {
    let n = 0, abgelehnt = 0;
    for (const [id, handles] of Array.from(wartend.entries())) {
      if (nurQuelle && id !== nurQuelle) continue;
      for (const h of handles) {
        let rechte = 'denied';
        try { rechte = await h.requestPermission({ mode: 'read' }); } catch (err) { /* abgelehnt */ }
        if (rechte === 'granted') n += await Media.attachDirectoryHandle(h, { quelle: id });
        else abgelehnt++;
      }
      wartend.delete(id);
    }
    ansichtenAuffrischen();
    if (n) { Meldung.zeige('<b>' + n.toLocaleString('de-DE') + '</b> Dateien wieder verbunden', 'ok'); Dokumentenlauf.alleLesen(); }
    if (abgelehnt) Meldung.zeige('Zugriff auf ' + abgelehnt + ' Ordner wurde nicht erlaubt.', 'warn');
  }

  /* ---- Ereignisse ------------------------------------------------------ */

  function verdrahten() {
    $('#mediaBtn').addEventListener('click', ordnerWaehlen);
    $('#mediaBtnWelcome').addEventListener('click', ordnerWaehlen);

    $('#dirInput').addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      if (!files || !files.length) return;
      const ziel = dirZiel;
      dirZiel = null;
      $('#importBusy').classList.add('show');
      await dateienAnhaengen(files, !ziel, ziel);
      $('#importBusy').classList.remove('show');
    });

    $('#mediaStatus').addEventListener('click', async e => {
      if (e.target.closest('[data-media-panel]')) { dialogOeffnen(); return; }
      if (e.target.closest('[data-media-reconnect]')) await freigeben();
    });

    // Link in Meldungen („Medienordner verbinden“)
    document.addEventListener('click', e => {
      if (e.target.closest('#toast [data-media-panel]')) dialogOeffnen();
    });

    $('#medienDialog').addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mqZuordnen) await zuordnen(b.dataset.mqZuordnen);
      else if (b.dataset.mqVerbinden) await ordnerFuerQuelle(b.dataset.mqVerbinden);
      else if (b.dataset.mqTrennen) await trennen(b.dataset.mqTrennen);
      else if (b.dataset.mqFreigeben) await freigeben(b.dataset.mqFreigeben);
    });
    $('#medienDialog').addEventListener('close', async () => {
      // Nicht zugeordneter Medienordner wird wieder gelöst
      if (offenerOrdner) {
        const q = offenerOrdner.quelle;
        offenerOrdner = null;
        Media.clear(q);
        Media.vergissQuelle(q);
        await Store.deleteHandle('medien:' + q);
        zeigeStatus();
      }
    });
  }

  global.Medienordner = {
    zeigeStatus: zeigeStatus, ansichtenAuffrischen: ansichtenAuffrischen,
    nachAnbindung: nachAnbindung, handleVerwenden: handleVerwenden, handlesSpeichern: handlesSpeichern,
    ordnerWaehlen: ordnerWaehlen, ordnerFuerQuelle: ordnerFuerQuelle, dateienAnhaengen: dateienAnhaengen,
    dialogOeffnen: dialogOeffnen, zuordnen: zuordnen,
    trennen: trennen, wiederherstellen: wiederherstellen, verdrahten: verdrahten
  };
})(window);
