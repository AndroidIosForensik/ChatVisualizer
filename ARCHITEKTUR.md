# Aufbau von ChatVisualizer

Wo was liegt und warum, als Einstieg für spätere Änderungen.

## Leitgedanken

1. **Kein Bauwerkzeug.** Kein npm, kein Bundler, kein Übersetzer. Jede Datei
   ist ein normales `<script>`, nach einer Änderung genügt F5. Deshalb keine
   ES-Module in der Seite, sondern klassische Skripte, die je einen globalen
   Namen ablegen (`Helfer`, `Model`, `Render`, …). Ausnahme ist der
   Arbeiter-Thread der Spracherkennung, der echte `import`-Anweisungen
   benutzt.
2. **Alles bleibt auf dem Rechner.** Keine Datei wird hochgeladen, kein
   Dienst angefragt. Übersetzung und Spracherkennung laufen im Browser bzw.
   aus dem Modellordner. Netzverbindungen gibt es nur zwei: das einmalige
   Laden des Spracherkennungsmodells beim ersten Start und – nur nach
   Freigabe per Klick – Medien, deren Pfad ein http(s)-Link ist
   (`Media.externErlaubt`). Eine lokale Kopie im Medienordner geht immer vor.
3. **Eine Aufgabe je Datei.** Wird eine Datei größer als ein paar hundert
   Zeilen, wird sie geteilt, so geschehen mit `app.js` und `render.js`.

## Ordner

```
index.html            Aufbau der Seite + Ladereihenfolge der Skripte
css/style.css         bindet die Teile aus css/teile/ ein
css/teile/*.css       Gestaltung je Bereich
js/kern/              Grundlagen ohne Oberfläche
js/daten/             Dateien, Medien, Dokumente, Übersetzung, Spracherkennung
js/ansicht/           erzeugt HTML – liest den Zustand, ändert ihn nicht
js/bedienung/         Knöpfe, Panels, Abläufe – ändert den Zustand
js/app.js             verbindet alles und startet
beispiel-daten/       CSV-Dateien und Medien zum Ausprobieren
modelle/quellen.json  Bauplan: welche Modelldateien wohin gehören
modelle/              Whisper-Modell, wird beim ersten Start geladen
hole-modell.py        lädt fehlende Modelldateien nach (von start.sh aufgerufen)
werkzeuge/            Hilfsskripte für Entwickler (z. B. Emoji-Tabelle neu erzeugen)
vendor/               PDF.js und transformers.js, unverändert übernommen
```

Das Modell liegt nicht im Git-Speicher, weil GitHub ohne Git LFS bei 100 MB
je Datei aufhört. `start.ps1` (Windows, mit Bordmitteln) und `hole-modell.py`
(macOS/Linux, von `start.sh` aufgerufen) prüfen beim Start gegen
`modelle/quellen.json`, laden fehlende Dateien nach, setzen abgebrochene
Downloads fort und schreiben anschließend `modelle/verzeichnis.json`.

## Die Schichten

### kern/ – Grundlagen

| Datei | Globaler Name | Aufgabe |
|---|---|---|
| `helfer.js` | `Helfer` | `$`, `$$`, `esc`, `debounce`, `withTimeout`, `download`, … |
| `csv.js` | `CSV` | CSV lesen (RFC 4180, Trennzeichen automatisch) |
| `store.js` | `Store` | IndexedDB (ein Eintrag je Unterhaltung) und Einstellungen |
| `model.js` | `Model` | Datenmodell, Spaltenzuordnung, Zustand (`Model.state`) |

`Model.state` ist der gemeinsame Zustand: alle Nachrichten, die daraus
gebildeten Unterhaltungen, der offene Chat, Suchbegriffe, Treffer.

### daten/ – Inhalte beschaffen

