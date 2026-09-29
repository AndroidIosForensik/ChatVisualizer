# ChatVisualizer

Liest Chat-Exporte im CSV-Format sowie WhatsApp-Textexporte (TXT oder ZIP mit Medien)
ein und zeigt sie als Messenger-Oberfläche an:
mit Logo, Chatliste, Suche und Detailspalte. Alles läuft im Browser auf dem
eigenen Rechner, es wird nichts hochgeladen.

## Starten

Windows: Doppelklick auf `ChatVisualizer starten.cmd`. Der Browser öffnet sich von
selbst, das Fenster daneben ist der lokale Server; zum Beenden schließen. Installiert
werden muss nichts, es genügt PowerShell. Der Ordner funktioniert auch vom USB-Stick
oder Netzlaufwerk.

macOS und Linux: `./start.sh`, benutzt python3, python, php oder ruby, je nachdem was
vorhanden ist.

Der Port wird automatisch gewählt: ab 8777 der erste freie. Ein fester Port geht auch:

```powershell
.\start.ps1 -Port 9000
```

Unter macOS/Linux `./start.sh 9000`, ohne Browserstart `.\start.ps1 -NoBrowser`.

Über `localhost` funktioniert die dauerhafte Speicherung (IndexedDB), importierte Chats
sind nach einem Neustart wieder da. `index.html` lässt sich zur Not auch direkt per
Doppelklick öffnen; dann verweigern manche Browser die dauerhafte Speicherung und die
Daten gelten nur für die Sitzung. Die Startdatei geht diesen Weg automatisch, falls kein
Server startet.

### Erster Start

Beim ersten Start prüft das Startskript, ob das Spracherkennungsmodell vorhanden ist,
und lädt es andernfalls nach: rund 242 MB von huggingface.co, einmalig. Der Fortschritt
steht im Konsolenfenster, ein Abbruch mit `Strg+C` setzt beim nächsten Start dort fort,
wo er aufgehört hat. Alles außer der Transkription funktioniert auch ohne das Modell.

Ohne Nachladen starten:

```powershell
.\start.ps1 -KeinModell
```

Unter macOS/Linux `CHATVISUALIZER_KEIN_MODELL=1 ./start.sh`. Nur das Modell holen, ohne
den Server zu starten: `python3 hole-modell.py`.

Welche Dateien dazugehören, steht in [`modelle/quellen.json`](modelle/quellen.json), mit
Größe und Prüfsumme je Datei. Wer ein weiteres Modell möchte, trägt es dort nach
demselben Muster ein.

## Bedienung

| Aktion | Wie |
| --- | --- |
| Importieren | Button **+ Import** oder Dateien ins Fenster ziehen: CSV, WhatsApp-TXT/ZIP und Anhänge, auch mehrere gleichzeitig |
| Format nachschlagen | Button **?** in der Seitenleiste: erklärt jede Spalte mit Bedeutung und Beispiel und speichert auf Wunsch eine Vorlage als CSV |
| Medienordner | Button **🖼** oder den Ordner ins Fenster ziehen. Bilder, Videos, PDFs und Sprachnachrichten erscheinen danach im Chat |
| Dokumente | PDFs zeigen eine Seitenvorschau, Word/Excel/Text eine Leseprobe, ein Klick öffnet den Inhalt. Alle Dokumente werden im Hintergrund gelesen und sind damit durchsuchbar |
| Sprachnachrichten | **🎤** in der Chat-Kopfzeile transkribiert alle Sprachnachrichten des Chats, 🎤 an der Sprechblase nur diese eine |
| Übersetzen | **🌐** in der Chat-Kopfzeile übersetzt den ganzen Chat, 🌐 an der Sprechblase nur diese eine. Das Original bleibt darunter sichtbar |
| Einstellungen dazu | das **▾** neben 🎤 bzw. 🌐: Ausgangs- und Zielsprache, Verfahren, Modell, Transkripte löschen |
| Ortszeit / UTC | Schalter **Ortszeit** in der Seitenleiste: zeigt alle Zeiten in UTC an (Sprechblasen, Tagestrenner, Chatliste, Details, Textexport). Der Tooltip der Uhrzeit nennt jeweils auch die andere Sicht. Die Wahl wird gemerkt |
| Fortschritt | Während eines Durchlaufs zeigt ein Balken über dem Chat den Stand an, etwa „Übersetzt… 12 / 14". Er bleibt auch bei geschlossenem Panel sichtbar und lässt sich dort abbrechen |
| Suchen (alle Chats) | Feld oben links, `Strg+K`. Zeigt die Trefferzahl je Chat, ein Klick springt zum Treffer |
| Suchen (im Chat) | Lupe in der Chat-Kopfzeile, `Strg+F`, mit `Enter` und `Umschalt+Enter` durch die Treffer |
| Filtern | Messenger-Chips unter dem Suchfeld |
| Sortieren | Auswahlfeld über der Chatliste: neueste, älteste, meiste Nachrichten, Name |
| Eigene Seite festlegen | **Ich:** in der Chat-Kopfzeile. Diese Person erscheint rechts in Blau |
| Details und Statistik | ⓘ rechts oben: Teilnehmer, Zeitraum, Nachrichtentypen, Medien |
| Exportieren | ⤓ in der Chat-Kopfzeile für den Chat als **PDF-Bericht** (siehe unten), ⤓ in der Seitenleiste für alles als JSON |
| Hell und Dunkel | ◐ in der Seitenleiste |
| Alles löschen | 🗑 in der Seitenleiste |

