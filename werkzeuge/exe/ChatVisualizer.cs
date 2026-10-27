// ChatVisualizer als eine einzige EXE (Windows, .NET Framework 4 – auf jedem Windows 10/11 vorhanden).
//
// Die EXE trägt das ganze Programm als eingebettetes ZIP (Ressource „app.zip“) und
//   1. entpackt es beim ersten Start nach %LOCALAPPDATA%\ChatVisualizer\app-<Fassung>,
//   2. holt das Spracherkennungsmodell nach (wie start.ps1, im Hintergrund) – oder entpackt
//      es aus der Ressource „modell.zip“, wenn die EXE mit Modell gebaut wurde,
//   3. startet den lokalen Server auf http://localhost:8777 (bis 8797) und öffnet den Browser.
// Gleiche Adresse wie start.ps1 – die im Browser gespeicherten Chats bleiben erhalten.
//
// Bauen: werkzeuge\baue-exe.ps1 (nutzt csc.exe aus Windows, kein Download nötig).
// Absichtlich C# 5: so übersetzt es der csc.exe, der mit Windows ausgeliefert wird.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("ChatVisualizer")]
[assembly: AssemblyProduct("ChatVisualizer")]
[assembly: AssemblyDescription("Lokaler Chat-Betrachter für Messenger-Exporte und Forensik-Berichte")]

