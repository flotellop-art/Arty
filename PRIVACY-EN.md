# Privacy Policy — Arty

**Last updated:** July 10, 2026

**Publisher:** Florent Pollet, natural person, residing at 884 chemin de la Prairie, 38270 Beaufort, France. No business is registered to date; a SIREN identifier will be added to this policy upon registration of the activity, planned before the public launch and the first payments.
**Contact:** flotellop@gmail.com

Arty is a personal AI assistant (Android mobile app and web app at `tryarty.com`). This policy explains what personal data we process, for what purposes, on what legal grounds, with whom we share it, how long we keep it, and what your rights are.

## 1. Data controller

The data controller under the GDPR is Florent Pollet, natural person (contact details above). No Data Protection Officer (DPO) is designated, as the activity does not meet the criteria of GDPR Article 37.

## 2. Data we process

| Category | Data | Source |
|---|---|---|
| Authentication identity | Email, full name, profile picture | Google Sign-In (OAuth) |
| User content | Messages, files, and attachments sent to the assistant; structured memory, shared conversations, and reports you voluntarily submit | You |
| Google Workspace data | Depending on the features used: sending emails (Gmail), reading and creating events (Calendar), contacts (Contacts) | Your Google accounts, on your explicit request |
| Location | Approximate geographic position | Your device's GPS sensor, only if enabled |
| Payment data | Account email, selected offer or pack, transaction identifiers and status; Arty receives no payment-card details | You + Lemon Squeezy or Creem |
| Waitlist signup | Email (pre-launch only) | Tally form |

We do not track your browsing for advertising purposes and do not use any commercial profiling.

## 3. Purposes and legal grounds

| Purpose | Legal ground (GDPR Article 6) |
|---|---|
| Authentication and service provision (account, conversations, AI, Google connectors) | Performance of contract — your terms of use |
| Geolocated answers | Explicit consent (you enable location) |
| Payments (Pro subscription and prepaid credit packs) | Performance of contract + legal accounting obligation |
| Fraud prevention and service security (technical logs, crypto kill-switch) | Legitimate interest |
| Pre-launch communication (waitlist) | Consent (voluntary signup) |

## 4. Sharing with third parties (sub-processors under GDPR Article 28)

Your data is shared, **strictly for the purposes above**, with the following providers:

| Provider | Role | Location | Safeguard |
|---|---|---|---|
| Cloudflare | Hosting Workers, Pages, KV (API proxy, non-sensitive key storage, site distribution) | EU + global (CDN) | Standard Contractual Clauses (SCC), Cloudflare DPA |
| Anthropic (Claude) | AI response generation | United States | SCC + EU-US Data Privacy Framework |
| OpenAI | AI response generation (depending on the selected model) | United States | SCC + EU-US Data Privacy Framework |
| Google (Gemini + Workspace) | AI response generation + Gmail/Calendar/Contacts connectors | EU + United States | SCC + EU-US Data Privacy Framework |
| Mistral AI | AI response generation | France (EU) | Direct EU hosting |
| Lemon Squeezy | Pro subscription payment processing | United States | SCC + EU-US Data Privacy Framework, PCI-DSS compliance |
| Creem | Merchant of Record and hosted checkout for prepaid credit packs. Arty sends the verified Google account email, selected product/pack, a random request ID, and the return URL. Payment-card details are entered directly with Creem and are not received by Arty. | Estonia (EU) | GDPR, Creem DPA; SCC for its sub-processors outside the EEA |
| Resend | Transactional email delivery (notifications, recaps) | EU | Resend DPA |
| Tally | Waitlist form (pre-launch) | EU | Tally DPA |

**No sharing for advertising purposes. No resale. No data brokerage.**

To request a copy of the SCC signed with any provider, contact `flotellop@gmail.com`.

## 5. Google API Services Compliance (Limited Use)

Arty's use of information received from Google APIs, and its transfer to any other app, complies with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements:

- access to your Google data is performed only to deliver the features you request;
- we do not use this data for advertising purposes;
- we do not sell it;
- we do not use it to train general-purpose AI models;
- no human accesses this data except with your explicit consent, for documented security reasons, or when required by law.

