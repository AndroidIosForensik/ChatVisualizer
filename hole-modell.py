"""Laedt das Spracherkennungsmodell nach, falls es fehlt.

Wird beim Start von start.sh aufgerufen; unter Windows erledigt start.ps1
dasselbe mit Bordmitteln. Laesst sich auch von Hand aufrufen:

    python3 hole-modell.py              fehlende Dateien laden
    python3 hole-modell.py --pruefen    nur nachsehen, nichts laden

Was geladen wird, steht in modelle/quellen.json. Abgebrochene Downloads
landen als *.teil und werden beim naechsten Versuch fortgesetzt.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Die Beschreibungen aus quellen.json enthalten Umlaute; auf Konsolen mit
# anderer Zeichentabelle soll das nicht zum Abbruch fuehren.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELLE = os.path.join(ROOT, "modelle")
QUELLEN = os.path.join(MODELLE, "quellen.json")
VERZEICHNIS = os.path.join(MODELLE, "verzeichnis.json")


def mb(bytes_):
    if bytes_ < 1048576:
        return "%.0f KB" % (bytes_ / 1024.0)
    return "%.1f MB" % (bytes_ / 1048576.0)


def lies_quellen():
    with open(QUELLEN, "r", encoding="utf-8") as f:
        return json.load(f).get("modelle", [])


def fehlende(modell):
    """Dateien, die noch fehlen oder die falsche Groesse haben."""
    offen = []
    for datei in modell["dateien"]:
        ziel = os.path.join(MODELLE, modell["name"].replace("/", os.sep),
                            *datei["pfad"].split("/"))
        if not os.path.exists(ziel) or os.path.getsize(ziel) != datei["bytes"]:
            offen.append((datei, ziel))
    return offen


def pruefsumme(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def lade(url, ziel, groesse, nummer, gesamt):
    """Eine Datei laden – mit Fortsetzung, falls ein Rest herumliegt."""
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    teil = ziel + ".teil"
    da = os.path.getsize(teil) if os.path.exists(teil) else 0
    if da > groesse:
        os.remove(teil)
        da = 0

    kopf = {"User-Agent": "ChatVisualizer"}
    if da:
        kopf["Range"] = "bytes=%d-" % da

    name = os.path.basename(ziel)
    print("  [%d/%d] %s  (%s)%s" % (nummer, gesamt, name, mb(groesse),
                                    "  fortgesetzt bei " + mb(da) if da else ""))

    anfrage = urllib.request.Request(url, headers=kopf)
    with urllib.request.urlopen(anfrage, timeout=60) as antwort:
        # Ignoriert der Server die Fortsetzung, faengt die Datei von vorn an
        modus = "ab" if antwort.status == 206 and da else "wb"
        if modus == "wb":
            da = 0
        geladen = da
        letzte = 0.0
        with open(teil, modus) as f:
            while True:
                block = antwort.read(1024 * 256)
                if not block:
                    break
                f.write(block)
                geladen += len(block)
                jetzt = time.time()
                if jetzt - letzte > 0.4:
                    letzte = jetzt
                    anteil = geladen * 100.0 / groesse if groesse else 0
                    sys.stdout.write("\r        %5.1f %%  %s von %s   "
                                     % (anteil, mb(geladen), mb(groesse)))
                    sys.stdout.flush()
    sys.stdout.write("\r        fertig: %s%s\n" % (mb(groesse), " " * 20))

    if os.path.getsize(teil) != groesse:
        raise IOError("unerwartete Groesse (%d statt %d)"
                      % (os.path.getsize(teil), groesse))
    if os.path.exists(ziel):
        os.remove(ziel)
    os.rename(teil, ziel)


def schreibe_verzeichnis(modelle):
    """verzeichnis.json sagt dem Programm, was bereitliegt."""
    vorhanden = [m for m in modelle if not fehlende(m)]
    if not vorhanden:
        return
    with open(VERZEICHNIS, "w", encoding="utf-8") as f:
        json.dump({
            "hinweis": "Erzeugt von hole-modell.py. Welche Modelle bereitliegen; "
                       "\"bytes\" dient nur der Fortschrittsanzeige.",
            "modelle": [{"name": m["name"], "bytes": m["bytes"]} for m in vorhanden]
        }, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    nur_pruefen = "--pruefen" in sys.argv
    if not os.path.exists(QUELLEN):
        print("  modelle/quellen.json fehlt – nichts zu tun.")
        return 0

    modelle = lies_quellen()
    schreibe_verzeichnis(modelle)
    offen = [(m, fehlende(m)) for m in modelle]
    offen = [(m, o) for m, o in offen if o]
    if not offen:
        return 0

    zu_laden = sum(d["bytes"] for _, o in offen for d, _ in o)
    print("")
    print("  Spracherkennung: %s werden einmalig geladen." % mb(zu_laden))
    for m, _ in offen:
        print("  %s – %s" % (m["name"], m.get("beschreibung", "")))
    if nur_pruefen:
        return 1
    print("  Quelle: huggingface.co · Abbrechen mit Strg+C, der Rest laeuft auch ohne.")
    print("")

    for modell, dateien in offen:
        for i, (datei, ziel) in enumerate(dateien, 1):
            url = modell["basis"] + datei["pfad"]
            for versuch in (1, 2, 3):
                try:
                    lade(url, ziel, datei["bytes"], i, len(dateien))
                    break
                except (urllib.error.URLError, IOError, OSError) as e:
                    if versuch == 3:
                        print("")
                        print("  Fehlgeschlagen: %s (%s)" % (datei["pfad"], e))
                        print("  ChatVisualizer startet trotzdem – nur die "
                              "Transkription bleibt aus.")
                        print("  Spaeter erneut versuchen: python3 hole-modell.py")
                        return 2
                    print("        Neuer Versuch (%d/3) …" % (versuch + 1))
                    time.sleep(2)

            if datei.get("sha256"):
                echt = pruefsumme(ziel)
                if echt != datei["sha256"]:
                    print("        Hinweis: Pruefsumme weicht ab (%s…). "
                          "Datei wurde behalten." % echt[:12])

    schreibe_verzeichnis(modelle)
    print("")
    print("  Spracherkennung ist bereit.")
    print("")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  Abgebrochen. Der angefangene Teil bleibt liegen und wird "
              "beim naechsten Start fortgesetzt.\n")
        sys.exit(1)