Zitierte Nachrichten (`antwort_auf_id`) sind anklickbar und springen zum Original.
Reaktionen (`reaktion_auf_id`) hängen als Emoji an der Zielnachricht, statt als eigene
Nachricht zu erscheinen.

## WhatsApp-Textexporte mit Medien

In WhatsApp die Unterhaltung über **Chat exportieren** sichern und bei Bedarf
**Medien einschließen** wählen. Anschließend im ChatVisualizer:

- **ZIP:** Über **+ Import** die ZIP-Datei auswählen oder ins Fenster ziehen. Der
  Chattext wird gelesen; Bilder, Videos, Audio und Dokumente werden beim Anzeigen
  direkt aus dem ZIP entpackt. Alles bleibt lokal.
- **TXT und einzelne Anhänge:** Die TXT-Datei und die dazugehörigen Mediendateien
  gemeinsam auswählen oder zusammen ins Fenster ziehen. Anhänge können auch später
  per Drag & Drop ergänzt werden.
- **Entpackter Ordner:** Den kompletten Exportordner ins Fenster ziehen oder über
  **🖼** verbinden. Enthaltene WhatsApp-Texte werden automatisch erkannt.

Vor jedem WhatsApp-Import erscheinen Chatname und Datumsformat. Beim erneuten Import
denselben Chatnamen verwenden; verschiedene Unterhaltungen brauchen unterschiedliche
Namen. Besonders iPhone-Dateien mit dem allgemeinen Namen `_chat.txt` sollten hier
einen aussagekräftigen Namen bekommen. Bei Daten wie `03/04/2026` ausdrücklich prüfen,
ob Tag oder Monat zuerst steht.

Unterstützt werden die üblichen numerischen Android- und iPhone-Zeitstempel mit Punkt,
Schrägstrich oder Bindestrich, zwei- oder vierstelliger Jahreszahl, optionalen Sekunden
und AM/PM. Mehrzeilige Nachrichten und Systemmeldungen bleiben erhalten. Medienmarker
wie `Foto.jpg (Datei angehängt)`, `(file attached)`, `<Anhang: Foto.jpg>` und
`<attached: Foto.jpg>` werden den Anhängen zugeordnet. Nicht unterstützte Texte werden
nicht als Chat übernommen. Sprachvarianten mit anderen Medienmarkern sind noch nicht
abgedeckt. Platzhalter wie „Medien ausgeschlossen“ bleiben als Text sichtbar; daraus
lässt sich eine fehlende Datei nicht rekonstruieren.

WhatsApp-Textexporte enthalten keine verlässlichen Nachrichten-IDs. Der Import bildet
diese aus Chatname, Zeitpunkt, Absender, Inhalt und Vorkommen. Derselbe Export wird
dadurch ohne Duplikate erneut eingelesen; veränderte Texte gelten als neue Nachrichten.
Zitierverknüpfungen, Reaktionen und Lesestatus werden aus dem Text nicht rekonstruiert.

Chats werden dauerhaft gespeichert. ZIP-Inhalte und lose Anhänge gelten für die
Sitzung: nach einem Neustart das ZIP erneut importieren, Anhänge erneut ablegen oder
den entpackten Medienordner verbinden. Große ZIPs (über 512 MB bzw. 1 GB entpackt)
vorher entpacken und als Ordner verbinden; einzelne ZIP-Anhänge dürfen höchstens
256 MB groß sein. Passwortgeschützte ZIPs werden nicht unterstützt.

Ein kleines Beispiel liegt in `tests/fixtures/WhatsApp Chat mit Importtest.txt`.
Die dort genannten Anhänge liegen in `beispiel-daten/medien/`.

## ALEAPP-Berichte

Die TSV-Dateien, die ALEAPP (auch aus Autopsy heraus) im Ordner `_TSV Exports` ablegt,
werden direkt erkannt. Am einfachsten zieht man den ganzen Berichtsordner
`ALEAPP_Reports_…` ins Fenster: Die Chat-Tabellen werden importiert, alle anderen
Tabellen (Browser, WLAN, Apps …) still übergangen, und die Medien im Ordner `WhatsApp`
werden den Nachrichten zugeordnet. Einzelne TSV-Dateien gehen über **+ Import** ebenso.

| Bericht | Messenger | Hinweis |
| --- | --- | --- |
| `WhatsApp - Group Messages` | WhatsApp | alte und neue Spaltenfolge |
| `WhatsApp - One To One Messages` | WhatsApp | |
| `WhatsApp - Messages` | WhatsApp | altes Datenbankschema (Tabelle `messages`) |
| `sms messages`, `mms messages` | SMS | beide landen im selben Thread; MMS haben keine Richtung, die eigene Nummer über **Ich:** festlegen |
| `Google Messages` | Google Messages | eigene Quelle, überschneidet sich inhaltlich mit SMS/MMS |
| `WhatsApp - Call Logs` | WhatsApp | Anrufe erscheinen im selben Chat wie die Nachrichten (Einzel- und Gruppenchat) |
| `Call logs` (calllog.db), `Call Logs` (contacts2.db) | Telefon | ein Chat je Rufnummer: eingehend, ausgehend, verpasst, abgelehnt, Mailbox |

