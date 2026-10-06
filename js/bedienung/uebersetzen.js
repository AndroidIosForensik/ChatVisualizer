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
  /** Sprachen alphabetisch nach deutschem Namen */
  function sprachOptionen() {
    return Object.keys(Translate.LANGS)
      .sort((a, b) => Translate.LANGS[a].localeCompare(Translate.LANGS[b], 'de'))
      .map(k => '<option value="' + esc(k) + '">' + esc(Translate.LANGS[k]) + '</option>').join('');
  }

  /** Erklärung unter der Sprachwahl: was mit „Von" gerade gemeint ist. */
  function sprachHinweis(conv) {
    const e = Translate.settings;
    const fest = conv ? Translate.sourceFor(conv.key) : '';
    const hinweis = $('#trSourceHint');
    hinweis.classList.remove('warn');
    if (fest && fest === e.target) {
      hinweis.classList.add('warn');
      hinweis.textContent = 'Ausgangs- und Zielsprache sind gleich – hier gibt es nichts zu übersetzen.';
    } else if (fest) {
      hinweis.textContent = 'Alle Nachrichten gelten als ' + Translate.sprachName(fest) +
        (e.skipTarget ? ', außer solche, die schon auf ' + Translate.sprachName(e.target) + ' sind.' : '.');
    } else {
      const erkannt = conv && Translate.erkannteSprache(conv.key);
      hinweis.textContent = 'Die Sprache wird je Nachricht erkannt' +
        (erkannt ? ' – dieser Chat ist überwiegend ' + Translate.sprachName(erkannt) + '.' : '.') +
        ' Bei kurzen Nachrichten oder falscher Erkennung die Sprache fest wählen.';
    }
  }

  function fuellePanel() {
    const e = Translate.settings;
    const conv = state.convByKey.get(state.activeConv);

    const ziel = $('#trTarget');
    if (!ziel.options.length) ziel.innerHTML = sprachOptionen();
    ziel.value = e.target;

    const quelle = $('#trSource');
    if (!quelle.options.length) quelle.innerHTML = '<option value="">Automatisch erkennen</option>' + sprachOptionen();
    quelle.value = conv ? Translate.sourceFor(conv.key) : '';
    quelle.disabled = !conv || Translate.job.active;
    ziel.disabled = Translate.job.active;
    $('#trSwap').disabled = !quelle.value || Translate.job.active;
    $('#trSkipTarget').checked = e.skipTarget;
    sprachHinweis(conv);

    /* Ampel: wird geprüft / einsatzbereit / nicht verfügbar */
    const st = Translate.status;
    const info = $('#trBackendInfo');
    if (st.checking) info.innerHTML = '<span class="dot wait"></span>wird geprüft…';
    else if (st.ok) info.innerHTML = '<span class="dot ok"></span>' + esc(st.detail);
    else info.innerHTML = '<span class="dot bad"></span>' + esc(st.detail || 'noch nicht geprüft');

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
    await Translate.check(true, Translate.sourceFor(state.activeConv));
    fuellePanel();
  }

  /**
   * Nach einem Wechsel der Ausgangssprache: Übersetzungen dieses Chats, die
   * aus einer anderen Sprache entstanden sind, verwerfen – sonst stünde neben
   * der neuen Wahl noch das alte Ergebnis. Übersprungene Nachrichten in der
   * Zielsprache bleiben stehen.
   */
  async function veralteteVerwerfen(conv) {
    const fest = Translate.sourceFor(conv.key);
    if (!fest) return 0;
    const ziel = Translate.settings.target;
    const weg = conv.messages.filter(m => {
      const tr = Translate.get(m.key);
      return tr && tr.s !== fest && !(tr.b === 'skip' && tr.s === ziel);
    }).map(m => m.key);
    if (weg.length) await Translate.clearFor(weg);
    return weg.length;
  }

  /** Sprachwahl übernehmen: prüfen, Ansicht auffrischen, Panel neu füllen. */
  async function spracheGeaendert(conv) {
    const verworfen = conv ? await veralteteVerwerfen(conv) : 0;
    Translate.status.ok = false;            // Verfügbarkeit gilt je Sprachpaar
    Render.renderChat('keep');
    await panelOeffnen();
    if (verworfen) {
      Meldung.zeige(verworfen + ' Übersetzungen aus einer anderen Ausgangssprache verworfen – ' +
        '„Diesen Chat übersetzen" erstellt sie neu.', 'warn');
    }
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
    Translate.vorbereiten(conv);           // noch im Klick: Sprachpaket anfordern
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
    Translate.vorbereiten(conv);           // noch im Klick: Sprachpaket anfordern

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

    Translate.vorbereiten(conv);           // noch im Klick: Sprachpaket anfordern
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
      spracheGeaendert(state.convByKey.get(state.activeConv));
    });
    $('#trSource').addEventListener('change', e => {
      const conv = state.convByKey.get(state.activeConv);
      if (!conv) return;
      Translate.setSource(conv.key, e.target.value);
      spracheGeaendert(conv);
    });
    // Tauschen: aus „Russisch → Deutsch" wird „Deutsch → Russisch"
    $('#trSwap').addEventListener('click', () => {
      const conv = state.convByKey.get(state.activeConv);
      const fest = conv && Translate.sourceFor(conv.key);
      if (!fest) return;
      Translate.setSource(conv.key, Translate.settings.target);
      Translate.settings.target = fest;
      Translate.saveSettings();
      spracheGeaendert(conv);
    });
    $('#trSkipTarget').addEventListener('change', e => {
      Translate.settings.skipTarget = e.target.checked;
      Translate.saveSettings();
      sprachHinweis(state.convByKey.get(state.activeConv));
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
