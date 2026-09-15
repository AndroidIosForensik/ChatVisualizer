# Aufbau von ChatVisualizer

Diese Datei erklärt, wo was liegt und warum. Sie richtet sich an alle, die
später etwas ändern wollen – auch an mich selbst in einem halben Jahr.

## Leitgedanken

1. **Kein Bauwerkzeug.** Kein npm, kein Bundler, kein Übersetzer. Jede Datei
   ist ein ganz normales `<script>`; wer etwas ändert, drückt F5. Deshalb
   keine ES-Module in der Seite, sondern klassische Skripte, die je einen
   globalen Namen ablegen (`Helfer`, `Model`, `Render`, …). Einzige Ausnahme:
   der Arbeiter-Thread der Spracherkennung, der echte `import`-Anweisungen
   benutzt.
2. **Alles bleibt auf dem Rechner.** Keine Datei wird hochgeladen, kein
   Dienst angefragt. Übersetzung und Spracherkennung laufen im Browser bzw.
   aus dem mitgelieferten Modellordner.
3. **Eine Aufgabe je Datei.** Wird eine Datei größer als ein paar hundert
   Zeilen, wird sie geteilt – so wie beim letzten Mal `app.js` und
   `render.js`.

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
modelle/              Whisper-Modell für die Spracherkennung (offline)
vendor/               PDF.js und transformers.js, unverändert übernommen
```

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
| `media.js` | `Media` | Medienordner einlesen, Pfade zuordnen, Dateien liefern |
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
| `import.js` | `Import` | CSV einlesen, Ablegen per Maus, Export, Demodaten |
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
`Import.importiereDateien` → `CSV.toObjects` → `Model.buildMapping` →
`Model.rowToMessage` je Zeile → zusammenführen über `Messenger::nachricht_id`
→ `Model.rebuild` → `Import.speichere` (ein IndexedDB-Eintrag je
Unterhaltung) → `Render.renderAll` → `Dokumentenlauf.alleLesen`.

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
  `rowToMessage`), dann die Anzeige in `ansicht/chat.js` und den
  Erklärtext in `index.html` (#helpDialog) und `bedienung/hilfe.js`.
* **… ein Dateiformat lesbar machen will?** `daten/documents.js`
  (`format`, Auszugsfunktion) – die Suche greift dann von selbst.
* **… einen neuen Messenger einfärben will?** `daten/messengers.js`.
* **… etwas an der Darstellung ändern will?** die passende Datei in
  `css/teile/` und den zugehörigen Zeichner in `js/ansicht/`.
* **… einen neuen Knopf braucht?** Auszeichnung in `index.html`, Verhalten
  in einem Modul unter `js/bedienung/` mit eigenem `verdrahten()`, Aufruf
  in `app.js` → `init()`.
