# ChatVisualizer

**English** | [Deutsch](README.de.md)

Reads ALEAPP reports (WhatsApp, Signal, SMS and about 40 other chat apps), WhatsApp text
exports (TXT or ZIP with media) and chat exports in CSV format, and shows them as a
messenger interface: with logo, chat list, search and details panel. Everything runs in
the browser on your own computer; nothing is uploaded.

The user interface is in German. Button labels, CSV column names and messages are quoted
below as they appear in the program, with an English explanation.

## Getting started

Windows: double-click `ChatVisualizer starten.cmd`. The browser opens by itself; the
window next to it is the local server – close it to stop. Nothing needs to be installed,
PowerShell is enough. The folder also works from a USB stick or a network drive.

macOS and Linux: `./start.sh`, which uses python3, python, php or ruby, whichever is
available.

The port is chosen automatically: the first free one from 8777 on. A fixed port works too:

```powershell
.\start.ps1 -Port 9000
```

On macOS/Linux `./start.sh 9000`; to start without opening the browser
`.\start.ps1 -NoBrowser`.

Via `localhost`, permanent storage (IndexedDB) works and imported chats are still there
after a restart. In an emergency `index.html` can also be opened directly by double-click;
some browsers then refuse permanent storage and the data only lasts for the session. The
start file falls back to this automatically if no server starts.

### First start

On the first start the start script checks whether the speech recognition model is present
and downloads it otherwise: about 242 MB from huggingface.co, once. Progress is shown in
the console window; cancelling with `Ctrl+C` resumes where it left off on the next start.
Everything except transcription works without the model.

Start without downloading:

```powershell
.\start.ps1 -KeinModell
```

On macOS/Linux `CHATVISUALIZER_KEIN_MODELL=1 ./start.sh`. To fetch only the model without
starting the server: `python3 hole-modell.py`.

The files that belong to the model are listed in
[`modelle/quellen.json`](modelle/quellen.json), with size and checksum for each file.
Another model can be added there following the same pattern.

## Usage

