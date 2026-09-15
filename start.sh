#!/bin/sh
# ChatVisualizer starten (macOS / Linux) - ohne Installation.
# Nutzt der Reihe nach python3, python, php oder ruby, je nachdem was vorhanden ist.
#
#   ./start.sh            freien Port ab 8777 suchen und Browser oeffnen
#   ./start.sh 9000       diesen Port benutzen
#
# Fehlt das Spracherkennungsmodell, wird es beim ersten Start automatisch
# geladen (rund 242 MB, siehe modelle/quellen.json). Ueberspringen mit
# CHATVISUALIZER_KEIN_MODELL=1 ./start.sh
#
# Beenden: Strg+C

set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

if [ ! -f "$DIR/index.html" ]; then
  echo "index.html wurde neben start.sh nicht gefunden ($DIR)."
  exit 1
fi

PORT=${1:-}

have() { command -v "$1" >/dev/null 2>&1; }

PY=""
if have python3; then PY=python3
elif have python; then PY=python
fi

# Fehlende Teile nachladen (Spracherkennungsmodell), bevor der Server startet
if [ -z "${CHATVISUALIZER_KEIN_MODELL:-}" ] && [ -f "$DIR/hole-modell.py" ]; then
  if [ -n "$PY" ]; then
    "$PY" "$DIR/hole-modell.py" || true
  elif [ -f "$DIR/modelle/quellen.json" ] && [ ! -d "$DIR/modelle/Xenova" ]; then
    echo "  Hinweis: Ohne Python laesst sich das Spracherkennungsmodell nicht"
    echo "  automatisch laden. Die Transkription bleibt dann aus."
  fi
fi

# Freien Port suchen (wenn keiner vorgegeben wurde und Python vorhanden ist)
if [ -z "$PORT" ] && [ -n "$PY" ]; then
  PORT=$("$PY" - <<'PYEOF'
import socket
for p in range(8777, 8798):
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p))
        print(p)
        break
    except OSError:
        pass
    finally:
        s.close()
PYEOF
)
fi
[ -n "$PORT" ] || PORT=8777

URL="http://localhost:$PORT/"

echo ""
echo "  ChatVisualizer laeuft"
echo "  $URL"
echo ""
echo "  Ordner:  $DIR"
echo "  Beenden: Strg+C"
echo ""

# Browser oeffnen, sobald der Server steht
( sleep 1
  if have open; then open "$URL"
  elif have xdg-open; then xdg-open "$URL" >/dev/null 2>&1
  else echo "  Browser bitte manuell oeffnen: $URL"
  fi ) &

if [ -n "$PY" ]; then
  # serve.py setzt die MIME-Typen, die das mitgelieferte Modell braucht
  exec "$PY" "$DIR/serve.py" "$PORT"
elif have php; then
  exec php -S "127.0.0.1:$PORT" -t "$DIR"
elif have ruby; then
  exec ruby -run -e httpd -- --bind-address=127.0.0.1 --port "$PORT" "$DIR"
else
  echo "  Weder python3, python, php noch ruby gefunden."
  echo "  index.html kann auch direkt im Browser geoeffnet werden -"
  echo "  dann speichern manche Browser die importierten Chats allerdings nicht dauerhaft."
  exit 1
fi
