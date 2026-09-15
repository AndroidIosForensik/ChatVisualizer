/* Erklärfenster „Welche Spalten braucht die CSV-Datei?".

   Der erklärende Text steht fest in index.html (#helpDialog); hier liegt
   nur die Bedienung und die Vorlage zum Herunterladen. */
(function (global) {
  'use strict';

  const $ = Helfer.$;

  /* Vorlage mit Kopfzeile und fünf Beispielzeilen – deckt Text, Antwort,
     Bild, Reaktion und Sprachnachricht ab. */
  const VORLAGE = [
    'nachricht_id,zeitstempel,absender_id,unterhaltungs_id,nachrichteninhalt,nachricht_typ,medienpfad,antwort_auf_id,reaktion_auf_id,status,messenger',
    'wa-001,2026-08-30T18:12:04,Mama,familie,Kommst du Sonntag zum Essen?,text,,,,gelesen,WhatsApp',
    'wa-002,2026-08-30T18:14:20,Ich,familie,"Ja, gerne!",text,,wa-001,,gesendet,WhatsApp',
    'wa-003,2026-08-30T18:20:11,Mama,familie,Der neue Tisch,bild,medien/tisch.jpg,,,gelesen,WhatsApp',
    'wa-004,2026-08-30T18:21:33,Ich,familie,❤️,reaktion,,,wa-003,gesendet,WhatsApp',
    'wa-005,2026-08-30T19:02:00,Papa,familie,,audio,medien/sprachnachricht.ogg,,,gelesen,WhatsApp',
    ''
  ].join('\n');

  function oeffnen() { $('#helpDialog').classList.add('show'); }
  function schliessen() { $('#helpDialog').classList.remove('show'); }
  function istOffen() { return $('#helpDialog').classList.contains('show'); }

  /** Knöpfe und Klicks rund um das Erklärfenster verdrahten. */
  function verdrahten() {
    $('#helpBtn').addEventListener('click', oeffnen);

    // Jeder Knopf mit der Klasse .help-open öffnet die Erklärung
    document.addEventListener('click', e => {
      if (e.target.closest('.help-open')) oeffnen();
    });

    // Klick auf den Hintergrund oder auf ein [data-help-close] schließt sie
    $('#helpDialog').addEventListener('click', e => {
      if (e.target.id === 'helpDialog' || e.target.closest('[data-help-close]')) schliessen();
    });

    $('#helpTemplate').addEventListener('click', () => {
      // BOM voranstellen, damit Excel die Umlaute richtig liest
      Helfer.download('chat-vorlage.csv', '﻿' + VORLAGE, 'text/csv;charset=utf-8');
      Meldung.zeige('Vorlage gespeichert – Kopfzeile und fünf Beispielzeilen.', 'ok');
    });
  }

  global.Hilfe = {
    oeffnen: oeffnen, schliessen: schliessen, istOffen: istOffen,
    verdrahten: verdrahten, VORLAGE: VORLAGE
  };
})(window);
