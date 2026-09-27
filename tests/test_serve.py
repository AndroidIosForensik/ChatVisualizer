"""python -m unittest discover -s tests -p test_serve.py"""
import importlib.util
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

spec = importlib.util.spec_from_file_location('serve', Path(__file__).resolve().parents[1] / 'serve.py')
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


class MediaServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        Path(cls.folder.name, 'video.mp4').write_bytes(bytes(range(256)))
        Path(cls.folder.name, 'empty.mp4').write_bytes(b'')
        Path(cls.folder.name, 'Foto #1 [a].png').write_bytes(b'image')
        cls.server = serve.ThreadingHTTPServer(('127.0.0.1', 0), partial(serve.Handler, directory=cls.folder.name))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}/'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.folder.cleanup()

    def request(self, name='video.mp4', range_=None, method='GET'):
        request = urllib.request.Request(self.base + name, method=method,
                                         headers={'Range': range_} if range_ else {})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_full_file(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'video/mp4')
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertEqual(body, bytes(range(256)))

    def test_ranges(self):
        for header, start, end in [('bytes=0-15', 0, 15), ('bytes=240-', 240, 255),
                                   ('bytes=-10', 246, 255), ('bytes=250-9999', 250, 255)]:
            with self.subTest(header=header):
                status, headers, body = self.request(range_=header)
                self.assertEqual(status, 206)
                self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/256')
                self.assertEqual(body, bytes(range(start, end + 1)))

    def test_head(self):
        status, headers, body = self.request(range_='bytes=5-10', method='HEAD')
        self.assertEqual(status, 206)
        self.assertEqual(headers['Content-Length'], '6')
        self.assertEqual(body, b'')

    def test_invalid_ranges(self):
        for header in ['bytes=256-', 'bytes=10-2', 'bytes=-0', 'bytes=-', 'bytes=invalid']:
            with self.subTest(header=header):
                status, headers, body = self.request(range_=header)
                self.assertEqual(status, 416)
                self.assertEqual(headers['Content-Range'], 'bytes */256')
                self.assertEqual(body, b'')

    def test_empty_and_special_names(self):
        self.assertEqual(self.request('empty.mp4')[2], b'')
        self.assertEqual(self.request('empty.mp4', range_='bytes=0-')[0], 416)
        self.assertEqual(self.request('Foto%20%231%20%5Ba%5D.png')[2], b'image')


if __name__ == '__main__':
    unittest.main()