**Wie die WhatsApp-Daten zusammenkommen:** Alle WhatsApp-Berichte eines ALEAPP-Ordners
landen unter WhatsApp, ein Chat je Unterhaltung. Nachrichten und Anrufe mit derselben
Person bzw. Gruppe stehen im selben Chat. Zugeordnet wird so, wie ALEAPP es liefert:
Einzelchats über den WhatsApp-Namen (ohne Namen über die JID), Gruppen über den
Gruppennamen. Daraus folgen drei Grenzen:

- Zwei Kontakte oder Gruppen mit gleichem Namen fallen zusammen.
- Bei **ausgehenden Einzelanrufen** nennt ALEAPP den Angerufenen nicht. Sie stehen
  gesammelt im Chat „Ausgehende WhatsApp-Anrufe“, statt jemandem falsch zugeordnet zu
  werden.
- Den Ausgang eines Anrufs (verpasst, abgelehnt) liefert der Bericht nicht. Ein Anruf
  ohne Dauer erscheint deshalb als „keine Verbindung“.

Ein WhatsApp-Textexport (TXT/ZIP) desselben Chats wird nicht mit den ALEAPP-Daten
zusammengelegt, sondern steht als eigener Chat daneben.

Erkannt wird an den Spalten, nicht am Dateinamen. ALEAPP schreibt Zeiten in UTC; sie
werden als UTC gelesen und in Ortszeit angezeigt.

Bekannte Lücke in ALEAPP selbst (Stand September 2026): `WhatsApp - One To One Messages`
verknüpft Einzelchats über die Telefonnummer mit dem Adressbuch. Neuere WhatsApp-Versionen
führen Einzelchats unter LID-Kennungen (`…@lid`), solche Nachrichten fehlen dann im
Bericht vollständig. Gruppen sind nicht betroffen.

## iLEAPP-Berichte

Genauso wie bei ALEAPP: TSV-Dateien aus `_TSV Exports` einzeln importieren oder den
Berichtsordner ablegen. Zeiten gelten als UTC.

| Bericht | Messenger | Hinweis |
| --- | --- | --- |
| `SMS & iMessage` (sms.db) | iMessage, SMS, RCS | Apple legt je Dienst einen eigenen Chat an, das bleibt so; Lesestatus und ROWID als Quelle |
| `WhatsApp - Messages` (ChatStorage.sqlite) | WhatsApp | auch ältere iLEAPP-Versionen ohne Richtungsspalte („Local User“); in Gruppen nennt der Bericht nur die Gruppe, nicht das Mitglied |
| `Threema - Chats` | Threema | Abstimmungen erscheinen als Umfrage |
| `Signal - Messages` | Signal | „Remotely Deleted“ wird als gelöscht markiert |
| `Telegram Messages` | Telegram | Aktionen ohne Text erscheinen als Systemnachricht |
| `WhatsApp - Call History` | WhatsApp | Anrufe im selben Chat wie die Nachrichten (gleiche JID), mit verpasst/abgelehnt und Video |
| `Call History` | Telefon, FaceTime, WhatsApp | iPhone-Anrufliste; nicht angenommene eingehende Anrufe gelten als verpasst |

## SQL-Exporte aus Geräte-Datenbanken

Wer die Datenbanken selbst abfragt (DB Browser for SQLite, `sqlite3 -csv` …) und das
Ergebnis als CSV speichert, muss nichts umbenennen. Erkannt werden die rohen Spaltennamen
dieser Tabellen:

| Datenbank | Tabelle | erkannt an |
| --- | --- | --- |
| WhatsApp iPhone `ChatStorage.sqlite` | `ZWAMESSAGE` | `ZMESSAGEDATE`, `ZISFROMME` |
| WhatsApp Android `msgstore.db` | `message` | `chat_row_id`, `from_me` |
| WhatsApp Android `msgstore.db` (alt) | `messages` | `key_remote_jid`, `key_from_me` |
| iPhone `sms.db` | `message` | `guid`, `is_from_me`, `date` |
| Android `mmssms.db` | `sms` | `thread_id`, `address`, `body`, `type` |
| Android `calllog.db` | `calls` | `number`, `date`, `duration`, `type` |
| WhatsApp Android `msgstore.db` | `call_log` | `call_id`, `video_call`, `duration`, `from_me` |
| iPhone `CallHistory.storedata` | `ZCALLRECORD` | `ZADDRESS`, `ZORIGINATED`, `ZDATE`, `ZDURATION` |
| WhatsApp iPhone `CallHistory.sqlite` | `ZWACDCALLEVENT` | `ZOUTCOME`, `ZDURATION`, `ZDATE` |

Damit WhatsApp-Anrufe aus SQL-Exporten im Chat der Nachrichten landen, braucht es in
beiden Abfragen dieselbe Chat-Kennung. Beim iPhone ist das `ZCONTACTJID` bzw.
`ZJIDSTRING`/`ZGROUPJIDSTRING`, bei Android `jid.raw_string` als Spalte `chat_jid`. Sonst
stehen sie unter ihrer Zeilennummer (`jid_row_id …`) daneben. Bei `ZWACDCALLEVENT`
ergibt sich die Richtung nur mit `ZINCOMING` aus `ZWAAGGREGATECALLEVENT`, ohne sie gilt
ein Anruf als eingehend.

