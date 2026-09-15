/* Bedienung der Transkription von Sprachnachrichten (🎤).

   Die Erkennung selbst steckt in daten/transcribe.js – entweder mit dem
   mitgelieferten Whisper-Modell aus `modelle/` (offline) oder mit der
   Spracherkennung von Chrome. Hier liegen Knopf, Panel und Fortschritt.

   Fertige Transkripte verhalten sich anschließend wie Nachrichtentext:
   sie lassen sich durchsuchen und übersetzen. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const $$ = Helfer.$$;
  const esc = Helfer.esc;
  const state = Model.state;

  /* Im Ordner modelle/ gefundene Modelle (wird beim Öffnen des Panels geholt) */
  let modelle = [];

  /* ---- Panel ---------------------------------------------------------- */

  /** Panel mit Verfahren, Modell, Sprache, Verfügbarkeit und offener Zahl füllen. */
  function fuellePanel() {
    const st = Transcribe.status;
    const e = Transcribe.settings;

    $('#scEngine').value = e.engine;

    const modellFeld = $('#scModel');
    if (!modellFeld.options.length && modelle.length) {
      modellFeld.innerHTML = modelle
        .map(k => '<option value="' + k + '">' + esc(Transcribe.MODELLE[k] || k) + '</option>').join('');
    }
    modellFeld.value = e.model;

    const sprachFeld = $('#scLanguage');
    if (!sprachFeld.options.length) {
      sprachFeld.innerHTML = '<option value="auto">Automatisch (aus dem Chat)</option>' +
        ['de', 'en', 'ru', 'fr', 'es', 'it', 'tr', 'pl', 'uk', 'nl', 'pt', 'ar']
          .map(k => '<option value="' + k + '">' + esc(Translate.LANGS[k] || k) + '</option>').join('');
    }
    sprachFeld.value = e.language;

    // Modell- und Sprachwahl gibt es nur beim mitgelieferten Verfahren
    $('#scModelRow').hidden = (e.engine !== 'bundled' || modellFeld.options.length < 2);
    $('#scLangRow').hidden = (e.engine !== 'bundled');

    const info = $('#scInfo');
    if (st.checking) info.innerHTML = '<span class="dot wait"></span>wird geprüft…';
    else if (st.state === 'ready') info.innerHTML = '<span class="dot ok"></span>' + esc(st.detail);
    else info.innerHTML = '<span class="dot bad"></span>' + esc(st.detail || 'noch nicht geprüft');

    const conv = state.convByKey.get(state.activeConv);
    const stimmen = conv ? conv.messages.filter(Transcribe.isVoice) : [];
    const offen = conv ? Transcribe.pendingMessages(conv).length : 0;
    const ohneDatei = stimmen.filter(m => !Transcribe.audioSource(m)).length;

    const knopf = $('#scRun');
    knopf.textContent = Transcribe.job.active
      ? 'Transkribiert…'
      : (offen ? 'Sprachnachrichten transkribieren (' + offen + ')'
               : (stimmen.length ? 'Alles transkribiert' : 'Keine Sprachnachrichten'));
    knopf.disabled = Transcribe.job.active || !offen || st.state !== 'ready';
    $('#scCancel').hidden = !Transcribe.job.active;

    /* Hinweiszeile: fehlende Freigabe in Chrome oder fehlende Audiodateien */
    const hinweis = $('#scHint');
    if (st.state === 'no' && st.hint) {
      hinweis.className = 'tr-hint show';
      hinweis.innerHTML = '<b>' + esc(st.detail) + '</b><pre>' + esc(st.hint) + '</pre>';
    } else if (ohneDatei) {
      hinweis.className = 'tr-hint show';
      hinweis.textContent = ohneDatei + ' von ' + stimmen.length +
        ' Sprachnachrichten fehlen als Datei – dafür den Medienordner verbinden (🖼).';
    } else {
      hinweis.className = 'tr-hint';
      hinweis.innerHTML = '';
    }
  }

  async function panelOeffnen() {
    Uebersetzen.panelSchliessen();
    $('#scPanel').classList.add('open');
    $('#scPanelBtn').classList.add('active');
    Transcribe.status.checking = true;
    fuellePanel();
    modelle = await Transcribe.installedModels();
    await Transcribe.check(true);
    fuellePanel();
  }

  function panelSchliessen() {
    $('#scPanel').classList.remove('open');
    $('#scPanelBtn').classList.remove('active');
  }

  function istPanelOffen() { return $('#scPanel').classList.contains('open'); }

  /* ---- Ansicht -------------------------------------------------------- */

  /** Nachrichten auffrischen, für die inzwischen ein Transkript vorliegt. */
  function frischeAnsichtAuf() {
    for (const el of $$('#chatMessages .msg')) {
      const key = el.dataset.key;
      if (!Transcribe.get(key)) continue;
      if (el.querySelector('.script') || el.querySelector('.orig')) continue;  // schon gezeichnet
      Render.refreshMessage(key);
    }
  }

  /* ---- Läufe ---------------------------------------------------------- */

  /** Alle offenen Sprachnachrichten des geöffneten Chats transkribieren. */
  async function laufeChat() {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    fuellePanel();

    const abbruch = () => Transcribe.cancel();
    Fortschritt.zeige({ icon: '🎤', titel: 'Transkribiert…', pct: 0, zaehler: '', abbruch: abbruch });

    const job = await Transcribe.transcribeConversation(conv, j => {
      Fortschritt.laufImPanel('#scProgress', j);
      frischeAnsichtAuf();
      fuellePanel();
      Fortschritt.zeige({
        icon: '🎤', titel: 'Transkribiert…', pct: Fortschritt.prozent(j),
        zaehler: j.done + ' / ' + j.total, abbruch: abbruch
      });
    });

    frischeAnsichtAuf();
    Render.renderConvList();
    fuellePanel();
    Fortschritt.fertig(job.failed ? 'Transkribiert – ' + job.failed + ' fehlgeschlagen' : 'Transkription fertig');

    if (job.failed) {
      const mehr = Transcribe.status.hint ? '<br><span class="toast-note">Mehr dazu unter 🎤 ▾</span>' : '';
      Meldung.zeige(job.failed + ' von ' + job.total + ' Sprachnachrichten fehlgeschlagen: ' +
        esc(job.error || 'unbekannter Grund') + mehr, 'error');
    } else if (job.done) {
      Meldung.zeige(job.done + ' Sprachnachrichten transkribiert.', 'ok');
    }
  }

  /** Eine einzelne Sprachnachricht transkribieren (Knopf an der Sprechblase). */
  async function eineNachricht(key) {
    const conv = state.convByKey.get(state.activeConv);
    const m = conv && conv.messages.find(x => x.key === key);
    if (!m) return;

    const knopf = $('#chatMessages .msg[data-key="' + Helfer.cssAttr(key) + '"] [data-sc-msg]');
    if (knopf) { knopf.classList.add('busy'); knopf.textContent = '…'; }
    Fortschritt.zeige({ icon: '🎤', titel: 'Sprachnachricht wird transkribiert', pct: -1, zaehler: '', abbruch: null });

    try {
      const r = await Transcribe.transcribeMessage(m, conv);
      if (r && r.t) Render.refreshMessage(key);
      else Meldung.zeige('In dieser Sprachnachricht war nichts Verständliches zu hören.', 'warn');
      Transcribe.flush();
    } catch (e) {
      const mehr = Transcribe.status.hint
        ? '<br><span class="toast-note">Details und Anleitung: 🎤 in der Kopfzeile</span>' : '';
      Meldung.zeige('Transkription fehlgeschlagen: ' + esc(e.message || e) + mehr, 'error');
    } finally {
      Fortschritt.fertig('Transkribiert');
      if (knopf && knopf.isConnected) { knopf.classList.remove('busy'); knopf.textContent = '🎤'; }
    }
  }

  /** Transkript löschen – und mit ihm die daraus entstandene Übersetzung. */
  async function transkriptLoeschen(key) {
    const conv = state.convByKey.get(state.activeConv);
    const m = conv && conv.messages.find(x => x.key === key);
    await Transcribe.clearFor([key]);
    if (m && !m.text) await Translate.clearFor([key]);
    Render.refreshMessage(key);
  }

  /** Der 🎤-Knopf in der Kopfzeile: alle Sprachnachrichten des Chats erfassen. */
  async function starten() {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    if (Transcribe.job.active) { panelOeffnen(); return; }

    const stimmen = conv.messages.filter(Transcribe.isVoice);
    if (!stimmen.length) { Meldung.zeige('In diesem Chat gibt es keine Sprachnachrichten.'); return; }

    const offen = Transcribe.pendingMessages(conv);
    if (!offen.length) {
      const ohneDatei = stimmen.filter(m => !Transcribe.audioSource(m)).length;
      Meldung.zeige(ohneDatei
        ? ohneDatei + ' von ' + stimmen.length + ' Sprachnachrichten fehlen als Datei – Medienordner verbinden (🖼).'
        : 'Alle ' + stimmen.length + ' Sprachnachrichten sind schon transkribiert.',
        ohneDatei ? 'warn' : 'ok');
      panelOeffnen();
      return;
    }

    Uebersetzen.panelSchliessen();
    panelSchliessen();
    Fortschritt.zeige({
      icon: '🎤', titel: 'Spracherkennung wird vorbereitet', pct: -1, zaehler: '',
      abbruch: () => Transcribe.cancel()
    });
    await laufeChat();
    if (Transcribe.status.state !== 'ready') panelOeffnen();     // zeigt den Grund
  }

  /* ---- Ereignisse ----------------------------------------------------- */

  function verdrahten() {
    $('#transcribeBtn').addEventListener('click', starten);
    $('#scPanelBtn').addEventListener('click', () => {
      if (istPanelOffen()) panelSchliessen();
      else { Uebersetzen.panelSchliessen(); panelOeffnen(); }
    });

    $('#scRun').addEventListener('click', laufeChat);
    $('#scCancel').addEventListener('click', () => {
      Transcribe.cancel();
      Meldung.zeige('Transkription abgebrochen.', 'warn');
    });

    $('#scEngine').addEventListener('change', e => {
      Transcribe.settings.engine = e.target.value;
      Transcribe.saveSettings();
      Transcribe.status.state = 'unknown';      // Verfügbarkeit neu prüfen
      panelOeffnen();
    });
    $('#scLanguage').addEventListener('change', e => {
      Transcribe.settings.language = e.target.value;
      Transcribe.saveSettings();
      Transcribe.forgetLanguages();             // erkannte Sprachen verwerfen
    });
    $('#scModel').addEventListener('change', e => {
      Transcribe.settings.model = e.target.value;
      Transcribe.saveSettings();
      Transcribe.whisper.state = 'unknown';
      Transcribe.status.state = 'unknown';
      panelOeffnen();
    });

    $('#scClearConv').addEventListener('click', async () => {
      const conv = state.convByKey.get(state.activeConv);
      if (!conv) return;
      const stimmen = conv.messages.filter(Transcribe.isVoice);
      await Transcribe.clearFor(stimmen.map(m => m.key));
      // Übersetzungen, die nur auf dem Transkript beruhten, werden ungültig
      await Translate.clearFor(stimmen.filter(m => !m.text).map(m => m.key));
      Render.renderChat('keep');
      fuellePanel();
      Meldung.zeige('Transkripte dieses Chats gelöscht.', 'warn');
    });

    // Das Modell wird beim ersten Mal aus modelle/ geladen (einige hundert MB)
    Transcribe.onDownloadProgress((beschriftung, pct) => {
      Fortschritt.balken('#scProgress', beschriftung, pct);
      Fortschritt.zeige({
        icon: '🎤', titel: beschriftung, pct: pct,
        zaehler: pct >= 0 ? pct + ' %' : '', abbruch: Fortschritt.aktuellerAbbruch()
      });
    });
  }

  global.Sprachnachrichten = {
    starten: starten, laufeChat: laufeChat, eineNachricht: eineNachricht,
    transkriptLoeschen: transkriptLoeschen,
    panelOeffnen: panelOeffnen, panelSchliessen: panelSchliessen,
    fuellePanel: fuellePanel, verdrahten: verdrahten
  };
})(window);
