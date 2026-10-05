"""Owned, bounded HTML corpus. Collection is CLI-only; the API never crawls.

No search engine, JS execution, cookie jar, environment proxy or model API.
Run `python arty_index.py --help`. Data/secrets stay outside the checkout.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import http.client
import ipaddress
import json
import multiprocessing
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import ssl
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

from lxml import html

AGENT = "ArtyIndex"
VERSION = "arty-html-static/1"
MAX_BYTES = 2_000_000
MAX_TEXT = 160_000
ROBOTS_BYTES = 1_048_576


class Refusal(Exception):
    pass


def normalize_url(value: str, hosts: set[str]) -> str:
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\x00-\x20\x7f\\]", value):
        raise Refusal("invalid_url")
    try:
        p = urlsplit(value)
        host = (p.hostname or "").encode("idna").decode("ascii").lower()
        port = p.port
    except (ValueError, UnicodeError):
        raise Refusal("invalid_url") from None
    if p.scheme != "https" or p.username or p.password or port not in (None, 443) or host not in hosts:
        raise Refusal("outside_corpus")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise Refusal("ip_literal")
    if not host or p.scheme != "https" or host not in hosts:
        raise Refusal("outside_corpus")
    # Keep percent-encoded reserved characters; quote Unicode for HTTP request targets.
    path = quote(p.path or "/", safe="/%:@!$&'()*+,;=-._~")
    query = quote(p.query, safe="/%?:@!$&'()*+,;=-._~")
    return urlunsplit(("https", host, path, query, ""))


def public_ip(value: str) -> bool:
    a = ipaddress.ip_address(value)
    # Reject transition addresses too: their routing can hide private IPv4.
    return a.is_global and not (a.is_multicast or a.is_unspecified or
        (a.version == 6 and (a.ipv4_mapped or a.sixtofour or a.teredo)))


def resolve_public(host: str) -> list[str]:
    addresses = list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or not all(public_ip(a) for a in addresses):
        raise Refusal("non_public_dns")
    return addresses


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str, timeout: float):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        family = socket.AF_INET6 if ":" in self.address else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        try:
            sock.connect((self.address, 443))  # Never resolve again after validation.
            if ipaddress.ip_address(sock.getpeername()[0]) != ipaddress.ip_address(self.address):
                raise Refusal("peer_mismatch")
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def request(url: str, hosts: set[str], deadline: float, limit: int, trace: list) -> tuple[int, dict, bytes]:
    url = normalize_url(url, hosts)
    p = urlsplit(url)
    addresses = resolve_public(p.hostname)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise Refusal("timeout")
    c = PinnedHTTPS(p.hostname, addresses[0], min(8, remaining))
    try:
        c.request("GET", p.path + ("?" + p.query if p.query else ""), headers={
            "User-Agent": AGENT + "/1.0", "Accept": "text/html,text/plain", "Accept-Encoding": "identity",
        })
        r = c.getresponse()
        headers = {k.lower(): v for k, v in r.getheaders()}
        trace.append({"url": url, "ip": addresses[0], "status": r.status})
        if headers.get("content-encoding", "identity").lower() not in ("", "identity"):
            raise Refusal("compressed_response")
        if headers.get("content-length", "").isdigit() and int(headers["content-length"]) > limit:
            raise Refusal("too_large")
        body = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise Refusal("timeout")
            c.sock.settimeout(min(8, remaining)) if c.sock else None
            chunk = r.read1(min(65536, limit + 1 - len(body)))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > limit:
                raise Refusal("too_large")
        return r.status, headers, bytes(body)
    finally:
        c.close()


def robots_octets(s: str) -> str:
    # RFC 9309: compare percent-encoded UTF-8 octets, decode only unreserved ASCII.
    s = quote(s, safe="/%?:@!$&'()*+,;=-._~")
    def decode(m):
        b = int(m[1], 16)
        c = chr(b)
        return c if c.isascii() and (c.isalnum() or c in "-._~") else "%" + m[1].upper()
    return re.sub(r"%([a-fA-F0-9]{2})", decode, s)


def robots_policy(body: bytes, path: str) -> tuple[bool, float]:
    text = body.decode("utf-8-sig", errors="replace")
    groups, agents, rules, delays, started = [], [], [], [], False
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (v.strip() for v in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if started:
                groups.append((agents, rules, delays)); agents, rules, delays, started = [], [], [], False
            if not value or not re.fullmatch(r"[A-Za-z_-]+|\*", value):
                # Invalid groups cannot inherit a previous valid group's rules.
                agents = []
                continue
            agents.append(value.lower())
        elif agents and key in ("allow", "disallow"):
            started = True
            if value:
                rules.append((key, robots_octets(value)))
        elif agents and key == "crawl-delay":
            started = True
            try:
                n = float(value)
                if 0 <= n <= 86400:
                    delays.append(n)
            except ValueError:
                pass
    groups.append((agents, rules, delays))
    exact = [g for g in groups if AGENT.lower() in g[0]]
    selected = exact or [g for g in groups if "*" in g[0]]
    target = robots_octets(path)
    matches = []
    for _, rs, _ in selected:
        for kind, pattern in rs:
            end = pattern.endswith("$")
            raw = pattern[:-1] if end else pattern
            expression = "^" + ".*".join(re.escape(p) for p in raw.split("*")) + ("$" if end else "")
            if re.search(expression, target):
                specificity = len(re.sub(r"%[0-9A-F]{2}", "x", raw.replace("*", "")))
                matches.append((specificity, kind == "allow"))
    return (max(matches)[1] if matches else True), max([0] + [d for _, _, ds in selected for d in ds])


def check_robots(url: str, hosts: set[str], deadline: float, trace: list) -> float:
    p = urlsplit(url)
    robot = f"https://{p.hostname}/robots.txt"
    for _ in range(4):
        status, headers, body = request(robot, hosts, deadline, ROBOTS_BYTES, trace)
        if status in (301, 302, 303, 307, 308):
            robot = normalize_url(urljoin(robot, headers.get("location", "")), hosts)
            if urlsplit(robot).hostname != p.hostname:
                raise Refusal("robots_cross_host")
            continue
        if status in (404, 410):
            return 0
        if status != 200:
            raise Refusal("robots_unavailable")
        if body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
            raise Refusal("robots_unavailable")
        allowed, delay = robots_policy(body, p.path + ("?" + p.query if p.query else ""))
        if not allowed:
            raise Refusal("robots_denied")
        return delay
    raise Refusal("robots_redirect_limit")


def extract(body: bytes, final_url: str, hosts: set[str]) -> tuple[str, str, list[str]]:
    tree = html.fromstring(body, base_url=final_url, parser=html.HTMLParser(no_network=True, recover=True))
    title = " ".join(tree.xpath("//title/text()"))[:300] or final_url
    for e in tree.xpath("//script|//style|//noscript|//nav|//header|//footer|//form|//svg|//template|//*[@hidden]|//*[@aria-hidden='true']"):
        e.drop_tree()
    for e in tree.xpath("//*[@style]"):
        if re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))", e.get("style", ""), re.I):
            e.drop_tree()
    roots = tree.xpath("//article|//main")
    root = max(roots, key=lambda e: len(e.text_content())) if roots else tree
    text = "\n".join(" ".join(s.split()) for s in root.text_content().splitlines() if s.strip()).strip()
    if len(text) < 80:
        raise Refusal("empty_or_js_required")
    if len(text) > MAX_TEXT:
        raise Refusal("text_too_large")  # No partial document can be called complete.
    refusal = re.compile(r"(?:blocked by network security|you(?:'|’)?ve been blocked|verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue|access denied|just a moment|attention required|security check)", re.I)
    if refusal.search(title) or (len(text) < 10_000 and refusal.search(text)):
        raise Refusal("site_refusal")
    links = []
    for href in tree.xpath("//a[@href]/@href")[:1000]:
        try:
            value = normalize_url(urljoin(final_url, href), hosts)
            # Discovery is conservative: no query permutations or binary downloads.
            if not urlsplit(value).query and not re.search(r"\.(pdf|zip|gz|jpg|png|mp4|exe)$", urlsplit(value).path, re.I):
                links.append(value)
        except (Refusal, ValueError, UnicodeError):
            pass
    return title, text, list(dict.fromkeys(links))[:100]


def collect_child(pipe, url: str, hosts: set[str], delay: float):
    trace = []
    try:
        deadline = time.monotonic() + 18
        final = normalize_url(url, hosts)
        for _ in range(4):
            robot_delay = check_robots(final, hosts, deadline, trace)
            wait = max(delay, robot_delay)
            if time.monotonic() + wait >= deadline:
                raise Refusal("crawl_delay_exceeds_budget")
            time.sleep(wait)
            status, headers, body = request(final, hosts, deadline, MAX_BYTES, trace)
            if status in (301, 302, 303, 307, 308):
                final = normalize_url(urljoin(final, headers.get("location", "")), hosts)
                continue
            if status != 200:
                raise Refusal("http_" + str(status))
            if headers.get("content-type", "").split(";", 1)[0].lower() not in ("text/html", "application/xhtml+xml"):
                raise Refusal("unsupported_type")
            title, text, links = extract(body, final, hosts)
            pipe.send({"ok": True, "url": url, "finalUrl": final, "title": title, "text": text, "links": links,
                "retrievedAt": datetime.now(timezone.utc).isoformat(), "sha256": hashlib.sha256(text.encode()).hexdigest(),
                "extraction": VERSION, "trace": trace})
            return
        raise Refusal("redirect_limit")
    except Exception as e:
        pipe.send({"ok": False, "url": url, "reason": str(e) if isinstance(e, Refusal) else "transport_or_parse_error", "trace": trace})
    finally:
        pipe.close()


def collect(url: str, hosts: set[str], delay: float, timeout: float = 20) -> dict:
    # A process boundary bounds DNS, TLS, parser CPU and memory lifetime, not just reads.
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=False)
    p = context.Process(target=collect_child, args=(child, url, hosts, delay))
    p.start(); child.close()
    try:
        if parent.poll(timeout):
            return parent.recv()
        return {"ok": False, "url": url, "reason": "timeout", "trace": []}
    except EOFError:
        return {"ok": False, "url": url, "reason": "collector_failed", "trace": []}
    finally:
        if p.is_alive():
            p.terminate()
        p.join(); parent.close()


class Store:
    def __init__(self, path: Path, fresh_hours: int = 168, allowed_hosts: set[str] | None = None):
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.fresh_seconds = fresh_hours * 3600
        self.allowed_hosts = allowed_hosts
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, url TEXT, final_url TEXT, title TEXT,
          text TEXT, sha256 TEXT, fetched_at TEXT, timestamp REAL, extraction TEXT);
        CREATE TABLE IF NOT EXISTS current(url TEXT PRIMARY KEY, snapshot_id INTEGER, status TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS corpus USING fts5(title, text, url UNINDEXED, snapshot_id UNINDEXED,
          tokenize='unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS frontier(url TEXT PRIMARY KEY, depth INTEGER, attempted_at REAL, reason TEXT);
        """)

    def record(self, result: dict):
        with self.db:
            self.db.execute("DELETE FROM corpus WHERE url=?", (result["url"],))
            sid = None
            if result["ok"]:
                sid = self.db.execute("INSERT INTO snapshots(url,final_url,title,text,sha256,fetched_at,timestamp,extraction) VALUES(?,?,?,?,?,?,?,?)",
                    (result["url"], result["finalUrl"], result["title"], result["text"], result["sha256"], result["retrievedAt"], time.time(), result["extraction"])).lastrowid
                self.db.execute("INSERT INTO corpus(title,text,url,snapshot_id) VALUES(?,?,?,?)", (result["title"], result["text"], result["url"], sid))
            self.db.execute("INSERT OR REPLACE INTO current VALUES(?,?,?)", (result["url"], sid, "ok" if sid else result["reason"]))

    def remove(self, url: str):
        with self.db:
            self.db.execute("DELETE FROM corpus WHERE url=?", (url,))
            self.db.execute("DELETE FROM current WHERE url=?", (url,))
            self.db.execute("DELETE FROM snapshots WHERE url=?", (url,))
            self.db.execute("DELETE FROM frontier WHERE url=?", (url,))

    def read(self, url: str) -> dict | None:
        if self.allowed_hosts is not None and urlsplit(url).hostname not in self.allowed_hosts:
            return None
        row = self.db.execute("SELECT s.* FROM current c JOIN snapshots s ON s.id=c.snapshot_id WHERE c.url=? AND s.timestamp>?",
            (url, time.time() - self.fresh_seconds)).fetchone()
        if not row:
            return None
        if self.allowed_hosts is not None and urlsplit(row["final_url"]).hostname not in self.allowed_hosts:
            return None
        return {"provider": "arty-index", "markdown": row["text"], "originalLength": len(row["text"]), "truncated": False,
            "receipt": {"provider": "arty-index", "requestedUrl": row["url"], "finalUrl": row["final_url"],
                "retrievedAt": row["fetched_at"], "sha256": row["sha256"], "snapshotId": row["id"], "extraction": row["extraction"],
                "captureMode": "html-static", "access": "public", "truncated": False, "imagesIncluded": False, "commentsIncluded": None}}

    def search(self, query: str, limit: int, sources: list[str]) -> dict:
        tokens = list(dict.fromkeys(re.findall(r"[^\W_]+", query, re.UNICODE)))[:32]
        expression = " OR ".join('"' + t + '"' for t in tokens)
        def results(domain=None):
            if not expression:
                return []
            domains = [domain] if domain else sorted(self.allowed_hosts or [])
            clause = " AND (" + " OR ".join("s.url LIKE ?" for _ in domains) + ")" if domains else ""
            rows = self.db.execute("""SELECT s.*, snippet(corpus,1,'','',' … ',48) AS excerpt
              FROM corpus JOIN snapshots s ON s.id=corpus.snapshot_id
              WHERE corpus MATCH ? AND s.timestamp>?""" + clause + " ORDER BY bm25(corpus,4.0,1.0) LIMIT 200",
              (expression, time.time() - self.fresh_seconds, *[f"https://{h}/%" for h in domains])).fetchall()
            out, seen = [], set()
            for r in rows:
                if self.allowed_hosts is not None and (urlsplit(r["url"]).hostname not in self.allowed_hosts or urlsplit(r["final_url"]).hostname not in self.allowed_hosts):
                    continue
                identity = (r["final_url"], r["sha256"])
                if identity in seen:
                    continue
                seen.add(identity)
                out.append({"title": r["title"], "url": r["url"], "snippet": r["excerpt"][:1200], "retrievedAt": r["fetched_at"],
                    "sha256": r["sha256"], "snapshotId": r["id"], "captureMode": "html-static"})
                if len(out) >= limit:
                    break
            return out
        coverage = [r[0] for r in self.db.execute("SELECT s.url,s.final_url FROM current c JOIN snapshots s ON s.id=c.snapshot_id WHERE s.timestamp>?", (time.time() - self.fresh_seconds,))
            if self.allowed_hosts is None or (urlsplit(r[0]).hostname in self.allowed_hosts and urlsplit(r[1]).hostname in self.allowed_hosts)]
        common = {"provider": "arty-index", "query": query, "coverage": {"domains": sorted(set(urlsplit(u).hostname for u in coverage)),
            "documents": len(coverage),
            "scope": "owned-corpus", "freshHours": self.fresh_seconds // 3600}}
        return {**common, "bySource": {s: {"results": results(s)} for s in sources}} if sources else {**common, "results": results()}


def config(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    hosts = data.get("allowed_hosts", [])
    if not hosts or len(hosts) > 20 or not all(isinstance(h, str) and re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", h) for h in hosts):
        raise ValueError("Configure 1-20 exact public hostnames")
    data["hosts"] = set(hosts)
    for key, default, low, high in (("max_pages", 10, 1, 50), ("max_depth", 1, 0, 2), ("max_seconds", 120, 1, 600),
            ("fresh_hours", 168, 1, 720), ("delay_seconds", 2, 1, 60)):
        value = data.get(key, default)
        if not isinstance(value, int) or not low <= value <= high:
            raise ValueError("Invalid bound: " + key)
        data[key] = value
    seeds = data.get("seeds", [])
    if not isinstance(seeds, list) or len(seeds) > 50:
        raise ValueError("Configure at most 50 seeds")
    data["seeds"] = [normalize_url(u, data["hosts"]) for u in seeds]
    return data


def crawl(store: Store, cfg: dict, trace_path: Path):
    # Frontier and attempts survive interruptions. Only the CLI admits new seeds.
    for url in cfg["seeds"]:
        store.db.execute("INSERT OR IGNORE INTO frontier VALUES(?,0,NULL,NULL)", (url,))
    store.db.commit()
    deadline, count = time.monotonic() + cfg["max_seconds"], 0
    while count < cfg["max_pages"] and time.monotonic() < deadline:
        row = store.db.execute("SELECT url,depth FROM frontier WHERE attempted_at IS NULL AND depth<=? ORDER BY depth,url LIMIT 1", (cfg["max_depth"],)).fetchone()
        if not row:
            break
        # Persist admission before the process starts; crash/restart never retries implicitly.
        with store.db:
            store.db.execute("UPDATE frontier SET attempted_at=?,reason='interrupted' WHERE url=?", (time.time(), row["url"]))
        result = collect(row["url"], cfg["hosts"], cfg["delay_seconds"], min(20, deadline - time.monotonic()))
        store.record(result); count += 1
        with store.db:
            store.db.execute("UPDATE frontier SET reason=? WHERE url=?", ("ok" if result["ok"] else result["reason"], row["url"]))
            if result["ok"] and row["depth"] < cfg["max_depth"]:
                for link in result["links"]:
                    if store.db.execute("SELECT count(*) FROM frontier").fetchone()[0] >= 500:
                        break
                    store.db.execute("INSERT OR IGNORE INTO frontier VALUES(?,?,NULL,NULL)", (link, row["depth"] + 1))
        with trace_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "url": row["url"], "ok": result["ok"],
                "reason": result.get("reason"), "requests": result["trace"]}, ensure_ascii=False) + "\n")
        print(json.dumps({"url": row["url"], "status": "indexed" if result["ok"] else result["reason"]}))
        time.sleep(min(cfg["delay_seconds"], max(0, deadline - time.monotonic())))


def serve(data_dir: Path, cfg: dict, port: int):
    key_path = data_dir / "service.key"
    if not key_path.exists():
        key_path.write_text(secrets.token_urlsafe(48), encoding="ascii")
        os.chmod(key_path, 0o600)
    key = key_path.read_text(encoding="ascii").strip()
    if len(key) < 32:
        raise ValueError("Service key too short")
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log authorization, queries or URLs from users.

        def send_json(self, status, obj):
            payload = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.headers.get("Host") != f"127.0.0.1:{port}" or self.path not in ("/", "/ui.js"):
                return self.send_json(404, {"error": "not_found"})
            file = Path(__file__).with_name("index.html" if self.path == "/" else "ui.js")
            payload = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8" if self.path == "/" else "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
            self.send_header("Cache-Control", "no-store")
            self.end_headers(); self.wfile.write(payload)

        def do_POST(self):
            self.connection.settimeout(5)
            local_ui = self.path in ("/local/search", "/local/fetch")
            if local_ui:
                # Public corpus UI is loopback only. Browser same-origin + exact
                # Host blocks hostile websites / DNS rebinding; no service key
                # is sent to or embedded in the browser. Never expose /local/*
                # or / through a deployment reverse proxy.
                if self.headers.get("Host") != f"127.0.0.1:{port}" or self.headers.get("Origin") != f"http://127.0.0.1:{port}" or self.headers.get("Sec-Fetch-Site") != "same-origin":
                    return self.send_json(403, {"error": "local_origin_required"})
            elif self.headers.get("Origin") or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + key):
                return self.send_json(401, {"error": "authentication_required"})
            path = self.path.removeprefix("/local") if local_ui else self.path
            if path not in ("/search", "/fetch"):
                return self.send_json(404, {"error": "not_found"})
            try:
                n = int(self.headers.get("Content-Length", "0"))
                if not 1 <= n <= 8192 or self.headers.get("Transfer-Encoding"):
                    raise ValueError()
                body = json.loads(self.rfile.read(n))
                if not isinstance(body, dict):
                    raise ValueError()
                store = Store(data_dir / "index.sqlite", cfg["fresh_hours"], cfg["hosts"])
                try:
                    if path == "/fetch":
                        url = normalize_url(body.get("url"), cfg["hosts"])
                        result = store.read(url)
                        return self.send_json(200 if result else 404, result or {"error": "not_in_index"})
                    query = body.get("query")
                    limit = body.get("maxResults", 5)
                    sources = body.get("sources", [])
                    if not isinstance(query, str) or not 2 <= len(query) <= 1024 or type(limit) is not int or not 1 <= limit <= 5 or not isinstance(sources, list) or len(sources) > 6 or not all(isinstance(s, str) and re.fullmatch(r"[a-z0-9.-]+", s) for s in sources):
                        raise ValueError()
                    return self.send_json(200, store.search(query, limit, sources))
                finally:
                    store.db.close()
            except Refusal as e:
                return self.send_json(404, {"error": str(e)})
            except (ValueError, TypeError, json.JSONDecodeError):
                return self.send_json(400, {"error": "invalid_request"})
            except (TimeoutError, OSError, sqlite3.Error):
                return self.send_json(503, {"error": "index_unavailable"})
    class BoundedServer(ThreadingHTTPServer):
        slots = threading.BoundedSemaphore(8)
        def get_request(self):
            conn, address = super().get_request()
            conn.settimeout(5)  # Includes incomplete headers, before do_POST.
            return conn, address
        def process_request(self, request, address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request)
                return
            try:
                super().process_request(request, address)
            except BaseException:
                self.slots.release()
                raise
        def process_request_thread(self, request, address):
            try:
                super().process_request_thread(request, address)
            finally:
                self.slots.release()
    print(f"Arty Index: http://127.0.0.1:{port} (read-only API; key file: {key_path})", flush=True)
    BoundedServer(("127.0.0.1", port), Handler).serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("example.json"))
    parser.add_argument("--data", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("crawl")
    sub.add_parser("serve").add_argument("--port", type=int, default=8789)
    sub.add_parser("refresh").add_argument("url")
    sub.add_parser("remove").add_argument("url")
    args = parser.parse_args(); cfg = config(args.config)
    args.data.mkdir(parents=True, exist_ok=True)
    if args.command == "serve":
        return serve(args.data, cfg, args.port)
    store = Store(args.data / "index.sqlite", cfg["fresh_hours"], cfg["hosts"])
    try:
        if args.command == "remove":
            store.remove(normalize_url(args.url, cfg["hosts"]))
        else:
            if args.command == "refresh":
                url = normalize_url(args.url, cfg["hosts"])
                with store.db:
                    store.db.execute("INSERT OR REPLACE INTO frontier VALUES(?,0,NULL,NULL)", (url,))
            crawl(store, cfg, args.data / "collection.jsonl")
    finally:
        store.db.close()


if __name__ == "__main__":
    main()
