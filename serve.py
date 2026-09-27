"""Kleiner lokaler Webserver fuer ChatVisualizer (macOS/Linux, von start.sh aufgerufen).

Gegenueber `python -m http.server` setzt er die MIME-Typen, die das mitgelieferte
Spracherkennungsmodell braucht (.wasm, .onnx, .mjs).

    python3 serve.py [port]
"""
import os
import re
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
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime", ".opus": "audio/ogg", ".ogg": "audio/ogg",
    ".oga": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac",
}


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.range_remaining = None
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()
        try:
            stream = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        size = os.fstat(stream.fileno()).st_size
        start, end = 0, size - 1
        status = 200
        requested = self.headers.get("Range")
        if requested and "," not in requested:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            try:
                if not match or not size:
                    raise ValueError()
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                else:
                    suffix = int(last)
                    if suffix <= 0:
                        raise ValueError()
                    start = max(0, size - suffix)
                if start >= size or end < start:
                    raise ValueError()
                status = 206
            except ValueError:
                stream.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
        self.send_response(status)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        stream.seek(start)
        self.range_remaining = end - start + 1
        return stream

    def copyfile(self, source, outputfile):
        if self.range_remaining is None:
            return super().copyfile(source, outputfile)
        remaining = self.range_remaining
        try:
            while remaining:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Player hat beim Spulen die alte Anfrage beendet.

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