| Datei | Name | Aufgabe |
|---|---|---|
| `messengers.js` | `Messengers` | Logos und Farben der Messenger |
| `emoji.js` | `Emoji` | Reaktionen als Kurzname („(purple_heart)", „:+1::skin-tone-3:", „(like)") in Emoji übersetzen |
| `emoji-namen.js` | `EmojiNamenDaten` | Tabelle Kurzname → Emoji, erzeugt von `werkzeuge/erzeuge-emoji-namen.py` aus gemoji (MIT) |
| `media.js` | `Media` | Medienordner einlesen, Pfade zuordnen, Dateien liefern |
| `whatsapp.js` | `WhatsApp` | Android-/iPhone-Textexporte erkennen, Datum und Anhänge lesen, stabile Nachrichten-IDs erzeugen |
| `aleapp.js` | `Aleapp` | ALEAPP-Berichte: jede TSV an ihren Spalten einer App und Rolle zuordnen, die Tabellen einer App gemeinsam auswerten, Quellen abgleichen (SMS ↔ Google Messages); kennt selbst keine App |
| `aleapp-whatsapp.js` | – | WhatsApp aus ALEAPP: Kontakte, LID-Chats über Zeit + Text, Lesebestätigungen, Reaktionen, Systemereignisse, Anrufe, Umfragen |
| `aleapp-apps.js` | – | Signal, Telegram, Threema, SMS/MMS, Google Messages und rund 35 weitere Apps über `Aleapp.einfach` |
| `ileapp.js` | `Ileapp` | dasselbe für iLEAPP: SMS/iMessage, WhatsApp, Threema, Signal, Telegram |
| `geraete-db.js` | `GeraeteDB` | SQL-Exporte mit rohen Spaltennamen erkennen: WhatsApp `ChatStorage.sqlite`/`msgstore.db`, iOS `sms.db`, Android `mmssms.db` |
| `archive.js` | `Archive` | ZIP lesen (für docx/xlsx/pptx/odf) – ganz ohne Bibliothek |
| `documents.js` | `Documents` | Dokumente: Vorschau, Textauszug, Hintergrundlauf |
| `translate.js` | `Translate` | Übersetzung über die Browser-Schnittstelle |
| `transcribe.js` | `Transcribe` | Sprachnachrichten: Audio aufbereiten, Verfahren wählen |
| `transcribe-worker.js` | – | Whisper im eigenen Thread (transformers.js/ONNX) |

Diese Module kennen die Oberfläche nicht. Sie melden Fortschritt über
Rückrufe (`onDownloadProgress`, der zweite Parameter von `…Conversation`).

### ansicht/ – HTML erzeugen

| Datei | Name | Aufgabe |
|---|---|---|
| `text.js` | `Textformat` | entschärfen, hervorheben, verlinken, `cssId` |
| `suche.js` | `Suchtreffer` | Treffersuche über Text, Übersetzung, Transkript, Dokument |
| `medien.js` | `Medienansicht` | Medienkacheln erzeugen und beim Sichtbarwerden beleben |
| `liste.js` | `Chatliste` | Seitenleiste: Filter und Unterhaltungsliste |
| `chat.js` | `Chatansicht` | Sprechblasen, Kopfzeile, Treffernavigation |
| `details.js` | `Detailspalte` | Kennzahlen, Teilnehmer, Mediengalerie |
| `render.js` | `Render` | Fassade: bündelt die vier Zeichner unter den alten Namen |

Regel: Ansicht liest `Model.state` und schreibt ins DOM – aber sie ändert
weder den Zustand noch stößt sie Läufe an.

### bedienung/ – Abläufe

| Datei | Name | Aufgabe |
|---|---|---|
| `meldung.js` | `Meldung` | kurze Rückmeldungen unten („Toast") |
| `fortschritt.js` | `Fortschritt` | Leiste über dem Chat und Balken in den Panels |
| `hilfe.js` | `Hilfe` | Erklärfenster zum CSV-Format, Vorlage speichern |
| `import.js` | `Import` | CSV, WhatsApp-Export und ALEAPP-Bericht einlesen, Ablegen per Maus, Export, Demodaten |
| `whatsapp-import.js` | `WhatsAppImport` | Chatname/Datumsformat abfragen, ZIP-Exporte lesen und Anhänge bei Bedarf entpacken |
| `pdf-bericht.js` | `PdfBericht` | Chat als druckfertiger Bericht (Deckblatt, Verlauf, Bilder, Prüfsumme) → Druckdialog „Als PDF speichern" |
| `spaltenzuordnung.js` | `Spaltenzuordnung` | Dialog „Spalten zuordnen" für fremde CSVs mit Beispielwerten und Zeitprobe; merkt die Antwort je Spaltensatz |
| `medienordner.js` | `Medienordner` | Ordner verbinden, merken, trennen |
| `uebersetzen.js` | `Uebersetzen` | 🌐 Knopf, Panel, Chatlauf, Einzelnachricht |
| `sprachnachrichten.js` | `Sprachnachrichten` | 🎤 Knopf, Panel, Chatlauf, Einzelnachricht |
| `dokumente.js` | `Dokumentenlauf` | Anhänge im Hintergrund durchsuchbar machen |
| `lightbox.js` | `Lightbox` | Großansicht für Bild, Video, PDF, Dokumenttext |

Jedes Modul bringt ein `verdrahten()` mit, das seine Ereignisse einhängt;
`app.js` ruft sie beim Start der Reihe nach auf. Wer ein neues Bedienmodul
anlegt, macht es genauso – dann bleibt `app.js` schlank.

### app.js

Öffnet Chats (`App.oeffneChat`), verdrahtet Seitenleiste, Kopfzeile,
Verlauf und Tastatur, startet alles (`init`) und stellt die öffentliche
Schnittstelle `window.ChatVisualizer` für Konsole und Automatisierung
bereit.

## Wer darf wen aufrufen?

```
bedienung  →  ansicht  →  daten  →  kern
     └──────────────────────┴────────→ kern
```

* **kern** ruft niemanden auf (außer `Helfer`).
* **daten** darf `kern` benutzen, aber nichts aus `ansicht`/`bedienung`.
* **ansicht** darf `kern` und `daten` lesen – aber nichts verändern und
  keine Läufe starten.
* **bedienung** darf alles benutzen und stößt die Läufe an.

Eine Ausnahme ist bewusst erlaubt: `ansicht/medien.js` ruft nach dem
Auslesen eines Dokuments `Chatliste.zeichne()` auf, damit die Trefferzahlen
stimmen. Das bleibt innerhalb der Ansicht.

Da alle Namen global sind, spielt die Ladereihenfolge nur dort eine Rolle,
wo ein Modul beim Laden (nicht erst beim Klick) auf ein anderes zugreift –
deshalb steht `helfer.js` ganz vorn und `app.js` ganz hinten.

## Abläufe im Überblick

**Import**
`Import.importiereDateien` → `CSV.toObjects` → ALEAPP-Tabellen sammeln (siehe unten) →
übrige Dateien: bekannte Quelle übersetzen (`Ileapp.umsetzen`, sonst `GeraeteDB.umsetzen`) →
`Model.buildMapping` (vergleicht Spaltennamen in der Schreibweise von
`Model.kopfNorm`) → bei fremden Spalten gemerkte Zuordnung oder
`Spaltenzuordnung.fragen` → `Model.rowToMessage` je Zeile (mit Zeitzone und
festem Chatnamen aus dem Dialog) → zusammenführen über `Messenger::nachricht_id`
→ `Model.rebuild` → `Import.speichere` (ein IndexedDB-Eintrag je
Unterhaltung) → `Render.renderAll` → `Dokumentenlauf.alleLesen`.

**ALEAPP-Bericht**
Erst werden alle Dateien eines Imports gelesen: `Aleapp.erkenne` ordnet jede Tabelle
an ihren Spalten einer Quelle und Rolle zu (Nachrichten, Kontakte, Anrufe …). Danach
wertet `Aleapp.kombiniere` die Tabellen je Quelle gemeinsam aus und liefert Zeilen im
eigenen Spaltenformat (auch `dauer`, `video`, `anruf_ergebnis`, `geloescht`, `quelle`);
sie laufen wie eine CSV durch `Model.rowToMessage`. Erst danach kommen die übrigen
Dateien. Tabellen aus einem ALEAPP-Bericht (Pfad `_TSV Exports` oder zusammen mit
erkannten ALEAPP-Tabellen) lösen nie den Zuordnungsdialog aus, sondern werden still
übergangen und in der Meldung gezählt. Eine neue App meldet sich mit
`Aleapp.quelle({app, tabellen, kombiniere})` an, eine einfache mit
`Aleapp.einfach({...})` in `aleapp-apps.js`; der Test „jede bekannte Tabelle wird
eindeutig …“ prüft, dass sich die Erkennungsspalten nicht überschneiden und
iLEAPP-Tabellen nicht als ALEAPP gelten.

**Zeiten**
`Model.parseTimestamp(wert, zone)` liest Text mit oder ohne Zone und Zahlen aus
Geräte-Datenbanken (Stellenzahl entscheidet: Apple-Sekunden/-Nanosekunden,
Unix s/ms/µs/ns, WebKit). Zahlen und Werte mit eigener Zone bleiben von der
Zonenwahl unberührt; ohne Zone gilt die Spalte `zeitzone`, sonst die Wahl im
Dialog, sonst die Ortszeit. Rohwert und Zone bleiben an der Nachricht
(`tsRaw`, `tz`) und stehen im Tooltip der Uhrzeit.

Angezeigt wird über `Model.DT_DATE`/`DT_TIME`/`DT_FULL`, `dayLabel`, `relative` und
`tagSchluessel` – alle folgen der Anzeige-Zone (`Model.setzeAnzeigeZone`, Schalter
Ortszeit/UTC in der Seitenleiste). Wer irgendwo eine Zeit anzeigt, nimmt diese
Formate statt eines eigenen `Intl.DateTimeFormat` oder `toDateString()`.

**WhatsApp-Import**
`Import.importiereDateien` verarbeitet TXT, ZIP und lose Anhänge; parallele Importe
werden nacheinander abgearbeitet. `WhatsApp.inspect` erkennt Textexporte,
`WhatsAppImport.configure` zeigt Chatname und Datumsformat, `WhatsApp.parse` liefert
das bestehende Nachrichtenformat. ZIPs werden durch `WhatsAppImport.unzip` geöffnet:
Chattexte sofort, Anhänge über `Media.attachSources` erst bei Bedarf. Ordnerimporte
geben Originalpfade weiter, damit gleichnamige Anhänge verschiedenen Chats zugeordnet
bleiben. Wiederholungsimporte setzen denselben vom Nutzer vergebenen Chatnamen voraus.

**Tests**
`node --test tests/*.test.cjs` prüft
Parser, Datumsvarianten, Zeitzonen, Anhänge, ZIPs, Wiederholungsimporte, GIF-Schleifen,
Medienpfade, Ladevorgänge, das Zusammenführen von ALEAPP-Berichten, iLEAPP/SQL-Exporte, den Zuordnungsdialog, die
Übersetzung mit fester und erkannter Ausgangssprache, den Inhalt des PDF-Berichts, Emoji-Kurznamen und die bestehenden CSV-Beispiele
ohne zusätzliche Pakete. `python -B -m unittest discover
-s tests -p test_serve.py` prüft die HTTP-Teilabrufe des Python-Servers. Die Datei
`tests/fixtures/medien-test.csv` dient zur Browserprüfung; die kleinen GIF-/PNG-Dateien
daneben sind synthetische Testbilder.

**Medien**
`Medienordner.ordnerWaehlen` → `Media.attachDirectoryHandle` (merkt sich den
Ordner) → `Medienordner.nachAnbindung` → Ansicht auffrischen → im Ordner
gefundene CSV-Dateien importieren → Dokumente lesen.

**Suche**
Eingabe → `Model.state.query` → `Chatliste.zeichne` → je Nachricht
`Suchtreffer.passt` (Text, Absender, Pfad, Übersetzung, Transkript,
Dokumentinhalt). Steckt der Treffer nicht im Text, zeigt
`Suchtreffer.auszug` die Fundstelle mit 🌐/🎤/📄 davor.

**Übersetzen / Transkribieren**
Knopf → `Uebersetzen.starten` bzw. `Sprachnachrichten.starten` →
`Translate.translateConversation` / `Transcribe.transcribeConversation`
mit Rückruf → `Fortschritt.zeige` → fertige Nachrichten einzeln über
`Render.refreshMessage` auffrischen → Ergebnisse landen in IndexedDB.

## Wo fängt man an, wenn man …

* **… eine Spalte hinzufügen will?** `kern/model.js` (`FIELDS`,
  `FELD_NAMEN`, `rowToMessage`), bei optionalen Feldern `kern/store.js`
  (`OPTIONAL`, sonst geht es beim Speichern verloren), dann die Anzeige in
  `ansicht/chat.js`, die Liste `FELDER` in `bedienung/spaltenzuordnung.js` und
  den Erklärtext in `index.html` (#helpDialog) und `bedienung/hilfe.js`.
* **… Anrufe anders darstellen will?** `Model.anruf` (Art, Richtung, Dauer,
  Ergebnis) liefert die Beschreibung für Sprechblase (`ansicht/chat.js`,
  `anrufHTML`), Chatliste (`Suchtreffer.vorschauText`) und PDF-Bericht.
  Anruflisten-Umsetzer tragen `nachricht_typ: 'anruf'`, `dauer`, `video`,
  `anruf_ergebnis` und dieselbe Chat-Kennung wie die Nachrichten der Quelle.
* **… einen weiteren Bericht oder eine weitere Datenbanktabelle erkennen will?**
  ALEAPP: eine Quelle in `daten/aleapp-apps.js` – `Aleapp.einfach({...})` für eine
  Nachrichtentabelle, `Aleapp.quelle({app, tabellen, kombiniere})`, wenn mehrere
  Tabellen zusammengehören (Vorbild `daten/aleapp-whatsapp.js`). iLEAPP: ein Eintrag
  in `BERICHTE` (`daten/ileapp.js`), Datenbanktabellen in `TABELLEN`
  (`daten/geraete-db.js`): woran er zu erkennen ist und wie eine Zeile ins eigene
  Spaltenformat übersetzt wird.
* **… ein Dateiformat lesbar machen will?** `daten/documents.js`
  (`format`, Auszugsfunktion) – die Suche greift dann von selbst.
* **… einen neuen Messenger einfärben will?** `daten/messengers.js`.
* **… etwas an der Darstellung ändern will?** die passende Datei in
  `css/teile/` und den zugehörigen Zeichner in `js/ansicht/`.
* **… einen neuen Knopf braucht?** Auszeichnung in `index.html`, Verhalten
  in einem Modul unter `js/bedienung/` mit eigenem `verdrahten()`, Aufruf
  in `app.js` → `init()`.
