# Hosted Arty reader —4 October2026

Developed on `codex/arty-browser-reader`, based on the URL recovery candidate
`ad74c403bcc04c7c158ab0bcba5d585030a58cc7` (draft PR514).
The earlier study/prototype branch is preserved separately.

## Delivered implementation

- Private Cloudflare Worker `arty-url-reader`, Browser Run with fixed exact
  server profiles, visible-text extraction and structured read receipts.
- Shared authenticated `/api/fetch/url` integration. Explicit new-client
  `public-browser` opt-in; legacy clients, EU-only policy and PDFs retain the
  legacy route. No new claim about EU processing geography.
- Server admission for every plan:100 admitted attempts/day globally,
  20/identity/day and two concurrent slots. No retry after site refusal.
-20-second operation deadline, attested closure via binding API, retained
  uncertain leases, completion via waitUntil and private reconciliation.
- Real-provider labels and omissions in model context; no claim of complete
  page/image/comment reading. Exact Reddit post body required.

## Real cloud observations

Invoked the **deployed private Worker** through a temporary remote development
proxy bound to that service. These are anonymous Browser Run reads, not the
previous logged-in desktop browser experiment.

| URL | Cloud observation | Approx.elapsed | Version |
|---|---|---:|---|
| `https://example.com/` | `read`, HTTP200, title Example Domain,921chars |3.596s |`3b287839-3eb0-46d8-a21a-827d64113f62`|
| `https://quotes.toscrape.com/js/` | initial `missing_body`:span text omitted; corrected from this observation |17.365s |same|
| exact Reddit post `1vqo6kl` | `unreadable/navigation_failed`; no extracted body |1.103s |same|
| JS page after span correction | `read`, HTTP200,1095chars; expected rendered quote anchor found |2.349s |`bc117ca8-1e05-4d05-b5f0-86f1865d1657`|
| JS page after early lifecycle retention | `read`, HTTP200,1095chars, anchor found; no retained leases |approximately2.3s |`d4c7e4f9-9a2a-4682-bc91-f6da5a0981c3`|

Private reconciliation after these runs returned `released:0, retained:0`:
the service had no outstanding admission leases after its normal cleanup.
This does not attest the absence of unrelated browsers in the Cloudflare
account or instantaneous remote closure after a client Stop.

No full scraped content, user cookies, account headers or private sidebar
content are saved as evidence. Timing is one observation per case, not a
success-rate or latency percentile. The Reddit failure is unresolved; the
cloud browser is not a guarantee against site blocking or login requirements.

## Validation boundaries

Local tests exercise exact-post extraction, wrong generic redirects, hidden
or absent bodies, login/interstitial, JS span extraction, gateway identity
and opt-in, EU/legacy/PDF compatibility, no-retry semantics and lifecycle.
The quota test uses real local workerd SQLite with concurrent requests.
Those tests validate decisions, not cloud provider accuracy.

Worker TypeScript and Cloudflare dry-run bundling pass. Frontend/functions
TypeScript and Vite production build pass. Final focused campaign:97 tests
passed across12 files, maxWorkers2/no file parallelism. Additionally, both
URL-fetch admission failure tests pass in the real workerd D1 suite. A broader
local D1 campaign was interrupted before completion; it is not counted as a
pass or a product failure. CI includes a new isolated Worker build job.
The source integrates OpenAI fetch_url and Anthropic's failure recovery;
Anthropic's native title-only-success branch remains an existing limitation.

The private Worker has been deployed. Arty production activation and real
phone end-to-end verification are separate from those cloud reader runs.
Arty Pages `appfacade` preview is provisioned with service binding `URL_READER`
and `URL_READER_ENABLED=true`. API read-back confirmed production configuration
and existing preview variables unchanged. A new preview deployment is required
to use this configuration. Production has no reader binding/flag.

Runtime/provisioning/rollback: [service README](../services/url-reader/README.md).
