# Privacy Policy — Arty

**Last updated:** May 22, 2026

**Publisher:** Florent Pollet, natural person, residing at 884 chemin de la Prairie, 38270 Beaufort, France. No business is registered to date; a SIREN identifier will be added to this policy upon registration of the activity, planned before the public launch and the first payments.
**Contact:** flotellop@gmail.com

Arty is a personal AI assistant (Android mobile app and web app at `tryarty.com`). This policy explains what personal data we process, for what purposes, on what legal grounds, with whom we share it, how long we keep it, and what your rights are.

## 1. Data controller

The data controller under the GDPR is Florent Pollet, natural person (contact details above). No Data Protection Officer (DPO) is designated, as the activity does not meet the criteria of GDPR Article 37.

## 2. Data we process

| Category | Data | Source |
|---|---|---|
| Authentication identity | Email, full name, profile picture | Google Sign-In (OAuth) |
| User content | Messages, files, and attachments you send to the assistant | You |
| Google Workspace data | Depending on the features used: sending emails (Gmail), reading and creating events (Calendar), contacts (Contacts) | Your Google accounts, on your explicit request |
| Location | Approximate geographic position | Your device's GPS sensor, only if enabled |
| Payment data | Email + transaction, no bank card details | You + Lemon Squeezy |
| Waitlist signup | Email (pre-launch only) | Tally form |

We do not track your browsing for advertising purposes and do not use any commercial profiling.

## 3. Purposes and legal grounds

| Purpose | Legal ground (GDPR Article 6) |
|---|---|
| Authentication and service provision (account, conversations, AI, Google connectors) | Performance of contract — your terms of use |
| Geolocated answers | Explicit consent (you enable location) |
| Payments (Pro subscription) | Performance of contract + legal accounting obligation |
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
| Lemon Squeezy (Stripe) | Pro subscription payment processing | United States | SCC + EU-US Data Privacy Framework, PCI-DSS compliance |
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

- **Encryption at rest on your device**: your conversations, attachments (IndexedDB), and personal API keys (BYOK) are encrypted with AES-256-GCM via the Web Crypto API. The encryption key is derived locally and never leaves your device.
- **Encryption in transit**: all communications use HTTPS (TLS 1.2+).
- **Server-side**: we only store your authentication email and the Google OAuth token required to deliver the service. Conversations, attachments, and personal API keys are never stored on our servers.
- **Server API keys**: never exposed to the client app. Stored as Cloudflare Workers secrets.

## 7. Local storage on your device

To operate, the app stores locally on your device (never sent server-side):

- **localStorage**: preferences (language, onboarding, plan), non-personal device identifier, hash of your email for reconnection, encrypted personal BYOK API keys, trial state.
- **sessionStorage**: Google OAuth state (CSRF protection), transient error messages.
- **IndexedDB**: encrypted attachments (images, PDFs, AES-256).

These storages are **strictly necessary to deliver the service** within the meaning of Article 82 of the French Data Protection Act (transposition of the ePrivacy directive) — they therefore do not require consent.

We use **no tracking or analytics cookies**. Loading our display fonts may trigger requests to `fonts.googleapis.com` (Google Fonts), which may set a third-party session cookie tied to Google; we plan to self-host these fonts before the public launch.

## 8. Data retention

| Category | Duration |
|---|---|
| Account (email + OAuth token) | As long as your account is active. Deletion within 30 days of your deletion request. |
| Conversations and attachments | Stored only on your device. Erased via "Sign out + erase" in the app. |
| Payment data | 10 years (legal accounting obligation, French Code of Commerce Article L123-22). |
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