## 6. Security

- **Encryption at rest on your device**: your conversations, attachments (IndexedDB), and generated reports are encrypted with AES-256-GCM via the Web Crypto API. The encryption key is derived locally and never leaves your device.
- **Personal API keys (BYOK)**: they are stored locally in your device's application storage without additional application-level encryption. They pass through Arty's Cloudflare API proxy only to relay your requests to the provider's API; Arty neither stores nor logs them server-side.
- **Encryption in transit**: all communications use HTTPS (TLS 1.2+).
- **Server-side processing**: Google tokens and BYOK keys are processed in transit to authenticate or relay a request, without being persisted or logged by Arty. Persisted data is limited to email identities and sessions, structured memory you explicitly save, shared conversations and reports you voluntarily submit, billing/wallet data, and technical quota and usage counters, subject to the retention periods in Section 8.
- **Server API keys**: never exposed to the client app. Stored as Cloudflare Workers secrets.

## 7. Local storage on your device

To operate, the app keeps the following data locally. Except for the transient BYOK-key relay described above, these items are not sent server-side:

- **localStorage**: preferences (language, onboarding, plan), non-personal device identifier, hash of your email for reconnection, personal BYOK API keys without application-level encryption, encrypted generated reports, trial state.
- **sessionStorage**: Google OAuth state (CSRF protection), transient error messages.
- **IndexedDB**: encrypted attachments (images, PDFs, AES-256).

These storages are **strictly necessary to deliver the service** within the meaning of Article 82 of the French Data Protection Act (transposition of the ePrivacy directive) — they therefore do not require consent.

We use **no tracking or analytics cookies**. Loading our display fonts may trigger requests to `fonts.googleapis.com` (Google Fonts), which may set a third-party session cookie tied to Google; we plan to self-host these fonts before the public launch.

## 8. Data retention

| Category | Duration |
|---|---|
| Email identities and sessions, structured memory, shared conversations, and submitted reports | As long as your account is active. These data are deleted when you submit a deletion request (within 30 days at the latest). |
| Conversations, attachments, and reports | Stored only on your device and encrypted. A simple sign-out keeps them for your next sign-in. Deleting a conversation erases its attachments; deleting the account erases all of this data. |
| Payment data | 10 years (legal accounting obligation, French Code of Commerce Article L123-22). |
| Minimal technical usage, quota, and anti-abuse counters | Retained only for as long as strictly necessary for security, abuse prevention, and billing integrity. They contain none of your conversation content. |
| Server-side technical logs (Cloudflare Workers, anti-abuse) | 12 months maximum. |
| Waitlist email (pre-launch) | Until app launch + 12 months, or until unsubscription, whichever comes first. |
| Content transmitted to AI providers | Not stored on our servers beyond request processing. Retention by the provider follows their own policy (Anthropic 30 days, OpenAI 30 days, Google varies, Mistral 30 days). |

## 9. Your rights (GDPR)

You have the following rights over your personal data:

- **Access**: obtain a copy of your data.
- **Rectification**: correct inaccurate data.
- **Erasure** ("right to be forgotten"): delete your data.
- **Restriction**: temporarily limit processing.
- **Objection**: oppose processing based on legitimate interest.
- **Portability**: receive your data in a structured format.
- **Withdraw consent**: at any time, without retroactive effect.

To exercise your rights: `flotellop@gmail.com`. Response within 30 days maximum.

**Right to lodge a complaint**: if you believe your rights are not respected, you may lodge a complaint with the French Data Protection Authority (CNIL): [www.cnil.fr/en/plaintes](https://www.cnil.fr/en/plaintes), or with the supervisory authority of your EU country of residence.

## 10. Minors

Arty is not intended for individuals under 16 years of age in France, nor under 13 years of age in COPPA jurisdictions (United States). If you discover that a minor has created an account, please write to `flotellop@gmail.com` and the account will be deleted.

## 11. Changes to this policy

This policy may evolve. Any substantial change will be notified to you by email at least **30 days before it takes effect**. The last-updated date is shown at the top of this page. Archived versions of previous policies are available on request at `flotellop@gmail.com`.
