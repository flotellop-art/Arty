import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import arty_index as a


class SafetyTests(unittest.TestCase):
    def test_urls_and_private_addresses(self):
        hosts = {"www.sqlite.org", "127.0.0.1"}
        for url in ("http://www.sqlite.org/", "https://www.sqlite.org:8443/", "https://u:p@www.sqlite.org/",
                    "https://127.0.0.1/", "https://www.sqlite.org:bad/", "https://evil.test/", "https://www.sqlite.org/\nx"):
            with self.subTest(url=url), self.assertRaises(a.Refusal):
                a.normalize_url(url, hosts)
        self.assertEqual(a.normalize_url("https://www.sqlite.org/été#anchor", hosts), "https://www.sqlite.org/%C3%A9t%C3%A9")
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2002:0a00:0001::"):
            with self.subTest(ip=ip):
                self.assertFalse(a.public_ip(ip))
        self.assertTrue(a.public_ip("1.1.1.1"))
        with patch.object(a.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("1.1.1.1", 443)), (2, 1, 6, "", ("10.0.0.1", 443))]), self.assertRaises(a.Refusal):
            a.resolve_public("www.sqlite.org")

    def test_robots_longest_merge_percent_wildcard_and_group_boundaries(self):
        body = b"User-agent: *\nDisallow: /\nUser-agent: ArtyIndex\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nUser-agent: artyindex\nDisallow: /secret\nAllow: /private/public\n"
        for path, allowed in (("/", True), ("/private", False), ("/private/public", True), ("/secret", False), ("/x.pdf", False), ("/x.pdf?q=1", True)):
            self.assertEqual(a.robots_policy(body, path)[0], allowed, path)
        self.assertFalse(a.robots_policy("User-agent: *\nDisallow: /café".encode(), "/caf%C3%A9")[0])
        self.assertFalse(a.robots_policy(b"User-agent: *\nDisallow: /%62locked", "/blocked")[0])
        self.assertTrue(a.robots_policy(b"User-agent: ArtyIndex\nDisallow:\nUser-agent: *\nDisallow: /", "/")[0])
        self.assertTrue(a.robots_policy(b"User-agent: *\nDisallow: /x\nAllow: /x", "/x")[0])
        self.assertFalse(a.robots_policy(b"User-agent:\nDisallow:\nUser-agent: *\nDisallow: /", "/")[0])
        self.assertFalse(a.robots_policy(b"User-agent: Index\nAllow: /\nUser-agent: *\nDisallow: /", "/")[0])
        self.assertFalse(a.robots_policy(b"User-agent: ArtyIndex\nDisallow: /\nUser-agent:\nAllow: /", "/")[0])
        self.assertFalse(a.robots_policy(b"\xef\xbb\xbfUser-agent: *\nDisallow: /", "/")[0])

    def test_robot_failures_and_redirect_scope(self):
        url, hosts = "https://www.sqlite.org/fts5.html", {"www.sqlite.org"}
        for status in (401, 403, 429, 500):
            with patch.object(a, "request", return_value=(status, {}, b"")), self.assertRaises(a.Refusal):
                a.check_robots(url, hosts, time.monotonic() + 1, [])
        with patch.object(a, "request", return_value=(302, {"location": "https://127.0.0.1/"}, b"")), self.assertRaises(a.Refusal):
            a.check_robots(url, hosts, time.monotonic() + 1, [])
        with patch.object(a, "request", return_value=(404, {}, b"")):
            self.assertEqual(a.check_robots(url, hosts, time.monotonic() + 1, []), 0)
        with patch.object(a, "request", return_value=(200, {}, b"<!doctype html><html>Security error</html>")), self.assertRaises(a.Refusal):
            a.check_robots(url, hosts, time.monotonic() + 1, [])

    def test_html_extraction_is_static_and_bounded(self):
        body = b"<title>Example</title><nav>menu</nav><article><h1>FTS5</h1><p>" + b"Full text index search. " * 8 + b"</p><p hidden>secret</p><p style='display:none'>hidden</p><script>attack()</script><a href='/about.html'>About</a><a href='https://127.0.0.1/'>private</a></article>"
        title, text, links = a.extract(body, "https://www.sqlite.org/fts5.html", {"www.sqlite.org"})
        self.assertEqual(title, "Example")
        for hidden in ("menu", "secret", "hidden", "attack()"):
            self.assertNotIn(hidden, text)
        self.assertEqual(links, ["https://www.sqlite.org/about.html"])
        with self.assertRaises(a.Refusal):
            a.extract(b"<main><script>loadPage()</script></main>", "https://www.sqlite.org/", {"www.sqlite.org"})
        with self.assertRaises(a.Refusal):
            a.extract(b"<article>" + b"x" * (a.MAX_TEXT + 1) + b"</article>", "https://www.sqlite.org/", {"www.sqlite.org"})
        with self.assertRaises(a.Refusal):
            a.extract(b"<title>Reddit</title><main>You've been blocked by network security. " + b"Try again. " * 20 + b"</main>", "https://www.sqlite.org/", {"www.sqlite.org"})

    def test_refused_page_is_not_followed_or_indexed(self):
        class Pipe:
            def send(self, result): self.result = result
            def close(self): pass
        pipe = Pipe()
        with patch.object(a, "check_robots", return_value=0), patch.object(a, "request", return_value=(403, {}, b"No")) as transport:
            a.collect_child(pipe, "https://www.sqlite.org/", {"www.sqlite.org"}, 0)
        self.assertEqual(pipe.result["reason"], "http_403")
        self.assertEqual(transport.call_count, 1)
        with patch.object(a, "check_robots", return_value=0), patch.object(a, "request", return_value=(302, {"location": "https://127.0.0.1/"}, b"")) as transport:
            a.collect_child(pipe, "https://www.sqlite.org/", {"www.sqlite.org"}, 0)
        self.assertFalse(pipe.result["ok"])
        self.assertEqual(transport.call_count, 1)


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "index.sqlite"
        self.store = a.Store(self.path)
        text = "Full text search uses SQLite FTS5. Documents remain in our own index. " * 3
        self.doc = {"ok": True, "url": "https://www.sqlite.org/fts5.html", "finalUrl": "https://www.sqlite.org/fts5.html", "title": "FTS5", "text": text,
                    "sha256": hashlib.sha256(text.encode()).hexdigest(), "retrievedAt": "2026-10-05T12:00:00+00:00", "extraction": a.VERSION}

    def tearDown(self):
        self.store.db.close(); self.tmp.cleanup()

    def test_update_delete_and_refusal_invalidate_search(self):
        self.store.record(self.doc)
        result = self.store.search("FTS5", 5, ["www.sqlite.org", "absent.test"])
        self.assertEqual(len(result["bySource"]["www.sqlite.org"]["results"]), 1)
        self.assertEqual(result["bySource"]["absent.test"]["results"], [])
        snapshot = self.store.read(self.doc["url"])
        self.assertEqual(snapshot["markdown"], self.doc["text"])
        self.assertEqual(snapshot["receipt"]["sha256"], self.doc["sha256"])
        self.store.record({"ok": False, "url": self.doc["url"], "reason": "robots_denied"})
        self.assertIsNone(self.store.read(self.doc["url"]))
        self.assertEqual(self.store.search("FTS5", 5, [])["results"], [])
        self.assertEqual(self.store.db.execute("select count(*) from snapshots").fetchone()[0], 1)
        self.store.record(self.doc)
        self.store.remove(self.doc["url"])
        self.assertEqual(self.store.db.execute("select count(*) from snapshots").fetchone()[0], 0)

    def test_freshness_restart_and_query_injection(self):
        self.store.record(self.doc)
        self.store.db.close(); self.store = a.Store(self.path)
        self.assertEqual(len(self.store.search('FTS5\" OR search* NOT \"', 5, [])["results"]), 1)
        with self.store.db:
            self.store.db.execute("update snapshots set timestamp=0")
        self.assertIsNone(self.store.read(self.doc["url"]))
        self.assertEqual(self.store.search("FTS5", 5, [])["results"], [])
        self.assertEqual(self.store.search("FTS5", 5, [])["coverage"]["documents"], 0)

    def test_removed_redirect_domain_cannot_be_served_through_original_url(self):
        self.store.record({**self.doc, "finalUrl": "https://removed.test/page"})
        self.store.allowed_hosts = {"www.sqlite.org"}
        self.assertIsNone(self.store.read(self.doc["url"]))
        self.assertEqual(self.store.search("FTS5", 5, [])["results"], [])
        self.assertEqual(self.store.search("FTS5", 5, [])["coverage"]["documents"], 0)

    def test_crawl_durable_budget_and_stop(self):
        cfg = {"seeds": [self.doc["url"]], "hosts": {"www.sqlite.org"}, "max_pages": 1, "max_seconds": 10, "max_depth": 1, "delay_seconds": 1}
        with patch.object(a, "collect", return_value={**self.doc, "links": ["https://www.sqlite.org/about.html"], "trace": []}) as collect:
            a.crawl(self.store, cfg, Path(self.tmp.name) / "trace.jsonl")
            self.assertEqual(collect.call_count, 1)
        self.assertEqual(self.store.db.execute("select count(*) from frontier where attempted_at is null").fetchone()[0], 1)
        with patch.object(a, "collect", side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            a.crawl(self.store, cfg, Path(self.tmp.name) / "trace.jsonl")
        self.assertEqual(self.store.db.execute("select count(*) from frontier where attempted_at is null").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
