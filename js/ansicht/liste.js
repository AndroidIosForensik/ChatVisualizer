/* Seitenleiste: Messenger-Filter und Liste der Unterhaltungen. */
(function (global) {
  'use strict';

  const esc = Helfer.esc;
  const $ = Helfer.$;
  const M = Model;
  const state = M.state;
  const norm = Textformat.norm;
  const hervorheben = Textformat.hervorheben;

  /* ---- Filterleiste (WhatsApp, Threema, …) --------------------------- */

  /** Für jeden vorkommenden Messenger ein Häppchen mit Anzahl. */
  function zeichneFilter() {
    const anzahl = new Map();
    for (const c of state.conversations) anzahl.set(c.messenger, (anzahl.get(c.messenger) || 0) + 1);
    const schluessel = Array.from(anzahl.keys()).sort((a, b) => anzahl.get(b) - anzahl.get(a));

    let html = '<button class="chip' + (state.messengerFilter === 'all' ? ' active' : '') +
      '" data-messenger="all"><span class="chip-dot all"></span>Alle' +
      '<span class="chip-n">' + state.conversations.length + '</span></button>';

    for (const k of schluessel) {
      const b = Messengers.brand(k);
      html += '<button class="chip' + (state.messengerFilter === k ? ' active' : '') +
        '" data-messenger="' + esc(k) + '" title="' + esc(b.label) + '">' +
        '<span class="chip-dot" style="background:' + b.color + '"></span>' + esc(b.label) +
        '<span class="chip-n">' + anzahl.get(k) + '</span></button>';
    }
    $('#messengerFilter').innerHTML = html;
  }

  /* ---- Liste --------------------------------------------------------- */

  /**
   * Unterhaltungen, die Filter und Suchbegriff überstehen.
   * Liefert je Eintrag die Trefferzahl und – falls der Treffer nicht im
   * Nachrichtentext steckt – einen Auszug aus Dokument/Transkript/Übersetzung.
   */
  function sichtbare() {
    const q = norm(state.query);
    const raus = [];

    for (const c of state.conversations) {
      if (state.messengerFilter !== 'all' && c.messenger !== state.messengerFilter) continue;
      if (!q) { raus.push({ conv: c, hits: 0, snippet: null }); continue; }

      const titelTreffer = norm(c.title).indexOf(q) !== -1 || norm(c.conv).indexOf(q) !== -1;
      let treffer = 0, erste = null;
      for (const m of c.messages) {
        if (Suchtreffer.passt(m, q)) {
          treffer++;
          if (!erste) erste = m;
        }
      }
      if (treffer || titelTreffer) {
        raus.push({
          conv: c, hits: treffer, snippet: erste,
          auszug: erste ? Suchtreffer.auszug(erste, q) : null
        });
      }
    }
    return raus;
  }

  /** Die komplette Chatliste neu aufbauen. */
  function zeichne() {
    const liste = $('#convList');
    const eintraege = sichtbare();

    $('#convCount').textContent = eintraege.length + (eintraege.length === 1 ? ' Chat' : ' Chats');

    if (!eintraege.length) {
      liste.innerHTML = '<div class="list-empty">' +
        (state.messages.length
          ? 'Keine Treffer für <b>' + esc(state.query) + '</b>'
          : 'Noch keine Daten importiert') + '</div>';
      return;
    }

    let html = '';
    for (const eintrag of eintraege) {
      const c = eintrag.conv;
      const b = Messengers.brand(c.messenger);
      const letzte = c.lastMessage;
      const ich = M.whoAmI(c.key);

      // Ohne Suchtreffer steht vorn, wer geschrieben hat; mit Auszug wäre das nur im Weg
      const vorsatz = eintrag.auszug ? ''
        : (letzte && (letzte.fromMe || letzte.sender === ich) ? 'Du: '
          : (c.senders.size > 2 && letzte ? esc(M.absenderName(letzte)) + ': ' : ''));

      const vorschau = eintrag.auszug
        ? hervorheben(esc(eintrag.auszug), state.query)
        : (eintrag.snippet
            ? hervorheben(esc(Suchtreffer.vorschauText(eintrag.snippet)), state.query)
            : esc(Suchtreffer.vorschauText(letzte)));

      html += '<button class="conv' + (state.activeConv === c.key ? ' active' : '') +
          '" data-conv="' + esc(c.key) + '">' +
        '<span class="conv-avatar" style="--ac:' + M.senderColor(c.key) + '">' + esc(M.initials(c.title)) +
          '<span class="conv-badge" title="' + esc(b.label) + '">' + Messengers.iconSVG(c.messenger, 16) + '</span></span>' +
        '<span class="conv-main">' +
          '<span class="conv-row">' +
            '<span class="conv-title">' + hervorheben(esc(c.title), state.query) + '</span>' +
            '<span class="conv-time">' + esc(M.relative(c.last)) + '</span></span>' +
          '<span class="conv-row">' +
            '<span class="conv-preview">' + vorsatz + vorschau + '</span>' +
            (eintrag.hits
              ? '<span class="conv-hits">' + eintrag.hits + '</span>'
              : '<span class="conv-n">' + c.count + '</span>') +
          '</span>' +
        '</span></button>';
    }
    liste.innerHTML = html;
  }

  global.Chatliste = { zeichne: zeichne, zeichneFilter: zeichneFilter, sichtbare: sichtbare };
})(window);
