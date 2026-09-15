/* ChatVisualizer – Zusammenspiel und Start.

   Aufbau des Programms (Ladereihenfolge siehe index.html):

     kern/      helfer, csv, store, model      – Grundlagen ohne Oberfläche
     daten/     messengers, media, archive, documents, transcribe, translate
     ansicht/   text, suche, medien, liste, chat, details, render
     bedienung/ meldung, fortschritt, hilfe, import, medienordner,
                uebersetzen, sprachnachrichten, dokumente, lightbox
     app.js     – dieses Modul

   Hier steht nur noch, was mehrere Bereiche verbindet: einen Chat öffnen,
   die allgemeinen Bedienelemente verdrahten und alles hochfahren.
   Jedes Bedienmodul bringt sein eigenes `verdrahten()` mit. */
(function () {
  'use strict';

  const $ = Helfer.$;
  const M = Model;
  const state = M.state;

  /* ------------------------------------------------------------------ *
   * Chat öffnen
   * ------------------------------------------------------------------ */

  /**
   * Eine Unterhaltung anzeigen.
   * Steht in der globalen Suche ein Begriff, der in diesem Chat vorkommt,
   * wird er in die Chatsuche übernommen und zum letzten Treffer gesprungen.
   */
  function oeffneChat(key) {
    const conv = state.convByKey.get(key);
    if (!conv) return;

    state.activeConv = key;
    state.shown = Render.PAGE;
    state.chatQuery = state.query &&
      conv.messages.some(m => Render.messageMatches(m, state.query.toLowerCase()))
      ? state.query : '';

    $('#chatSearchInput').value = state.chatQuery;
    $('#chatSearch').classList.toggle('open', !!state.chatQuery);
    $('#chatPane').classList.add('open');

    Render.renderChatHeader(conv);
    Render.collectHits();
    Render.renderChat();
    Render.renderDetails();
    Render.renderConvList();

    if (state.chatQuery && state.chatHits.length) {
      // kurz warten, bis der Verlauf im Layout steht
      setTimeout(() => Render.gotoMessage(state.chatHits[state.chatHitIndex].key), 60);
    }
  }

  /* ------------------------------------------------------------------ *
   * Klicks im Chatverlauf
   * ------------------------------------------------------------------ */

  /* Eine einzige Weiche für alle Knöpfe in den Sprechblasen – das ist
     sparsamer, als an jede Nachricht eigene Zuhörer zu hängen. */
  function verdrahteVerlauf() {
    $('#chatMessages').addEventListener('click', e => {
      const skEine = e.target.closest('[data-sc-msg]');
      if (skEine) { Sprachnachrichten.eineNachricht(skEine.dataset.scMsg); return; }

      const skWeg = e.target.closest('[data-sc-remove]');
      if (skWeg) { Sprachnachrichten.transkriptLoeschen(skWeg.dataset.scRemove); return; }

      const uebEine = e.target.closest('[data-tr-msg]');
      if (uebEine) { Uebersetzen.eineNachricht(uebEine.dataset.trMsg); return; }

      const uebWeg = e.target.closest('[data-tr-remove]');
      if (uebWeg) {
        const key = uebWeg.dataset.trRemove;
        Translate.clearFor([key]).then(() => Render.refreshMessage(key));
        return;
      }

      const sprung = e.target.closest('[data-goto]');
      if (sprung) { Render.gotoMessage(sprung.dataset.goto); return; }

      const mehr = e.target.closest('#loadMore');
      if (mehr) {
        state.shown = (state.shown || Render.PAGE) + Render.PAGE;
        Render.renderChat('top');
        return;
      }

      const pdf = e.target.closest('.media-pdf[data-media]');
      if (pdf) { Lightbox.pdfOeffnen(pdf.dataset.media); return; }

      const dok = e.target.closest('.media-doc[data-media]');
      if (dok) { Lightbox.textOeffnen(dok.dataset.media); return; }

      const bild = e.target.closest('.media-img[data-media]');
      if (bild) { Lightbox.oeffnen(bild.dataset.key); return; }

      // Kachel ohne Vorschau: wenigstens den Pfad in die Zwischenablage legen
      const kachel = e.target.closest('.media-chip[data-media]');
      if (kachel && !e.target.closest('a') && navigator.clipboard) {
        navigator.clipboard.writeText(kachel.dataset.media)
          .then(() => Meldung.zeige('Pfad kopiert: ' + Helfer.esc(kachel.dataset.media)), () => {});
      }
    });

    // Automatisches Nachladen beim Hochscrollen + Medien im Blickfeld beleben
    let angefordert = false;
    $('#chatScroll').addEventListener('scroll', () => {
      if ($('#chatScroll').scrollTop < 60 && $('#loadMore')) {
        state.shown = (state.shown || Render.PAGE) + Render.PAGE;
        Render.renderChat('top');
        return;
      }
      if (angefordert) return;
      angefordert = true;
      requestAnimationFrame(() => {
        angefordert = false;
        Render.hydrateMedia($('#chatMessages'));
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Seitenleiste: Suche, Filter, Sortierung
   * ------------------------------------------------------------------ */
  function verdrahteSeitenleiste() {
    const beiEingabe = Helfer.debounce(() => {
      state.query = $('#search').value.trim();
      $('#searchClear').classList.toggle('show', !!state.query);
      Render.renderConvList();
    }, 140);
    $('#search').addEventListener('input', beiEingabe);

    $('#searchClear').addEventListener('click', () => {
      $('#search').value = '';
      state.query = '';
      $('#searchClear').classList.remove('show');
      Render.renderConvList();
      $('#search').focus();
    });

    $('#messengerFilter').addEventListener('click', e => {
      const knopf = e.target.closest('[data-messenger]');
      if (!knopf) return;
      state.messengerFilter = knopf.dataset.messenger;
      Render.renderMessengerFilter();
      Render.renderConvList();
    });

    $('#sortSelect').value = state.sortMode;
    $('#sortSelect').addEventListener('change', e => {
      state.sortMode = e.target.value;
      Store.settings.set('sortMode', state.sortMode);
      M.sortConversations();
      Render.renderConvList();
    });

    $('#convList').addEventListener('click', e => {
      const knopf = e.target.closest('[data-conv]');
      if (knopf) oeffneChat(knopf.dataset.conv);
    });
  }

  /* ------------------------------------------------------------------ *
   * Kopfzeile des Chats: Suche, Details, „Ich", Zurück, Design
   * ------------------------------------------------------------------ */
  function verdrahteKopfzeile() {
    /* Suche im geöffneten Chat */
    $('#chatSearchToggle').addEventListener('click', () => {
      const kasten = $('#chatSearch');
      kasten.classList.toggle('open');
      if (kasten.classList.contains('open')) {
        $('#chatSearchInput').focus();
      } else {
        $('#chatSearchInput').value = '';
        state.chatQuery = '';
        Render.collectHits();
        Render.renderChat('keep');
      }
    });

    const beiChatsuche = Helfer.debounce(() => {
      state.chatQuery = $('#chatSearchInput').value.trim();
      Render.collectHits();
      Render.renderChat('keep');
      if (state.chatHits.length) Render.gotoMessage(state.chatHits[state.chatHitIndex].key);
    }, 160);
    $('#chatSearchInput').addEventListener('input', beiChatsuche);

    /** Zum vorigen (-1) oder nächsten (+1) Treffer springen. */
    function zumTreffer(richtung) {
      if (!state.chatHits.length) return;
      state.chatHitIndex =
        (state.chatHitIndex + richtung + state.chatHits.length) % state.chatHits.length;
      Render.updateHitCounter();
      Render.gotoMessage(state.chatHits[state.chatHitIndex].key);
    }
    $('#chatSearchInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); zumTreffer(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') $('#chatSearchToggle').click();
    });
    $('#hitPrev').addEventListener('click', () => zumTreffer(-1));
    $('#hitNext').addEventListener('click', () => zumTreffer(1));

    /* Detailspalte */
    $('#detailsToggle').addEventListener('click', () => {
      state.detailsOpen = !state.detailsOpen;
      Store.settings.set('detailsOpen', state.detailsOpen);
      $('#detailsToggle').classList.toggle('active', state.detailsOpen);
      Render.renderDetails();
    });
    $('#detailsToggle').classList.toggle('active', state.detailsOpen);

    $('#details').addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { $('#detailsToggle').click(); return; }
      const sprung = e.target.closest('[data-goto]');
      if (sprung) Render.gotoMessage(sprung.dataset.goto);
    });
    $('#details').addEventListener('dblclick', e => {
      const kachel = e.target.closest('.d-media-item[data-kind="pdf"]');
      if (kachel) Lightbox.pdfOeffnen(kachel.dataset.thumb);
    });

    /* Wer bin ich? – bestimmt, welche Blasen rechts stehen */
    $('#meSelect').addEventListener('change', e => {
      const conv = state.convByKey.get(state.activeConv);
      if (!conv) return;
      state.me[conv.key] = e.target.value;
      Store.settings.set('me', state.me);
      for (const c of state.conversations) c.title = M.conversationTitle(c);
      Render.renderChatHeader(conv);
      Render.renderChat('keep');
      Render.renderConvList();
      Render.renderDetails();
    });

    /* Zurück zur Liste (schmale Fenster) */
    $('#backBtn').addEventListener('click', () => {
      $('#chatPane').classList.remove('open');
      state.activeConv = null;
      Render.renderConvList();
    });

    /* Hell / Dunkel */
    $('#themeBtn').addEventListener('click', () => {
      const jetzt = document.documentElement.getAttribute('data-theme') || 'dark';
      const neu = jetzt === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', neu);
      Store.settings.set('theme', neu);
    });

    /* Ein Klick neben ein offenes Einstellungs-Panel schließt es */
    document.addEventListener('click', e => {
      if ($('#trPanel').classList.contains('open') &&
          !e.target.closest('#trPanel') && !e.target.closest('#trPanelBtn')) {
        Uebersetzen.panelSchliessen();
      }
      if ($('#scPanel').classList.contains('open') &&
          !e.target.closest('#scPanel') && !e.target.closest('#scPanelBtn')) {
        Sprachnachrichten.panelSchliessen();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Tastatur
   * ------------------------------------------------------------------ */
  function verdrahteTastatur() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && Hilfe.istOffen()) { Hilfe.schliessen(); return; }

      if (Lightbox.istOffen()) {
        if (e.key === 'Escape') { Lightbox.schliessen(); return; }
        if (e.key === 'ArrowLeft') { Lightbox.blaettern(-1); return; }
        if (e.key === 'ArrowRight') { Lightbox.blaettern(1); return; }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#search').focus();
        $('#search').select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.activeConv) {
        e.preventDefault();
        if (!$('#chatSearch').classList.contains('open')) $('#chatSearchToggle').click();
        else $('#chatSearchInput').focus();
      }
      if (e.key === 'Escape' && document.activeElement === $('#search')) $('#searchClear').click();
    });
  }

  /* ------------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------------ */
  async function init() {
    document.documentElement.setAttribute('data-theme', Store.settings.get('theme', 'dark'));

    /* Jedes Modul hängt seine eigenen Zuhörer ein */
    Hilfe.verdrahten();
    Import.verdrahten();
    Medienordner.verdrahten();
    Uebersetzen.verdrahten();
    Sprachnachrichten.verdrahten();
    Lightbox.verdrahten();
    Fortschritt.verdrahten();
    verdrahteSeitenleiste();
    verdrahteKopfzeile();
    verdrahteVerlauf();
    verdrahteTastatur();

    /* Gespeicherte Einstellungen und Zwischenergebnisse laden */
    await Translate.load();
    await Transcribe.load();
    await Documents.load();

    /* Nachrichten aus der letzten Sitzung */
    const gespeichert = await Store.getAll();
    if (gespeichert.length) {
      state.messages = gespeichert;
      M.rebuild();
      M.guessMe();
      for (const c of state.conversations) c.title = M.conversationTitle(c);
    }
    Render.renderAll();

    /* Zuvor verbundenen Medienordner wieder anbinden */
    await Medienordner.wiederherstellen();

    if (!Store.isAvailable()) {
      Meldung.zeige('Hinweis: Der Browser erlaubt hier keine dauerhafte Speicherung – ' +
        'Daten gelten nur für diese Sitzung. Tipp: <code>start.ps1</code> nutzen.', 'warn');
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  /* ------------------------------------------------------------------ *
   * Öffentliche Schnittstellen
   * ------------------------------------------------------------------ */

  /* Für die anderen Module (z. B. springt der Import in den ersten Chat) */
  window.App = { oeffneChat: oeffneChat };

  /* Für Konsole und Automatisierung */
  window.ChatVisualizer = {
    importFiles: Import.importiereDateien,
    openConversation: oeffneChat,
    state: state,
    demoData: Import.demodaten,
    pickMediaFolder: Medienordner.ordnerWaehlen,
    attachMediaFiles: files => Medienordner.dateienAnhaengen(files, false),
    detachMedia: Medienordner.trennen,
    transcribe: Transcribe,
    documents: Documents,
    leseDokumente: Dokumentenlauf.alleLesen,
    openPdf: Lightbox.pdfOeffnen,
    openDocText: Lightbox.textOeffnen,
    openLightbox: Lightbox.oeffnen,
    media: Media
  };
})();
