/* Medienordner verbinden, anzeigen, trennen.

   Der Ordner selbst wird nie kopiert – gemerkt wird nur ein Verweis
   (File System Access API). Beim nächsten Start fragt der Browser
   gegebenenfalls nach der Freigabe; bis dahin steht der Ordner als
   „wieder verbinden" in der Seitenleiste. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;
  const state = Model.state;

  /* Gemerkter Ordner, dem noch die Freigabe des Nutzers fehlt */
  let wartenderHandle = null;

  /* ---- Anzeige -------------------------------------------------------- */

  /** Zeile unter der Kopfleiste: verbunden, wartend oder nichts. */
  function zeigeStatus() {
    const el = $('#mediaStatus');
    if (Media.count()) {
      el.className = 'media-status connected';
      el.innerHTML = '<span class="ms-icon">🖼️</span><span class="ms-text"><b>' + Media.count() +
        '</b> Mediendateien · <span class="ms-root">' + esc(Media.label()) + '</span></span>' +
        '<button class="ms-x" data-media-detach title="Medienordner trennen">✕</button>';
    } else if (wartenderHandle) {
      el.className = 'media-status pending';
      el.innerHTML = '<span class="ms-icon">🔌</span>' +
        '<button class="ms-link" data-media-reconnect>Medienordner „' +
        esc(wartenderHandle.name) + '" wieder verbinden</button>';
    } else {
      el.className = 'media-status';
      el.innerHTML = '';
    }
  }

  /** Chat und Detailspalte neu zeichnen, damit Medien erscheinen. */
  function ansichtenAuffrischen() {
    if (state.activeConv) {
      Render.renderChat('keep');
      Render.renderDetails();
    }
    zeigeStatus();
  }

  /* ---- Anbinden -------------------------------------------------------- */

  /**
   * Nach dem Anbinden: Zahlen melden, Ansicht auffrischen und im Ordner
   * gefundene CSV-Dateien auf Wunsch gleich mit importieren.
   * @param {number} anzahl        gefundene Dateien
   * @param {boolean} csvImportieren CSV-Dateien aus dem Ordner übernehmen?
   */
  async function nachAnbindung(anzahl, csvImportieren) {
    wartenderHandle = null;
    $('#importBusy').classList.remove('show');
    const zahlen = Media.stats(state.messages);
    ansichtenAuffrischen();

    let text = '<b>' + anzahl + '</b> Dateien aus „' + esc(Media.label()) + '" verbunden';
    if (zahlen.withMedia) {
      text += ' – ' + zahlen.matched + ' von ' + zahlen.withMedia + ' Medien-Nachrichten zugeordnet';
    }
    Meldung.zeige(text, zahlen.withMedia && !zahlen.matched ? 'warn' : 'ok');

    if (csvImportieren) {
      const csvDateien = Media.listByExt(['csv', 'tsv']);
      if (csvDateien.length) {
        const dateien = [];
        for (const e of csvDateien) {
          const f = await Media.getFile(e);
          if (f) dateien.push(f);
        }
        if (dateien.length) await Import.importiereDateien(dateien);
        ansichtenAuffrischen();
      }
    }
    Dokumentenlauf.alleLesen();     // Anhänge im Hintergrund durchsuchbar machen
  }

  /**
   * Einen Ordner-Verweis übernehmen.
   * @param {FileSystemDirectoryHandle} handle
   * @param {boolean} merken         für den nächsten Start speichern
   * @param {boolean} csvImportieren enthaltene CSV-Dateien importieren
   */
  async function handleVerwenden(handle, merken, csvImportieren) {
    $('#importBusy').classList.add('show');
    let anzahl = 0;
    try {
      anzahl = await Media.attachDirectoryHandle(handle);
    } catch (e) {
      $('#importBusy').classList.remove('show');
      Meldung.zeige('Ordner konnte nicht gelesen werden.', 'error');
      return;
    }
    if (merken) await Store.saveHandle('mediaRoot', handle);
    await nachAnbindung(anzahl, csvImportieren);
  }

  /** Ordnerauswahl öffnen – moderner Dialog, sonst der klassische Datei-Dialog. */
  async function ordnerWaehlen() {
    if (Media.supportsPicker()) {
      let handle;
      try {
        handle = await window.showDirectoryPicker({ id: 'chatvisualizer-media', mode: 'read' });
      } catch (e) {
        return;                     // vom Nutzer abgebrochen
      }
      await handleVerwenden(handle, true, true);
    } else {
      $('#dirInput').click();
    }
  }

  /** Eine fertige Dateiliste anbinden (Ordner-Dialog ohne File System Access API). */
  async function dateienAnhaengen(files, csvImportieren) {
    const anzahl = Media.attachFileList(files);
    await nachAnbindung(anzahl, !!csvImportieren);
    return anzahl;
  }

  /** Verbindung lösen (die Dateien selbst bleiben unangetastet). */
  function trennen() {
    Media.clear();
    wartenderHandle = null;
    Store.deleteHandle('mediaRoot');
    ansichtenAuffrischen();
    Meldung.zeige('Medienordner getrennt.', 'warn');
  }

  /**
   * Beim Start den zuletzt benutzten Ordner wieder anbinden.
   * Ohne erteilte Freigabe wird er nur vorgemerkt – das Nachfragen muss
   * vom Nutzer ausgehen, sonst blockt der Browser.
   */
  async function wiederherstellen() {
    try {
      const handle = await Store.getHandle('mediaRoot');
      if (!handle || typeof handle.queryPermission !== 'function') return;

      const rechte = await handle.queryPermission({ mode: 'read' });
      if (rechte === 'granted') {
        const n = await Media.attachDirectoryHandle(handle);
        ansichtenAuffrischen();
        if (n) Meldung.zeige('Medienordner „' + esc(Media.label()) + '" verbunden – ' + n + ' Dateien', 'ok');
        Dokumentenlauf.alleLesen();
      } else {
        wartenderHandle = handle;
        zeigeStatus();
      }
    } catch (e) {
      /* Browser ohne File System Access API – dann eben ohne gemerkten Ordner */
    }
  }

  /* ---- Ereignisse ------------------------------------------------------ */

  function verdrahten() {
    $('#mediaBtn').addEventListener('click', ordnerWaehlen);
    $('#mediaBtnWelcome').addEventListener('click', ordnerWaehlen);

    $('#dirInput').addEventListener('change', async e => {
      const files = e.target.files;
      e.target.value = '';
      if (!files || !files.length) return;
      $('#importBusy').classList.add('show');
      await dateienAnhaengen(files, true);
    });

    $('#mediaStatus').addEventListener('click', async e => {
      if (e.target.closest('[data-media-detach]')) { trennen(); return; }

      if (e.target.closest('[data-media-reconnect]') && wartenderHandle) {
        let rechte = 'denied';
        try { rechte = await wartenderHandle.requestPermission({ mode: 'read' }); } catch (err) { /* abgelehnt */ }
        if (rechte === 'granted') await handleVerwenden(wartenderHandle, true, false);
        else Meldung.zeige('Zugriff auf den Ordner wurde nicht erlaubt.', 'warn');
      }
    });
  }

  global.Medienordner = {
    zeigeStatus: zeigeStatus, ansichtenAuffrischen: ansichtenAuffrischen,
    nachAnbindung: nachAnbindung, handleVerwenden: handleVerwenden,
    ordnerWaehlen: ordnerWaehlen, dateienAnhaengen: dateienAnhaengen,
    trennen: trennen, wiederherstellen: wiederherstellen, verdrahten: verdrahten
  };
})(window);
