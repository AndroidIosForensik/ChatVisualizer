# ChatVisualizer

Ein lokales Werkzeug, das Chat-Exporte im CSV-Format einliest und als vertraute
Messenger-Oberfläche darstellt – mit Messenger-Logo, Chatliste, Suche und Details.

**Alles läuft im Browser.** Es gibt keinen Server-Upload, keine Cloud, keine Abhängigkeiten.

## Starten

**Windows: Doppelklick auf `ChatVisualizer starten.cmd`** – fertig. Der Browser öffnet
sich von selbst, das schwarze Fenster daneben ist der Server; zum Beenden einfach
schließen. Es muss nichts installiert werden, alles läuft mit Windows-Bordmitteln
(PowerShell). Der Ordner funktioniert genauso vom USB-Stick oder Netzlaufwerk.

**macOS / Linux:** `./start.sh` (nutzt python3, python, php oder ruby – was vorhanden ist).

Der Port wird automatisch gewählt: ab 8777 wird der erste freie genommen, ein zweiter
Start stört also nicht. Fester Port bei Bedarf:

```powershell
.\start.ps1 -Port 9000
```

(unter macOS/Linux: `./start.sh 9000`; ohne Browserstart: `.\start.ps1 -NoBrowser`)

Über `localhost` funktioniert die dauerhafte Speicherung (IndexedDB) zuverlässig,
importierte Chats sind nach einem Neustart also wieder da. Notfalls lässt sich
`index.html` auch direkt per Doppelklick öffnen – dann verweigern manche Browser
allerdings die dauerhafte Speicherung und die Daten gelten nur für die Sitzung.
Genau das macht die Startdatei auch automatisch, falls kein Server starten kann.

## Bedienung

