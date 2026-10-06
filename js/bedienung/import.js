/* Import von CSV- und WhatsApp-Exporten, Ablegen per Maus, Export und Demodaten.

   Ablauf eines Imports:
     Datei lesen → CSV.toObjects → Model.buildMapping (Spalten zuordnen)
     → Model.rowToMessage (eine Nachricht je Zeile) → zusammenführen
     → Model.rebuild → speichern → neu zeichnen

   Zusammengeführt wird über den Schlüssel „Messenger::nachricht_id": dieselbe
   Datei zweimal zu importieren erzeugt darum keine Doppelten, sondern
   aktualisiert die vorhandenen Nachrichten. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const $$ = Helfer.$$;
  const esc = Helfer.esc;
  const M = Model;
  const state = M.state;

  /* ---- Speichern ----------------------------------------------------- */

  /**
   * Betroffene Unterhaltungen als Block speichern.
   * Ein Datensatz je Unterhaltung statt je Nachricht – das ist bei 50.000
   * Nachrichten der Unterschied zwischen 20 Sekunden und einer halben.
   * @param {Set<string>} convKeys
   */
  async function speichere(convKeys) {
    if (!convKeys || !convKeys.size) return;

    const koerbe = new Map();
    for (const k of convKeys) koerbe.set(k, []);
    for (const m of state.messages) {
      const korb = koerbe.get(m.convKey);
      if (korb) korb.push(m);
    }

    const saetze = [];
    for (const [convKey, messages] of koerbe) saetze.push({ convKey: convKey, messages: messages });
    await Store.putConversations(saetze);
  }

  /* ---- CSV einlesen --------------------------------------------------- */

  /** Internen Feldnamen in den erwarteten Spaltennamen übersetzen (für Meldungen). */
  function spaltenName(feld) {
    const namen = M.FIELDS[feld];
    return namen && namen.length ? namen[0] : feld;
  }

  /**
   * Eine oder mehrere CSV-Dateien einlesen und in den Bestand übernehmen.
   * @param {FileList|File[]} files
   */
  let importQueue = Promise.resolve();

  function importiereDateien(files, options) {
    // FileList vor dem Zurücksetzen des Eingabefeldes sichern. Importe und
    // ihre Dialoge nacheinander abarbeiten, auch bei mehreren Drop-Ereignissen.
    const snapshot = Array.from(files);
    const next = importQueue.then(async () => {
      try { await importiere(snapshot, options || {}); }
      catch (e) { Meldung.zeige('Import fehlgeschlagen: ' + esc(e.message || e), 'error'); }
      finally { $('#importBusy').classList.remove('show'); }
    });
    importQueue = next;
    return next;
  }

  async function importiere(files, options) {
    const liste = Array.from(files).filter(f =>
      /\.(csv|txt|tsv|zip)$/i.test(f.name) || (f.type || '').indexOf('csv') !== -1);
    if (!liste.length) {
      if (files.length) await Medienordner.dateienAnhaengen(files, false);
      else Meldung.zeige('Keine Importdateien gefunden.', 'error');
      return;
    }

    $('#importBusy').classList.add('show');
    let neu = 0, aktualisiert = 0, uebersprungen = 0, lauf = Date.now();
    const probleme = [];
    const eingang = [];
    const kandidaten = [];
    const bericht = [];      // erkannte ALEAPP-Tabellen
    const tabellen = [];     // übrige CSV/TSV, nach dem Bericht verarbeitet
    const chatDateien = new Set();
    let medienGeaendert = false;

    for (const datei of liste) {
      if (/\.zip$/i.test(datei.name)) {
        try {
          const archive = await WhatsAppImport.unzip(datei);
          for (const chat of archive.chats) kandidaten.push({ ...chat, archive });
        } catch (e) { probleme.push('<b>' + esc(datei.name) + '</b>: ' + esc(e.message)); }
      } else kandidaten.push({ file: datei, path: (options.paths && options.paths.get(datei)) || datei.webkitRelativePath || datei.name });
    }

    for (const kandidat of kandidaten) {
      const datei = kandidat.file;
      try {
        const text = await Helfer.leseTextdatei(datei);
        const info = kandidat.info || (/\.txt$/i.test(datei.name) ? WhatsApp.inspect(text) : null);
        if (info) {
          chatDateien.add(datei);
          const einstellungen = await WhatsAppImport.configure(info, kandidat.displayPath || kandidat.path, kandidat.suggestedName);
          if (!einstellungen) continue;
          const slash = kandidat.path.lastIndexOf('/');
          const messages = WhatsApp.parse(info, { ...einstellungen,
            directory: slash >= 0 ? kandidat.path.slice(0, slash) : '' });
          for (const m of messages) eingang.push(m);
          if (kandidat.archive && !kandidat.archive.attached) {
            Media.attachSources(kandidat.archive.sources, kandidat.archive.label);
            kandidat.archive.attached = true;
            medienGeaendert = true;
          }
          continue;
        }
        const { header, data } = CSV.toObjects(text);
        const erkannt = Aleapp.erkenne(header);
        if (erkannt) {
          // Teil eines ALEAPP-Berichts: erst sammeln, dann je App gemeinsam auswerten
          bericht.push(Object.assign({ name: datei.name, data }, erkannt));
          chatDateien.add(datei);
          continue;
        }
        tabellen.push({ datei, pfad: kandidat.path, header, data });
      } catch (e) {
        probleme.push('<b>' + esc(datei.name) + '</b>: ' + esc(e.message || 'Lesefehler'));
      }
    }

    /* Zeilen einer Tabelle (eigene CSV oder zusammengeführter Bericht) übernehmen */
    function zeilenUebernehmen(header, data, ersatzName, map) {
      map = map || M.buildMapping(header).map;
      const vorkommen = new Map();
      for (let zeile = 0; zeile < data.length; zeile++) {
        const m = M.rowToMessage(data[zeile], map, ersatzName, lauf++);
        // Völlig leere Zeilen (kein Text, kein Medium, keine Reaktion) überspringen
        if (!m.text && !m.media && !m.reactionTo && m.type === 'text') { uebersprungen++; continue; }
        m.sourceOrder = zeile;   // gleiche Zeitstempel behalten die Reihenfolge der Datei
        if (!map.id || !String(data[zeile][map.id] || '').trim()) {
          // Ohne ID: stabile ID aus dem Inhalt, damit ein erneuter
          // Import aktualisiert statt zu verdoppeln.
          const signatur = WhatsApp.fingerprint(JSON.stringify([m.conv, m.tsRaw, m.sender, m.text, m.media, m.reactionTo]));
          const n = (vorkommen.get(signatur) || 0) + 1;
          vorkommen.set(signatur, n);
          m.id = 'auto-' + signatur + '-' + n;
          m.key = m.messenger + '::' + m.id;
        }
        eingang.push(m);
      }
    }

    // ALEAPP: alle Tabellen einer App zusammen – Namen, Anhänge, Anrufe, Lesebestätigungen
    const berichtsApps = [];
    for (const satz of Aleapp.kombiniere(bericht)) {
      const vorher = eingang.length;
      zeilenUebernehmen(satz.header, satz.data, satz.app);
      const eintrag = berichtsApps.find(b => b.app === satz.app);
      const abgeglichen = satz.abgeglichen ? { mit: satz.doppeltMit, anzahl: satz.abgeglichen } : null;
      if (eintrag) { eintrag.tabellen += satz.dateien.length; eintrag.nachrichten += eingang.length - vorher; }
      else berichtsApps.push({ app: satz.app, tabellen: satz.dateien.length, nachrichten: eingang.length - vorher, abgeglichen });
    }

    let uebergangen = 0;
    for (const t of tabellen) {
      const { map, missingRequired, missing } = M.buildMapping(t.header);
      if (missingRequired.length) {
        // Aus einem Bericht oder Exportordner: Tabellen ohne Chats (Browser, WLAN,
        // Konten …) und beliebige Textanhänge still übergehen.
        const ausBericht = bericht.length > 0 || Aleapp.istBericht(t.header, t.pfad);
        if ((/\.txt$/i.test(t.datei.name) || ausBericht) && (options.fromFolder || files.length > 1)) {
          if (ausBericht) uebergangen++;
          continue;
        }
        // Die erwarteten Spaltennamen zeigen, nicht die internen Feldnamen
        probleme.push('<b>' + esc(t.datei.name) + '</b>: Pflichtspalten fehlen (' +
          esc(missingRequired.map(spaltenName).join(', ')) +
          ') – übersprungen. <button class="toast-link help-open">Welche Spalten braucht es?</button>');
        uebersprungen += t.data.length;
        continue;
      }
      chatDateien.add(t.datei);
      if (missing.length) {
        probleme.push('<b>' + esc(t.datei.name) + '</b>: empfohlene Spalten fehlen (' +
          esc(missing.map(spaltenName).join(', ')) + ')');
      }
      // Fehlt die Messenger-Spalte, muss der Dateiname herhalten
      const ersatzName = t.datei.name
        .replace(/\.(csv|txt|tsv)$/i, '')
        .replace(/[_\-.]?(export|chat|chats|messages|nachrichten|\d+)/gi, '').trim();
      zeilenUebernehmen(t.header, t.data, ersatzName, map);
    }

    const anhaenge = files.filter(f => !chatDateien.has(f) && !/\.(csv|tsv|zip)$/i.test(f.name));
    if (!options.fromFolder && anhaenge.length && eingang.length) {
      Media.attachFileList(anhaenge);
      medienGeaendert = true;
    }

    /* Zusammenführen: bekannte Schlüssel ersetzen, neue anhängen */
    const index = new Map();
    for (let i = 0; i < state.messages.length; i++) index.set(state.messages[i].key, i);
    const betroffen = new Set();

    for (const m of eingang) {
      const i = index.get(m.key);
      if (i !== undefined) {
        // Umgezogene Nachricht: auch die alte Unterhaltung muss neu gespeichert werden
        if (state.messages[i].convKey !== m.convKey) betroffen.add(state.messages[i].convKey);
        state.messages[i] = m;
        aktualisiert++;
      } else {
        index.set(m.key, state.messages.length);
        state.messages.push(m);
        neu++;
      }
      betroffen.add(m.convKey);
    }

    M.rebuild();
    M.meFromColumn();
    M.guessMe();
    for (const c of state.conversations) c.title = M.conversationTitle(c);
    await speichere(betroffen);

    Render.renderAll();
    if (medienGeaendert) Medienordner.ansichtenAuffrischen();
    $('#importBusy').classList.remove('show');

    let text = '<b>' + neu + '</b> neue Nachrichten importiert';
    if (aktualisiert) text += ', ' + aktualisiert + ' aktualisiert';
    if (uebersprungen) text += ', ' + uebersprungen + ' übersprungen';
    if (berichtsApps.length) {
      text += '<br><span class="toast-note">ALEAPP-Bericht zusammengeführt: ' + berichtsApps.map(b =>
        '<b>' + esc(b.app) + '</b> (' + b.tabellen + (b.tabellen === 1 ? ' Tabelle' : ' Tabellen') +
        (b.nachrichten ? ', ' + b.nachrichten + ' Einträge' : '') +
        (b.abgeglichen ? ', ' + b.abgeglichen.anzahl + ' schon in ' + esc(b.abgeglichen.mit) + ' enthalten' : '') +
        (!b.nachrichten && !b.abgeglichen ? ', keine Nachrichten enthalten' : '') + ')').join(', ') +
        (uebergangen ? ' · ' + uebergangen + ' weitere Tabellen ohne Chats übergangen' : '') + '</span>';
    }
    if (probleme.length) text += '<br><span class="toast-note">' + probleme.slice(0, 4).join('<br>') + '</span>';
    Meldung.zeige(text, probleme.length ? 'warn' : 'ok');

    if (!state.activeConv && state.conversations.length) App.oeffneChat(state.conversations[0].key);
    Dokumentenlauf.alleLesen();          // neue Anhänge gleich durchsuchbar machen
  }

  /* ---- Ablegen per Maus ---------------------------------------------- */

  /**
   * Fallengelassene Dateien und Ordner trennen:
   * Ordner werden als Medienquelle verbunden, CSV-Dateien importiert.
   * @param {DataTransfer} dt
   */
  async function verarbeiteAblage(dt) {
    const einfach = [];
    const offen = [];   // Versprechen auf Handles/Einträge – müssen synchron erzeugt werden

    for (const eintrag of Array.from(dt.items || [])) {
      if (eintrag.kind !== 'file') continue;
      if (typeof eintrag.getAsFileSystemHandle === 'function') {
        offen.push(eintrag.getAsFileSystemHandle());
        continue;
      }
      const alt = typeof eintrag.webkitGetAsEntry === 'function' ? eintrag.webkitGetAsEntry() : null;
      if (alt && alt.isDirectory) { offen.push(Promise.resolve(alt)); continue; }
      const f = eintrag.getAsFile();
      if (f) einfach.push(f);
    }
    if (!offen.length && !einfach.length) {
      for (const f of Array.from(dt.files || [])) einfach.push(f);
    }

    const aufgeloest = await Promise.all(offen.map(p => p.catch(() => null)));
    const dateien = einfach.slice();
    let medien = 0, letzterHandle = null, ordner = 0;

    for (const h of aufgeloest) {
      if (!h) continue;
      if (h.kind === 'directory') {                 // moderner Weg (File System Access API)
        $('#importBusy').classList.add('show');
        medien += await Media.attachDirectoryHandle(h);
        letzterHandle = h; ordner++;
      } else if (h.isDirectory) {                   // älterer Weg (webkitGetAsEntry)
        $('#importBusy').classList.add('show');
        medien += await Media.attachDropEntry(h);
        ordner++;
      } else if (h.kind === 'file') {
        try { dateien.push(await h.getFile()); } catch (e) { /* nicht lesbar */ }
      } else if (h.isFile) {
        const f = await new Promise(res => h.file(res, () => res(null)));
        if (f) dateien.push(f);
      }
    }

    if (ordner) {
      if (letzterHandle) await Store.saveHandle('mediaRoot', letzterHandle);
      await Medienordner.nachAnbindung(medien, true);
    }
    if (dateien.length) await importiereDateien(dateien);
  }

  /* ---- Export --------------------------------------------------------- */

  /** Einen Chat als lesbare Textdatei sichern. */
  function exportiereChat(conv) {
    const ich = M.whoAmI(conv.key);
    const zeilen = ['# ' + conv.title + ' (' + Messengers.brand(conv.messenger).label + ' · ' + conv.conv + ')', ''];

    for (const m of conv.messages) {
      const zeit = m.ts
        ? M.DT_DATE.format(new Date(m.ts)) + ' ' + M.DT_TIME.format(new Date(m.ts))
        : (m.tsRaw || '');
      const wer = m.sender === ich ? m.sender + ' (du)' : m.sender;
      let inhalt = m.text || '';
      if (m.media) inhalt = (inhalt ? inhalt + ' ' : '') + '[' + m.type + ': ' + m.media + ']';
      if (m.reactions) inhalt += ' {' + m.reactions.map(r => r.text + ' ' + r.sender).join(', ') + '}';
      zeilen.push('[' + zeit + '] ' + wer + ': ' + inhalt);
    }

    Helfer.download(conv.messenger + '_' + conv.conv.replace(/[^\w.-]+/g, '_') + '.txt', zeilen.join('\n'));
  }

  /** Alle Nachrichten als JSON sichern (ohne Hilfsfelder). */
  function exportiereAllesJSON() {
    const json = JSON.stringify(state.messages,
      (k, v) => (k === 'reactions' || k === '_i' ? undefined : v), 2);
    Helfer.download('chatvisualizer-export.json', json, 'application/json');
  }

  /* ---- Demodaten ------------------------------------------------------ */

  /** Kleiner Beispielbestand, damit man das Programm ohne eigene Datei ansehen kann. */
  function demodaten() {
    const jetzt = Date.now();
    const zeilen = [];
    let n = 1;

    function add(messenger, conv, absender, text, minutenHer, extra) {
      const r = Object.assign({
        nachricht_id: messenger.slice(0, 2) + (n++),
        zeitstempel: new Date(jetzt - minutenHer * 60000).toISOString(),
        absender_id: absender, unterhaltungs_id: conv, nachrichteninhalt: text,
        nachricht_typ: 'text', medienpfad: '', antwort_auf_id: '', reaktion_auf_id: '',
        status: 'gelesen', messenger: messenger
      }, extra || {});
      zeilen.push(r);
      return r.nachricht_id;
    }

    const a1 = add('WhatsApp', 'wa-fam', 'Mama', 'Kommst du Sonntag zum Essen?', 2880);
    add('WhatsApp', 'wa-fam', 'Ich', 'Ja klar, ich bringe Kuchen mit 🎂', 2875, { antwort_auf_id: a1 });
    const a3 = add('WhatsApp', 'wa-fam', 'Mama', 'Der neue Tisch!', 2870, { nachricht_typ: 'bild', medienpfad: 'medien/gartentisch.png' });
    add('WhatsApp', 'wa-fam', 'Papa', 'Sehr schick 👍', 2860);
    add('WhatsApp', 'wa-fam', 'Ich', '❤️', 2859, { reaktion_auf_id: a3, nachricht_typ: 'reaktion' });
    add('WhatsApp', 'wa-fam', 'Mama', 'Bis Sonntag!', 120, { status: 'zugestellt' });

    const t1 = add('Threema', 'th-team', 'Lena', 'Server-Migration heute Abend 20 Uhr?', 300);
    add('Threema', 'th-team', 'Ich', 'Passt. Ich bereite das Rollback-Skript vor.', 295, { antwort_auf_id: t1 });
    const t3 = add('Threema', 'th-team', 'Jonas', '', 290, { nachricht_typ: 'datei', medienpfad: 'medien/migrationsplan_v3.pdf' });
    add('Threema', 'th-team', 'Lena', '👍', 289, { reaktion_auf_id: t3, nachricht_typ: 'reaktion' });
    add('Threema', 'th-team', 'Ich', 'Kurzes Update: alles grün.', 45, { status: 'gesendet' });

    add('Telegram', 'tg-lauf', 'system', 'Gruppe „Laufgruppe" wurde erstellt', 10000, { nachricht_typ: 'system', absender_id: 'system' });
    add('Telegram', 'tg-lauf', 'Sara', 'Morgen 7 Uhr am Park?', 900);
    add('Telegram', 'tg-lauf', 'Ich', 'Bin dabei 🏃', 890);
    add('Telegram', 'tg-lauf', 'Tim', '', 880, { nachricht_typ: 'audio', medienpfad: 'medien/sprachnachricht_papa.wav' });
    add('Telegram', 'tg-lauf', 'Sara', '', 870, { nachricht_typ: 'standort', nachrichteninhalt: 'Treffpunkt Nordeingang' });

    /* Dieselbe Zuordnung wie beim echten Import benutzen */
    const kopf = ['nachricht_id', 'zeitstempel', 'absender_id', 'unterhaltungs_id', 'nachrichteninhalt',
      'nachricht_typ', 'medienpfad', 'antwort_auf_id', 'reaktion_auf_id', 'status', 'messenger'];
    const map = {};
    for (const feld of Object.keys(M.FIELDS)) {
      const spalte = M.FIELDS[feld].find(c => kopf.indexOf(c) !== -1);
      if (spalte) map[feld] = spalte;
    }

    let lauf = 0;
    const nachrichten = zeilen.map(r => M.rowToMessage(r, map, 'unknown', lauf++));
    for (const m of nachrichten) {
      if (!state.byKey.has(m.key)) { state.messages.push(m); state.byKey.set(m.key, m); }
    }

    state.meGlobal = 'Ich';
    Store.settings.set('meGlobal', 'Ich');
    M.rebuild();
    speichere(new Set(nachrichten.map(m => m.convKey)));
    Render.renderAll();
    if (state.conversations.length) App.oeffneChat(state.conversations[0].key);
    Meldung.zeige('Demodaten geladen – ' + nachrichten.length + ' Nachrichten', 'ok');
  }

  /* ---- Ereignisse ----------------------------------------------------- */

  function verdrahten() {
    // Dateiauswahl
    $('#fileInput').addEventListener('change', e => {
      importiereDateien(e.target.files);
      e.target.value = '';          // damit dieselbe Datei erneut gewählt werden kann
    });
    $$('.import-trigger').forEach(b => b.addEventListener('click', () => $('#fileInput').click()));
    $('#demoBtn').addEventListener('click', demodaten);

    // Ablegen per Maus: dragenter/-leave zählen, weil auch Kindelemente feuern
    let tiefe = 0;
    window.addEventListener('dragenter', e => {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types).indexOf('Files') === -1) return;
      e.preventDefault(); tiefe++; $('#dropzone').classList.add('show');
    });
    window.addEventListener('dragover', e => { if (e.dataTransfer) e.preventDefault(); });
    window.addEventListener('dragleave', () => {
      if (--tiefe <= 0) { tiefe = 0; $('#dropzone').classList.remove('show'); }
    });
    window.addEventListener('drop', e => {
      if (!e.dataTransfer) return;
      e.preventDefault(); tiefe = 0; $('#dropzone').classList.remove('show');
      verarbeiteAblage(e.dataTransfer);
    });

    // Export
    $('#exportChat').addEventListener('click', () => {
      const conv = state.convByKey.get(state.activeConv);
      if (conv) exportiereChat(conv);
    });
    $('#exportAll').addEventListener('click', exportiereAllesJSON);

    // Alles löschen
    $('#clearBtn').addEventListener('click', async () => {
      if (!confirm('Alle importierten Nachrichten löschen?')) return;
      await Store.clear();
      state.messages = [];
      state.byKey = new Map();
      state.activeConv = null;
      M.rebuild();
      Render.renderAll();
      Meldung.zeige('Alle Daten gelöscht.', 'warn');
    });
  }

  global.Import = {
    importiereDateien: importiereDateien, speichere: speichere,
    verarbeiteAblage: verarbeiteAblage, demodaten: demodaten,
    exportiereChat: exportiereChat, exportiereAllesJSON: exportiereAllesJSON,
    verdrahten: verdrahten
  };
})(window);
