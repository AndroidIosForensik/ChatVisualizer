/* Fortschrittsanzeigen für längere Läufe (Übersetzen, Transkribieren, Dokumente).

   Zwei Darstellungen:
   - die Leiste über dem Chat (#jobBar): immer sichtbar, auch wenn ein Panel zu ist
   - der kleine Balken in einem Panel (#trProgress, #scProgress)

   Ist kein Prozentwert bekannt (pct < 0), läuft der Balken unbestimmt durch,
   statt eine erfundene Zahl zu zeigen. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;

  /* Aktueller Zustand der Leiste */
  const leiste = { icon: '', titel: '', pct: -1, zaehler: '', abbruch: null };
  let ausblendTimer = null;

  function zeichne() {
    const el = $('#jobBar');
    if (!el) return;
    if (!leiste.icon) { el.classList.remove('show', 'done'); return; }

    el.classList.add('show');
    $('.job-icon', el).textContent = leiste.icon;
    $('.job-title', el).textContent = leiste.titel;
    $('.job-count', el).textContent = leiste.zaehler;

    const linie = $('.job-line', el);
    const balken = $('i', linie);
    if (leiste.pct >= 0) {
      linie.classList.remove('unbestimmt');
      balken.style.width = leiste.pct + '%';
    } else {
      linie.classList.add('unbestimmt');
      balken.style.width = '';
    }
    $('.job-cancel', el).hidden = !leiste.abbruch;
  }

  /**
   * Leiste zeigen oder aktualisieren.
   * @param {{icon?:string, titel?:string, pct?:number, zaehler?:string, abbruch?:Function|null}} teile
   */
  function zeige(teile) {
    clearTimeout(ausblendTimer);
    Object.assign(leiste, teile);
    const el = $('#jobBar');
    if (el) el.classList.remove('done');
    zeichne();
  }

  /** Lauf beenden: kurz grün stehen lassen, dann ausblenden. */
  function fertig(text) {
    clearTimeout(ausblendTimer);
    leiste.pct = 100;
    leiste.zaehler = '';
    leiste.abbruch = null;
    if (text) leiste.titel = text;
    zeichne();
    const el = $('#jobBar');
    if (el) el.classList.add('done');
    ausblendTimer = setTimeout(() => {
      leiste.icon = '';
      leiste.abbruch = null;
      leiste.pct = -1;
      zeichne();
    }, 2600);
  }

  /** Aus einem Job-Objekt {done,total} den Prozentwert bilden. */
  function prozent(job) {
    return job && job.total ? Math.round(job.done / job.total * 100) : 0;
  }

  /** Den gerade hinterlegten Abbruch auslösen (Knopf in der Leiste). */
  function abbrechen() {
    if (leiste.abbruch) leiste.abbruch();
  }

  /** Aktuell hinterlegte Abbruchfunktion – zum Weiterreichen beim Aktualisieren. */
  function aktuellerAbbruch() { return leiste.abbruch; }

  /* ---- Balken innerhalb eines Panels -------------------------------- */

  /** Ladebalken im Panel; ohne bekannte Gesamtgröße läuft er unbestimmt durch. */
  function balken(kastenId, beschriftung, pct) {
    const kasten = $(kastenId);
    if (!kasten) return;
    kasten.className = 'tr-progress show';
    kasten.innerHTML =
      '<div class="tr-bar' + (pct < 0 ? ' unbestimmt' : '') + '">' +
        '<i' + (pct >= 0 ? ' style="width:' + pct + '%"' : '') + '></i></div>' +
      '<div class="tr-bar-text">' + esc(beschriftung) + (pct >= 0 ? ' · ' + pct + ' %' : '') + '</div>';
  }

  /** Zählerstand eines Laufs im Panel darstellen. */
  function laufImPanel(kastenId, job) {
    const kasten = $(kastenId);
    if (!kasten) return;
    if (!job.active && !job.done) { kasten.className = 'tr-progress'; kasten.innerHTML = ''; return; }
    kasten.className = 'tr-progress show';
    kasten.innerHTML =
      '<div class="tr-bar"><i style="width:' + prozent(job) + '%"></i></div>' +
      '<div class="tr-bar-text">' + job.done + ' / ' + job.total +
        (job.failed ? ' · ' + job.failed + ' fehlgeschlagen' : '') + '</div>' +
      (job.error ? '<div class="tr-err">' + esc(job.error) + '</div>' : '');
  }

  /** Knopf „Abbrechen" in der Leiste verdrahten. */
  function verdrahten() {
    const knopf = $('#jobBar .job-cancel');
    if (knopf) knopf.addEventListener('click', abbrechen);
  }

  global.Fortschritt = {
    zeige: zeige, fertig: fertig, prozent: prozent,
    balken: balken, laufImPanel: laufImPanel,
    abbrechen: abbrechen, aktuellerAbbruch: aktuellerAbbruch,
    verdrahten: verdrahten
  };
})(window);
