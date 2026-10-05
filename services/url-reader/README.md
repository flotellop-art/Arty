# Arty hosted page reader

Private Cloudflare Worker with Browser Run, called only through Arty Pages'
`URL_READER` service binding. No user browser, PC companion, cookie import,
account login, CAPTCHA solving, or page interaction is involved.

## Runtime and integration

`POST /api/fetch/url` authenticates the existing Arty identity. For public HTML,
when `URL_READER_ENABLED` is exactly `true` AND a new client explicitly sends
`readerPolicy:"public-browser"`, it sends only the URL and a SHA-256
hash of the verified email to this private service. Legacy `{url}` payloads
remain on Linkup, including old APKs in EU-only conversations. The browser receives only
the URL. PDFs and client `readerPolicy:"eu-only"` use the legacy Linkup route.
No processing-region guarantee is newly asserted for that legacy route.

The default server profiles cover example.com, quotes.toscrape.com,
English/French Wikipedia, and the canonical Reddit site. Domains outside a
profile use the legacy reader, before any browser acquisition. Add reviewed
exact navigation/resource hosts to `READER_PROFILES` in wrangler.toml to
support another site. Users, page content and models cannot supply profiles.
No alternate reader is invoked after a browser refusal, timeout or rate limit.

Reads follow redirects in the same browser session and original deadline.
The current main-document response is tied to its request, and CDP loader IDs
attest that its document has committed before extraction. A navigation or URL
change invalidates an extraction in progress. Context loss is recoverable only
when a main navigation was observed during that extraction; no URL is reloaded.
This does not guarantee that a page will never navigate again after a read.

Failures expose only closed reason/stage codes and a validated upstream HTTP
status. The gateway, client tool and terminal Claude response preserve those
observations. A DOM network-security refusal differs from a plain HTTP refusal,
a Cloudflare guardrail and an internal reader error. Raw exceptions, sessions,
HTML and challenge query parameters are not forwarded. Reddit's security rule
can still refuse this browser; neither the code nor its diagnostics bypass it.

The original `markdown` field stays compatible. A browser receipt additionally
records provider, request and final URL, timestamp, anonymous access, HTTP
status, truncation and omissions. The final URL omits query/fragment; requested
URLs remain in the chat to identify the requested source. Generic extraction
does not attest that comments are absent. Reddit extraction requires the exact
requested post ID, its visible title and its own visible text body; image-only,
removed or missing post bodies are unreadable. No image or comment analysis.

Anthropic's native reader still runs first. This service helps its fallback,
and tools using the common endpoint. A title-only native success remains an
existing limitation; the backend checks do not certify every native read.

## Limits and network boundaries

One singleton SQLite Durable Object admits all plans:100 attempts per UTC day,
20 per identity per UTC day, two concurrent admitted sessions. Attempts count
even if a page is blocked. Busy requests are refused, never queued or retried.
Three simultaneous client requests may therefore include one busy result.
Cloudflare account-wide acquisition/concurrency limits remain independent;
the configured counts are not a dollar-denominated spending guarantee.

The operation has a20-second deadline plus up to3 seconds waiting for cleanup.
Cloudflare's default60-second **inactivity** timeout is not a maximum lifetime.
The slot is released only when the binding reports `closeSession.status=closed`
or `getSession=null`. Puppeteer's adapter can swallow close errors, so its
`browser.close()` promise alone is insufficient. A failed closure,
pending acquisition or crash leaves a conservative orphan slot with no timed
release. Completion stays registered in `ctx.waitUntil` (up to30 seconds after
the response); a late closure attestation releases its lease. Operators can
POST `/reconcile` through a private operator service binding:it releases only
known session IDs which `getSession` attests absent. Live/unknown leases remain
retained. It never closes unrelated account sessions. Do not delete
DO storage or reset admission merely because a timer elapsed. Two unknown slots
stop this service until reconciliation. A late acquisition is still closed.
Client Stop propagates its signal but instantaneous remote closure is not
guaranteed without a real cancellation observation.

Browser Run guardrails allow only fixed server hosts across HTTP/HTTPS
requests. They do not constitute DNS/IP attestation. The browser runs without
Arty DB, model keys, tokens, history or conversation text. No outbound/private
network Worker is configured. Interception additionally restricts page
requests to HTTPS GET/HEAD and blocks foreign navigation, media and fonts.
CDP blocks ws/wss/file/ftp; initialization disables common worker/WebRTC/socket
APIs and closes popups. This is defense in depth, not an attestation that a
hostile site cannot start another browser context. Fixed profiles are the
network authority; do not replace them with arbitrary user-supplied domains.

## Provisioning

1. `npm ci` in this directory; `npm run typecheck && npm run build`.
2. `npm run deploy` creates the private Worker and the SQLite DO migration.
   `workers_dev=false` and `preview_urls=false`:no public route is created.
3. On the selected Arty **preview** environment, add service binding
   `URL_READER` → `arty-url-reader` and variable `URL_READER_ENABLED=true`.
   Redeploy the preview for configuration to take effect.
4. Test authenticated Arty reads of static HTML, JavaScript content and the
   exact Reddit link. A correctly reported Reddit refusal is a valid negative
   test, not a successfully read post. Do not promote automatically to main.

Rollback:remove/set false the Pages flag and redeploy that environment. The
legacy reader resumes. Keep the private Worker idle unless it is intentionally
removed after all sessions have closed. No recurring job or cron is installed.

Tests under `src/__tests__` cover extraction, gateway/policy, browser lifecycle
and real local workerd SQLite admission. They are not cloud browser evidence.
CI also typechecks and bundles this isolated Worker without deployment.

Primary docs consulted4 October2026:
[Browser Run Puppeteer](https://developers.cloudflare.com/browser-run/puppeteer/),
[guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/),
[limits](https://developers.cloudflare.com/browser-run/limits/),
[Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/).
