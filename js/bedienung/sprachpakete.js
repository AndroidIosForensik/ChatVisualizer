/* Sprachpakete für die Übersetzung vorab laden (Startseite und 🌐-Panel).

   Chrome/Edge laden je Sprachpaar ein Paket und behalten es im Browserprofil –
   beim nächsten Start ist es sofort wieder da, auch ohne Internet. Laden darf
   der Browser nur direkt nach einem Klick: „Ausgewählte laden" ruft deshalb
   Translate.paketeLaden ohne vorheriges Warten auf. Gemerkt wird die Auswahl,
   damit die Startseite zeigt, was davon bereitliegt. */
(function (global) {
  'use strict';

  const $ = Helfer.$;
  const esc = Helfer.esc;

  /* Schnellauswahl: in Ermittlungen häufige Sprachen */
  const HAEUFIGE = ['en', 'ru', 'uk', 'tr', 'ar', 'pl', 'ro', 'fa'];

  const STAND_TEXT = {
    available: ['bereit', 'ok'], downloadable: ['nicht geladen', ''], downloading: ['wird geladen …', 'laeuft'],
    unavailable: ['nicht angeboten', 'nein'], fehlt: ['keine Antwort', 'nein'], fehler: ['fehlgeschlagen', 'nein']
  };

  let stand = {};                 // code → Stand
  let laeuft = false;

  const sprachen = ziel => Object.keys(Translate.LANGS).filter(c => c !== ziel)
    .sort((a, b) => Translate.LANGS[a].localeCompare(Translate.LANGS[b], 'de'));

  function standHTML(code, text, klasse) {
    return '<span class="paket-stand ' + (klasse || '') + '" data-stand-fuer="' + esc(code) + '">' + esc(text) + '</span>';
  }

  /** Liste mit Ankreuzfeldern zeichnen (Stand zunächst „wird geprüft") */
  function liste(ziel) {
    const gewaehlt = new Set(Translate.pakete.auswahl);
    $('#paketListe').innerHTML = sprachen(ziel).map(c =>
      '<label class="paket-zeile"><input type="checkbox" value="' + esc(c) + '"' + (gewaehlt.has(c) ? ' checked' : '') + '>' +
      '<span class="paket-name">' + esc(Translate.LANGS[c]) + '</span>' + standHTML(c, '…', 'wartet') + '</label>').join('');
  }

  function zeigeStand(code, s, pct) {
    const el = document.querySelector('#paketListe [data-stand-fuer="' + Helfer.cssAttr(code) + '"]');
    if (!el) return;
    const t = STAND_TEXT[s] || [s, ''];
    el.textContent = pct != null && pct >= 0 && pct < 100 ? 'wird geladen … ' + pct + ' %' : t[0];
    el.className = 'paket-stand ' + (pct != null && pct < 100 ? 'laeuft' : t[1]);
    const box = el.parentNode.querySelector('input');
    if (box) box.disabled = s === 'unavailable';
  }

  /** Stand aller Paare zum Ziel abfragen (parallel, je mit Zeitlimit) */
  async function pruefen(ziel) {
    stand = {};
    await Promise.all(sprachen(ziel).map(async c => {
      stand[c] = await Translate.paketStand(c, ziel);
      if ($('#paketZiel').value === ziel) zeigeStand(c, stand[c]);
    }));
    const e = await Translate.erkennungStand();
    $('#paketErkennung').textContent = 'Automatische Spracherkennung: ' + (STAND_TEXT[e] || [e])[0] +
      (e === 'downloadable' ? ' – wird beim Laden mitgeholt.' : '.');
  }

  function oeffnen() {
    const dialog = $('#paketDialog');
    const ziel = $('#paketZiel');
    if (!ziel.options.length) {
      ziel.innerHTML = Object.keys(Translate.LANGS)
        .sort((a, b) => Translate.LANGS[a].localeCompare(Translate.LANGS[b], 'de'))
        .map(c => '<option value="' + esc(c) + '">' + esc(Translate.LANGS[c]) + '</option>').join('');
    }
    ziel.value = Translate.settings.target;
    $('#paketHinweis').textContent = 'Translator' in global ? ''
      : 'Dieser Browser übersetzt nicht selbst. ChatVisualizer bitte in Chrome oder Edge (ab Version 138) öffnen.';
    $('#paketLaden').disabled = !('Translator' in global);
    liste(ziel.value);
    if ('Translator' in global) pruefen(ziel.value);
    if (!dialog.open) dialog.showModal();
  }

  /** „Ausgewählte laden" – läuft im Klick, damit der Browser laden darf */
  function laden() {
    if (laeuft) return;
    const ziel = $('#paketZiel').value;
    const codes = Array.from(document.querySelectorAll('#paketListe input:checked')).map(i => i.value);
    Translate.paketeMerken(codes);
    if (!codes.length) { $('#paketHinweis').textContent = 'Bitte mindestens eine Sprache ankreuzen.'; return; }
    $('#paketHinweis').textContent = '';
    laeuft = true;
    $('#paketLaden').disabled = true;
    $('#paketLaden').textContent = 'Lädt …';
    const fehler = [];
    let auftrag;
    try {
      auftrag = Translate.paketeLaden(codes, ziel, (code, pct, fertig) => {
        if (code === '*') {
          $('#paketErkennung').textContent = 'Automatische Spracherkennung: ' +
            (fertig === 'ok' ? 'bereit' : fertig ? 'nicht geladen (' + fertig + ')' : 'wird geladen … ' + Math.max(0, pct) + ' %');
          return;
        }
        if (fertig === 'ok') zeigeStand(code, 'available');
        else if (fertig) { zeigeStand(code, 'fehler'); fehler.push(Translate.LANGS[code] + ': ' + fertig); }
        else zeigeStand(code, 'downloading', pct);
      });
    } catch (e) { auftrag = Promise.reject(e); }
    Promise.resolve(auftrag).catch(e => fehler.push(e.message || String(e))).then(() => {
      laeuft = false;
      $('#paketLaden').disabled = false;
      $('#paketLaden').textContent = 'Ausgewählte laden';
      if (fehler.length) $('#paketHinweis').textContent = fehler.join(' · ');
      else Meldung.zeige('Sprachpakete bereit – sie bleiben im Browser gespeichert.', 'ok');
      Translate.status.ok = false;                     // Panel prüft beim nächsten Öffnen neu
      startseite();
    });
  }

  /** Zeile auf der Startseite: welche gemerkten Pakete bereitliegen */
  async function startseite() {
    const el = $('#welcomePakete');
    if (!el) return;
    const knopf = '<button class="w-format-link" data-pakete-oeffnen>Sprachpakete für die Übersetzung vorab laden</button>';
    if (!('Translator' in global)) {
      el.innerHTML = '🌐 Übersetzen geht in Chrome oder Edge (ab Version 138) – dieser Browser kann es nicht.';
      return;
    }
    const ziel = Translate.settings.target;
    const auswahl = Translate.pakete.auswahl.filter(c => c !== ziel && Translate.LANGS[c]);
    if (!auswahl.length) { el.innerHTML = '🌐 ' + knopf; return; }
    el.innerHTML = '🌐 Sprachpakete werden geprüft …';
    const staende = await Promise.all(auswahl.map(c => Translate.paketStand(c, ziel)));
    const bereit = auswahl.filter((c, i) => staende[i] === 'available');
    const offen = auswahl.filter((c, i) => staende[i] === 'downloadable' || staende[i] === 'downloading');
    const namen = l => l.map(c => Translate.LANGS[c]).join(', ');
    el.innerHTML = '🌐 ' + (bereit.length ? esc(bereit.length + (bereit.length === 1 ? ' Sprachpaket' : ' Sprachpakete') +
      ' bereit (' + namen(bereit) + ' → ' + Translate.LANGS[ziel] + ')') : 'Noch keine Sprachpakete geladen') +
      (offen.length ? ' · <b>fehlen: ' + esc(namen(offen)) + '</b>' : '') +
      ' · <button class="w-format-link" data-pakete-oeffnen>' + (offen.length ? 'jetzt laden' : 'verwalten') + '</button>';
  }

  function verdrahten() {
    document.addEventListener('click', e => {
      if (e.target.closest('[data-pakete-oeffnen]')) oeffnen();
    });
    $('#trPakete').addEventListener('click', () => { Uebersetzen.panelSchliessen(); oeffnen(); });
    $('#paketLaden').addEventListener('click', laden);
    $('#paketZiel').addEventListener('change', e => {
      // Zielsprache gilt auch für das 🌐-Panel
      Translate.settings.target = e.target.value;
      Translate.saveSettings();
      Translate.status.ok = false;
      liste(e.target.value);
      pruefen(e.target.value);
    });
    $('#paketDialog').addEventListener('click', e => {
      const haeufig = e.target.closest('[data-paket-haeufige]'), keine = e.target.closest('[data-paket-keine]');
      if (!haeufig && !keine) return;
      for (const box of document.querySelectorAll('#paketListe input')) {
        if (!box.disabled) box.checked = haeufig ? HAEUFIGE.indexOf(box.value) !== -1 : false;
      }
    });
    $('#paketDialog').addEventListener('close', startseite);
    startseite();
  }

  global.Sprachpakete = { oeffnen, startseite, verdrahten, HAEUFIGE };
})(window);
