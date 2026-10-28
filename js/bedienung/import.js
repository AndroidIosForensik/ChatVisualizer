/* Import von CSV- und WhatsApp-Exporten, Ablegen per Maus, Export und Demodaten.

   Ablauf eines Imports:
     Datei lesen → CSV.toObjects → Model.buildMapping (Spalten zuordnen)
     → Model.rowToMessage (eine Nachricht je Zeile) → zusammenführen
     → Model.rebuild → speichern → neu zeichnen

   Zusammengeführt wird über den Schlüssel „Messenger::nachricht_id": dieselbe
   Datei zweimal zu importieren erzeugt darum keine Doppelten, sondern
   aktualisiert die vorhandenen Nachrichten.

   WhatsApp-Datenbanken (msgstore.db, wa.db, je mit -wal) liest whatsapp-db.js
   direkt. Liegen sie bei – im ALEAPP-Bericht unter data/…, im Fallordner des
   Entschlüsselungs-Tools unter extraktion/… –, ersetzen sie die WhatsApp-TSVs
   des Berichts. Eine Kontaktliste (Name + Nummer) benennt die Chatpartner. */
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
    for (const [convKey, messages] of koerbe) {
      // Leer geworden (Nachrichten umgezogen oder neu zugeordnet): ganz entfernen
      if (messages.length) saetze.push({ convKey: convKey, messages: messages });
      else await Store.deleteConv(convKey);
    }
    await Store.putConversations(saetze);
  }

  /* ---- Tabellen in Nachrichten umsetzen ------------------------------- */

  let lauf = Date.now();     // fortlaufende Nummer für Zeilen ohne ID

  /**
   * Zeilen einer Tabelle (eigene CSV oder zusammengeführter Bericht) in Nachrichten umsetzen.
   * @returns {{messages: object[], uebersprungen: number, warnung: string}}
   */
  function tabelleUmsetzen(header, data, ersatzName, map, auswertung, dateiname) {
    map = map || M.buildMapping(header).map;
    const messages = [];
    let uebersprungen = 0, warnung = '';
    const vorkommen = new Map();
    // Eine ID-Spalte, deren Werte sich wiederholen, taugt nicht als Schlüssel:
    // gleiche ID hieße „dieselbe Nachricht" und Zeilen würden sich überschreiben.
    // Dann wie ohne ID-Spalte eine Kennung aus dem Inhalt bilden.
    let idTaugt = !!map.id;
    if (idTaugt) {
      const ids = new Set();
      for (const r of data) {
        const v = String(r[map.id] || '').trim();
        if (v && ids.has(v)) { idTaugt = false; break; }
        ids.add(v);
      }
      if (!idTaugt) {
        warnung = '<b>' + esc(dateiname || ersatzName) + '</b>: Die Spalte „' + esc(map.id) +
          '“ enthält doppelte Werte und wird nicht als Nachrichten-ID verwendet.';
      }
    }
    for (let zeile = 0; zeile < data.length; zeile++) {
      const m = M.rowToMessage(data[zeile], map, ersatzName, lauf++, auswertung || {});
      // Völlig leere Zeilen (kein Text, kein Medium, keine Reaktion) überspringen –
      // gelöschte Nachrichten nicht: dass es sie gab, ist selbst ein Befund
      if (!m.text && !m.media && !m.reactionTo && m.type === 'text' && !m.deleted) { uebersprungen++; continue; }
      m.sourceOrder = zeile;   // gleiche Zeitstempel behalten die Reihenfolge der Datei
      if (!idTaugt || !String(data[zeile][map.id] || '').trim()) {
        // Ohne ID: stabile ID aus dem Inhalt, damit ein erneuter
        // Import aktualisiert statt zu verdoppeln.
        const signatur = WhatsApp.fingerprint(JSON.stringify([m.conv, m.tsRaw, m.sender, m.text, m.media, m.reactionTo]));
        const n = (vorkommen.get(signatur) || 0) + 1;
        vorkommen.set(signatur, n);
        m.id = 'auto-' + signatur + '-' + n;
        m.key = m.messenger + '::' + m.id;
      }
      messages.push(m);
    }
    return { messages, uebersprungen, warnung };
  }

  /** Kennung einer importierten Tabelle: gleiche Datei = gleiche Kennung */
  function tabellenKennung(dateiname, header, data) {
    return 'tab-' + WhatsApp.fingerprint(JSON.stringify([dateiname, Spaltenzuordnung.signatur(header),
      data.length, data[0] || null, data[data.length - 1] || null]));
  }

  /**
   * Neue Nachrichten in den Bestand übernehmen: bekannte Schlüssel ersetzen, neue anhängen.
   * @param {Set<string>} betroffen  wird um die geänderten Unterhaltungen ergänzt
   */
  function zusammenfuehren(eingang, betroffen) {
    const index = new Map();
    for (let i = 0; i < state.messages.length; i++) index.set(state.messages[i].key, i);
    let neu = 0, aktualisiert = 0;
    for (const m of eingang) {
      const i = index.get(m.key);
      if (i !== undefined) {
        // Umgezogene Nachricht: auch die alte Unterhaltung muss neu gespeichert werden
        if (state.messages[i].convKey !== m.convKey) betroffen.add(state.messages[i].convKey);
        // Erneuter Import ohne Medien (nur die Tabelle): die Medien der alten Quelle behalten
        const alt = state.messages[i].medienQuelle;
        if (alt && alt !== m.medienQuelle && Media.hatOrdner(alt) && !Media.hatOrdner(m.medienQuelle)) m.medienQuelle = alt;
        state.messages[i] = m;
        aktualisiert++;
      } else {
        index.set(m.key, state.messages.length);
        state.messages.push(m);
        neu++;
      }
      betroffen.add(m.convKey);
    }
    return { neu, aktualisiert };
  }

  /** Medienquellen ohne Nachrichten (durch einen neueren Import ersetzt) lösen und vergessen. */
  function quellenAufraeumen(ausser) {
    const benutzt = new Set(state.messages.map(m => m.medienQuelle).filter(Boolean));
    for (const o of Media.ordner()) {
      if (o.id === ausser || o.id === Media.ALLGEMEIN || benutzt.has(o.id)) continue;
      Media.clear(o.id);
    }
    for (const q of Media.quellen()) {
      if (q.id === ausser || benutzt.has(q.id)) continue;
      Media.vergissQuelle(q.id);
      if (Store.deleteHandle) Store.deleteHandle('medien:' + q.id);
    }
  }

  /** Nach dem Zusammenführen: Chats neu aufbauen, speichern, zeichnen. */
  async function abschliessen(betroffen) {
    M.rebuild();
    M.meFromColumn();
    M.guessMe();
    for (const c of state.conversations) c.title = M.conversationTitle(c);
    await speichere(betroffen);
    Render.renderAll();
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
    const pfadVon = f => (options.paths && options.paths.get(f)) || f.webkitRelativePath || f.name;
    // WhatsApp-Datenbanken: nur msgstore.db und wa.db (mit -wal), andere .db bleiben liegen
    const waDateien = WhatsAppDB.findeDateien(Array.from(files).filter(f =>
      /^(msgstore|wa)\.db(-wal)?$/i.test(f.name)), pfadVon);
    const liste = Array.from(files).filter(f =>
      /\.(csv|txt|tsv|zip)$/i.test(f.name) || (f.type || '').indexOf('csv') !== -1);
    if (!liste.length && !waDateien) {
      if (files.length) await Medienordner.dateienAnhaengen(files, false);
      else Meldung.zeige('Keine Importdateien gefunden.', 'error');
      return;
    }

    $('#importBusy').classList.add('show');
    // Jeder Import ist eine Medienquelle: seine Nachrichten suchen Medien nur in seinen Ordnern
    const quelle = options.quelle || Media.neueQuelle(
      (waDateien ? waDateien.msgstore : liste[0]).name + (files.length > 1 ? ' + ' + (files.length - 1) + ' weitere' : ''), 'dateien');
    let uebersprungen = 0;
    const probleme = [];
    const erkannt = new Set();           // Namen der erkannten Berichte/Tabellen
    const eingang = [];
    const kandidaten = [];
    const bericht = [];      // erkannte ALEAPP-Tabellen
    const tabellen = [];     // übrige CSV/TSV, nach dem Bericht verarbeitet
    const chatDateien = new Set();
    const kontakte = [];     // aus Kontaktlisten (kontakte.csv)
    const kontaktDateien = [];
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
            Media.attachSources(kandidat.archive.sources, kandidat.archive.label, quelle);
            kandidat.archive.attached = true;
            medienGeaendert = true;
          }
          continue;
        }
        const { header, data } = CSV.toObjects(text);
        if (WhatsAppDB.istKontaktliste(header)) {
          // Name + Nummer: benennt Chatpartner, ist selbst kein Chat
          kontakte.push(...WhatsAppDB.kontakteAus(header, data));
          kontaktDateien.push(datei.name);
          chatDateien.add(datei);
          continue;
        }
        const aleappTabelle = Aleapp.erkenne(header);
        if (aleappTabelle) {
          // Teil eines ALEAPP-Berichts: erst sammeln, dann je App gemeinsam auswerten
          bericht.push(Object.assign({ name: datei.name, data }, aleappTabelle));
          chatDateien.add(datei);
          continue;
        }
        tabellen.push({ datei, pfad: kandidat.path, header, data });
      } catch (e) {
        probleme.push('<b>' + esc(datei.name) + '</b>: ' + esc(e.message || 'Lesefehler'));
      }
    }

    /* Zeilen einer Tabelle übernehmen; mit Kennung wird die Rohtabelle für
       „Spalten neu zuordnen" gemerkt */
    function zeilenUebernehmen(header, data, ersatzName, map, auswertung, dateiname, tabelle) {
      const r = tabelleUmsetzen(header, data, ersatzName, map, auswertung, dateiname);
      uebersprungen += r.uebersprungen;
      if (r.warnung) probleme.push(r.warnung);
      for (const m of r.messages) {
        if (tabelle) m.tabelle = tabelle;
        eingang.push(m);
      }
    }

    // WhatsApp-Datenbank direkt – dann ohne die WhatsApp-TSVs des Berichts
    let waBericht = null;
    if (waDateien) {
      try {
        const lese = f => f ? f.arrayBuffer() : null;
        const [msgstore, msgstoreWal, wa, waWal] = await Promise.all([waDateien.msgstore, waDateien.msgstoreWal,
          waDateien.wa, waDateien.waWal].map(lese));
        const r = await WhatsAppDB.lies({ msgstore, msgstoreWal, wa, waWal, kontakte,
          kontaktQuelle: kontaktDateien.join(', ') });
        const vorher = eingang.length;
        zeilenUebernehmen(Aleapp.SPALTEN, r.data, 'WhatsApp', null, { zone: 'UTC' });
        waBericht = Object.assign(r.info, { pfad: waDateien.pfad, weitere: waDateien.weitere,
          eintraege: eingang.length - vorher, wa: !!waDateien.wa,
          tsvUebergangen: bericht.filter(b => b.app === 'WhatsApp').length });
        for (let i = bericht.length - 1; i >= 0; i--) if (bericht[i].app === 'WhatsApp') bericht.splice(i, 1);
      } catch (e) {
        probleme.push('<b>' + esc(waDateien.msgstore.name) + '</b>: ' + esc(e.message || e) +
          (bericht.some(b => b.app === 'WhatsApp') ? ' – es werden die WhatsApp-Tabellen des ALEAPP-Berichts verwendet.' : ''));
      }
    }
    // Ohne Datenbank: die Kontaktliste dem WhatsApp-Teil des Berichts mitgeben –
    // aber nur, wenn der Bericht selbst keine Kontakte mit Namen hat
    if (!waBericht && kontakte.length && bericht.some(b => b.app === 'WhatsApp')) {
      const rolle = Aleapp.erkenne(['jid', 'number', 'name']);
      const hatNamen = bericht.some(b => b.app === 'WhatsApp' && b.rolle === 'kontakte' &&
        b.data.some(r => r.name && !Aleapp.istKennung(r.name)));
      if (rolle && !hatNamen) {
        const buch = WhatsAppDB.nummernbuch(kontakte);
        const jids = new Set();
        for (const b of bericht) {
          if (b.app !== 'WhatsApp') continue;
          for (const r of b.data) for (const v of Object.values(r)) {
            const m = /^(\d{6,})@s\.whatsapp\.net$/.exec(String(v).trim());
            if (m) jids.add(m[1]);
          }
        }
        const zeilen = Array.from(jids).map(n => ({ jid: n + '@s.whatsapp.net', number: n, name: buch(n) }))
          .filter(z => z.name);
        if (zeilen.length) bericht.push(Object.assign({ name: kontaktDateien.join(', '), data: zeilen }, rolle));
      }
    }

    // ALEAPP: alle Tabellen einer App zusammen – Namen, Anhänge, Anrufe, Lesebestätigungen
    const berichtsApps = [];
    for (const satz of Aleapp.kombiniere(bericht)) {
      const vorher = eingang.length;
      zeilenUebernehmen(satz.header, satz.data, satz.app, null, { zone: 'UTC' });
      const eintrag = berichtsApps.find(b => b.app === satz.app);
      const abgeglichen = satz.abgeglichen ? { mit: satz.doppeltMit, anzahl: satz.abgeglichen } : null;
      if (eintrag) { eintrag.tabellen += satz.dateien.length; eintrag.nachrichten += eingang.length - vorher; }
      else berichtsApps.push({ app: satz.app, tabellen: satz.dateien.length, nachrichten: eingang.length - vorher, abgeglichen });
    }

    // Übrige Dateien: iLEAPP, rohe Geräte-Datenbanken, eigenes Format, sonst nachfragen
    let uebergangen = 0;
    for (const t of tabellen) {
      let { header, data } = t;
      const datei = t.datei;
      const umgesetzt = Ileapp.umsetzen(header, data) || GeraeteDB.umsetzen(header, data);
      if (umgesetzt) { ({ header, data } = umgesetzt); erkannt.add(umgesetzt.bericht); }
      let { map, missingRequired, missing, utc } = M.buildMapping(header);
      const auswertung = { zone: utc ? 'UTC' : '', festerChat: '' };

      // Fehlt die Messenger-Spalte, muss der Dateiname herhalten
      let ersatzName = datei.name
        .replace(/\.(csv|txt|tsv)$/i, '')
        .replace(/[_\-.]?(export|chat|chats|messages|nachrichten|\d+)/gi, '').trim();

      // Übrige Tabellen eines ALEAPP-Berichts (Browser, WLAN, Konten …) werden nie
      // nachgefragt, sondern still übergangen – ebenso beliebige Textanhänge eines Exportordners.
      const imBericht = /(^|[\\/])_TSV Exports[\\/]/i.test(String(t.pfad || '')) ||
        (bericht.length > 0 && /\.tsv$/i.test(datei.name));
      if (!umgesetzt && imBericht) { uebergangen++; continue; }
      if (missingRequired.length && !umgesetzt && (options.fromFolder || files.length > 1) &&
          (/\.txt$/i.test(datei.name) || Aleapp.istBericht(header, t.pfad))) {
        if (Aleapp.istBericht(header, t.pfad)) uebergangen++;
        continue;
      }

      /* Fremde Spalten: einmal nachfragen, die Antwort gilt dann für alle
         Dateien mit denselben Spalten. Das eigene Format geht ohne Frage durch. */
      if (!umgesetzt) {
        const gemerkt = Spaltenzuordnung.gemerkt(header);
        let wahl = gemerkt;
        if (!wahl && Spaltenzuordnung.noetig(header, map, missingRequired)) {
          wahl = await Spaltenzuordnung.fragen({ datei: t.pfad || datei.name, header, data, map,
            zone: auswertung.zone, messenger: ersatzName });
          // „Überspringen" gilt auch dann, wenn die Datei sich importieren ließe
          if (!wahl && !missingRequired.length) {
            probleme.push('<b>' + esc(datei.name) + '</b>: beim Zuordnen übersprungen');
            uebersprungen += data.length;
            continue;
          }
        }
        if (wahl) {
          ({ map, missingRequired, missing } = M.pruefeMapping(wahl.map, wahl.festerChat));
          auswertung.zone = wahl.zone;
          auswertung.festerChat = wahl.festerChat;
          if (wahl.messenger) ersatzName = wahl.messenger;
        }
      }

      if (missingRequired.length) {
        // Die erwarteten Spaltennamen zeigen, nicht die internen Feldnamen
        probleme.push('<b>' + esc(datei.name) + '</b>: Pflichtspalten fehlen (' +
          esc(missingRequired.map(spaltenName).join(', ')) +
          ') – übersprungen. <button class="toast-link help-open">Welche Spalten braucht es?</button>');
        uebersprungen += data.length;
        continue;
      }
      chatDateien.add(datei);
      if (missing.length) {
        probleme.push('<b>' + esc(datei.name) + '</b>: empfohlene Spalten fehlen (' +
          esc(missing.map(spaltenName).join(', ')) + ')');
      }
      const tabelle = tabellenKennung(t.pfad || datei.name, header, data);
      zeilenUebernehmen(header, data, ersatzName, map, auswertung, datei.name, tabelle);
      await Store.putTabelle({ id: tabelle, datei: t.pfad || datei.name, header, data, ersatzName, quelle,
        wahl: { map, zone: auswertung.zone, festerChat: auswertung.festerChat, messenger: ersatzName },
        zeit: Date.now() });
    }

    // Anhänge: alles außer Tabellen, Datenbanken und verschlüsselten Backups
    const anhaenge = files.filter(f => !chatDateien.has(f) &&
      !/\.(csv|tsv|zip|db|db-wal|db-shm|db-journal|sqlite|sqlite3|crypt\d+)$/i.test(f.name));
    if (!options.fromFolder && anhaenge.length && eingang.length) {
      Media.attachFileList(anhaenge, quelle);
      medienGeaendert = true;
    }

    for (const m of eingang) m.medienQuelle = quelle;
    const betroffen = new Set();
    const { neu, aktualisiert } = zusammenfuehren(eingang, betroffen);
    await abschliessen(betroffen);
    if (eingang.length) quellenAufraeumen(quelle);
    else if (!Media.hatOrdner(quelle)) Media.vergissQuelle(quelle);
    if (medienGeaendert) Medienordner.ansichtenAuffrischen();
    else if (Medienordner.zeigeStatus) Medienordner.zeigeStatus();
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
    if (waBericht) text += '<br><span class="toast-note">' + waMeldung(waBericht) + '</span>';
    else if (kontakte.length) text += '<br><span class="toast-note">Kontaktliste ' + esc(kontaktDateien.join(', ')) +
      ': ' + kontakte.length + ' Einträge</span>';
    if (erkannt.size) text += '<br><span class="toast-note">Erkannt: ' + esc(Array.from(erkannt).join(', ')) + '</span>';
    const medienZahl = Media.stats(state.messages).jeQuelle.get(quelle);
    if (medienZahl && medienZahl.withMedia) {
      text += '<br><span class="toast-note">Medien: ' + (Media.hatOrdner(quelle)
        ? medienZahl.matched + ' von ' + medienZahl.withMedia + ' gefunden'
        : medienZahl.withMedia + (medienZahl.withMedia === 1 ? ' Nachricht' : ' Nachrichten') +
          ' mit Medien – <button class="toast-link" data-media-panel>Medienordner verbinden</button>') + '</span>';
    }
    if (probleme.length) text += '<br><span class="toast-note">' + probleme.slice(0, 4).join('<br>') + '</span>';
    Meldung.zeige(text, probleme.length ? 'warn' : 'ok');

    if (!state.activeConv && state.conversations.length) App.oeffneChat(state.conversations[0].key);
    Dokumentenlauf.alleLesen();          // neue Anhänge gleich durchsuchbar machen
  }

  /** Kurzbericht zum Lesen der WhatsApp-Datenbank für die Meldung nach dem Import */
  function waMeldung(w) {
    const mehr = (n, eins, viele) => n + ' ' + (n === 1 ? eins : viele);
    const teile = ['<b>WhatsApp-Datenbank</b> gelesen (' + esc(w.pfad) + '): ' + mehr(w.nachrichten, 'Nachricht', 'Nachrichten') +
      ' in ' + mehr(w.chats, 'Chat', 'Chats') + (w.reaktionen ? ', ' + mehr(w.reaktionen, 'Reaktion', 'Reaktionen') : '') +
      (w.anrufe ? ', ' + mehr(w.anrufe, 'Anruf', 'Anrufe') : '')];
    if (w.lidZuordnungen) teile.push(mehr(w.lidZuordnungen, 'LID-Kennung ihrer', 'LID-Kennungen ihrer') + ' Telefonnummer zugeordnet');
    if (w.walMsgstore || w.walWa) teile.push((w.walMsgstore + w.walWa) + ' Seiten aus -wal eingespielt');
    if (w.waKontakte) teile.push('Namen aus wa.db (' + w.waKontakte + ' Kontakte)' +
      (w.listeUebergangen ? ', Kontaktliste nicht verwendet' : ''));
    else if (w.listeVerwendet) teile.push(w.benannt + ' Chatpartner über ' + esc(w.kontaktQuelle || 'die Kontaktliste') + ' benannt');
    else teile.push(w.wa ? 'wa.db ohne Kontakte – Namen fehlen (Kontaktliste mit importieren)' : 'ohne wa.db – keine Namen');
    if (w.tsvUebergangen) teile.push(w.tsvUebergangen + ' WhatsApp-Tabellen des ALEAPP-Berichts dadurch ersetzt');
    if (w.weitere) teile.push('weitere msgstore.db im Ordner nicht verwendet');
    return teile.join(' · ');
  }

  /* ---- Spalten neu zuordnen ------------------------------------------- */

  /** Kennungen der gespeicherten Tabellen, aus denen ein Chat stammt */
  function tabellenVon(convKey) {
    const ids = new Set();
    for (const m of state.messages) if (m.convKey === convKey && m.tabelle) ids.add(m.tabelle);
    return Array.from(ids);
  }

  /**
   * Zuordnung einer schon importierten Tabelle ändern: Dialog mit der bisherigen
   * Wahl öffnen, dann alle Nachrichten dieser Tabelle neu aufbauen. Chats können
   * dabei entstehen, umziehen oder wegfallen.
   * @param {string} convKey  Chat, von dem aus der Dialog geöffnet wurde
   */
  async function neuZuordnen(convKey) {
    const ids = tabellenVon(convKey);
    const saetze = (await Promise.all(ids.map(id => Store.getTabelle(id)))).filter(Boolean);
    if (!saetze.length) {
      Meldung.zeige('Zu diesem Chat ist keine Tabelle gespeichert – er stammt aus einem älteren Import, ' +
        'einem ALEAPP-Bericht oder einem WhatsApp-Export. Für eine neue Zuordnung die Datei bitte noch einmal importieren.', 'warn');
      return false;
    }
    const satz = saetze.length > 1 ? await Spaltenzuordnung.waehleTabelle(saetze) : saetze[0];
    if (!satz) return false;

    const alt = satz.wahl || {};
    const wahl = await Spaltenzuordnung.fragen({ datei: satz.datei, header: satz.header, data: satz.data,
      map: alt.map || M.buildMapping(satz.header).map, zone: alt.zone || '', festerChat: alt.festerChat || '',
      messenger: alt.messenger || satz.ersatzName, neu: true });
    if (!wahl) return false;

    const { map, missingRequired } = M.pruefeMapping(wahl.map, wahl.festerChat);
    if (missingRequired.length) { Meldung.zeige('Ohne Chat-Kennung oder Chatnamen lässt sich nichts zuordnen.', 'error'); return false; }
    const ersatzName = wahl.messenger || satz.ersatzName;
    const r = tabelleUmsetzen(satz.header, satz.data, ersatzName, map,
      { zone: wahl.zone, festerChat: wahl.festerChat }, satz.datei);
    for (const m of r.messages) { m.tabelle = satz.id; if (satz.quelle) m.medienQuelle = satz.quelle; }

    // Alles aus dieser Tabelle herausnehmen, dann neu einsetzen
    const betroffen = new Set();
    state.messages = state.messages.filter(m => {
      if (m.tabelle !== satz.id) return true;
      betroffen.add(m.convKey);
      return false;
    });
    zusammenfuehren(r.messages, betroffen);
    satz.wahl = { map, zone: wahl.zone, festerChat: wahl.festerChat, messenger: wahl.messenger };
    satz.ersatzName = ersatzName;
    await Store.putTabelle(satz);
    await abschliessen(betroffen);

    const chats = new Set(r.messages.map(m => m.convKey));
    if (!state.conversations.some(c => c.key === state.activeConv)) {
      const ziel = state.conversations.find(c => chats.has(c.key));
      if (ziel) App.oeffneChat(ziel.key);
    } else if (state.activeConv) App.oeffneChat(state.activeConv);
    let text = '<b>' + esc(satz.datei) + '</b> neu zugeordnet: ' + r.messages.length + ' Nachrichten in ' +
      chats.size + (chats.size === 1 ? ' Chat' : ' Chats');
    if (r.uebersprungen) text += ', ' + r.uebersprungen + ' leere Zeilen übersprungen';
    if (r.warnung) text += '<br><span class="toast-note">' + r.warnung + '</span>';
    Meldung.zeige(text, r.warnung ? 'warn' : 'ok');
    return true;
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
    let medien = 0, ordner = 0, quelle = null;
    // Was zusammen hineingezogen wird, ist ein Import – eine Medienquelle
    const ordnerName = h => h.name || 'Ordner';
    const neu = name => quelle || (quelle = Media.neueQuelle(name, 'ordner'));

    for (const h of aufgeloest) {
      if (!h) continue;
      if (h.kind === 'directory') {                 // moderner Weg (File System Access API)
        $('#importBusy').classList.add('show');
        medien += await Media.attachDirectoryHandle(h, { quelle: neu(ordnerName(h)) });
        ordner++;
      } else if (h.isDirectory) {                   // älterer Weg (webkitGetAsEntry)
        $('#importBusy').classList.add('show');
        medien += await Media.attachDropEntry(h, neu(ordnerName(h)));
        ordner++;
      } else if (h.kind === 'file') {
        try { dateien.push(await h.getFile()); } catch (e) { /* nicht lesbar */ }
      } else if (h.isFile) {
        const f = await new Promise(res => h.file(res, () => res(null)));
        if (f) dateien.push(f);
      }
    }

    if (ordner) {
      await Medienordner.handlesSpeichern(quelle);
      await Medienordner.nachAnbindung(medien, true, quelle);
    }
    if (dateien.length) await importiereDateien(dateien, quelle ? { quelle } : {});
  }

  /* ---- Export --------------------------------------------------------- */

  /* Einen einzelnen Chat exportiert bedienung/pdf-bericht.js als PDF. */

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

    // Spaltenzuordnung des offenen Chats ändern
    $('#spaltenBtn').addEventListener('click', () => {
      if (state.activeConv) importQueue = importQueue.then(() => neuZuordnen(state.activeConv))
        .catch(e => Meldung.zeige('Neu zuordnen fehlgeschlagen: ' + esc(e.message || e), 'error'));
    });

    // Export aller Daten (der einzelne Chat: PdfBericht)
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
    importiereDateien: importiereDateien, speichere: speichere, quellenAufraeumen: quellenAufraeumen,
    neuZuordnen: neuZuordnen, tabellenVon: tabellenVon,
    verarbeiteAblage: verarbeiteAblage, demodaten: demodaten,
    exportiereAllesJSON: exportiereAllesJSON,
    verdrahten: verdrahten
  };
})(window);
