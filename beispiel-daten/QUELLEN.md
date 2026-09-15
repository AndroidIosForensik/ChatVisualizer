# Herkunft der Beispieldaten

Alle Chats sind frei erfunden. Die Mediendateien sind entweder selbst erzeugt oder
gemeinfrei – nichts davon stammt aus echten Unterhaltungen.

## Sprachaufnahmen

| Datei | Sprache | Herkunft |
| --- | --- | --- |
| `ru_sprachnachricht_dialog.ogg` | Russisch, ~18 s | [Ru-dialog 1.ogg](https://commons.wikimedia.org/wiki/File:Ru-dialog_1.ogg), Wikimedia Commons, **gemeinfrei** |
| `ru_sprachnachricht_lang.ogg` | Russisch, ~39 s | [Julio Jurenito.ogg](https://commons.wikimedia.org/wiki/File:Julio_Jurenito.ogg), Wikimedia Commons, **gemeinfrei** (Lesung aus Ilja Ehrenburgs Roman) |
| `sprachnachricht_papa.wav`, `sprachnachricht_lena.wav`, `sprachnachricht_sara.wav` | Deutsch | mit der Windows-Sprachausgabe (Microsoft Hedda) erzeugt |
| `voice_alex_en.wav`, `voice_tim_en.wav` | Englisch | mit der Windows-Sprachausgabe (Microsoft Zira) erzeugt |

Die beiden russischen Aufnahmen sind echte menschliche Sprache – damit lässt sich die
Transkription an realistischem Material ausprobieren. Die längere Datei (39 s) wird beim
Transkribieren automatisch in zwei Abschnitte zerlegt.

## Übrige Medien

* `gartentisch.png`, `datscha_garten.png`, `lauf_sonnenaufgang.png`, `laufstrecke.png` –
  mit einem kleinen Python-Skript erzeugte Grafiken
* `clip_sonnenaufgang.webm` – im Browser aufgezeichnete Canvas-Animation (5 s)
* `*.pdf` – selbst erzeugte Minimal-PDFs; `unterlagen_2026.pdf` hat drei Seiten,
  damit sich das Blättern in der PDF-Vorschau ausprobieren lässt
* `standort.json` – Beispielkoordinaten
* `angebot_umbau.docx`, `kalkulation_umbau.xlsx` – mit Python erzeugte Office-Dateien
  (echte ZIP/XML-Struktur), damit sich die Dokumentsuche ausprobieren lässt
* `notizen_migration.txt`, `konfiguration.json`, `protokoll_abnahme.xml` – Beispieltexte
  für die Suche in Text-, JSON- und XML-Dateien

`medien/vereinsheim_video.mp4` fehlt **mit Absicht**: Eine Nachricht im Chat „Sportverein"
verweist darauf, damit sichtbar wird, wie das Werkzeug mit fehlenden Dateien umgeht
(Kachel mit Pfad statt Abspieler).