static class ChatVisualizerExe
{
    static string appOrdner;      // entpacktes Programm
    static string modellOrdner;   // gemeinsam für alle Fassungen
    static readonly object konsole = new object();

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" }, { ".htm", "text/html; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".js", "application/javascript; charset=utf-8" },
        { ".mjs", "application/javascript; charset=utf-8" }, { ".wasm", "application/wasm" },
        { ".onnx", "application/octet-stream" }, { ".json", "application/json; charset=utf-8" },
        { ".jsonl", "application/json; charset=utf-8" }, { ".txt", "text/plain; charset=utf-8" },
        { ".csv", "text/csv; charset=utf-8" }, { ".tsv", "text/tab-separated-values; charset=utf-8" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" },
        { ".gif", "image/gif" }, { ".webp", "image/webp" }, { ".ico", "image/x-icon" },
        { ".mp4", "video/mp4" }, { ".webm", "video/webm" }, { ".mov", "video/quicktime" },
        { ".ogg", "audio/ogg" }, { ".opus", "audio/ogg" }, { ".oga", "audio/ogg" }, { ".mp3", "audio/mpeg" },
        { ".wav", "audio/wav" }, { ".m4a", "audio/mp4" }, { ".aac", "audio/aac" }, { ".flac", "audio/flac" },
        { ".amr", "audio/amr" }, { ".pdf", "application/pdf" }, { ".pfb", "application/octet-stream" },
        { ".icc", "application/octet-stream" }, { ".bcmap", "application/octet-stream" },
        { ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { ".xml", "application/xml; charset=utf-8" }
    };

    [STAThread]
    static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.Title = "ChatVisualizer";
        bool keinBrowser = Array.IndexOf(args, "--kein-browser") >= 0;
        bool keinModell = Array.IndexOf(args, "--kein-modell") >= 0;
        if (Array.IndexOf(args, "--browser-pruefen") >= 0) {       // Diagnose: welcher Browser würde geöffnet?
            Console.WriteLine("Chrome: " + (BrowserFinden("chrome.exe", @"Google\Chrome\Application\chrome.exe") ?? "–"));
            Console.WriteLine("Edge:   " + (BrowserFinden("msedge.exe", @"Microsoft\Edge\Application\msedge.exe") ?? "–"));
            return 0;
        }

        string basis = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChatVisualizer");
        modellOrdner = Path.Combine(basis, "modelle");
        Directory.CreateDirectory(modellOrdner);

        try {
            appOrdner = ProgrammEntpacken(basis);
        } catch (Exception e) {
            Fehler("Das Programm konnte nicht entpackt werden: " + e.Message);
            return 1;
        }

        // Modell: aus der EXE (falls eingebaut), sonst im Hintergrund aus dem Netz
        if (!keinModell) {
            Thread t = new Thread(delegate () {
                try { ModellBereitstellen(); }
                catch (Exception e) { Hinweis("Spracherkennungsmodell: " + e.Message + " – alles andere funktioniert.", ConsoleColor.Yellow); }
            });
            t.IsBackground = true;
            t.Start();
        }

        HttpListener server = null;
        int port = 0;
        for (int p = 8777; p <= 8797 && server == null; p++) {
            HttpListener versuch = new HttpListener();
            versuch.Prefixes.Add("http://localhost:" + p + "/");
            try { versuch.Start(); server = versuch; port = p; }
            catch { try { versuch.Close(); } catch { } }
        }
        if (server == null) { Fehler("Kein freier Port zwischen 8777 und 8797 gefunden."); return 3; }

        string url = "http://localhost:" + port + "/";
        Console.Title = "ChatVisualizer – " + url + " (Fenster schließen zum Beenden)";
        Hinweis("", ConsoleColor.Gray);
        Hinweis("  ChatVisualizer läuft", ConsoleColor.Green);
        Hinweis("  " + url, ConsoleColor.White);
        Hinweis("", ConsoleColor.Gray);
        Hinweis("  Beenden: dieses Fenster schließen", ConsoleColor.DarkGray);
        Hinweis("", ConsoleColor.Gray);
        if (!keinBrowser) BrowserOeffnen(url, Array.IndexOf(args, "--standardbrowser") >= 0);

        while (server.IsListening) {
            HttpListenerContext ctx;
            try { ctx = server.GetContext(); } catch { break; }
            ThreadPool.QueueUserWorkItem(delegate (object o) { Bedienen((HttpListenerContext)o); }, ctx);
        }
        return 0;
    }

    /* ---- Programm entpacken ------------------------------------------------- */

    static string ProgrammEntpacken(string basis)
    {
        Assembly a = Assembly.GetExecutingAssembly();
        string fassung = Fassung(a);
        string ziel = Path.Combine(basis, "app-" + fassung);
        if (File.Exists(Path.Combine(ziel, "index.html")) && File.Exists(Path.Combine(ziel, ".fertig"))) return ziel;

        Hinweis("  Erster Start dieser Fassung – Programm wird entpackt …", ConsoleColor.DarkGray);
        string temp = ziel + ".neu";
        if (Directory.Exists(temp)) Directory.Delete(temp, true);
        using (Stream s = a.GetManifestResourceStream("app.zip"))
        using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read)) {
            Entpacken(zip, temp);
        }
        File.WriteAllText(Path.Combine(temp, ".fertig"), fassung);
        if (Directory.Exists(ziel)) Directory.Delete(ziel, true);
        Directory.Move(temp, ziel);

        // Ältere Fassungen aufräumen (das Modell liegt getrennt und bleibt)
        foreach (string alt in Directory.GetDirectories(basis, "app-*")) {
            if (!string.Equals(alt, ziel, StringComparison.OrdinalIgnoreCase)) {
                try { Directory.Delete(alt, true); } catch { }
            }
        }
        return ziel;
    }

    /* Kennung der eingebauten Fassung: SHA-256 über app.zip, gekürzt */
    static string Fassung(Assembly a)
    {
        using (Stream s = a.GetManifestResourceStream("app.zip"))
        using (SHA256 sha = SHA256.Create()) {
            byte[] h = sha.ComputeHash(s);
            return BitConverter.ToString(h, 0, 6).Replace("-", "").ToLowerInvariant();
        }
    }

    static void Entpacken(ZipArchive zip, string ziel)
    {
        string wurzel = Path.GetFullPath(ziel).TrimEnd('\\') + "\\";
        foreach (ZipArchiveEntry e in zip.Entries) {
            if (string.IsNullOrEmpty(e.Name)) continue;                  // Ordnereintrag
            string pfad = Path.GetFullPath(Path.Combine(ziel, e.FullName.Replace('/', '\\')));
            if (!pfad.StartsWith(wurzel, StringComparison.OrdinalIgnoreCase)) continue;  // nichts außerhalb
            Directory.CreateDirectory(Path.GetDirectoryName(pfad));
            using (Stream ein = e.Open()) using (FileStream aus = File.Create(pfad)) ein.CopyTo(aus);
        }
    }

    /* ---- Spracherkennungsmodell -------------------------------------------- */

    static void ModellBereitstellen()
    {
        string quellenPfad = Path.Combine(appOrdner, "modelle", "quellen.json");
        if (!File.Exists(quellenPfad)) return;
        File.Copy(quellenPfad, Path.Combine(modellOrdner, "quellen.json"), true);
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        var quellen = (Dictionary<string, object>)json.DeserializeObject(File.ReadAllText(quellenPfad, Encoding.UTF8));
        var modelle = (object[])quellen["modelle"];

        // Mit Modell gebaut? Dann zuerst aus der EXE entpacken
        Assembly a = Assembly.GetExecutingAssembly();
        if (Array.IndexOf(a.GetManifestResourceNames(), "modell.zip") >= 0 && Fehlende(modelle).Count > 0) {
            Hinweis("  Spracherkennungsmodell wird aus der EXE entpackt …", ConsoleColor.DarkGray);
            using (Stream s = a.GetManifestResourceStream("modell.zip"))
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read)) Entpacken(zip, modellOrdner);
        }

        List<object[]> offen = Fehlende(modelle);
        if (offen.Count > 0) {
            long menge = 0;
            foreach (object[] o in offen) menge += Convert.ToInt64(((Dictionary<string, object>)o[1])["bytes"]);
            Hinweis(string.Format("  Spracherkennungsmodell wird geladen ({0:N0} MB, einmalig) – das Programm ist schon benutzbar.", menge / 1048576.0), ConsoleColor.DarkGray);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            int nr = 0;
            foreach (object[] o in offen) {
                nr++;
                var modell = (Dictionary<string, object>)o[0];
                var datei = (Dictionary<string, object>)o[1];
                string url = (string)modell["basis"] + (string)datei["pfad"];
                for (int versuch = 1; ; versuch++) {
                    try { Laden(url, (string)o[2], Convert.ToInt64(datei["bytes"]), (string)datei["sha256"], nr, offen.Count); break; }
                    catch (Exception e) {
                        if (versuch >= 3) throw new Exception("Download von " + datei["pfad"] + " fehlgeschlagen (" + e.Message + "). Beim nächsten Start geht es weiter.");
                        Thread.Sleep(2000);
                    }
                }
            }
            Hinweis("  Spracherkennungsmodell bereit.", ConsoleColor.Green);
        }
        VerzeichnisSchreiben(modelle);
    }

    /* Fehlende oder unvollständige Dateien: [Modell, Datei, Zielpfad] */
    static List<object[]> Fehlende(object[] modelle)
    {
        var offen = new List<object[]>();
        foreach (Dictionary<string, object> m in modelle) {
            foreach (Dictionary<string, object> d in (object[])m["dateien"]) {
                string ziel = Path.Combine(modellOrdner, ((string)m["name"]).Replace('/', '\\'), ((string)d["pfad"]).Replace('/', '\\'));
                FileInfo fi = new FileInfo(ziel);
                if (!fi.Exists || fi.Length != Convert.ToInt64(d["bytes"])) offen.Add(new object[] { m, d, ziel });
            }
        }
        return offen;
    }

    static void Laden(string url, string ziel, long groesse, string sha256, int nr, int gesamt)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ziel));
        string teil = ziel + ".teil";
        long da = File.Exists(teil) ? new FileInfo(teil).Length : 0;
        if (da > groesse) { File.Delete(teil); da = 0; }

        HttpWebRequest anfrage = (HttpWebRequest)WebRequest.Create(url);
        anfrage.UserAgent = "ChatVisualizer";
        anfrage.Timeout = 60000;
        anfrage.ReadWriteTimeout = 180000;
        if (da > 0) anfrage.AddRange(da);
        using (HttpWebResponse antwort = (HttpWebResponse)anfrage.GetResponse()) {
            bool fortsetzen = antwort.StatusCode == HttpStatusCode.PartialContent && da > 0;
            if (!fortsetzen) da = 0;
            using (Stream quelle = antwort.GetResponseStream())
            using (FileStream aus = new FileStream(teil, fortsetzen ? FileMode.Append : FileMode.Create, FileAccess.Write)) {
                byte[] puffer = new byte[262144];
                long geladen = da;
                Stopwatch uhr = Stopwatch.StartNew();
                long letzte = 0;
                int n;
                while ((n = quelle.Read(puffer, 0, puffer.Length)) > 0) {
                    aus.Write(puffer, 0, n);
                    geladen += n;
                    if (groesse > 10485760 && uhr.ElapsedMilliseconds - letzte > 3000) {
                        letzte = uhr.ElapsedMilliseconds;
                        Hinweis(string.Format("    Datei {0}/{1}: {2:N0} %", nr, gesamt, geladen * 100.0 / groesse), ConsoleColor.DarkGray);
                    }
                }
            }
        }
        if (new FileInfo(teil).Length != groesse) throw new Exception("unerwartete Größe");
        using (FileStream f = File.OpenRead(teil)) using (SHA256 sha = SHA256.Create()) {
            string ist = BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
            if (ist != sha256) { f.Close(); File.Delete(teil); throw new Exception("Prüfsumme stimmt nicht"); }
        }
        if (File.Exists(ziel)) File.Delete(ziel);
        File.Move(teil, ziel);
    }

    /* modelle/verzeichnis.json: welche Modelle vollständig bereitliegen (liest die Seite) */
    static void VerzeichnisSchreiben(object[] modelle)
    {
        var fertig = new List<object>();
        foreach (Dictionary<string, object> m in modelle) {
            if (Fehlende(new object[] { m }).Count == 0) {
                var e = new Dictionary<string, object>();
                e["name"] = m["name"]; e["bytes"] = m["bytes"];
                fertig.Add(e);
            }
        }
        if (fertig.Count == 0) return;
        var inhalt = new Dictionary<string, object>();
        inhalt["hinweis"] = "Erzeugt von ChatVisualizer.exe. Welche Modelle bereitliegen; \"bytes\" dient nur der Fortschrittsanzeige.";
        inhalt["modelle"] = fertig;
        File.WriteAllText(Path.Combine(modellOrdner, "verzeichnis.json"), new JavaScriptSerializer().Serialize(inhalt), new UTF8Encoding(false));
    }

    /* ---- HTTP ---------------------------------------------------------------- */

    static void Bedienen(HttpListenerContext ctx)
    {
        HttpListenerResponse antwort = ctx.Response;
        try {
            // RawUrl bewahrt maskierte # und ? in Dateinamen
            string pfad = Uri.UnescapeDataString(ctx.Request.RawUrl.Split('?')[0]);
            if (pfad == "/") pfad = "/index.html";
            string rel = pfad.TrimStart('/').Replace('/', '\\');

            // modelle/… liegt außerhalb des Programmordners (gemeinsam für alle Fassungen)
            string wurzel = appOrdner;
            if (rel.StartsWith("modelle\\", StringComparison.OrdinalIgnoreCase) &&
                !rel.Equals("modelle\\quellen.json", StringComparison.OrdinalIgnoreCase)) {
                wurzel = modellOrdner;
                rel = rel.Substring("modelle\\".Length);
            }
            string voll = Path.GetFullPath(Path.Combine(wurzel, rel));
            string grenze = Path.GetFullPath(wurzel).TrimEnd('\\') + "\\";
            if (!voll.StartsWith(grenze, StringComparison.OrdinalIgnoreCase) || !File.Exists(voll)) {
                antwort.StatusCode = 404;
                byte[] t = Encoding.UTF8.GetBytes("Nicht gefunden");
                antwort.OutputStream.Write(t, 0, t.Length);
                return;
            }

            string ext = Path.GetExtension(voll);
            string typ;
            antwort.ContentType = Mime.TryGetValue(ext, out typ) ? typ : "application/octet-stream";
            antwort.AddHeader("Accept-Ranges", "bytes");
            antwort.AddHeader("Cache-Control", ext == ".onnx" || ext == ".wasm" ? "public, max-age=31536000, immutable" : "no-cache");

            using (FileStream f = new FileStream(voll, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
                long laenge = f.Length, von = 0, bis = laenge - 1;
                string bereich = ctx.Request.Headers["Range"];
                if (!string.IsNullOrEmpty(bereich) && bereich.StartsWith("bytes=") && bereich.IndexOf(',') < 0 && laenge > 0) {
                    string[] teile = bereich.Substring(6).Split('-');
                    bool gueltig = teile.Length == 2;
                    if (gueltig && teile[0] == "") {
                        long ende; gueltig = long.TryParse(teile[1], out ende) && ende > 0;
                        if (gueltig) von = Math.Max(0, laenge - ende);
                    } else if (gueltig) {
                        gueltig = long.TryParse(teile[0], out von);
                        long b;
                        if (gueltig && teile[1] != "") { gueltig = long.TryParse(teile[1], out b); bis = Math.Min(b, laenge - 1); }
                        gueltig = gueltig && von < laenge && bis >= von;
                    }
                    if (!gueltig) {
                        antwort.StatusCode = 416;
                        antwort.AddHeader("Content-Range", "bytes */" + laenge);
                        return;
                    }
                    antwort.StatusCode = 206;
                    antwort.AddHeader("Content-Range", "bytes " + von + "-" + bis + "/" + laenge);
                }
                long menge = laenge == 0 ? 0 : bis - von + 1;
                antwort.ContentLength64 = menge;
                if (ctx.Request.HttpMethod == "HEAD") return;
                f.Seek(von, SeekOrigin.Begin);
                byte[] puffer = new byte[65536];
                while (menge > 0) {
                    int n = f.Read(puffer, 0, (int)Math.Min(puffer.Length, menge));
                    if (n <= 0) break;
                    antwort.OutputStream.Write(puffer, 0, n);
                    menge -= n;
                }
            }
        } catch {
            // Abgebrochene Verbindungen (Spulen, Seitenwechsel) sind normal
        } finally {
            try { antwort.OutputStream.Close(); } catch { }
        }
    }

    /* ---- Browser --------------------------------------------------------------- */

    /* Zuerst Chrome, dann Edge: nur sie übersetzen lokal (Translator-API). Sonst der Standardbrowser. */
    static void BrowserOeffnen(string url, bool standard)
    {
        string pfad = standard ? null : (BrowserFinden("chrome.exe", @"Google\Chrome\Application\chrome.exe")
            ?? BrowserFinden("msedge.exe", @"Microsoft\Edge\Application\msedge.exe"));
        try {
            if (pfad != null) {
                Process.Start(pfad, "\"" + url + "\"");
                Hinweis("  Geöffnet in " + (pfad.EndsWith("chrome.exe", StringComparison.OrdinalIgnoreCase) ? "Chrome" : "Edge"), ConsoleColor.DarkGray);
            } else {
                Process.Start(url);
                Hinweis("  Chrome/Edge nicht gefunden – Standardbrowser geöffnet. Zum Übersetzen Chrome oder Edge nutzen.", ConsoleColor.Yellow);
            }
        } catch {
            Hinweis("  Browser bitte selbst öffnen: " + url, ConsoleColor.Yellow);
        }
    }

    /* Installationsort über „App Paths" (Benutzer, dann Rechner), sonst die üblichen Ordner */
    static string BrowserFinden(string exe, string unterpfad)
    {
        string schluessel = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe;
        foreach (Microsoft.Win32.RegistryKey wurzel in new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine }) {
            try {
                using (Microsoft.Win32.RegistryKey k = wurzel.OpenSubKey(schluessel)) {
                    string p = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                }
            } catch { }
        }
        foreach (Environment.SpecialFolder ordner in new[] { Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.LocalApplicationData }) {
            string p = Path.Combine(Environment.GetFolderPath(ordner), unterpfad);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    /* ---- Ausgabe ------------------------------------------------------------- */

    static void Hinweis(string text, ConsoleColor farbe)
    {
        lock (konsole) {
            Console.ForegroundColor = farbe;
            Console.WriteLine(text);
            Console.ResetColor();
        }
    }

    static void Fehler(string text)
    {
        Hinweis("", ConsoleColor.Gray);
        Hinweis("  " + text, ConsoleColor.Red);
        Hinweis("  Taste drücken zum Schließen.", ConsoleColor.DarkGray);
        try { Console.ReadKey(true); } catch { }
    }
}
