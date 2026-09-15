/* Bedienung der Übersetzung (🌐).

   Die eigentliche Arbeit macht daten/translate.js mit der eingebauten
   Übersetzung von Chrome/Edge; hier liegen nur Knopf, Panel und Fortschritt.

   Zwei Wege:
     🌐  legt sofort los (starten)
     ▾   öffnet die Einstellungen (panelOeffnen) */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const $$ = Helfer.$$;
  const esc = Helfer.esc;
  const state = Model.state;

  /* ---- Panel ---------------------------------------------------------- */

  /** Panel mit dem aktuellen Stand füllen (Sprachen, Verfügbarkeit, offene Zahl). */
  function fuellePanel() {
    const e = Translate.settings;

    const ziel = $('#trTarget');
    if (!ziel.options.length) {
      ziel.innerHTML = Object.keys(Translate.LANGS)
        .map(k => '<option value="' + k + '">' + esc(Translate.LANGS[k]) + '</option>').join('');
    }
    ziel.value = e.target;
    $('#trSkipTarget').checked = e.skipTarget;

    /* Ampel: wird geprüft / einsatzbereit / nicht verfügbar */
    const st = Translate.status;
    const info = $('#trBackendInfo');
    if (st.checking) info.innerHTML = '<span class="dot wait"></span>wird geprüft…';
    else if (st.ok) info.innerHTML = '<span class="dot ok"></span>' + esc(st.detail);
    else info.innerHTML = '<span class="dot bad"></span>' + esc(st.detail || 'noch nicht geprüft');

    const conv = state.convByKey.get(state.activeConv);
    const offen = conv ? Translate.pendingMessages(conv).length : 0;
    const knopf = $('#trRun');
    knopf.textContent = Translate.job.active
      ? 'Übersetzt…'
      : (offen ? 'Diesen Chat übersetzen (' + offen + ')' : 'Alles übersetzt');
    knopf.disabled = Translate.job.active || !offen || !st.ok;
    $('#trCancel').hidden = !Translate.job.active;
  }

  async function panelOeffnen() {
    $('#trPanel').classList.add('open');
    $('#trPanelBtn').classList.add('active');
    Translate.status.checking = true;      // sofort „wird geprüft…" zeigen
    fuellePanel();
    await Translate.check(true);
    fuellePanel();
  }

  function panelSchliessen() {
    $('#trPanel').classList.remove('open');
    $('#trPanelBtn').classList.remove('active');
  }

  function istPanelOffen() { return $('#trPanel').classList.contains('open'); }

  /* ---- Ansicht -------------------------------------------------------- */

  /** Fertig übersetzte, aber noch im Original gezeichnete Nachrichten auffrischen. */
  function frischeAnsichtAuf() {
    for (const el of $$('#chatMessages .msg:not(.translated)')) {
      const tr = Translate.get(el.dataset.key);
      if (tr && tr.t) Render.refreshMessage(el.dataset.key);
    }
  }

  /* ---- Läufe ---------------------------------------------------------- */

  /** Den ganzen geöffneten Chat übersetzen. */
  async function laufeChat() {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    fuellePanel();

    const abbruch = () => Translate.cancel();
    Fortschritt.zeige({ icon: '🌐', titel: 'Übersetzt…', pct: 0, zaehler: '', abbruch: abbruch });

    const job = await Translate.translateConversation(conv, j => {
      Fortschritt.laufImPanel('#trProgress', j);
      frischeAnsichtAuf();
      fuellePanel();
      Fortschritt.zeige({
        icon: '🌐', titel: 'Übersetzt…', pct: Fortschritt.prozent(j),
        zaehler: j.done + ' / ' + j.total, abbruch: abbruch
      });
    });

    frischeAnsichtAuf();
    Render.renderConvList();
    fuellePanel();
    Fortschritt.fertig(job.failed ? 'Übersetzt – ' + job.failed + ' fehlgeschlagen' : 'Übersetzung fertig');

    if (job.failed) {
      Meldung.zeige(job.failed + ' von ' + job.total + ' Nachrichten fehlgeschlagen: ' +
        esc(job.error || 'unbekannter Grund'), 'error');
    } else if (job.done) {
      Meldung.zeige(job.done + ' Nachrichten übersetzt.', 'ok');
    }
  }

  /** Eine einzelne Nachricht übersetzen (Knopf an der Sprechblase). */
  async function eineNachricht(key) {
    const conv = state.convByKey.get(state.activeConv);
    const m = conv && conv.messages.find(x => x.key === key);
    if (!m) return;

    const knopf = $('#chatMessages .msg[data-key="' + Helfer.cssAttr(key) + '"] [data-tr-msg]');
    if (knopf) { knopf.classList.add('busy'); knopf.textContent = '…'; }
    Fortschritt.zeige({ icon: '🌐', titel: 'Nachricht wird übersetzt', pct: -1, zaehler: '', abbruch: null });

    try {
      const r = await Translate.translateMessage(m, conv);
      if (r && r.t) Render.refreshMessage(key);
      else if (r && r.b === 'skip') {
        Meldung.zeige('Nachricht ist bereits auf ' + esc(Translate.LANGS[Translate.settings.target]) + '.');
      } else {
        Meldung.zeige('Keine Übersetzung nötig.');
      }
      Translate.flush();
    } catch (e) {
      Meldung.zeige('Übersetzung fehlgeschlagen: ' + esc(e.message || e), 'error');
    } finally {
      Fortschritt.fertig('Übersetzt');
      if (knopf && knopf.isConnected) { knopf.classList.remove('busy'); knopf.textContent = '🌐'; }
    }
  }

  /** Der 🌐-Knopf in der Kopfzeile: ohne Umweg den ganzen Chat übersetzen. */
  async function starten() {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    if (Translate.job.active) { panelOeffnen(); return; }

    if (!Translate.pendingMessages(conv).length) {
      Meldung.zeige('In diesem Chat ist nichts (mehr) zu übersetzen.', 'ok');
      panelOeffnen();
      return;
    }

    panelSchliessen();
    Sprachnachrichten.panelSchliessen();
    Fortschritt.zeige({
      icon: '🌐', titel: 'Übersetzung wird vorbereitet', pct: -1, zaehler: '',
      abbruch: () => Translate.cancel()
    });
    await laufeChat();
    if (!Translate.status.ok) panelOeffnen();        // zeigt den Grund
  }

  /* ---- Ereignisse ----------------------------------------------------- */

  function verdrahten() {
    $('#translateBtn').addEventListener('click', starten);
    $('#trPanelBtn').addEventListener('click', () => {
      if (istPanelOffen()) panelSchliessen();
      else { Sprachnachrichten.panelSchliessen(); panelOeffnen(); }
    });

    $('#trRun').addEventListener('click', laufeChat);
    $('#trCancel').addEventListener('click', () => {
      Translate.cancel();
      Meldung.zeige('Übersetzung abgebrochen.', 'warn');
    });

    $('#trTarget').addEventListener('change', e => {
      Translate.settings.target = e.target.value;
      Translate.saveSettings();
      Translate.status.ok = false;            // Verfügbarkeit gilt je Sprachpaar
      Render.renderChat('keep');
      panelOeffnen();
    });
    $('#trSkipTarget').addEventListener('change', e => {
      Translate.settings.skipTarget = e.target.checked;
      Translate.saveSettings();
    });

    $('#trClearConv').addEventListener('click', async () => {
      const conv = state.convByKey.get(state.activeConv);
      if (!conv) return;
      await Translate.clearFor(conv.messages.map(m => m.key));
      Render.renderChat('keep');
      fuellePanel();
      Meldung.zeige('Übersetzungen dieses Chats gelöscht.', 'warn');
    });

    // Der Browser lädt das Sprachpaket beim ersten Mal selbst herunter
    Translate.onDownloadProgress((beschriftung, pct) => {
      Fortschritt.balken('#trProgress', beschriftung, pct);
      Fortschritt.zeige({
        icon: '🌐', titel: beschriftung, pct: pct,
        zaehler: pct >= 0 ? pct + ' %' : '', abbruch: Fortschritt.aktuellerAbbruch()
      });
    });
  }

  global.Uebersetzen = {
    starten: starten, laufeChat: laufeChat, eineNachricht: eineNachricht,
    panelOeffnen: panelOeffnen, panelSchliessen: panelSchliessen,
    fuellePanel: fuellePanel, verdrahten: verdrahten
  };
})(window);
