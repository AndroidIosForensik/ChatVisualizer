/* Anhänge im Hintergrund auslesen, damit die Suche sie findet.

   Ohne diesen Lauf würde der Inhalt eines PDFs erst dann durchsuchbar,
   wenn die Sprechblase einmal sichtbar war. Gestartet wird er nach jedem
   Import und nach dem Verbinden eines Medienordners.

   Hinweis zur Benennung: `Dokumentenlauf` ist die Bedienung,
   `Documents` (daten/documents.js) die eigentliche Auswertung. */
(function (global) {
  'use strict';

  const state = Model.state;

  /** Alle noch nicht ausgelesenen Dokumente verarbeiten. */
  async function alleLesen() {
    if (!window.Documents || Documents.job.active) return;

    const offen = Documents.pendingDocs(state.messages);
    if (!offen.length) return;

    const abbruch = () => Documents.cancel();
    Fortschritt.zeige({
      icon: '📄', titel: 'Dokumente werden gelesen',
      pct: 0, zaehler: '0 / ' + offen.length, abbruch: abbruch
    });

    const job = await Documents.extractAll(state.messages, j => {
      Fortschritt.zeige({
        icon: '📄', titel: 'Dokumente werden gelesen', pct: Fortschritt.prozent(j),
        zaehler: j.done + ' / ' + j.total, abbruch: abbruch
      });
    });

    // Kacheln zeigen jetzt Seitenzahl/Leseprobe, die Liste neue Trefferzahlen
    if (state.activeConv) Render.renderChat('keep');
    Render.renderConvList();
    Fortschritt.fertig(job.failed
      ? 'Dokumente gelesen – ' + job.failed + ' fehlgeschlagen'
      : 'Dokumente gelesen');
  }

  global.Dokumentenlauf = { alleLesen: alleLesen };
})(window);