Spalten aus einem JOIN werden mitgenommen, wenn sie in der Abfrage stehen, zum Beispiel
`ZPARTNERNAME`, `ZCONTACTJID`, `ZMEMBERJID` und `ZMEDIALOCALPATH` bei iPhone-WhatsApp,
`chat_jid`, `sender_jid` und `file_path` bei Android-WhatsApp oder `chat_identifier`,
`display_name` und `filename` bei `sms.db`. Ohne sie bleiben die Zeilennummern der
Datenbank als Chat-Kennung stehen (`ZCHATSESSION 3`, `chat_row_id 2`). Die Chats werden
trotzdem richtig getrennt, nur ohne Namen. `NULL` gilt als leer. Jede Nachricht trägt ihre
Herkunft (Datenbank, Tabelle, Zeile) im Tooltip der Uhrzeit.

Zeiten bleiben dabei Zahlen, eine Umrechnung in SQL ist nicht nötig: Apple-Sekunden,
Apple-Nanosekunden (`sms.db` ab iOS 11) und Unix-Millisekunden erkennt der Import an der
Stellenzahl.

## Andere Formate: Spalten zuordnen

Hat eine CSV Spalten, die ChatVisualizer nicht kennt, erscheint beim Import der Dialog
**Spalten zuordnen**. Die erkannten Spalten sind dort vorausgewählt, daneben stehen
Beispielwerte. Außerdem lassen sich einstellen:

- die Zeitzone für Zeiten ohne Zonenangabe (Ortszeit, UTC, Europe/Berlin oder eine
  beliebige Zone),
- ein fester Chatname für Dateien ohne Chatspalte, etwa den SQL-Export eines einzelnen
  Chats,
- der Messenger, falls keine Spalte ihn nennt.

Eine **Zeitprobe** zeigt die erste Zeit als Ortszeit und als UTC, bevor importiert wird.
Die Antwort gilt für alle Dateien mit denselben Spalten. Vergessen lässt sie sich im
Hilfefenster (**?**).

## CSV-Format

Dieselbe Übersicht steckt im Programm hinter dem Button **?** in der Seitenleiste. Dort
lässt sich auch eine Vorlage als CSV speichern: Kopfzeile plus fünf Beispielzeilen, die
sich direkt wieder importieren lässt.

Erwartet wird eine Kopfzeile mit Spaltennamen. Das Trennzeichen (`,` `;` Tabulator oder
`|`) wird automatisch erkannt, ebenso UTF-8 mit und ohne BOM; Anführungszeichen nach
RFC 4180.

**Pflicht ist nur eine Spalte:** zu welchem Chat die Zeile gehört, als `unterhaltungs_id`
oder `chatname`. Alles andere hat einen Ersatz. Für einen Chat wie im Messenger (richtiger
Chatname, eigene Nachrichten rechts, Uhrzeiten, Anhänge) reichen sechs Spalten:

```
chatname,absender_id,von_mir,zeitstempel,nachrichteninhalt,medienpfad
Familie,Mama,0,2026-08-30T18:12:04,Kommst du Sonntag zum Essen?,
Familie,,1,2026-08-30T18:14:20,"Ja, gerne!",
Familie,Mama,0,2026-08-30T18:20:11,Der neue Tisch,medien/tisch.jpg
```

| Spalte | Bedeutung | ohne die Spalte |
| --- | --- | --- |
| `unterhaltungs_id` | Chat, zu dem die Nachricht gehört | `chatname` dient als Kennung |
| `chatname` | Name des Chats in Liste und Kopfzeile | Titel aus den Absendern |
| `absender_id` | Name oder ID des Absenders | eigene Nachricht: „Ich“, sonst der Chatname |
| `von_mir` | `1` = eigene Nachricht, steht rechts | „Ich:“ in der Kopfzeile bzw. Vermutung |
| `zeitstempel` | `2026-08-30T18:12:04`, `30.08.2026 18:12`, Unix-Zeit in Sekunden (10 Stellen) bzw. Millisekunden (13 Stellen) oder Apple-Zeit (9 Stellen, Sekunden seit 1.1.2001, wie in iPhone-Datenbanken); Nachkommastellen erlaubt | Reihenfolge der Datei, keine Uhrzeit |
| `nachrichteninhalt` | Text, bei Medien die Beschriftung, bei Reaktionen das Emoji | nur Medien |
| `medienpfad` | Pfad zur Datei | keine Anhänge |
| `nachricht_typ` | `text`, `bild`, `video`, `gif`, `audio`, `datei`, `system`, `standort`, `kontakt`, `umfrage`, `anruf` … | aus der Dateiendung, sonst Text |
| `nachricht_id` | eindeutige ID der Nachricht | aus dem Inhalt gebildet |
| `antwort_auf_id` | ID der zitierten Nachricht (braucht `nachricht_id`) | keine Zitate |
| `reaktion_auf_id` | gesetzt: die Zeile ist eine Reaktion auf diese Nachricht | keine Reaktionen |
| `status` | `gesendet`, `zugestellt`, `gelesen`, `fehlgeschlagen`, `gelöscht` … | keine Häkchen |
| `messenger` | `WhatsApp`, `Threema`, `Telegram`, `Signal`, `Instagram`, `SMS` … | Dateiname |

