/* Chatverlauf: Sprechblasen, Kopfzeile, Trefferführung.

   Gezeichnet wird immer nur das Ende des Verlaufs (SEITE Nachrichten);
   ältere holt der Knopf „ältere Nachrichten laden" oder das Hochscrollen.
   So bleiben auch Chats mit 50.000 Nachrichten flüssig. */
(function (global) {
  'use strict';

  const esc = Helfer.esc;
  const $ = Helfer.$;
  const M = Model;
  const state = M.state;
  const norm = Textformat.norm;
  const formatiere = Textformat.formatiere;
  const cssId = Textformat.cssId;

  const SEITE = 400;              // Nachrichten je Zeichenblock
  const GRUPPE_MS = 5 * 60000;    // Nachrichten desselben Absenders binnen 5 min zusammenfassen

  /* ---- Bausteine der Sprechblase ------------------------------------ */

  /** Häkchen für den Zustellzustand (nur bei eigenen Nachrichten). */
  function statusHTML(m) {
    const s = norm(m.status);
    if (!s) return '';
    if (/(gelesen|read|seen)/.test(s)) return '<span class="ticks read" title="Gelesen">✓✓</span>';
    if (/(zugestellt|delivered|empfangen|received)/.test(s)) return '<span class="ticks" title="Zugestellt">✓✓</span>';
    if (/(gesendet|sent|versendet)/.test(s)) return '<span class="ticks" title="Gesendet">✓</span>';
    if (/(fehl|failed|error)/.test(s)) return '<span class="ticks fail" title="Fehlgeschlagen">⚠</span>';
    if (/(ausstehend|pending|wartend)/.test(s)) return '<span class="ticks" title="Ausstehend">🕓</span>';
    if (/(gelöscht|geloescht|deleted|zurückgezogen)/.test(s)) return '<span class="ticks" title="Gelöscht">🗑</span>';
    return '<span class="ticks" title="' + esc(m.status) + '">•</span>';
  }

  /** Zitat über der Sprechblase (antwort_auf_id). */
  function antwortHTML(m, conv) {
    if (!m.replyTo) return '';
    const ziel = state.byKey.get(m.messenger + '::' + m.replyTo) ||
                 conv.messages.find(x => x.id === m.replyTo);
    if (!ziel) {
      return '<div class="reply missing">Antwort auf gelöschte/unbekannte Nachricht (' + esc(m.replyTo) + ')</div>';
    }
    const zielTr = Translate.get(ziel.key);
    const t = ((zielTr && zielTr.t) || ziel.text || '').replace(/\s+/g, ' ').trim() ||
              Suchtreffer.vorschauText(ziel);
    return '<button class="reply" data-goto="' + esc(ziel.key) + '" style="--rc:' + M.senderColor(ziel.sender) + '">' +
      '<span class="reply-sender">' + esc(ziel.sender) + '</span>' +
      '<span class="reply-text">' + esc(t.slice(0, 160)) + (t.length > 160 ? '…' : '') + '</span></button>';
  }

  /** Reaktionen als kleine Emoji-Marken, gleiche Emoji zusammengefasst. */
  function reaktionenHTML(m) {
    if (!m.reactions || !m.reactions.length) return '';
    const anzahl = new Map();
    for (const r of m.reactions) {
      const e = (r.text || '❤️').trim() || '❤️';
      if (!anzahl.has(e)) anzahl.set(e, []);
      anzahl.get(e).push(r.sender);
    }
    let html = '<div class="reactions">';
    for (const [e, absender] of anzahl) {
      html += '<span class="reaction" title="' + esc(absender.join(', ')) + '">' + esc(e) +
        (absender.length > 1 ? '<b>' + absender.length + '</b>' : '') + '</span>';
    }
    return html + '</div>';
  }

  /**
   * Eine komplette Nachricht als HTML.
   * @param {object} m    Nachricht
   * @param {?object} prev Vorgänger (für die Gruppierung)
   * @param {object} conv Unterhaltung
   * @param {?string} me  Absendername, der als „ich" gilt
   * @param {string} q    Suchbegriff im Chat (kleingeschrieben)
   */
  function nachrichtHTML(m, prev, conv, me, q) {
    if (m.type === 'system') {
      return '<div class="system" data-key="' + esc(m.key) + '" id="m_' + esc(cssId(m.key)) + '">' +
        '<span>' + formatiere(m.text || 'Systemnachricht', q) + '</span></div>';
    }

    const eigen = m.fromMe || (me != null && m.sender === me);
    const gruppiert = prev && prev.sender === m.sender && prev.type !== 'system' &&
                      m.ts && prev.ts && (m.ts - prev.ts) < GRUPPE_MS && !m.replyTo;
    const geloescht = /(gelöscht|geloescht|deleted|zurückgezogen)/.test(norm(m.status));
    const zeigeName = !eigen && !gruppiert && conv.senders.size > 2;

    const tr = Translate.get(m.key);
    const uebersetzt = !!(tr && tr.t);
    const skEintrag = window.Transcribe ? Transcribe.get(m.key) : null;
    const transkript = skEintrag && skEintrag.t ? skEintrag.t : '';
    const skSprache = skEintrag && skEintrag.l ? (Translate.LANGS[skEintrag.l] || skEintrag.l) : '';
    const quelle = m.text || transkript;          // Sprachnachricht: das Transkript ist der Text
    const nurEmoji = !uebersetzt && !m.media && Textformat.istNurEmoji(m.text);

    /* Körper: Übersetzung oben groß, Original darunter klein */
    let koerper;
    if (geloescht) {
      koerper = '<div class="text deleted">🚫 Diese Nachricht wurde gelöscht</div>';
    } else if (uebersetzt) {
      const quellName = tr.s ? (Translate.LANGS[tr.s] || tr.s.toUpperCase()) : 'Original';
      koerper = '<div class="text">' + formatiere(tr.t, q) + '</div>' +
        '<div class="orig"><span class="orig-label">' +
          (transkript && !m.text ? '🎤 ' : '') + esc(quellName) + '</span>' +
        formatiere(quelle, q) + '</div>';
    } else if (m.text) {
      koerper = '<div class="text' + (nurEmoji ? ' big-emoji' : '') + '">' + formatiere(m.text, q) + '</div>';
    } else if (transkript) {
      koerper = '<div class="script"><span class="script-label">🎤 Transkript' +
        (skSprache ? ' · ' + esc(skSprache) : '') + '</span>' + formatiere(transkript, q) + '</div>';
    } else {
      koerper = '';
    }

    /* Knöpfe am Rand der Blase: 🎤 transkribieren, 🌐 übersetzen, ↩ zurücknehmen */
    let knoepfe = '';
    if (!geloescht && Translate.translatable(quelle)) {
      knoepfe = uebersetzt
        ? '<button class="tr-btn done" data-tr-remove="' + esc(m.key) + '" title="Übersetzung entfernen">↩</button>'
        : '<button class="tr-btn" data-tr-msg="' + esc(m.key) + '" title="Diese Nachricht übersetzen">🌐</button>';
    }
    if (!geloescht && window.Transcribe && Transcribe.isVoice(m)) {
      knoepfe = (transkript
        ? '<button class="tr-btn done" data-sc-remove="' + esc(m.key) + '" title="Transkript entfernen">↩</button>'
        : '<button class="tr-btn" data-sc-msg="' + esc(m.key) + '" title="Sprachnachricht transkribieren">🎤</button>'
      ) + knoepfe;
    }

    const eigenerTyp = m.type !== 'text' && m.type !== 'bild' && m.type !== 'video' &&
                       m.type !== 'audio' && m.type !== 'datei';

    return '<div class="msg ' + (eigen ? 'out' : 'in') + (gruppiert ? ' grouped' : '') +
      (m.reactions ? ' has-reactions' : '') + (uebersetzt ? ' translated' : '') + '"' +
      ' data-key="' + esc(m.key) + '" id="m_' + esc(cssId(m.key)) + '">' +
      (!eigen ? '<span class="msg-avatar" style="--ac:' + M.senderColor(m.sender) + '">' +
        (gruppiert ? '' : esc(M.initials(m.sender))) + '</span>' : '') +
      '<div class="bubble">' +
        (zeigeName ? '<div class="bubble-sender" style="color:' + M.senderColor(m.sender) + '">' + esc(m.sender) + '</div>' : '') +
        antwortHTML(m, conv) +
        Medienansicht.medienHTML(m) +
        koerper +
        '<div class="bubble-meta">' +
          (eigenerTyp ? '<span class="type-tag">' + esc(m.type) + '</span>' : '') +
          '<span class="time" title="' + esc(m.ts ? M.DT_FULL.format(new Date(m.ts)) : m.tsRaw) + '">' +
            esc(m.ts ? M.DT_TIME.format(new Date(m.ts)) : (m.tsRaw || '')) + '</span>' +
          (eigen ? statusHTML(m) : '') +
        '</div>' +
        reaktionenHTML(m) +
      '</div>' + knoepfe + '</div>';
  }

  /** Eine einzelne Nachricht neu zeichnen (nach dem Übersetzen/Transkribieren). */
  function auffrischen(key) {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    const i = conv.messages.findIndex(m => m.key === key);
    if (i < 0) return;
    const el = document.getElementById('m_' + cssId(key));
    if (!el) return;

    // Gruppierung nur beibehalten, wenn der Vorgänger auch im DOM steht
    const prev = conv.messages[i - 1] || null;
    const echterPrev = prev && el.previousElementSibling &&
                       el.previousElementSibling.classList.contains('msg') ? prev : null;

    const huelle = document.createElement('div');
    huelle.innerHTML = nachrichtHTML(conv.messages[i], echterPrev, conv, M.whoAmI(conv.key), norm(state.chatQuery));
    const neu = huelle.firstElementChild;
    if (neu) {
      el.replaceWith(neu);
      Medienansicht.belebeAlle(neu.parentNode || document);
    }
  }

  /* ---- Kopfzeile ----------------------------------------------------- */

  /** Logo, Titel, Zeitraum und die Auswahl „Ich:". */
  function zeichneKopf(conv) {
    const b = Messengers.brand(conv.messenger);
    const ich = M.whoAmI(conv.key);
    $('#chatTitle').innerHTML = esc(conv.title);
    $('#chatLogo').innerHTML = Messengers.iconSVG(conv.messenger, 30);

    const zeitraum = conv.first && conv.last
      ? M.DT_DATE.format(new Date(conv.first)) + ' – ' + M.DT_DATE.format(new Date(conv.last))
      : 'ohne Datum';
    $('#chatSub').innerHTML = '<b style="color:' + b.color + '">' + esc(b.label) + '</b> · ' +
      esc(conv.conv) + ' · ' + conv.count + ' Nachrichten · ' + esc(zeitraum);

    let optionen = '<option value="">– niemand –</option>';
    for (const s of Array.from(conv.senders.keys()).sort((a, b2) => a.localeCompare(b2, 'de'))) {
      optionen += '<option value="' + esc(s) + '"' + (s === ich ? ' selected' : '') + '>' + esc(s) + '</option>';
    }
    $('#meSelect').innerHTML = optionen;
  }

  /* ---- Verlauf ------------------------------------------------------- */

  /**
   * Den Verlauf zeichnen.
   * @param {string} [scrollen] 'keep' = Position halten, 'top' = beim Nachladen
   *        an derselben Nachricht bleiben, sonst ans Ende springen.
   */
  function zeichne(scrollen) {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    const rahmen = $('#chatScroll');

    const q = norm(state.chatQuery);
    const ich = M.whoAmI(conv.key);
    const gesamt = conv.messages.length;
    const zeige = Math.min(state.shown || SEITE, gesamt);
    const start = gesamt - zeige;
    const hoeheVorher = rahmen.scrollHeight, obenVorher = rahmen.scrollTop;

    let html = '';
    if (start > 0) {
      html += '<button class="load-more" id="loadMore">' + start + ' ältere Nachrichten laden</button>';
    }

    let letzterTag = null, prev = null;
    for (let i = start; i < gesamt; i++) {
      const m = conv.messages[i];
      const tag = m.ts ? new Date(m.ts).toDateString() : 'none';
      if (tag !== letzterTag) {
        html += '<div class="day-sep"><span>' + esc(M.dayLabel(m.ts)) + '</span></div>';
        letzterTag = tag;
        prev = null;                       // nach einem Datumstrenner nicht gruppieren
      }
      html += nachrichtHTML(m, prev, conv, ich, q);
      prev = m;
    }
    $('#chatMessages').innerHTML = html;

    if (scrollen === 'top') {
      rahmen.scrollTop = rahmen.scrollHeight - hoeheVorher + obenVorher;
    } else if (scrollen !== 'keep') {
      rahmen.scrollTop = rahmen.scrollHeight;
    }

    // erst nach dem Scrollen beleben – dann stimmt der sichtbare Bereich
    Medienansicht.belebeAlle($('#chatMessages'));
    zeigeTrefferzahl();
  }

  /* ---- Suche im Chat -------------------------------------------------- */

  /** Treffer im geöffneten Chat sammeln; gestartet wird beim letzten. */
  function sammleTreffer() {
    const conv = state.convByKey.get(state.activeConv);
    const q = norm(state.chatQuery);
    state.chatHits = [];
    state.chatHitIndex = 0;
    if (!conv || !q) return;
    for (const m of conv.messages) if (Suchtreffer.passt(m, q)) state.chatHits.push(m);
    state.chatHitIndex = state.chatHits.length - 1;
  }

  /** Anzeige „3/17" neben dem Suchfeld. */
  function zeigeTrefferzahl() {
    const el = $('#chatSearchCount');
    if (!state.chatQuery) { el.textContent = ''; return; }
    el.textContent = state.chatHits.length
      ? (state.chatHitIndex + 1) + '/' + state.chatHits.length
      : 'keine';
  }

  /**
   * Zu einer Nachricht springen – notfalls werden dafür ältere nachgeladen.
   * @param {boolean} [blinken=true] kurz hervorheben
   */
  function springeZu(key, blinken) {
    const conv = state.convByKey.get(state.activeConv);
    if (!conv) return;
    const ziel = conv.messages.find(m => m.key === key);
    if (!ziel) return;

    const noetig = conv.messages.length - ziel._i + 20;
    if ((state.shown || SEITE) < noetig) {
      state.shown = Math.ceil(noetig / SEITE) * SEITE;
      zeichne('keep');
    }

    const el = document.getElementById('m_' + cssId(key));
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (blinken !== false) {
      el.classList.remove('flash');
      void el.offsetWidth;                 // Neustart der Animation erzwingen
      el.classList.add('flash');
    }
  }

  global.Chatansicht = {
    SEITE: SEITE,
    nachrichtHTML: nachrichtHTML, auffrischen: auffrischen,
    zeichneKopf: zeichneKopf, zeichne: zeichne,
    sammleTreffer: sammleTreffer, zeigeTrefferzahl: zeigeTrefferzahl, springeZu: springeZu
  };
})(window);
