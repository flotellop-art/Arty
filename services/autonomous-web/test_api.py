import http.client
import json
import multiprocessing
from pathlib import Path
import socket
import tempfile
import time
import unittest

import arty_index as a


def read_only_server(directory, cfg, port):
    def no_transport(*args):
        raise AssertionError("An API consultation may not collect a page")
    a.request = no_transport
    a.serve(Path(directory), cfg, port)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.tmp.name)
        cls.key = "synthetic-test-key-" * 3
        (cls.path / "service.key").write_text(cls.key)
        store = a.Store(cls.path / "index.sqlite")
        cls.url = "https://www.sqlite.org/fts5.html"
        text = "Fictional full text index API test document. " * 5
        store.record({"ok": True, "url": cls.url, "finalUrl": cls.url, "title": "Test FTS5", "text": text,
            "sha256": a.hashlib.sha256(text.encode()).hexdigest(), "retrievedAt": "2026-10-05T07:00:00Z", "extraction": a.VERSION})
        store.db.close()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0)); cls.port = s.getsockname()[1]
        cls.process = multiprocessing.get_context("spawn").Process(target=read_only_server,
            args=(cls.tmp.name, {"hosts": {"www.sqlite.org"}, "fresh_hours": 168}, cls.port))
        cls.process.start()
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=.1): break
            except OSError: time.sleep(.1)
        else: raise RuntimeError("Test server failed to start")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate(); cls.process.join(); cls.tmp.cleanup()

    def post(self, path, body, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            c.request("POST", path, json.dumps(body), {"Content-Type": "application/json", **(headers or {})})
            r = c.getresponse(); return r.status, json.loads(r.read())
        finally: c.close()

    def test_private_api_and_no_collection(self):
        headers = {"Authorization": "Bearer " + self.key}
        self.assertEqual(self.post("/search", {"query": "FTS5"})[0], 401)
        status, result = self.post("/search", {"query": "FTS5"}, headers)
        self.assertEqual(status, 200)
        self.assertEqual(result["results"][0]["url"], self.url)
        status, page = self.post("/fetch", {"url": self.url}, headers)
        self.assertEqual(status, 200)
        self.assertEqual(page["receipt"]["captureMode"], "html-static")
        self.assertEqual(self.post("/fetch", {"url": "https://www.sqlite.org/not-in-index"}, headers)[0], 404)
        self.assertEqual(self.post("/crawl", {"url": self.url}, headers)[0], 404)
        self.assertFalse((self.path / "collection.jsonl").exists())

    def test_local_ui_origin_host_and_bounded_query(self):
        ui = {"Origin": f"http://127.0.0.1:{self.port}", "Sec-Fetch-Site": "same-origin"}
        self.assertEqual(self.post("/local/search", {"query": "FTS5"}, ui)[0], 200)
        self.assertEqual(self.post("/local/search", {"query": "FTS5"})[0], 403)
        self.assertEqual(self.post("/local/search", {"query": "FTS5"}, {**ui, "Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.post("/local/search", {"query": "FTS5"}, {**ui, "Host": "evil.test"})[0], 403)
        self.assertEqual(self.post("/local/search", {"query": "a" * 1025}, ui)[0], 400)


if __name__ == "__main__": unittest.main()
