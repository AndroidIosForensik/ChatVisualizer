/* Import-Assistent: führt in drei Schritten durch den Import.

     1. Was? – Bericht/Export oder Datenbank, dazu der Katalog der Datenbanken
     2. Prüfung – was im gewählten Ordner bzw. in den Dateien steckt, mit
        Ampel und Rat für alles, was nicht direkt geht (Datenbanken.pruefe)
     3. Importieren – über die üblichen Wege (Medienordner.nachAnbindung für
        Ordner, Import.importiereDateien für Dateien)

   Ein gewählter Ordner wird schon für die Prüfung als Medienquelle verbunden
   (so ist er nur einmal zu lesen). Bricht man ab, wird er wieder gelöst. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;

  /* Aktuelle Auswahl: { weg: 'bericht'|'db', art: 'ordner'|'dateien', name, quelle?, handle?, anzahl,
                         dateien: [{ name, pfad, holen: () => Promise<File> }] } */
  let auswahl = null;
  let lauf = 0;                      // verhindert, dass eine alte Prüfung eine neue überschreibt

  const MEDIEN = /\.(jpe?g|png|gif|webp|heic|heif|bmp|mp4|mov|3gp|webm|mkv|m4v|opus|ogg|oga|m4a|mp3|aac|amr|wav|pdf|docx?|xlsx?|pptx?|vcf|webp)$/i;
  const SYMBOL = { ok: '✓', warn: '⚠', fehler: '🔒', info: 'ℹ', leer: '✗' };
  const STATUS = { direkt: 'ok', bericht: 'warn', verschluesselt: 'fehler', unbekannt: 'info' };

  /* ---- Schritte -------------------------------------------------------- */

  function schritt(name) {
    $('#impWahl').hidden = name !== 'wahl';
    $('#impPruefung').hidden = name !== 'pruefung';
    $('#impZurueck').hidden = name !== 'pruefung';
    $('#impImport').hidden = name !== 'pruefung';
  }

  function katalogHTML() {
    const marke = { direkt: '<span class="imp-marke ok">direkt</span>', bericht: '<span class="imp-marke warn">über Bericht/CSV</span>',
      verschluesselt: '<span class="imp-marke fehler">verschlüsselt</span>' };
    return '<table class="imp-tabelle"><thead><tr><th>Datenbank</th><th>Dateien</th><th>Versionen</th><th>Stand</th></tr></thead><tbody>' +
      Datenbanken.KATALOG.map(k => '<tr><td>' + esc(k.name) + '</td><td><code>' + esc(k.dateien) + '</code></td><td>' +
        esc(k.versionen) + '</td><td>' + marke[k.status] + '<br><small>' + esc(k.hinweis) + '</small></td></tr>').join('') +
      '</tbody></table>';
  }

  async function oeffnen() {
    verwerfen();
    schritt('wahl');
    $('#impKatalog').innerHTML = katalogHTML();
    const d = $('#importDialog');
    if (!d.open) d.showModal();
  }

  /** Auswahl verwerfen – einen schon verbundenen Ordner wieder lösen */
  function verwerfen() {
    lauf++;
    if (auswahl && auswahl.quelle) {
      Media.clear(auswahl.quelle);
      Media.vergissQuelle(auswahl.quelle);
    }
    auswahl = null;
  }

  /* ---- Auswählen --------------------------------------------------------- */

  async function ordnerWaehlen(weg) {
    if (!Media.supportsPicker()) { $('#impOrdner').dataset.weg = weg; $('#impOrdner').click(); return; }
    let handle;
    try {
      handle = await global.showDirectoryPicker({ id: 'chatvisualizer-import', mode: 'read' });
    } catch (e) {
      return;                         // abgebrochen
    }
    schritt('pruefung');
    warten('Ordner „' + handle.name + '“ wird gelesen …');
    const quelle = Media.neueQuelle(handle.name, 'ordner');
    let anzahl = 0;
    try {
      anzahl = await Media.attachDirectoryHandle(handle, { quelle });
    } catch (e) {
      Media.vergissQuelle(quelle);
      zeigeFunde([{ status: 'leer', titel: 'Ordner nicht lesbar', text: e.message || String(e) }]);
      return;
    }
    auswahl = { weg, art: 'ordner', name: handle.name, quelle, handle, anzahl,
      dateien: Media.eintraege(quelle).map(e => ({ name: e.name, pfad: e.originalPath, holen: () => Media.getFile(e) })) };
    await pruefen();
  }

  function ausDateiliste(files, weg, ordner) {
    const liste = Array.from(files || []);
    if (!liste.length) return;
    if (ordner) {
      const name = (liste[0].webkitRelativePath || '').split('/')[0] || 'Ordner';
      const quelle = Media.neueQuelle(name, 'ordner');
      const anzahl = Media.attachFileList(liste, quelle);
      auswahl = { weg, art: 'ordner', name, quelle, anzahl,
        dateien: liste.map(f => ({ name: f.name, pfad: f.webkitRelativePath || f.name, holen: async () => f })) };
    } else {
      const namen = liste.map(f => f.name);
      auswahl = { weg, art: 'dateien', name: namen.slice(0, 3).join(', ') + (namen.length > 3 ? ' …' : ''), anzahl: liste.length,
        dateien: liste.map(f => ({ name: f.name, pfad: f.name, holen: async () => f, file: f })) };
    }
    pruefen();
  }

  /* ---- Prüfen ------------------------------------------------------------ */

  function warten(text) {
    $('#impFunde').innerHTML = '';
    $('#impWarten').hidden = false;
    $('#impWarten').textContent = text;
    $('#impImport').disabled = true;
  }

  async function pruefen() {
    const meinLauf = ++lauf;
    schritt('pruefung');
    $('#impQuelle').innerHTML = (auswahl.art === 'ordner' ? '📁 ' : '📄 ') + '<b>' + esc(auswahl.name) + '</b> · ' +
      mehr(auswahl.anzahl, 'Datei', 'Dateien');
    warten('Wird geprüft …');
    let funde;
    try {
      funde = await analysieren(auswahl);
    } catch (e) {
      funde = [{ status: 'leer', titel: 'Prüfung fehlgeschlagen', text: e.message || String(e) }];
    }
    if (meinLauf !== lauf) return;
    zeigeFunde(funde);
  }

  function zeigeFunde(funde) {
    $('#impWarten').hidden = true;
    $('#impFunde').innerHTML = funde.map(f =>
      '<div class="imp-fund ' + f.status + '"><span class="imp-ampel">' + SYMBOL[f.status] + '</span><div>' +
        '<b>' + esc(f.titel) + '</b>' + (f.text ? '<p>' + f.text + '</p>' : '') + '</div></div>').join('');
    const geht = funde.some(f => f.status === 'ok' || f.import);
    $('#impImport').disabled = !geht;
    $('#impImport').textContent = geht ? 'Importieren' : 'Nichts zu importieren';
  }

  const zahl = n => Number(n || 0).toLocaleString('de-DE');
  const mehr = (n, eins, viele) => zahl(n) + ' ' + (Number(n) === 1 ? eins : viele);
  const datum = ms => new Date(ms).toLocaleDateString('de-DE');

  /**
   * Was steckt in der Auswahl? Liefert Funde mit Ampel (ok, warn, fehler, info, leer).
   * Gelesen werden nur Kopfzeilen und Datenbank-Tabellen, nichts wird importiert.
   */
  async function analysieren(a) {
    const funde = [];
    const pfad = d => String(d.pfad || d.name).replace(/\\/g, '/');
    const imBericht = d => /(^|\/)_TSV Exports\//i.test(pfad(d));
    const tsv = a.dateien.filter(d => imBericht(d) && /\.tsv$/i.test(d.name));
    const dbs = a.dateien.filter(d => Datenbanken.istDatenbankName(d.name) && !/^_lava/i.test(d.name));
    const zips = a.dateien.filter(d => /\.zip$/i.test(d.name));
    const chats = a.dateien.filter(d => /\.txt$/i.test(d.name) && (/^whatsapp/i.test(d.name) || /^_chat\.txt$/i.test(d.name)));
    const tabellen = a.dateien.filter(d => /\.(csv|tsv)$/i.test(d.name) && !imBericht(d));
    const medien = a.dateien.filter(d => MEDIEN.test(d.name) && !/\.nomedia$/i.test(d.name));
    const ordnerVon = d => pfad(d).replace(/[^/]*$/, '');

    // WhatsApp-Datenbank, die der Import tatsächlich nimmt
    const wa = WhatsAppDB.findeDateien(a.dateien.map(d => Object.assign({ name: d.name }, d)), d => d.pfad);

    // 1. Bericht
    if (tsv.length) {
      const apps = new Map();
      for (const d of tsv) {
        const app = d.name.split(' - ')[0].trim();
        apps.set(app, (apps.get(app) || 0) + 1);
      }
      const art = a.dateien.some(d => /ileapp/i.test(pfad(d))) ? 'iLEAPP' : 'ALEAPP';
      const liste = Array.from(apps.entries()).sort((x, y) => y[1] - x[1]).slice(0, 8)
        .map(([app, n]) => esc(app) + ' (' + n + ')').join(', ');
      funde.push({ status: 'ok', titel: art + '-Bericht: ' + tsv.length + ' Tabellen',
        text: liste + (apps.size > 8 ? ' …' : '') + '. Die Tabellen einer App werden zusammengeführt, Tabellen ohne Chats übergangen.' +
          (wa ? ' <b>Die WhatsApp-Tabellen werden durch die Datenbank ersetzt</b> (siehe unten).' : '') });
    }

    // 2. Datenbanken
    let geprueft = 0;
    const kontaktlisten = [];
    for (const d of tabellen) {
      if (!/\.csv$/i.test(d.name)) continue;
      const f = await d.holen();
      if (!f || f.size > 5e6) continue;
      const { header, data } = CSV.toObjects(await Helfer.leseTextdatei(f));
      if (WhatsAppDB.istKontaktliste(header)) kontaktlisten.push({ d, n: WhatsAppDB.kontakteAus(header, data).length });
    }
    let waKontakte = null;
    const verschluesselt = new Map();          // Katalog-Eintrag → Dateinamen (eine Zeile statt vieler)
    for (const d of dbs) {
      if (geprueft >= 25) {
        funde.push({ status: 'info', titel: 'Weitere ' + (dbs.length - geprueft) + ' Datenbanken nicht geprüft', text: '' });
        break;
      }
      const f = await d.holen();
      if (!f) continue;
      geprueft++;
      const r = await Datenbanken.pruefe(f);
      // In einem Bericht liegen viele fremde Datenbanken – nur bekannte zeigen
      if (!r.eintrag && tsv.length) continue;
      const k = r.eintrag;
      if (k && k.status === 'verschluesselt') {
        if (!verschluesselt.has(k)) verschluesselt.set(k, []);
        verschluesselt.get(k).push(d.name);
        continue;
      }
      const genommen = !!wa && pfad(wa.msgstore) === pfad(d);
      const titel = (k ? k.name : 'Datenbank') + ' · ' + d.name;
      let text = r.text || '';
      let status = STATUS[r.status] || 'info';
      if (k && k.id === 'whatsapp-android') {
        const z = r.details || {};
        if (d.name.toLowerCase() !== 'msgstore.db') {
          status = 'info';
          text = 'Älterer Tagesstand – wird nicht importiert, nur msgstore.db.';
        } else if (!genommen && wa) {
          status = 'info';
          text = 'Weitere msgstore.db – importiert wird ' + wa.pfad + '.';
        } else {
          text = mehr(z.nachrichten, 'Nachricht', 'Nachrichten') + ' in ' + mehr(z.chats, 'Chat', 'Chats') +
            (z.von ? ' · ' + datum(z.von) + ' bis ' + datum(z.bis) : '') +
            (z.lid ? ' · ' + mehr(z.lid, 'LID-Kennung wird ihrer', 'LID-Kennungen werden ihrer') + ' Nummer zugeordnet' : '') +
            (wa && wa.msgstoreWal ? ' · mit -wal' : '') + '.';
        }
      } else if (k && k.id === 'whatsapp-kontakte') {
        waKontakte = (r.details || {}).kontakte || 0;
        status = waKontakte ? 'ok' : 'warn';
        text = waKontakte ? mehr(waKontakte, 'Kontakt', 'Kontakte') + ' – liefert die Namen.'
          : 'Keine Kontakte (so ist die wa.db aus einem Backup immer) – Namen kommen aus einer Kontaktliste.';
      }
      funde.push({ status, titel, text: esc(text) });
    }
    for (const [k, namen] of verschluesselt) {
      funde.push({ status: 'fehler', titel: k.name + ' · ' + (namen.length === 1 ? namen[0] : namen.length + ' Dateien'),
        text: esc(k.hinweis) + (namen.length > 1 ? '<br><small>' + esc(namen.slice(0, 6).join(', ')) +
          (namen.length > 6 ? ' …' : '') + '</small>' : '') });
    }
    if (wa && !wa.wa) {
      funde.push({ status: 'warn', titel: 'Keine wa.db', text: 'Ohne wa.db fehlen Namen, die nur dort stehen. ' +
        'Liegt sie im selben Ordner wie die msgstore.db, wird sie automatisch genommen.' });
    }

    // 3. Kontaktlisten
    for (const { d, n } of kontaktlisten) {
      funde.push({ status: wa && waKontakte ? 'info' : 'ok', titel: 'Kontaktliste · ' + d.name,
        text: mehr(n, 'Eintrag', 'Einträge') + (wa && waKontakte ? ' – wird nicht gebraucht, die wa.db hat eigene Kontakte.'
          : ' – benennt die Chatpartner.') });
    }
    if (wa && waKontakte === 0 && !kontaktlisten.length) {
      funde.push({ status: 'warn', titel: 'Keine Namen', text: 'Weder die wa.db noch eine Kontaktliste enthalten Namen – ' +
        'die Chatpartner erscheinen mit ihrer Nummer. Kontakte holt der WhatsAppE2EDecryptor im Reiter „Vom Gerät (adb)“ ' +
        '(kontakte.csv), oder jede CSV mit Name und Nummer.' });
    }

    // 4. WhatsApp-Chatexporte
    for (const d of zips) funde.push({ status: 'ok', titel: 'ZIP · ' + d.name, text: 'WhatsApp-Chatexport: Chat und Medien werden entpackt.' });
    for (const d of chats) funde.push({ status: 'ok', titel: 'WhatsApp-Chatexport · ' + d.name, text: 'Datumsformat und Namen werden beim Import abgefragt.' });

    // 5. Übrige Tabellen
    const sonstige = tabellen.filter(d => !kontaktlisten.some(k => k.d === d));
    if (sonstige.length) {
      funde.push({ status: 'ok', titel: sonstige.length === 1 ? 'Tabelle · ' + sonstige[0].name : sonstige.length + ' Tabellen (CSV/TSV)',
        text: 'Eigenes Format und bekannte SQL-Exporte gehen direkt durch; bei unbekannten Spalten fragt der Dialog „Spalten zuordnen“.' });
    }

    // 6. Medien
    if (medien.length) {
      funde.push({ status: 'info', titel: mehr(medien.length, 'Mediendatei', 'Mediendateien'),
        text: a.art === 'ordner' ? 'Gehören zu diesem Import – Bilder, Videos und Sprachnachrichten werden nur hier gesucht.'
          : 'Werden als Anhänge dieses Imports verbunden.' });
    }

    if (!funde.some(f => f.status === 'ok')) {
      if (medien.length && Model.state.messages.length) {
        funde.push({ status: 'info', titel: 'Nur Medien?', text: 'Einen Ordner, der nur Bilder, Videos oder Sprachnachrichten ' +
          'enthält, über 🖼 „Medienquellen“ dem Import zuordnen, zu dem er gehört.' });
      }
      funde.unshift({ status: 'leer', titel: 'Nichts direkt Importierbares gefunden', text: a.weg === 'db'
        ? 'Gesucht wurden Geräte-Datenbanken wie <code>msgstore.db</code>. Beim Fallordner des WhatsAppE2EDecryptors den ganzen Ordner ' +
          '<code>WA_ADB_…</code> wählen, beim ALEAPP-Bericht den Berichtsordner.'
        : 'Gesucht wurden ALEAPP-/iLEAPP-Berichte (Ordner mit <code>_TSV Exports</code>), WhatsApp-Chatexporte (TXT/ZIP) und CSV/TSV.' });
    }
    return funde;
  }

  /* ---- Importieren ------------------------------------------------------- */

  async function importieren() {
    const a = auswahl;
    if (!a) return;
    auswahl = null;                    // nicht mehr verwerfen
    $('#importDialog').close();
    $('#importBusy').classList.add('show');
    try {
      if (a.art === 'ordner') {
        if (a.handle) await Medienordner.handlesSpeichern(a.quelle);
        await Medienordner.nachAnbindung(a.anzahl, true, a.quelle);
      } else {
        const files = (await Promise.all(a.dateien.map(d => d.holen()))).filter(Boolean);
        await Import.importiereDateien(files);
      }
    } finally {
      $('#importBusy').classList.remove('show');
    }
  }

  /* ---- Ereignisse ---------------------------------------------------------- */

  function verdrahten() {
    Helfer.$$('.import-trigger').forEach(b => b.addEventListener('click', oeffnen));
    const dialog = $('#importDialog');
    dialog.addEventListener('click', e => {
      const b = e.target.closest('[data-imp]');
      if (!b) return;
      const [weg, art] = b.dataset.imp.split('-');
      if (art === 'ordner') ordnerWaehlen(weg);
      else { $('#impDateien').dataset.weg = weg; $('#impDateien').click(); }
    });
    $('#impDateien').addEventListener('change', e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      ausDateiliste(files, e.target.dataset.weg || 'bericht', false);
    });
    $('#impOrdner').addEventListener('change', e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      ausDateiliste(files, e.target.dataset.weg || 'bericht', true);
    });
    $('#impZurueck').addEventListener('click', () => { verwerfen(); schritt('wahl'); });
    // Dateien auf den offenen Assistenten ziehen: gleich prüfen statt sofort importieren
    dialog.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    dialog.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) { verwerfen(); pruefeDateien(files); }
    });
    $('#impImport').addEventListener('click', importieren);
    dialog.addEventListener('close', verwerfen);
  }

  /** Dateien prüfen lassen (Ablegen auf dem Assistenten) */
  function pruefeDateien(files, weg) { ausDateiliste(files, weg || 'bericht', false); }

  global.ImportAssistent = { oeffnen, verdrahten, analysieren, pruefeDateien };
})(window);