Englische Spaltennamen (`message_id`, `timestamp`, `sender_id`, `conversation_id`,
`chat_name`, `from_me`, `content`, `message_type`, `media_path`, `reply_to_id`,
`reaction_to_id`, `platform`) werden ebenfalls erkannt. `von_mir` versteht `1`, `true`, `ja`
und `x`. Fehlt die Spalte `messenger`, dient der Dateiname als Messengername; eine Datei
`whatsapp.csv` wird also WhatsApp zugeordnet. Unbekannte Messenger bekommen ein Logo mit
Anfangsbuchstaben und eigener Farbe.

### Mehrfachimport

Nachrichten werden über `messenger + nachricht_id` eindeutig gehalten, ohne ID-Spalte über
Chat, Zeitpunkt, Absender und Inhalt. Dieselbe Datei zweimal zu importieren erzeugt deshalb
keine Duplikate, sondern aktualisiert die vorhandenen Nachrichten.

## Chat als PDF-Bericht

⤓ in der Chat-Kopfzeile öffnet den Dialog **Chat als PDF ausgeben**. Dort lassen sich
einstellen:

- der Zeitraum (von/bis, in der gerade angezeigten Zeitzone),
- ein Aktenzeichen oder Vermerk,
- ob Bilder eingebettet werden,
- ob Übersetzungen, Transkripte und technische Angaben je Nachricht (ID, Rohwert der
  Zeit, Quelle) mit hinein sollen,
- bei aktiver Chatsuche: nur die Treffer.

**PDF erstellen** öffnet den Druckdialog des Browsers, dort **„Als PDF speichern“** wählen.
Der vorgeschlagene Dateiname ist „Chat <Titel> <Datum>“.

Der Bericht besteht aus einem Deckblatt und dem Verlauf:

- **Deckblatt:** Messenger, Chat-Kennung, Teilnehmer mit Name und Kennung, Zeitraum,
  Anzahl, Zeitzone, Filter, Quellen, Erstellzeit und eine SHA-256-Prüfsumme über die
  enthaltenen Nachrichten. Dieselben Daten ergeben dieselbe Prüfsumme.
- **Verlauf:** Sprechblasen wie im Programm, mit Datum und Uhrzeit auf die Sekunde.
- **Kopf- und Fußzeile:** Chatname, Vermerk und „Seite X von Y“.

Übersetzungen und Transkripte stehen immer nach dem Originaltext und sind als maschinell
gekennzeichnet. Gelöschte Nachrichten tragen einen Vermerk. Bilder werden verkleinert
eingebettet (höchstens 500 je Bericht), andere Anhänge erscheinen mit Dateiname und Pfad.

Warum über den Druckdialog? Ein eigener PDF-Erzeuger müsste Schriften für Kyrillisch,
Arabisch, Chinesisch und Emoji mitbringen. So nimmt der Browser die Schriften des
Systems, und nichts verlässt den Rechner. Im Druckdialog die „Kopf- und Fußzeilen“ des
Browsers ausschalten, sie überlagern sonst die eigenen.

## Übersetzung

Fremdsprachige Nachrichten lassen sich ins Deutsche oder eine andere Sprache übersetzen.
Das läuft lokal, es geht kein Text ins Netz. Das Original bleibt sichtbar: die
Übersetzung steht in normaler Größe oben, darunter durch eine feine Linie getrennt das
Original, kleiner und blasser, mit der erkannten Sprache als Kennzeichen.

Bedient wird das über **🌐** in der Chat-Kopfzeile. Ein Klick übersetzt den ganzen Chat,
bereits Übersetztes wird übersprungen.

- Der Fortschritt steht über dem Chat und lässt sich dort abbrechen.
- Das **▾** daneben öffnet die Einstellungen: **Von** (Ausgangssprache, je Chat) und
  **Nach** (Zielsprache, für alle Chats), dazwischen ⇄ zum Tauschen, außerdem Löschen.
- Ausgangssprache „Automatisch erkennen“ ist der Normalfall. Wird sie für einen Chat fest
  gewählt, gilt jede Nachricht dieses Chats als in dieser Sprache geschrieben. Ausnahme:
  Ist „schon in der Zielsprache überspringen“ an, bleiben etwa die eigenen deutschen
  Antworten unübersetzt. Das hilft bei kurzen Nachrichten und bei Sprachen, die die
  Erkennung verwechselt (Russisch/Ukrainisch, Serbisch/Kroatisch …). Die feste Wahl gilt
  auch für die Transkription der Sprachnachrichten im selben Chat. Beim Wechsel werden
  Übersetzungen verworfen, die aus einer anderen Ausgangssprache entstanden sind.
- Einzelne Nachricht: 🌐 erscheint beim Überfahren einer Sprechblase, ↩ nimmt die
  Übersetzung zurück.
- Übersetzungen werden gespeichert, stehen nach einem Neustart sofort bereit und werden
  von der Suche mitdurchsucht. Zitierte Antworten zeigen ebenfalls die Übersetzung.

### Verfahren

