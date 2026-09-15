"""Kleiner lokaler Webserver fuer ChatVisualizer (macOS/Linux, von start.sh aufgerufen).

Gegenueber `python -m http.server` setzt er die MIME-Typen, die das mitgelieferte
Spracherkennungsmodell braucht (.wasm, .onnx, .mjs).

    python3 serve.py [port]
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

EXTRA_TYPES = {
    ".wasm": "application/wasm",
    ".mjs": "application/javascript",
    ".js": "application/javascript",
    ".onnx": "application/octet-stream",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
}


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        ext = os.path.splitext(self.path.split("?")[0])[1].lower()
        if ext in (".onnx", ".wasm"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    handler = partial(Handler, directory=ROOT)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
