/* Detailspalte rechts: Kennzahlen, Teilnehmer, Zeitraum, Mediengalerie. */
(function (global) {
  'use strict';

  const esc = Helfer.esc;
  const $ = Helfer.$;
  const M = Model;
  const state = M.state;

  /** Eine Kennzahl-Kachel. */
  function kennzahl(n, beschriftung) {
    return '<div class="stat"><b>' + n + '</b><span>' + beschriftung + '</span></div>';
  }

  /** Die Detailspalte neu aufbauen (nur, wenn sie überhaupt offen ist). */
  function zeichne() {
    const conv = state.convByKey.get(state.activeConv);
    const spalte = $('#details');
    spalte.classList.toggle('open', state.detailsOpen);
    if (!conv || !state.detailsOpen) return;

    const b = Messengers.brand(conv.messenger);
    const absender = Array.from(conv.senders.entries()).sort((a, c) => c[1] - a[1]);
    const meiste = absender.length ? absender[0][1] : 1;

    const typen = new Map();
    for (const m of conv.messages) typen.set(m.type, (typen.get(m.type) || 0) + 1);

    /* Kopf */
    let html = '<button class="d-close" data-close="1" title="Details schließen">✕</button>' +
      '<div class="d-head">' +
        '<span class="conv-avatar big" style="--ac:' + M.senderColor(conv.key) + '">' +
          esc(M.initials(conv.title)) + '</span>' +
        '<h3>' + esc(conv.title) + '</h3>' +
        '<div class="d-badge">' + Messengers.iconSVG(conv.messenger, 18) +
          '<span>' + esc(b.label) + '</span></div>' +
      '</div>';

    /* Kennzahlen */
    html += '<div class="d-stats">' +
      kennzahl(conv.count, 'Nachrichten') +
      kennzahl(conv.senders.size, 'Teilnehmer') +
      kennzahl(conv.media.length, 'Medien') +
      kennzahl(conv.reactionCount, 'Reaktionen') +
      '</div>';

    /* Teilnehmer mit Balken nach Nachrichtenzahl */
    html += '<div class="d-block"><h4>Teilnehmer</h4>';
    for (const [s, n] of absender) {
      html += '<div class="d-person">' +
        '<span class="msg-avatar" style="--ac:' + M.senderColor(s) + '">' + esc(M.initials(s)) + '</span>' +
        '<span class="d-person-main">' +
          '<span class="d-person-name">' + esc(s) +
            (s === M.whoAmI(conv.key) ? ' <em>(du)</em>' : '') + '</span>' +
          '<span class="d-bar"><i style="width:' + Math.round(n / meiste * 100) +
            '%;background:' + M.senderColor(s) + '"></i></span>' +
        '</span>' +
        '<span class="d-person-n">' + n + '</span></div>';
    }
    html += '</div>';

    /* Zeitraum */
    html += '<div class="d-block"><h4>Zeitraum</h4>' +
      '<div class="d-kv"><span>Erste Nachricht</span><b>' +
        esc(conv.first ? M.DT_DATE.format(new Date(conv.first)) : '–') + '</b></div>' +
      '<div class="d-kv"><span>Letzte Nachricht</span><b>' +
        esc(conv.last ? M.DT_DATE.format(new Date(conv.last)) : '–') + '</b></div>' +
      '<div class="d-kv"><span>Unterhaltungs-ID</span><b>' + esc(conv.conv) + '</b></div></div>';

    /* Nachrichtentypen */
    html += '<div class="d-block"><h4>Nachrichtentypen</h4><div class="d-chips">';
    for (const [t, n] of Array.from(typen.entries()).sort((a, c) => c[1] - a[1])) {
      html += '<span class="d-chip">' + (Medienansicht.TYP_SYMBOL[t] || '💬') + ' ' + esc(t) +
        '<b>' + n + '</b></span>';
    }
    html += '</div></div>';

    /* Mediengalerie: die letzten 60, neueste zuerst */
    if (conv.media.length) {
      html += '<div class="d-block"><h4>Medien (' + conv.media.length + ')</h4><div class="d-media">';
      for (const m of conv.media.slice(-60).reverse()) {
        const art = Medienansicht.artVon(m);
        html += '<button class="d-media-item" data-goto="' + esc(m.key) + '" data-thumb="' + esc(m.media) + '"' +
          ' data-kind="' + art + '" title="' + esc(m.media) + '">' +
          (Medienansicht.ART_SYMBOL[art] || '📎') + '</button>';
      }
      html += '</div></div>';
    }

    spalte.innerHTML = html;
    Medienansicht.belebeVorschauen(spalte);     // Vorschaubilder nachladen
  }

  global.Detailspalte = { zeichne: zeichne };
})(window);