Übersetzt wird mit der eingebauten Übersetzung von Chrome und Edge (Translator-API, ab
Version 138). Sie arbeitet on-device: der Browser lädt beim ersten Mal ein Sprachpaket
für das jeweilige Sprachpaar, der Fortschritt steht im Panel. Danach bleibt jeder Text
auf dem Rechner.

Die Ausgangssprache erkennt der Browser selbst (`LanguageDetector`). Fehlt die Erkennung,
springt eine einfache Heuristik ein; reicht auch die bei einem kurzen Satz nicht, zählt
die vorherrschende Sprache der Unterhaltung. Bietet der Browser kein Verfahren an, sagt
das Panel das. Alle Aufrufe laufen in ein Zeitlimit, damit die Oberfläche nicht hängt.

Zum Übersetzen wird nichts installiert und nichts mitgeliefert, das erledigt der Browser.
Das Modell im Ordner `modelle/` ist nur für die Spracherkennung zuständig.

Muss der Browser ein Sprachpaket erst laden, verlangt Chrome dafür einen frischen Klick.
Deshalb wird das Paket gleich beim Klick auf 🌐 angefordert, noch vor der Spracherkennung.
Schlägt es trotzdem fehl, sagt die Meldung, dass ein weiterer Klick nötig ist.

Weitere Schalter im Panel: „Nachrichten, die schon in der Zielsprache sind, überspringen“ und
das Löschen aller Übersetzungen des Chats. Reine Emoji- und Link-Nachrichten werden nicht
übersetzt.

## Sprachnachrichten transkribieren

