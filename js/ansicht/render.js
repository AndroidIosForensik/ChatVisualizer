/* Fassade der Ansicht.

   Die Darstellung steckt in vier Modulen:
     ansicht/liste.js    → Chatliste     (Seitenleiste)
     ansicht/chat.js     → Chatansicht   (Verlauf, Kopfzeile, Treffer)
     ansicht/details.js  → Detailspalte  (Kennzahlen, Galerie)
     ansicht/medien.js   → Medienansicht (Kacheln beleben)

   Dieses Modul bündelt sie unter dem gewohnten Namen `Render` und enthält
   nur noch das, was mehrere Bereiche gemeinsam betrifft. Neuer Code darf
   die Module gern direkt ansprechen – `Render` bleibt als bequemer
   Sammelpunkt bestehen. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const state = Model.state;

  /** Grundgerüst umschalten: Startbildschirm oder Arbeitsansicht. */
  function zeigeLeerzustand() {
    $('#app').classList.toggle('has-data', state.messages.length > 0);
    $('#chatPane').classList.toggle('open', !!state.activeConv);
  }

  /** Alles neu zeichnen – nach Import, Löschen oder Programmstart. */
  function alles() {
    Chatliste.zeichneFilter();
    Chatliste.zeichne();
    zeigeLeerzustand();

    if (state.activeConv && state.convByKey.has(state.activeConv)) {
      const conv = state.convByKey.get(state.activeConv);
      Chatansicht.zeichneKopf(conv);
      Chatansicht.zeichne();
      Detailspalte.zeichne();
    } else {
      state.activeConv = null;
      $('#chatPane').classList.remove('open');
    }
  }

  global.Render = {
    /* Gesamtansicht */
    renderAll: alles,
    showEmptyState: zeigeLeerzustand,

    /* Seitenleiste */
    renderConvList: Chatliste.zeichne,
    renderMessengerFilter: Chatliste.zeichneFilter,

    /* Chat */
    renderChat: Chatansicht.zeichne,
    renderChatHeader: Chatansicht.zeichneKopf,
    refreshMessage: Chatansicht.auffrischen,
    collectHits: Chatansicht.sammleTreffer,
    updateHitCounter: Chatansicht.zeigeTrefferzahl,
    gotoMessage: Chatansicht.springeZu,
    PAGE: Chatansicht.SEITE,

    /* Detailspalte */
    renderDetails: Detailspalte.zeichne,

    /* Medien und Suche */
    hydrateMedia: Medienansicht.belebeAlle,
    hydrateThumbs: Medienansicht.belebeVorschauen,
    directURL: Medienansicht.direkteURL,
    messageMatches: Suchtreffer.passt,
    previewText: Suchtreffer.vorschauText,

    /* Textwerkzeuge */
    cssId: Textformat.cssId,
    fileName: Helfer.dateiname
  };
})(window);