| Action | How |
| --- | --- |
| Import | Button **+ Import** or drag files into the window: ALEAPP report folder or TSV, WhatsApp TXT/ZIP, CSV and attachments, several at once – see [Supported sources](#supported-sources) |
| Look up the format | Button **?** in the sidebar: explains every column with meaning and example, and saves a CSV template on request |
| Media folder | Button **🖼** or drag the folder into the window. Images, videos, PDFs and voice messages then appear in the chat |
| Documents | PDFs show a page preview, Word/Excel/text a short excerpt; a click opens the content. All documents are read in the background and become searchable |
| Voice messages | **🎤** in the chat header transcribes all voice messages of the chat, 🎤 on a bubble only that one |
| Translate | **🌐** in the chat header translates the whole chat, 🌐 on a bubble only that one. The original stays visible below |
| Settings for both | the **▾** next to 🎤 or 🌐: target language, method, model, delete transcripts |
| Progress | During a run a bar above the chat shows the state, e.g. „Übersetzt… 12 / 14" (translated). It stays visible with the panel closed and can be cancelled there |
| Search (all chats) | Field at the top left, `Ctrl+K`. Shows the number of hits per chat; a click jumps to the hit |
| Search (in chat) | Magnifier in the chat header, `Ctrl+F`, step through hits with `Enter` and `Shift+Enter` |
| Filter | Messenger chips below the search field |
| Sort | Select box above the chat list: newest, oldest, most messages, name |
| Set your own side | **Ich:** („me") in the chat header. This person appears on the right in blue |
| Details and statistics | ⓘ at the top right: participants, period, message types, media |
| Export | ⤓ in the chat header exports the chat as text, ⤓ in the sidebar everything as JSON |
| Light and dark | ◐ in the sidebar |
| Delete everything | 🗑 in the sidebar |

Quoted messages (`antwort_auf_id`) are clickable and jump to the original. Reactions
(`reaktion_auf_id`) are attached as an emoji to the target message instead of appearing
as a message of their own.

## Supported sources

There are three ways into the ChatVisualizer, none of them asks about columns:

| Source | What you drop in | What happens |
| --- | --- | --- |
| **ALEAPP report** | the whole report folder (`ALEAPP_Reports_…` or `ALEAPP_Output_…`) or the TSV files from `_TSV Exports` | The tables of each app are recognised and **combined**: names, attachments, calls, system events, read receipts, reactions. All other tables of the report (browser, Wi-Fi, accounts …) are skipped silently. |
| **WhatsApp text export** | TXT, ZIP with media or the unpacked folder (Android and iPhone) | see [WhatsApp text exports with media](#whatsapp-text-exports-with-media) |
| **Your own CSV/TSV** | CSV or TSV files, e.g. from SQL queries on app databases | see [CSV format](#csv-format) |

### Chat apps from ALEAPP reports

Every table is recognised by its columns, not by its file name – the names change between
ALEAPP versions. The columns are taken from the ALEAPP source code
(`scripts/artifacts/*.py`, as of October 2026). "Real report" means: checked against ALEAPP
reports of real Android devices; the other apps are tested with the exact ALEAPP columns,
but without a real device.

| App | combined tables | checked |
| --- | --- | --- |
| **WhatsApp** | One To One Messages, Group Messages, Messages (old schema), Contacts, Call Logs, System Events, Message Receipts Per Recipient, Message Reactions, Message Edit History, Revoked Messages, Polls | real report |
| **Signal** | Messages, Attachments, Calls, Contacts, Groups | real report |
| **SMS/MMS** (mmssms.db) | SMS and MMS Messages, SMS Messages, MMS Messages, MMS Attachments | real report |
| **Google Messages** | GoogleMessages – matched against SMS/MMS, see below | real report |
| **Telegram** | Messages, Chats | recognised¹ |
| **Threema** | Messages, Contacts | recognised¹ |
| Facebook Messenger | Chats (msys_database), Chats (threads_db2) | ALEAPP columns |
| Instagram | Direct Messages | ALEAPP columns |
| Snapchat | Messages (arroyo.db), Messages | ALEAPP columns |
| Discord, Viber, Skype, Teams, LINE, Kik, WeChat, TikTok | one message table each | ALEAPP columns |
| Tinder, Bumble, Badoo, Zangi, TextNow, Google Chat, Google Voice, imo, MeWe, Wire, SimpleX, Bluesky, Burner, MeetMe, RandoChat, Tango, Kijiji, Sideline, Slack, Chess.com | one message table each | ALEAPP columns |
| SMS backups | SMS Backup and Restore Messages, SMS and MMS Backup | ALEAPP columns |
| RCS (LG), DeepSeek | one message table each | ALEAPP columns |

¹ The checked reports only contained account and settings tables – the message databases
of Telegram, Threema and Signal are encrypted on current devices and ALEAPP does not read
them there. The ChatVisualizer then reports „keine Nachrichten enthalten" (no messages
contained).

### How the tables are connected

- **Names:** identifiers such as `4917…@s.whatsapp.net` are turned into names via the
  contacts table; without a name the phone number is shown, anonymous identifiers as
  `LID …` (not a phone number).
- **Chat assignment via time and text:** newer WhatsApp versions refer to chats in read
  receipts, reactions and system events only by an anonymous `…@lid`. A read receipt,
  however, states the time and text of its message – which reveals the chat behind the
  identifier. This puts system events and reactions into the right chat.
- **Ticks:** your own messages with a read receipt show ✓✓ in blue, otherwise ✓✓.
- **Calls:** a call from the call log that also appears in the chat history gets its type
  and duration there („Sprachanruf · 2:13 min", voice call) and does not show up twice.
- **Attachments:** the copy in the report folder (`media/…`) is preferred, otherwise the
  path on the device. If the whole report folder is dropped in, images and videos are
  available right away.
- **Google Messages and SMS:** both databases contain the same messages. If both are
  present, each message is kept once: the delivery status from SMS, the contact names from
  Google Messages; messages only found in Google Messages (RCS) go into the same chat.
- **Nothing disappears silently:** messages without text and file appear as a note
  („Systemmeldung", „Anruf", „WhatsApp-Nachrichtentyp 7 (ohne Inhalt)").
- **Times:** ALEAPP writes UTC, even without a time zone; times are read as UTC and shown
  in local time.
- **Repeated import:** importing the same report twice creates no duplicates.

The message after the import summarises which apps were combined, with how many tables and
entries.

### Limitations

- Ideally import all TSV files of a report **together** (drop the folder). Contacts or read
  receipts imported later on their own are no longer linked.
- An `…@lid` chat without any message or read receipt appears as a separate chat „LID …" –
  usually containing only the encryption notice.
- For your own WhatsApp calls without a counterpart in the chat history, ALEAPP does not
  name the other party; these are listed under „Anrufe ohne Gesprächspartner" (calls
  without a partner).
- Older ALEAPP versions without `jid_map` resolution drop one-to-one chats with an `…@lid`
  identifier from the report „WhatsApp - One To One Messages" entirely. Then only SQL
  queries on the database itself help.
- Reactions are only available for WhatsApp; edits are marked with „(bearbeitet)" (edited).

## WhatsApp text exports with media

In WhatsApp, save the conversation via **Export chat** and choose **Include media** if
needed. Then in the ChatVisualizer:

- **ZIP:** select the ZIP file via **+ Import** or drag it into the window. The chat text
  is read; images, videos, audio and documents are unpacked directly from the ZIP when
  displayed. Everything stays local.
- **TXT and individual attachments:** select the TXT file and the matching media files
  together or drag them into the window together. Attachments can also be added later by
  drag & drop.
- **Unpacked folder:** drag the complete export folder into the window or connect it via
  **🖼**. WhatsApp texts in it are recognised automatically.

Before each WhatsApp import, the chat name and date format are shown. Use the same chat
name when importing again; different conversations need different names. iPhone files with
the generic name `_chat.txt` in particular should get a meaningful name here. For dates
like `03/04/2026`, check explicitly whether the day or the month comes first.

The usual numeric Android and iPhone timestamps are supported, with dot, slash or hyphen,
two- or four-digit years, optional seconds and AM/PM. Multi-line messages and system
messages are preserved. Media markers such as `Foto.jpg (Datei angehängt)`,
`(file attached)`, `<Anhang: Foto.jpg>` and `<attached: Foto.jpg>` are matched to the
attachments. Unsupported texts are not taken over as a chat. Language variants with other
media markers are not covered yet. Placeholders such as „Medien ausgeschlossen" (media
omitted) remain visible as text; a missing file cannot be reconstructed from them.

WhatsApp text exports contain no reliable message IDs. The import derives them from chat
name, time, sender, content and occurrence. The same export can therefore be read again
without duplicates; changed texts count as new messages. Quote links, reactions and read
status are not reconstructed from the text.

Chats are stored permanently. ZIP contents and loose attachments last for the session:
after a restart, import the ZIP again, drop the attachments again or connect the unpacked
media folder. Unpack large ZIPs (over 512 MB, or 1 GB unpacked) beforehand and connect them
as a folder; single ZIP attachments may be at most 256 MB. Password-protected ZIPs are not
supported.

A small example is in `tests/fixtures/WhatsApp Chat mit Importtest.txt`. The attachments
mentioned there are in `beispiel-daten/medien/`.

## CSV format

The same overview is available in the program behind the **?** button in the sidebar. A
template can be saved there as CSV: header plus five example rows that can be imported
directly.

A header row with column names is expected. The delimiter (`,` `;` tab or `|`) is detected
automatically, as is UTF-8 with or without BOM; quoting follows RFC 4180.

**Only one column is required:** which chat the row belongs to, as `unterhaltungs_id` or
`chatname`. Everything else has a fallback. For a chat like in a messenger (correct chat
name, own messages on the right, times, attachments) six columns are enough:

```
chatname,absender_id,von_mir,zeitstempel,nachrichteninhalt,medienpfad
Familie,Mama,0,2026-08-30T18:12:04,Kommst du Sonntag zum Essen?,
Familie,,1,2026-08-30T18:14:20,"Ja, gerne!",
Familie,Mama,0,2026-08-30T18:20:11,Der neue Tisch,medien/tisch.jpg
```

| Column | Meaning | without the column |
| --- | --- | --- |
| `unterhaltungs_id` | chat the message belongs to | `chatname` is used as identifier |
| `chatname` | name of the chat in list and header | title made up from the senders |
| `absender_id` | name or ID of the sender | own message: „Ich" (me), otherwise the chat name |
| `von_mir` | `1` = own message, shown on the right | „Ich:" in the header, or a guess |
| `zeitstempel` | `2026-08-30T18:12:04`, `30.08.2026 18:12`, Unix time in seconds (10 digits) or milliseconds (13 digits), or Apple time (9 digits, seconds since 1 Jan 2001, as in iPhone databases); decimals allowed | order of the file, no time |
| `nachrichteninhalt` | text; for media the caption, for reactions the emoji | media only |
| `medienpfad` | path to the file | no attachments |
| `nachricht_typ` | `text`, `bild` (image), `video`, `gif`, `audio`, `datei` (file), `system`, `standort` (location), `kontakt` (contact), `umfrage` (poll), `anruf` (call) … | from the file extension, otherwise text |
| `nachricht_id` | unique ID of the message | derived from the content |
| `antwort_auf_id` | ID of the quoted message (needs `nachricht_id`) | no quotes |
| `reaktion_auf_id` | if set: the row is a reaction to this message | no reactions |
| `status` | `gesendet` (sent), `zugestellt` (delivered), `gelesen` (read), `fehlgeschlagen` (failed), `gelöscht` (deleted) … | no ticks |
| `messenger` | `WhatsApp`, `Threema`, `Telegram`, `Signal`, `Instagram`, `SMS` … | file name |

English column names (`message_id`, `timestamp`, `sender_id`, `conversation_id`,
`chat_name`, `from_me`, `content`, `message_type`, `media_path`, `reply_to_id`,
`reaction_to_id`, `platform`) are recognised as well. `von_mir` understands `1`, `true`,
`ja` and `x`. If the `messenger` column is missing, the file name is used as messenger
name; a file `whatsapp.csv` is therefore assigned to WhatsApp. Unknown messengers get a
logo with their initial and a colour of their own.

### Repeated import

Messages are kept unique via `messenger + nachricht_id`, without an ID column via chat,
time, sender and content. Importing the same file twice therefore creates no duplicates but
updates the existing messages.

## Translation

Messages in other languages can be translated into German or another language. This runs
locally, no text leaves the computer. The original stays visible: the translation is shown
at normal size on top, below it, separated by a thin line, the original – smaller and
paler, labelled with the detected language.

It is operated via **🌐** in the chat header. One click translates the whole chat; already
translated messages are skipped.

- Progress is shown above the chat and can be cancelled there.
- The **▾** next to it opens the settings: target language, delete.
- Single message: 🌐 appears when hovering over a bubble, ↩ undoes the translation.
- Translations are stored, available immediately after a restart and included in the
  search. Quoted replies also show the translation.

### Method

Translation uses the built-in translation of Chrome and Edge (Translator API, version 138
and later). It works on-device: the first time, the browser downloads a language pack for
the language pair, with progress shown in the panel. After that every text stays on the
computer.

The browser detects the source language itself (`LanguageDetector`). If detection is not
available, a simple heuristic steps in; if that is not enough for a short sentence, the
predominant language of the conversation counts. If the browser offers no method, the
panel says so. All calls run with a time limit so that the interface does not hang.

Nothing is installed or shipped for translation; the browser does it. The model in the
`modelle/` folder is only used for speech recognition.

Further switches in the panel: target language, „Nachrichten in der Zielsprache
überspringen" (skip messages already in the target language) and deleting all translations
of the chat. Pure emoji and link messages are not translated.

## Transcribing voice messages

Voice messages can be turned into text. This also runs locally; the recording does not
leave the computer. The model (Whisper small) is in the `modelle/` folder and is downloaded
on the first start, see [First start](#first-start).

It is operated via **🎤** in the chat header. One click processes all voice messages of the
chat one after another.

- Progress is shown above the chat and can be cancelled there.
- If there is nothing to do, a message says why: no voice messages, everything already
  transcribed, file missing.
- The **▾** next to it opens the settings: method, model, language.
- Single message: 🎤 appears when hovering over a voice message, ↩ removes the transcript.
- The transcript appears below the player in the bubble, together with the detected
  language. It is stored and is back after a restart.

A transcript counts as normal message text for everything else. It is found by the search
and can be translated with 🌐; then the translation is shown on top and the transcript in
small print below, marked with 🎤.

### Language

Whisper needs to know which language is spoken, otherwise it silently translates into
English. The language is therefore derived from the text messages of the same
conversation, preferably from the same person. In a Russian chat transcription is in
Russian, in an English chat in English. The language can also be fixed in the panel in
case the automatic choice is wrong.

### Speed and quality

Whisper small (242 MB) is used. Recognition takes about as long as the recording itself,
measured on an ordinary computer:

| Recording | Length | Time |
| --- | --- | --- |
| Russian, dialogue | 18 s | 16 s |
| Russian, reading | 39 s | 34 s |
| German | 10 s | 12 s |
| English | 9 s | 12 s |

The model is loaded once, which takes a few seconds; after that it stays warm. Whisper
splits long recordings into 30-second sections with overlap by itself. With many voice
messages it pays to let the run continue in the background; the results are stored.

Whisper base is about three times faster and only 78 MB, but slips on names and
punctuation („Мария Степановна" becomes „моря степановна"). It can be added in
`modelle/quellen.json` or placed by hand in `modelle/Xenova/whisper-base`; it then appears
in the panel as a second choice.

### Alternative: Chrome speech recognition

The panel can switch to Chrome's speech recognition (Prompt API with audio input, Gemini
Nano on-device). It is hidden behind flags in Chrome. If it is not enabled, the panel shows
why and what to do (`chrome://flags` → *Prompt API for Gemini Nano* and *…with Multimodal
Input*, then `chrome://components`). It also requires about 22 GB of free storage and a
GPU with 4 GB VRAM.

Both methods need the media folder to be connected, otherwise the audio file is missing.
The panel shows the number of affected messages.

## Media folder

In addition to the CSV files, the folder with the attachments can be connected, via the
**🖼** button in the sidebar or by dragging the folder into the window. The chat then shows
the files:

- Images appear directly as a preview; a click opens the large view (`←` `→` pages through
  all images and videos of the conversation, `Esc` closes)
- GIFs loop automatically, without a play button. This also applies to WhatsApp GIFs
  exported as video with `GIF` in the file name (such as `00001234-GIF-….mp4`) or with the
  CSV message type `gif`. These videos play muted, also in the large view.
- Normal videos as a player with controls in the bubble
- Voice messages and audio as a playable player
- PDF and other files as a tile that opens the file
- real thumbnails in the media gallery of the details panel

Files that are not found remain visible as a tile with their path; a click copies the path.
If the browser cannot display an existing attachment or play its codec, a message appears
with a link to save the original file. The local Windows and Python servers support range
requests for loading and seeking. Restart the server after updating the start scripts.

### Documents: preview and search

Attached documents are read so that the search finds their content, not just the file
name:

| Format | What happens |
| --- | --- |
| PDF | preview of the first page in the bubble; a click opens the document page by page (`←` `→` to page). The text is extracted. |
| Word, Excel, PowerPoint (`docx`, `xlsx`, `pptx`) | tile with an excerpt; a click shows the full text. |
| OpenDocument (`odt`, `ods`, `odp`) | the same |
| Text and data (`txt`, `md`, `json`, `xml`, `html`, `csv`, `log`, `ini`, `yaml`, `srt`, `rtf` …) | the same |

As soon as the media folder is connected or new CSV files are added, all documents are read
in the background; progress is shown above the chat. The search then also finds words that
only occur in the document, without the file having been opened. In the hit list a 📄 shows
the location with context, a 🎤 for voice messages, a 🌐 for translations. Thumbnail and text
are stored and are available on the next start, even without a connected media folder.

Up to 60 pages or 400,000 characters per document are read; longer ones are marked
„gekürzt" (truncated). PDFs are handled by the bundled PDF.js (`vendor/pdfjs/`, about
4 MB); Office files are unpacked by the browser itself. Scanned PDFs without a text layer
can be viewed but not searched; that would need OCR. The old binary formats `.doc`, `.xls`
and `.ppt` are not read.

### Path matching

The path from `medienpfad` is matched against the folder by its ending; the longest match
wins. Upper/lower case and `\` versus `/` do not matter. So
`C:\Backup\WhatsApp\Media\medien\foto.jpg` finds the file `medien/foto.jpg` in the
connected folder; a bare file name is enough as well.

If the connected folder itself contains CSV files, they are imported along with it. A
complete export folder can therefore be dropped into the window in one go.

### Storage and reconnecting

In Chrome and Edge the tool remembers the selected folder. On the next start a click on
„Medienordner … wieder verbinden" (reconnect media folder) in the sidebar is enough.
Nothing is copied – the files stay where they are, and only what is currently needed is
read. In other browsers and when opened by double-click, folder selection works too, but
only for the current session.

If the media are located directly next to `index.html`, for example in a `medien` folder,
they are loaded through the local server even without a connected folder.

## Sample data

`beispiel-daten/` contains 10 chats with 108 messages across seven messengers:

| File | Delimiter | Time format | Content |
| --- | --- | --- | --- |
| `whatsapp_familie.csv` | comma | ISO | family and sports club, German |
| `whatsapp_datscha_russisch.csv` | comma | ISO | Russian group with two Russian voice messages |
| `threema_arbeit.csv` | semicolon | `03.09.2026 08:58:00` | project group and consulting |
| `telegram_freunde.csv` | tab | Unix time | running group, English column names |
| `signal_anna_englisch.csv` | comma | ISO | English chat with voice messages |
| `diverse_messenger.csv` | pipe `\|` | ISO | Instagram, SMS notifications, unknown messenger |

Included are quoted replies, reactions, deleted and system messages, all status levels,
multi-line messages, links, emoji messages, location, contact, poll, a missed call and an
unknown messenger with a generated logo. `beispiel-daten/medien/` contains images, a video,
PDFs, Office and text files as well as seven voice messages in German, English and
Russian.

One message deliberately refers to a missing video file, to show how the tool handles it.
Where the media files come from is described in
[`beispiel-daten/QUELLEN.md`](beispiel-daten/QUELLEN.md); the Russian recordings are
public-domain speech recordings, everything else was created for this project.

To try it out: double-click the start file and drag the six CSV files and the folder
`beispiel-daten/medien` into the window. Or choose „Mit Demodaten ansehen" (view with demo
data) on the start screen.

## Structure

The code is split into four layers: core (`kern`), data (`daten`), view (`ansicht`) and
interaction (`bedienung`). [`ARCHITEKTUR.md`](ARCHITEKTUR.md) (German) describes the
modules, the dependency rules and the usual entry points for changes.

```
index.html          page skeleton and script load order
css/style.css       includes the styles from css/teile/
css/teile/*.css     design per area: base, sidebar, chat, panels …

js/kern/helfer.js       small helpers used everywhere
js/kern/csv.js          CSV parser (RFC 4180, delimiter detection)
js/kern/store.js        IndexedDB (one entry per conversation) and settings
js/kern/model.js        data model, column mapping, conversation index

js/daten/messengers.js  messenger detection, brand colours, logos
js/daten/media.js       media library: read folders, match paths, deliver files
js/daten/archive.js     ZIP reader for Office files (docx, xlsx, pptx, odt …)
js/daten/whatsapp.js    WhatsApp text exports: detect formats, read messages
js/daten/aleapp.js      ALEAPP reports: recognise tables and combine them per app
js/daten/aleapp-whatsapp.js  WhatsApp from ALEAPP: names, LID chats, receipts, calls
js/daten/aleapp-apps.js      Signal, Telegram, Threema, SMS, Google Messages and others
js/daten/documents.js   documents: preview, text extraction, background run
js/daten/translate.js   translation: browser API, language detection, queue, storage
js/daten/transcribe.js  voice messages: prepare audio, choose method, store
js/daten/transcribe-worker.js  Whisper in its own thread (transformers.js/ONNX)

js/ansicht/text.js      escape, highlight and link text
js/ansicht/suche.js     search across text, translation, transcript and document content
js/ansicht/medien.js    media tiles, loaded when they become visible
js/ansicht/liste.js     sidebar: filters and chat list
js/ansicht/chat.js      bubbles, header, hit navigation
js/ansicht/details.js   details panel with figures and gallery
js/ansicht/render.js    facade over the four renderers

js/bedienung/meldung.js          short notifications
js/bedienung/fortschritt.js      progress bar and loading bars
js/bedienung/hilfe.js            help dialog for the CSV format
js/bedienung/import.js           import of CSV, WhatsApp export and ALEAPP report, drag & drop, export, demo data
js/bedienung/whatsapp-import.js  ask for chat name and date format, read WhatsApp ZIPs
js/bedienung/medienordner.js     connect, remember and disconnect the media folder
js/bedienung/uebersetzen.js      translation controls (🌐)
js/bedienung/sprachnachrichten.js transcription controls (🎤)
js/bedienung/dokumente.js        make attachments searchable in the background
js/bedienung/lightbox.js         large view for image, video, PDF, document
js/app.js                        connects everything and starts

modelle/quellen.json     blueprint for the speech recognition model
modelle/                 the model itself, downloaded on first start (242 MB)
vendor/transformers/     runtime for the model (transformers.js and ONNX WASM, 22 MB)
vendor/pdfjs/            PDF.js for preview and text extraction (4 MB)
hole-modell.py           downloads missing model files
serve.py                 web server for macOS/Linux with the required MIME types
ChatVisualizer starten.cmd   start file for Windows
start.ps1                local web server, Windows built-in tools only
start.sh                 the same for macOS/Linux
```

In the browser console, `window.ChatVisualizer` provides `state`, `importFiles(files)`,
`openConversation(key)`, `demoData()`, `pickMediaFolder()`, `attachMediaFiles(files)` and
`media`; `media.lookup(path)` checks path matching.

## Disk space

With the speech recognition model the folder takes up about 270 MB. If you do not need to
transcribe voice messages, you can delete `modelle/` and start with `-KeinModell`; the 🎤
panel then states that no model is available.

## Performance

50,000 messages in 20 conversations: import including storage about 0.6 s, loading at
start about 0.1 s, global search about 10 ms. Long chats are rendered in blocks of 400
messages and loaded on scrolling up.

## License

The ChatVisualizer is licensed under the [MIT License](LICENSE).

Bundled third-party components keep their own licenses:

| Component | License |
| --- | --- |
| `vendor/pdfjs/` – PDF.js (Mozilla) | Apache-2.0; fonts and WASM decoders with their own license files in the same folder |
| `vendor/transformers/` – Transformers.js (Hugging Face) with ONNX Runtime Web (Microsoft) | Apache-2.0 and MIT |
| Speech recognition model in `modelle/` (downloaded on first start) | Apache-2.0, see `modelle/quellen.json` |
| Sample media in `beispiel-daten/medien/` | see `beispiel-daten/QUELLEN.md` |