Sprachnachrichten lassen sich in Text umwandeln. Auch das läuft lokal, die Aufnahme
verlässt den Rechner nicht. Das Modell (Whisper small) liegt im Ordner `modelle/` und
wird beim ersten Start geladen, siehe [Erster Start](#erster-start).

Bedient wird das über **🎤** in der Chat-Kopfzeile. Ein Klick arbeitet alle
Sprachnachrichten des Chats der Reihe nach ab.

- Der Fortschritt steht über dem Chat und lässt sich dort abbrechen.
- Gibt es nichts zu tun, sagt eine Meldung warum: keine Sprachnachrichten, alles schon
  transkribiert, Datei fehlt.
- Das **▾** daneben öffnet die Einstellungen: Verfahren, Modell, Sprache.
- Einzelne Nachricht: 🎤 erscheint beim Überfahren einer Sprachnachricht, ↩ entfernt das
  Transkript.
- Das Transkript steht unter dem Abspieler in der Sprechblase, zusammen mit der erkannten
  Sprache. Es wird gespeichert und ist nach einem Neustart wieder da.

Ein Transkript zählt für alles Weitere wie normaler Nachrichtentext. Es wird von der
Suche gefunden und lässt sich mit 🌐 übersetzen; dann steht oben die Übersetzung und
darunter klein das Transkript, gekennzeichnet mit 🎤.

### Sprache

Whisper muss wissen, in welcher Sprache gesprochen wird, sonst übersetzt es
stillschweigend ins Englische. Die Sprache wird deshalb aus den Textnachrichten derselben
Unterhaltung abgeleitet, bevorzugt von derselben Person. In einem russischen Chat wird
also russisch transkribiert, in einem englischen englisch. Im Panel lässt sich die
Sprache auch fest vorgeben, falls die Automatik danebenliegt.

### Tempo und Qualität

Benutzt wird Whisper small (242 MB). Die Erkennung braucht ungefähr so lange wie die
Aufnahme selbst, gemessen auf einem normalen Rechner:

| Aufnahme | Dauer | Zeit |
| --- | --- | --- |
| Russisch, Dialog | 18 s | 16 s |
| Russisch, Lesung | 39 s | 34 s |
| Deutsch | 10 s | 12 s |
| Englisch | 9 s | 12 s |

Das Modell wird einmal geladen, das dauert ein paar Sekunden, danach bleibt es warm.
Lange Aufnahmen zerlegt Whisper selbst in Abschnitte von 30 Sekunden mit Überlappung.
Bei vielen Sprachnachrichten lohnt es sich, den Lauf im Hintergrund durchlaufen zu
lassen; die Ergebnisse werden gespeichert.

Whisper base ist rund dreimal schneller und nur 78 MB groß, patzt dafür bei Namen und
Zeichensetzung (aus „Мария Степановна" wird „моря степановна"). Es lässt sich in
`modelle/quellen.json` eintragen oder von Hand nach `modelle/Xenova/whisper-base` legen,
dann erscheint es im Panel als zweite Auswahl.

### Alternative: Chrome-Spracherkennung

Im Panel lässt sich auf die Chrome-Spracherkennung umschalten (Prompt-API mit
Audio-Eingabe, Gemini Nano on-device). Sie ist in Chrome hinter Schaltern versteckt. Ist
sie nicht freigegeben, zeigt das Panel, woran es liegt und was zu tun ist
(`chrome://flags` → *Prompt API for Gemini Nano* und *…with Multimodal Input*, danach
`chrome://components`). Voraussetzung sind außerdem rund 22 GB freier Speicher und eine
GPU mit 4 GB VRAM.

Für beide Verfahren muss der Medienordner verbunden sein, sonst fehlt die Audiodatei. Das
Panel nennt die Zahl der betroffenen Nachrichten.

## Medienordner

Zusätzlich zu den CSV-Dateien lässt sich der Ordner mit den Anhängen verbinden, über den
Button **🖼** in der Seitenleiste oder indem der Ordner ins Fenster gezogen wird. Danach
zeigt der Chat die Dateien an:

- Bilder erscheinen direkt als Vorschau, ein Klick öffnet die Großansicht (`←` `→` blättert durch alle
  Bilder und Videos der Unterhaltung, `Esc` schließt)
- GIFs laufen automatisch in Endlosschleife, ohne Play-Knopf. Das gilt auch für als
  Video exportierte WhatsApp-GIFs mit `GIF` im Dateinamen (etwa `00001234-GIF-….mp4`)
  oder dem CSV-Nachrichtentyp `gif`. Diese Videos laufen stumm, auch in der Großansicht.
- Normale Videos als Player mit Steuerung in der Sprechblase
- Sprachnachrichten und Audio als abspielbarer Player
- PDF und andere Dateien als Kachel, die die Datei öffnet
- in der Detailspalte echte Vorschaubilder in der Mediengalerie

Nicht gefundene Dateien bleiben als Kachel mit Pfad sichtbar, ein Klick kopiert den Pfad.
Kann der Browser einen vorhandenen Anhang nicht darstellen oder seinen Codec nicht
abspielen, erscheint eine Meldung mit einem Link zum Speichern der Originaldatei.
Die lokalen Windows- und Python-Server unterstützen Teilabrufe zum Laden und Spulen.
Nach einer Aktualisierung der Startskripte den Server neu starten.

### Medien aus dem Internet (GIF-Links)

Steht im Medienpfad ein `http(s)`-Link, etwa bei GIFs von Klipy, Tenor oder Giphy,
bettet der Chat Bild, GIF, Video oder Ton direkt ein und zeigt den Link darunter. Steht
der Link schon im Nachrichtentext, erscheint er nicht doppelt. Ein Link darf `?Parameter`
haben, die Dateiart ergibt sich trotzdem aus der Endung.

Geladen wird erst nach einer **Freigabe per Klick**, denn der fremde Server sieht dabei die
IP-Adresse des Auswerterechners. Bei einer Ermittlung kann das auffallen. Die Kachel
bietet dazu zwei Knöpfe:

- **Laden** gibt nur diese Datei frei.
- **Externe Medien immer laden** gibt alle frei. Zurücknehmen lässt sich das im
  Hilfefenster (**?**).

Liegt dieselbe Datei im verbundenen Medienordner, wird die lokale Kopie gezeigt, ganz
ohne Netz.

Im PDF-Bericht werden freigegebene Internet-Bilder mit eingebettet, der vollständige
Link steht darunter.

### Dokumente: Vorschau und Suche

Angehängte Dokumente werden gelesen, damit die Suche ihren Inhalt findet und nicht nur
den Dateinamen:

| Format | Was passiert |
| --- | --- |
| PDF | Vorschau der ersten Seite in der Sprechblase, ein Klick öffnet das Dokument seitenweise (`←` `→` blättern). Der Text wird ausgelesen. |
| Word, Excel, PowerPoint (`docx`, `xlsx`, `pptx`) | Kachel mit Leseprobe, ein Klick zeigt den ganzen Text. |
| OpenDocument (`odt`, `ods`, `odp`) | genauso |
| Text und Daten (`txt`, `md`, `json`, `xml`, `html`, `csv`, `log`, `ini`, `yaml`, `srt`, `rtf` …) | genauso |

Sobald der Medienordner verbunden ist oder neue CSV-Dateien dazukommen, werden alle
Dokumente im Hintergrund gelesen; der Fortschritt steht über dem Chat. Damit findet die
Suche auch Wörter, die nur im Dokument stehen, ohne dass die Datei vorher geöffnet worden
sein muss. In der Trefferliste zeigt ein 📄 die Fundstelle samt Umgebung, bei
Sprachnachrichten ein 🎤, bei Übersetzungen ein 🌐. Vorschaubild und Text werden
gespeichert und sind beim nächsten Start da, auch ohne verbundenen Medienordner.

Gelesen werden bis zu 60 Seiten bzw. 400.000 Zeichen je Dokument, längere werden als
„gekürzt" gekennzeichnet. PDFs übernimmt das mitgelieferte PDF.js (`vendor/pdfjs/`, rund
4 MB), Office-Dateien packt der Browser selbst aus. Gescannte PDFs ohne Textebene lassen
sich ansehen, aber nicht durchsuchen; dafür bräuchte es eine Texterkennung. Die alten
Binärformate `.doc`, `.xls` und `.ppt` werden nicht gelesen.

### Zuordnung der Pfade