| Aktion | Wie |
| --- | --- |
| Importieren | Button **+ CSV** oder Dateien irgendwo ins Fenster ziehen (mehrere gleichzeitig möglich) |
| Format nachschlagen | Button **?** in der Seitenleiste: erklärt jede Spalte mit Bedeutung und Beispiel, und speichert auf Wunsch eine fertige Vorlage als CSV |
| Medienordner | Button **🖼** oder den Ordner ins Fenster ziehen – Bilder, Videos, PDFs und Sprachnachrichten erscheinen danach direkt im Chat |
| Dokumente | PDFs zeigen eine Seitenvorschau, Word/Excel/Text eine Leseprobe – Klick öffnet den Inhalt; alle Dokumente werden im Hintergrund gelesen und sind damit durchsuchbar |
| Sprachnachrichten | **🎤** in der Chat-Kopfzeile transkribiert sofort alle Sprachnachrichten des Chats; 🎤 an der einzelnen Sprechblase nur diese eine |
| Übersetzen | **🌐** in der Chat-Kopfzeile übersetzt sofort den ganzen Chat; 🌐 an der einzelnen Sprechblase nur diese eine – das Original bleibt darunter sichtbar |
| Einstellungen dazu | das kleine **▾** neben 🎤 bzw. 🌐 (Zielsprache, Verfahren, Modell, Transkripte löschen) |
| Fortschritt | Läuft ein Durchlauf, zeigt ein Balken über dem Chat, wie weit er ist (z. B. „Übersetzt… 12 / 14") – auch wenn das Panel geschlossen ist; dort lässt er sich auch abbrechen |
| Suchen (alle Chats) | Feld oben links, `Strg+K` – zeigt Trefferzahl je Chat, Klick springt zum Treffer |
| Suchen (im Chat) | Lupe in der Chat-Kopfzeile, `Strg+F` – mit `Enter` / `Umschalt+Enter` durch die Treffer |
| Filtern | Messenger-Chips unter dem Suchfeld |
| Sortieren | Auswahlfeld über der Chatliste (neueste, älteste, meiste Nachrichten, Name) |
| Eigene Seite festlegen | **Ich:** in der Chat-Kopfzeile – diese Person erscheint rechts in Blau |
| Details / Statistik | ⓘ rechts oben: Teilnehmer, Zeitraum, Nachrichtentypen, Medien |
| Exportieren | ⤓ in der Chat-Kopfzeile (Chat als Text), ⤓ in der Seitenleiste (alles als JSON) |
| Hell / Dunkel | ◐ in der Seitenleiste |
| Alles löschen | 🗑 in der Seitenleiste |

Zitierte Nachrichten (`antwort_auf_id`) sind anklickbar und springen zum Original.
Reaktionen (`reaktion_auf_id`) werden als Emoji-Chip an die Zielnachricht gehängt
statt als eigene Nachricht angezeigt.

## CSV-Format

Dieselbe Übersicht steckt im Programm: Button **?** in der Seitenleiste (oder der Verweis
auf dem Startbildschirm). Dort lässt sich auch eine **Vorlage als CSV speichern** –
Kopfzeile plus fünf Beispielzeilen, die sich direkt wieder importieren lässt.

Kopfzeile mit diesen Spalten (Trennzeichen `,` `;` Tab oder `|` wird automatisch erkannt,
UTF-8 mit oder ohne BOM, Anführungszeichen nach RFC 4180):

| Spalte | Bedeutung |
| --- | --- |
| `nachricht_id` | eindeutige ID der Nachricht — **erforderlich** |
| `zeitstempel` | `2026-08-30T18:12:04`, `30.08.2026 18:12`, oder Unix-Zeit (Sekunden/Millisekunden) |
| `absender_id` | Name oder ID des Absenders — **erforderlich** |
| `unterhaltungs_id` | Chat, zu dem die Nachricht gehört — **erforderlich** |
| `nachrichteninhalt` | Text (bei Reaktionen: das Emoji) |
| `nachricht_typ` | `text`, `bild`, `video`, `audio`, `datei`, `system`, `standort`, `kontakt`, `umfrage`, `anruf` … |
| `medienpfad` | Pfad zur Datei |
| `antwort_auf_id` | ID der zitierten Nachricht |
| `reaktion_auf_id` | gesetzt = die Zeile ist eine Reaktion auf diese Nachricht |
| `status` | `gesendet`, `zugestellt`, `gelesen`, `fehlgeschlagen`, `gelöscht` … |
| `messenger` | `WhatsApp`, `Threema`, `Telegram`, `Signal`, `Instagram`, `SMS`, … |

Englische Spaltennamen (`message_id`, `timestamp`, `sender_id`, `conversation_id`,
`content`, `message_type`, `media_path`, `reply_to_id`, `reaction_to_id`, `platform`)
werden ebenfalls erkannt. Fehlt die Spalte `messenger`, wird der Dateiname als Messenger verwendet.

Unbekannte Messenger bekommen automatisch ein Logo mit Anfangsbuchstaben und eigener Farbe.

### Mehrfachimport

Nachrichten werden über `messenger + nachricht_id` eindeutig gehalten: dieselbe Datei
zweimal zu importieren erzeugt keine Duplikate, sondern aktualisiert die Nachrichten.

## Übersetzung

Fremdsprachige Nachrichten lassen sich ins Deutsche (oder eine andere Sprache)
übersetzen – **komplett lokal**, es geht nichts ins Netz. Das Original bleibt immer
sichtbar: die Übersetzung steht in normaler Größe oben, darunter durch eine feine Linie
getrennt das Original kleiner und etwas blasser, mit der erkannten Sprache als Kennzeichen.

Bedienung über das **🌐** in der Chat-Kopfzeile – ein Klick übersetzt den ganzen Chat,
bereits Übersetztes wird übersprungen:

- Der Fortschritt steht über dem Chat und lässt sich dort abbrechen
- Das kleine **▾** daneben öffnet die Einstellungen (Zielsprache, Löschen)
- **Einzelne Nachricht** – 🌐 erscheint beim Überfahren einer Sprechblase, ↩ entfernt
  die Übersetzung wieder
- Übersetzungen werden gespeichert, sind nach einem Neustart sofort wieder da
  und werden von der Suche mitdurchsucht; zitierte Antworten zeigen ebenfalls die Übersetzung

### Verfahren

Übersetzt wird mit der **eingebauten Übersetzung von Chrome/Edge** (Translator-API, ab
Version 138). Sie läuft on-device: der Browser lädt beim ersten Mal einmalig ein
Sprachpaket für das jeweilige Sprachpaar – der Fortschritt wird im Panel angezeigt –,
danach bleibt jeder Text auf dem Rechner.

Die Ausgangssprache erkennt der Browser selbst (`LanguageDetector`); fehlt die
Erkennung, springt eine einfache Heuristik ein, und wenn auch die bei einem kurzen Satz
passen muss, zählt die vorherrschende Sprache der Unterhaltung. Bietet der Browser kein Verfahren an,
sagt das Panel das deutlich – es bleibt nie hängen, alle Aufrufe laufen in ein Zeitlimit.

Fürs Übersetzen wird also **nichts installiert und nichts mitgeliefert** – das erledigt
der Browser. (Das mitgelieferte Modell im Ordner `modelle/` ist nur für die
Spracherkennung, siehe nächster Abschnitt.)

Weitere Schalter im Panel: Zielsprache, „Nachrichten in der Zielsprache überspringen"
und das Löschen aller Übersetzungen des Chats. Reine Emoji- oder Link-Nachrichten werden gar nicht erst
übersetzt.

## Sprachnachrichten transkribieren

Sprachnachrichten lassen sich in Text umwandeln – **komplett lokal**, die Aufnahme
verlässt den Rechner nicht. Das Modell (Whisper small) liegt fertig im Ordner `modelle/`,
es muss nichts installiert und nichts heruntergeladen werden.

Bedienung über das **🎤** in der Chat-Kopfzeile – ein Klick, und alle Sprachnachrichten
des Chats werden der Reihe nach abgearbeitet:

- Der Fortschritt steht über dem Chat und lässt sich dort abbrechen
- Gibt es nichts zu tun, sagt eine kurze Meldung warum (keine Sprachnachrichten, alles
  schon transkribiert, Datei fehlt)
- Das kleine **▾** daneben öffnet die Einstellungen (Verfahren, Modell, Sprache)
- **Einzeln** – 🎤 erscheint beim Überfahren einer Sprachnachricht, ↩ entfernt das
  Transkript wieder
- Das Transkript steht unter dem Abspieler in der Sprechblase, zusammen mit der erkannten
  Sprache, wird gespeichert und ist nach einem Neustart sofort wieder da

**Und danach übersetzbar:** ein Transkript zählt für alles Weitere wie ein normaler
Nachrichtentext. Es wird von der Suche gefunden und lässt sich mit 🌐 ins Deutsche
übersetzen – dann steht oben die Übersetzung und darunter klein das Transkript,
gekennzeichnet mit 🎤.

### Sprache

Whisper muss wissen, in welcher Sprache gesprochen wird – ohne Angabe übersetzt es
stillschweigend ins Englische. Die Sprache wird deshalb **aus den Textnachrichten
derselben Unterhaltung abgeleitet** (bevorzugt von derselben Person). In einem russischen
Chat wird also russisch transkribiert, in einem englischen englisch. Im Panel lässt sich
die Sprache auch fest vorgeben, falls die Automatik danebenliegt.

### Tempo und Qualität

Mitgeliefert ist **Whisper small** (242 MB). Die Erkennung braucht ungefähr so lange wie
die Aufnahme selbst – gemessen auf einem normalen Rechner:

| Aufnahme | Dauer | Zeit |
| --- | --- | --- |
| Russisch, Dialog | 18 s | 16 s |
| Russisch, Lesung | 39 s | 34 s |
| Deutsch | 10 s | 12 s |
| Englisch | 9 s | 12 s |

Das Modell wird einmal geladen (ein paar Sekunden) und bleibt danach warm. Lange
Aufnahmen zerlegt Whisper selbst in Abschnitte von 30 Sekunden mit Überlappung.
Für einen Chat mit vielen Sprachnachrichten lohnt es sich, den Lauf einmal im
Hintergrund durchlaufen zu lassen – die Ergebnisse werden gespeichert.

Wer es schneller braucht: **Whisper base** ist rund dreimal schneller und nur 78 MB groß,
patzt dafür bei Namen und Zeichensetzung (aus „Мария Степановна" wird „моря степановна").
Es ist nicht mitgeliefert – der Ordner `modelle/Xenova/whisper-base` genügt, dann taucht
es über `modelle/verzeichnis.json` als zweite Auswahl im Panel auf.

### Alternative: Chrome-Spracherkennung

Im Panel lässt sich auf **Chrome-Spracherkennung** umschalten (Prompt-API mit
Audio-Eingabe, Gemini Nano on-device). Die ist in Chrome noch hinter Schaltern versteckt;
ist sie nicht freigegeben, zeigt das Panel genau, woran es liegt, und was zu tun ist
(`chrome://flags` → *Prompt API for Gemini Nano* und *…with Multimodal Input*, danach
`chrome://components`). Voraussetzung sind außerdem rund 22 GB freier Speicher und eine
GPU mit 4 GB VRAM.

Für beide Verfahren gilt: der **Medienordner muss verbunden sein**, sonst fehlt die
Audiodatei – das Panel sagt, bei wie vielen Nachrichten das der Fall ist.

## Medienordner

Zusätzlich zu den CSV-Dateien lässt sich der Ordner mit den Anhängen verbinden – über
den Button **🖼** in der Seitenleiste oder indem der Ordner ins Fenster gezogen wird.
Danach zeigt der Chat die Dateien direkt an:

- **Bilder** als Vorschau im Chat, Klick öffnet die Lightbox (`←` `→` blättert durch alle
  Bilder und Videos der Unterhaltung, `Esc` schließt)
- **Videos** als Player mit Steuerung direkt in der Sprechblase
- **Sprachnachrichten und Audio** als abspielbarer Player
- **PDF und andere Dateien** als Kachel, die die Datei in einem neuen Tab öffnet
- **Detailspalte** zeigt echte Vorschaubilder in der Mediengalerie

Nicht gefundene Dateien bleiben als Kachel mit Pfad sichtbar (Klick kopiert den Pfad),
es geht also nichts verloren.

### Dokumente: Vorschau und Suche

Angehängte Dokumente werden gelesen, damit die Suche ihren **Inhalt** findet – nicht nur
den Dateinamen:

| Format | Was passiert |
| --- | --- |
| **PDF** | Vorschau der ersten Seite in der Sprechblase; Klick öffnet das Dokument seitenweise (`←` `→` blättern). Text wird ausgelesen. |
| **Word, Excel, PowerPoint** (`docx`, `xlsx`, `pptx`) | Kachel mit Leseprobe; Klick zeigt den ganzen Text. |
| **OpenDocument** (`odt`, `ods`, `odp`) | genauso |
| **Text und Daten** (`txt`, `md`, `json`, `xml`, `html`, `csv`, `log`, `ini`, `yaml`, `srt`, `rtf` …) | genauso |

Sobald der Medienordner verbunden ist (oder neue CSV-Dateien dazukommen), werden **alle
Dokumente im Hintergrund gelesen** – der Fortschritt steht über dem Chat. Damit findet die
Suche auch Wörter, die nur im Dokument stehen, ohne dass man die Datei vorher geöffnet
haben muss. In der Trefferliste zeigt ein 📄 die Fundstelle samt Umgebung (bei
Sprachnachrichten entsprechend ein 🎤, bei Übersetzungen ein 🌐). Vorschaubild und Text
werden gespeichert und sind beim nächsten Start sofort da, auch ohne verbundenen
Medienordner.

Gelesen werden bis zu 60 Seiten bzw. 400.000 Zeichen je Dokument; längere werden als
„gekürzt" gekennzeichnet. PDFs erledigt das mitgelieferte PDF.js (`vendor/pdfjs/`, ~4 MB),
Office-Dateien packt der Browser selbst aus – beides ohne Installation und ohne Netz.
**Gescannte PDFs ohne Textebene** lassen sich ansehen, aber nicht durchsuchen; dafür
bräuchte es eine Texterkennung. Die alten Binärformate `.doc`, `.xls` und `.ppt` werden
nicht gelesen.

### Zuordnung der Pfade

Der Pfad aus `medienpfad` wird über seine **Endung** gegen den Ordner abgeglichen –
die längste Übereinstimmung gewinnt. Groß-/Kleinschreibung und `\` vs. `/` sind egal.
So findet `C:\Backup\WhatsApp\Media\medien\foto.jpg` die Datei `medien/foto.jpg`
im verbundenen Ordner, und auch ein bloßer Dateiname genügt.

Enthält der verbundene Ordner selbst CSV-Dateien, werden diese gleich mit importiert –
ein kompletter Export-Ordner lässt sich also in einem Zug ins Fenster ziehen.

### Speicherung und Wiederverbinden

In Chrome und Edge merkt sich das Werkzeug den gewählten Ordner: beim nächsten Start
genügt ein Klick auf **„Medienordner … wieder verbinden"** in der Seitenleiste, es wird
nichts kopiert. Die Dateien selbst bleiben, wo sie sind – gelesen wird nur bei Bedarf,
und nur was gerade sichtbar ist. In anderen Browsern (oder beim Öffnen per Doppelklick)
funktioniert die Ordnerauswahl ebenfalls, gilt aber nur für die laufende Sitzung.

Liegen die Medien direkt neben `index.html` (z. B. Ordner `medien`), werden sie auch
ohne verbundenen Ordner über den lokalen Server geladen.

## Beispieldaten

`beispiel-daten/` enthält **10 Chats mit 108 Nachrichten** über sieben Messenger –
genug, um alles auszuprobieren, ohne eigene Exporte zu brauchen:

| Datei | Trennzeichen | Zeitformat | Inhalt |
| --- | --- | --- | --- |
| `whatsapp_familie.csv` | Komma | ISO | Familie und Sportverein, deutsch |
| `whatsapp_datscha_russisch.csv` | Komma | ISO | **russische Gruppe** mit zwei russischen Sprachnachrichten |
| `threema_arbeit.csv` | Semikolon | `03.09.2026 08:58:00` | Projektgruppe und Beratung |
| `telegram_freunde.csv` | Tabulator | Unix-Zeit | Laufgruppe, **englische Spaltennamen** |
| `signal_anna_englisch.csv` | Komma | ISO | englischer Chat mit Sprachnachrichten |
| `diverse_messenger.csv` | Pipe `\|` | ISO | Instagram, SMS-Benachrichtigungen, unbekannter Messenger |

Enthalten sind unter anderem: Antworten mit Zitat, Reaktionen, gelöschte und
Systemnachrichten, alle Statusstufen, mehrzeilige Nachrichten, Links, Emoji-Nachrichten,
Standort, Kontakt, Umfrage, verpasster Anruf, ein unbekannter Messenger mit automatisch
erzeugtem Logo – und in `beispiel-daten/medien/` Bilder, ein Video, PDFs sowie **sieben
Sprachnachrichten auf Deutsch, Englisch und Russisch**.

Eine Nachricht verweist absichtlich auf eine **fehlende** Videodatei, damit sichtbar wird,
wie das Werkzeug damit umgeht. Woher die Mediendateien stammen, steht in
[`beispiel-daten/QUELLEN.md`](beispiel-daten/QUELLEN.md) – die russischen Aufnahmen sind
echte, gemeinfreie Sprachaufnahmen, alles andere ist selbst erzeugt.

Zum Ausprobieren: Startdatei doppelklicken, die sechs CSV-Dateien und den Ordner
`beispiel-daten/medien` ins Fenster ziehen – oder auf dem Startbildschirm
**Mit Demodaten ansehen** wählen.

## Aufbau

Der Code ist in vier Schichten aufgeteilt – Grundlagen, Daten, Ansicht, Bedienung.
Wer etwas ändern will, findet in [`ARCHITEKTUR.md`](ARCHITEKTUR.md) die
ausführliche Beschreibung samt Abhängigkeitsregeln und typischen Einstiegspunkten.

```
index.html          Grundgerüst der Oberfläche + Ladereihenfolge
css/style.css       bindet die Gestaltung aus css/teile/ ein
css/teile/*.css     Design je Bereich (Basis, Seitenleiste, Chat, Panels, …)

js/kern/helfer.js       kleine Helfer, die überall gebraucht werden
js/kern/csv.js          CSV-Parser (RFC 4180, Trennzeichenerkennung)
js/kern/store.js        IndexedDB (ein Eintrag je Unterhaltung) + Einstellungen
js/kern/model.js        Datenmodell, Spaltenzuordnung, Index der Unterhaltungen

js/daten/messengers.js  Messenger-Erkennung, Markenfarben, Logos
js/daten/media.js       Medienbibliothek: Ordner einlesen, Pfade zuordnen, Dateien liefern
js/daten/archive.js     ZIP-Leser für Office-Dateien (docx, xlsx, pptx, odt …)
js/daten/documents.js   Dokumente: Vorschau, Textauszug, Hintergrundlauf
js/daten/translate.js   Übersetzung: Browser-API, Spracherkennung, Warteschlange, Speicher
js/daten/transcribe.js  Sprachnachrichten: Audio aufbereiten, Verfahren wählen, speichern
js/daten/transcribe-worker.js  Whisper im eigenen Thread (transformers.js/ONNX)

js/ansicht/text.js      Text entschärfen, hervorheben, verlinken
js/ansicht/suche.js     Suche über Text, Übersetzung, Transkript und Dokumentinhalt
js/ansicht/medien.js    Medienkacheln – beim Sichtbarwerden geladen
js/ansicht/liste.js     Seitenleiste: Filter und Chatliste
js/ansicht/chat.js      Sprechblasen, Kopfzeile, Treffernavigation
js/ansicht/details.js   Detailspalte mit Kennzahlen und Galerie
js/ansicht/render.js    Fassade über die vier Zeichner

js/bedienung/meldung.js          kurze Rückmeldungen
js/bedienung/fortschritt.js      Fortschrittsleiste und Ladebalken
js/bedienung/hilfe.js            Erklärfenster zum CSV-Format
js/bedienung/import.js           CSV-Import, Ablegen per Maus, Export, Demodaten
js/bedienung/medienordner.js     Medienordner verbinden, merken, trennen
js/bedienung/uebersetzen.js      Bedienung der Übersetzung (🌐)
js/bedienung/sprachnachrichten.js Bedienung der Transkription (🎤)
js/bedienung/dokumente.js        Anhänge im Hintergrund durchsuchbar machen
js/bedienung/lightbox.js         Großansicht für Bild, Video, PDF, Dokument
js/app.js                        verbindet alles und startet

modelle/            Spracherkennungsmodell Whisper small (~242 MB) – liegt fertig dabei
vendor/transformers/     Laufzeit für das Modell (transformers.js + ONNX-WASM, ~22 MB)
vendor/pdfjs/       PDF.js für Vorschau und Textauszug (~4 MB)
serve.py            Webserver für macOS/Linux mit den nötigen MIME-Typen
ChatVisualizer starten.cmd   Startdatei für Windows (Doppelklick)
start.ps1           Lokaler Webserver, nur Windows-Bordmittel
start.sh            Dasselbe für macOS/Linux
```

In der Konsole steht `window.ChatVisualizer` mit `state`, `importFiles(files)`,
`openConversation(key)`, `demoData()`, `pickMediaFolder()`, `attachMediaFiles(files)`
und `media` (Zuordnung prüfen mit `media.lookup(pfad)`) zur Verfügung.

## Platzbedarf

Der Ordner ist mit dem Spracherkennungsmodell rund **270 MB** groß. Wer keine
Sprachnachrichten transkribieren will, kann `modelle/` und `vendor/` löschen – alles
andere läuft weiter, im 🎤-Panel steht dann nur, dass das Modell fehlt.

## Modell nachlegen

Im Git-Speicher fehlt der Ordner `modelle/`: GitHub nimmt ohne Git LFS keine Datei
über 100 MB an, und die Modelldatei ist 150 MB groß. Ohne ihn funktioniert alles
außer der Transkription (🎤 meldet dann „kein Modell vorhanden"). Zum Nachlegen die
Dateien von Hugging Face herunterladen – Modell
[`Xenova/whisper-small`](https://huggingface.co/Xenova/whisper-small) – und genau so
ablegen:

```
modelle/
  verzeichnis.json
  Xenova/whisper-small/
    config.json  generation_config.json  preprocessor_config.json
    tokenizer.json  tokenizer_config.json  special_tokens_map.json
    added_tokens.json  normalizer.json  merges.txt  vocab.json
    onnx/
      encoder_model_quantized.onnx          (89 MB)
      decoder_model_merged_quantized.onnx   (150 MB)
```

`modelle/verzeichnis.json` sagt dem Programm, welche Modelle bereitliegen; die
Angabe `bytes` ist nur für die Fortschrittsanzeige da:

```json
{ "modelle": [ { "name": "Xenova/whisper-small", "bytes": 253462711 } ] }
```

Fehlt die Datei, sieht das Programm selbst nach, ob `modelle/<Name>/config.json`
vorhanden ist. Andere Whisper-Größen (etwa `Xenova/whisper-base`) lassen sich
genauso danebenlegen.

## Größenordnung

50 000 Nachrichten in 20 Unterhaltungen: Import inklusive Speichern rund 0,6 s,
Laden beim Start rund 0,1 s, globale Suche rund 10 ms. Lange Chats werden in
Blöcken von 400 Nachrichten gerendert und beim Hochscrollen nachgeladen.
