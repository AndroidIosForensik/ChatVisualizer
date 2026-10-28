/* Zuordnungsdialog: welche Spalte einer fremden CSV ist was?

   Erscheint beim Import, wenn eine Datei Spalten hat, die ChatVisualizer
   nicht kennt, oder wenn Pflicht- bzw. empfohlene Felder fehlen – typisch
   für SQL-Exporte aus Geräte-Datenbanken. Die automatische Zuordnung ist
   vorausgewählt, daneben stehen Beispielwerte und eine Zeitprobe, damit
   Zeitstempel und Zeitzone vor dem Import geprüft werden können.

   Die Antwort wird je Spaltensatz gemerkt (Store.settings 'spaltenZuordnungen'):
   Dateien mit denselben Spalten laufen danach ohne Rückfrage durch.

   Derselbe Dialog dient später zum Ändern (Knopf ⇄ im Chatkopf): Import.neuZuordnen
   öffnet ihn mit der gespeicherten Tabelle und der bisherigen Wahl. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;
  const M = Model;

  const SPEICHER = 'spaltenZuordnungen';

  /* Reihenfolge im Dialog: erst was einen Chat ausmacht, dann Details */
  const FELDER = ['conv', 'convName', 'ts', 'date', 'time', 'sender', 'senderName', 'fromMe', 'text', 'media',
    'type', 'id', 'replyTo', 'reactionTo', 'status', 'read', 'deleted', 'source', 'duration', 'video', 'callResult',
    'tz', 'messenger'];

  const ERKLAERUNG = {
    conv: 'Gleiche Kennung = gleicher Chat',
    convName: 'Steht in der Chatliste',
    ts: 'Datum mit Uhrzeit oder Zahl (Unix, Apple)',
    date: 'Nur nötig, wenn Datum und Uhrzeit getrennt stehen',
    time: 'Wird an das Datum angehängt',
    sender: 'Telefonnummer, JID, Nutzer-ID',
    senderName: 'Wird statt der Kennung angezeigt',
    fromMe: '1/ja/Outgoing = eigene Nachricht',
    deleted: '1/ja = gelöscht, Text bleibt sichtbar',
    source: 'Datei, Tabelle, Zeile – für die Nachvollziehbarkeit',
    tz: 'Nur wenn jede Zeile ihre eigene Zone hat',
    type: '„anruf" bzw. „Videoanruf" für Anrufe',
    duration: 'Sekunden oder h:mm:ss (nur Anrufe)',
    callResult: 'verpasst, abgelehnt, angenommen … (nur Anrufe)'
  };

  /** Kennung eines Spaltensatzes – unabhängig von Reihenfolge und Schreibweise */
  function signatur(header) {
    return header.map(M.kopfNorm).filter(Boolean).sort().join('|');
  }

  function alleGemerkten() {
    const s = Store.settings.get(SPEICHER, {});
    return s && typeof s === 'object' ? s : {};
  }

  /** Gemerkte Zuordnung für diese Spalten, sonst null */
  function gemerkt(header) {
    const eintrag = alleGemerkten()[signatur(header)];
    if (!eintrag || !eintrag.map) return null;
    // Nur Spalten übernehmen, die es in der Datei wirklich gibt
    const map = {};
    for (const f of Object.keys(eintrag.map)) if (header.indexOf(eintrag.map[f]) !== -1) map[f] = eintrag.map[f];
    return { map, zone: eintrag.zone || '', festerChat: eintrag.festerChat || '', messenger: eintrag.messenger || '' };
  }

  function merken(header, wahl) {
    const alle = alleGemerkten();
    alle[signatur(header)] = wahl;
    Store.settings.set(SPEICHER, alle);
  }

  function anzahlGemerkt() { return Object.keys(alleGemerkten()).length; }
  function vergessen() { Store.settings.set(SPEICHER, {}); }

  /**
   * Braucht die Datei den Dialog? Ja, wenn etwas Wichtiges fehlt oder Spalten
   * übrig sind, die nichts zugeordnet bekamen – bei einer Datei im eigenen
   * Format also nicht.
   */
  function noetig(header, map, missingRequired) {
    const vergeben = new Set(Object.values(map));
    const uebrig = header.filter(h => h && !vergeben.has(h));
    return missingRequired.length > 0 || uebrig.length > 0;
  }

  /* ---- Dialog -------------------------------------------------------- */

  /** Die ersten nicht leeren Werte einer Spalte, gekürzt */
  function beispiele(data, spalte, n) {
    const werte = [];
    for (let i = 0; i < data.length && werte.length < n; i++) {
      const w = String(data[i][spalte] == null ? '' : data[i][spalte]).trim();
      if (w) werte.push(w.length > 48 ? w.slice(0, 47) + '…' : w);
    }
    return werte;
  }

  function ortszeitName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Ortszeit'; } catch (e) { return 'Ortszeit'; }
  }

  /** Aktuelle Auswahl aus dem Dialog lesen */
  function leseAuswahl() {
    const map = {};
    for (const sel of document.querySelectorAll('#mapFelder select[data-feld]')) {
      if (sel.value) map[sel.dataset.feld] = sel.value;
    }
    const zonenWahl = $('#mapZone').value;
    const zone = zonenWahl === 'andere' ? $('#mapZoneFrei').value.trim() : zonenWahl;
    return { map, zone, festerChat: $('#mapFesterChat').value.trim(), messenger: $('#mapMessenger').value.trim() };
  }

  /** Beispielwerte, Zeitprobe und Pflichtprüfung nach jeder Änderung auffrischen */
  function auffrischen(header, data) {
    for (const sel of document.querySelectorAll('#mapFelder select[data-feld]')) {
      const ziel = sel.closest('tr').querySelector('.map-bsp');
      ziel.textContent = sel.value ? beispiele(data, sel.value, 2).join('  ·  ') || '(leer)' : '';
    }
    $('#mapZoneFrei').hidden = $('#mapZone').value !== 'andere';

    const wahl = leseAuswahl();
    const probe = $('#mapZeitprobe');
    const zeile = data.find(r => M.rowToMessage(r, wahl.map, '', 0, wahl).tsRaw);
    if (!wahl.map.ts && !wahl.map.date && !wahl.map.time) {
      probe.innerHTML = 'Ohne Zeitspalte bleibt die Reihenfolge der Datei.';
    } else if (!zeile) {
      probe.innerHTML = 'Die gewählte Zeitspalte ist leer.';
    } else {
      const m = M.rowToMessage(zeile, wahl.map, '', 0, wahl);
      probe.innerHTML = m.ts
        ? 'Zeitprobe: <code>' + esc(m.tsRaw) + '</code> → <b>' + esc(M.DT_FULL.format(new Date(m.ts))) +
          '</b>' + (M.zeigeZone() ? '' : ' Ortszeit') + ' · <code>' +
          esc(new Date(m.ts).toISOString().replace('.000Z', 'Z')) + '</code> UTC'
        : 'Zeitprobe: <code>' + esc(m.tsRaw) + '</code> wird <b>nicht</b> als Zeit erkannt.';
    }

    const zoneOk = M.zoneGueltig(wahl.zone);
    $('#mapZoneFrei').classList.toggle('falsch', !zoneOk);
    const chatOk = !!(wahl.map.conv || wahl.map.convName || wahl.festerChat);
    $('#mapFehler').textContent = !chatOk
      ? 'Bitte eine Chat-Kennung oder einen Chatnamen zuordnen – oder unten einen festen Chatnamen eintragen.'
      : !zoneOk ? 'Diese Zeitzone ist unbekannt. Beispiele: UTC, +02:00, Europe/Berlin.' : '';
    $('#mapImport').disabled = !chatOk || !zoneOk;

    const vergeben = new Set(Object.values(wahl.map));
    const frei = header.filter(h => h && !vergeben.has(h));
    $('#mapUebrig').textContent = frei.length ? 'Nicht übernommen: ' + frei.join(', ') : 'Alle Spalten sind zugeordnet.';
  }

  /**
   * Zuordnung abfragen.
   * @param {{datei: string, header: string[], data: object[], map: object, zone: string, messenger: string,
   *          festerChat?: string, neu?: boolean}} a  neu = Zuordnung eines schon importierten Chats ändern
   * @returns {Promise<?{map: object, zone: string, festerChat: string, messenger: string}>} null = überspringen
   */
  function fragen(a) {
    const dialog = $('#mappingDialog');
    $('#mapDatei').textContent = a.datei + ' · ' + a.data.length.toLocaleString('de-DE') + ' Zeilen · ' +
      a.header.length + ' Spalten';

    const optionen = '<option value="">– keine –</option>' +
      a.header.filter(Boolean).map(h => '<option value="' + esc(h) + '">' + esc(h) + '</option>').join('');
    $('#mapFelder').innerHTML = FELDER.map(f =>
      '<tr' + (f === 'conv' || f === 'convName' ? ' class="pflicht"' : '') + '>' +
        '<th><label for="map_' + f + '">' + esc(M.FELD_NAMEN[f]) + '</label>' +
          (ERKLAERUNG[f] ? '<small>' + esc(ERKLAERUNG[f]) + '</small>' : '') + '</th>' +
        '<td><select id="map_' + f + '" data-feld="' + f + '">' + optionen + '</select></td>' +
        '<td class="map-bsp"></td></tr>').join('');
    for (const f of FELDER) $('#map_' + f).value = a.map[f] || '';

    $('#mapZoneOrt').textContent = 'Ortszeit dieses Rechners (' + ortszeitName() + ')';
    const bekannt = Array.from($('#mapZone').options).some(o => o.value === a.zone);
    $('#mapZone').value = bekannt ? a.zone : 'andere';
    $('#mapZoneFrei').value = bekannt ? '' : a.zone;
    $('#mapFesterChat').value = a.festerChat || '';
    $('#mapMessenger').value = a.messenger || '';
    $('#mapMerken').checked = true;
    $('#mapHinweis').hidden = !!a.neu;
    $('#mapHinweisNeu').hidden = !a.neu;
    $('#mapImport').textContent = a.neu ? 'Neu zuordnen' : 'Importieren';
    $('#mapAbbrechen').textContent = a.neu ? 'Abbrechen' : 'Überspringen';

    const neu = () => auffrischen(a.header, a.data);
    dialog.oninput = neu;
    dialog.onchange = neu;
    neu();

    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        dialog.oninput = dialog.onchange = null;
        if (dialog.returnValue !== 'import') { resolve(null); return; }
        const wahl = leseAuswahl();
        if ($('#mapMerken').checked) merken(a.header, wahl);
        resolve(wahl);
      }, { once: true });
      dialog.showModal();
    });
  }

  /**
   * Stammt ein Chat aus mehreren Tabellen: welche soll neu zugeordnet werden?
   * @param {object[]} saetze  gespeicherte Tabellen (Store.getTabelle)
   * @returns {Promise<?object>} gewählte Tabelle oder null
   */
  function waehleTabelle(saetze) {
    const dialog = $('#tabelleDialog');
    $('#tabelleListe').innerHTML = saetze.map((t, i) =>
      '<label><input type="radio" name="tabelleWahl" value="' + i + '"' + (i ? '' : ' checked') + '> <b>' +
        esc(t.datei) + '</b> <small>' + t.data.length.toLocaleString('de-DE') + ' Zeilen' +
        (t.zeit ? ' · importiert ' + esc(new Date(t.zeit).toLocaleString('de-DE')) : '') + '</small></label>').join('');
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        const gewaehlt = dialog.querySelector('input[name="tabelleWahl"]:checked');
        resolve(dialog.returnValue === 'weiter' && gewaehlt ? saetze[+gewaehlt.value] : null);
      }, { once: true });
      dialog.showModal();
    });
  }

  /** Knopf „gemerkte Zuordnungen vergessen" im Hilfefenster */
  function verdrahten() {
    const knopf = $('#mapVergessen');
    if (!knopf) return;
    const beschriften = () => {
      const n = anzahlGemerkt();
      knopf.hidden = !n;
      knopf.textContent = n === 1 ? '1 gemerkte Spaltenzuordnung vergessen' : n + ' gemerkte Spaltenzuordnungen vergessen';
    };
    knopf.addEventListener('click', () => {
      vergessen();
      beschriften();
      Meldung.zeige('Spaltenzuordnungen vergessen – beim nächsten Import wird wieder gefragt.', 'ok');
    });
    $('#helpBtn').addEventListener('click', beschriften);
    document.addEventListener('click', e => { if (e.target.closest('.help-open')) beschriften(); });
  }

  global.Spaltenzuordnung = { gemerkt, merken, noetig, fragen, waehleTabelle, vergessen, anzahlGemerkt, signatur, verdrahten };
})(window);