Der Pfad aus `medienpfad` wird über seine Endung gegen den Ordner abgeglichen, die
längste Übereinstimmung gewinnt. Groß- und Kleinschreibung sowie `\` gegen `/` spielen
keine Rolle. So findet `C:\Backup\WhatsApp\Media\medien\foto.jpg` die Datei
`medien/foto.jpg` im verbundenen Ordner; auch ein bloßer Dateiname genügt.

Enthält der verbundene Ordner selbst CSV-Dateien, werden sie gleich mit importiert. Ein
kompletter Export-Ordner lässt sich also in einem Zug ins Fenster ziehen.

### Speicherung und Wiederverbinden

In Chrome und Edge merkt sich das Werkzeug den gewählten Ordner. Beim nächsten Start
genügt ein Klick auf „Medienordner … wieder verbinden" in der Seitenleiste. Kopiert wird
nichts, die Dateien bleiben, wo sie sind; gelesen wird nur, was gerade gebraucht wird. In
anderen Browsern und beim Öffnen per Doppelklick funktioniert die Ordnerauswahl ebenfalls,
gilt aber nur für die laufende Sitzung.

Liegen die Medien direkt neben `index.html`, etwa im Ordner `medien`, werden sie auch ohne
verbundenen Ordner über den lokalen Server geladen.

## Beispieldaten

`beispiel-daten/` enthält 10 Chats mit 108 Nachrichten über sieben Messenger:

| Datei | Trennzeichen | Zeitformat | Inhalt |
| --- | --- | --- | --- |
| `whatsapp_familie.csv` | Komma | ISO | Familie und Sportverein, deutsch |
| `whatsapp_datscha_russisch.csv` | Komma | ISO | russische Gruppe mit zwei russischen Sprachnachrichten |
| `threema_arbeit.csv` | Semikolon | `03.09.2026 08:58:00` | Projektgruppe und Beratung |
| `telegram_freunde.csv` | Tabulator | Unix-Zeit | Laufgruppe, englische Spaltennamen |
| `signal_anna_englisch.csv` | Komma | ISO | englischer Chat mit Sprachnachrichten |
| `diverse_messenger.csv` | Pipe `\|` | ISO | Instagram, SMS-Benachrichtigungen, unbekannter Messenger |

Enthalten sind Antworten mit Zitat, Reaktionen, gelöschte und Systemnachrichten, alle
Statusstufen, mehrzeilige Nachrichten, Links, Emoji-Nachrichten, Standort, Kontakt,
Umfrage, ein verpasster Anruf und ein unbekannter Messenger mit erzeugtem Logo. In
`beispiel-daten/medien/` liegen Bilder, ein Video, PDFs, Office- und Textdateien sowie
sieben Sprachnachrichten auf Deutsch, Englisch und Russisch.

Eine Nachricht verweist absichtlich auf eine fehlende Videodatei, damit sichtbar wird, wie
das Werkzeug damit umgeht. Woher die Mediendateien stammen, steht in
[`beispiel-daten/QUELLEN.md`](beispiel-daten/QUELLEN.md); die russischen Aufnahmen sind
gemeinfreie Sprachaufnahmen, alles andere ist selbst erzeugt.

Ausprobieren: Startdatei doppelklicken, die sechs CSV-Dateien und den Ordner
`beispiel-daten/medien` ins Fenster ziehen. Oder auf dem Startbildschirm „Mit Demodaten
ansehen" wählen.

## Aufbau

Der Code ist in vier Schichten aufgeteilt: Grundlagen, Daten, Ansicht, Bedienung.
[`ARCHITEKTUR.md`](ARCHITEKTUR.md) beschreibt die Module, die Abhängigkeitsregeln und die
üblichen Einstiegspunkte für Änderungen.

```
index.html          Grundgerüst der Oberfläche und Ladereihenfolge
css/style.css       bindet die Gestaltung aus css/teile/ ein
css/teile/*.css     Design je Bereich: Basis, Seitenleiste, Chat, Panels …

js/kern/helfer.js       kleine Helfer, die überall gebraucht werden
js/kern/csv.js          CSV-Parser (RFC 4180, Trennzeichenerkennung)
js/kern/store.js        IndexedDB (ein Eintrag je Unterhaltung) und Einstellungen
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
js/ansicht/medien.js    Medienkacheln, beim Sichtbarwerden geladen
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

modelle/quellen.json     Bauplan für das Spracherkennungsmodell
modelle/                 das Modell selbst, wird beim ersten Start geladen (242 MB)
vendor/transformers/     Laufzeit für das Modell (transformers.js und ONNX-WASM, 22 MB)
vendor/pdfjs/            PDF.js für Vorschau und Textauszug (4 MB)
hole-modell.py           lädt fehlende Modelldateien nach
serve.py                 Webserver für macOS/Linux mit den nötigen MIME-Typen
ChatVisualizer starten.cmd   Startdatei für Windows
start.ps1                lokaler Webserver, nur Windows-Bordmittel
start.sh                 dasselbe für macOS/Linux
```

In der Konsole steht `window.ChatVisualizer` mit `state`, `importFiles(files)`,
`openConversation(key)`, `demoData()`, `pickMediaFolder()`, `attachMediaFiles(files)` und
`media` zur Verfügung; die Pfadzuordnung prüft `media.lookup(pfad)`.

## Platzbedarf

Mit dem Spracherkennungsmodell belegt der Ordner rund 270 MB. Wer keine Sprachnachrichten
transkribieren will, kann `modelle/` löschen und mit `-KeinModell` starten; im 🎤-Panel
steht dann, dass kein Modell vorhanden ist.

## Größenordnung

50.000 Nachrichten in 20 Unterhaltungen: Import einschließlich Speichern rund 0,6 s, Laden
beim Start rund 0,1 s, globale Suche rund 10 ms. Lange Chats werden in Blöcken von 400
Nachrichten gezeichnet und beim Hochscrollen nachgeladen.
