# Cahier des charges Cowork — le restant après l'audit du 3 juillet 2026

**Pour qui** : une session Claude Cowork / Claude Code fraîche, sans le contexte
de la session d'audit. Chaque chantier ci-dessous est autonome : contexte,
état actuel (file:line), spec, pièges connus, critères d'acceptation.

**Références** : rapport d'audit `docs/audits/repo-audit-2026-07-03.md` (les
identifiants F-x renvoient à ses findings), CDC de remédiation
`repo-audit-2026-07-03-cdc.md` (ce qui a DÉJÀ été corrigé en PR #307 — ne pas
refaire), et `CLAUDE.md` (RÈGLES 0-7 + journal des 60+ bugs, à lire d'abord).

## État d'avancement (MAJ 5 juillet 2026 — contre-audit Fable : code relu, CI verte sur HEAD, prod sondée)

- ✅ **C1** FAIT (PR #309) — aud validé sur peek/checkAllowedUser, fail-safe natif, 9 tests.
- ✅ **C2** ENTIÈREMENT CLOS le 5 juillet : front (PR #313), ops vérifié en prod
  (sonde → `403 captcha_failed`), et volet code fail-closed FAIT (décision
  Florent) — gate 503 sur `request-otp` si host prod sans `TURNSTILE_SECRET_KEY`
  (détection par hostname `PRODUCTION_HOSTS`, PAS `CF_PAGES_BRANCH` non garanti
  au runtime), test de parité CI `PRODUCTION_HOSTS` ⇄ `ALLOWED_ORIGINS`.
  Relecture 2 agents (Opus sécu + Sonnet régressions) : GO. Résiduel ops à
  vérifier au dashboard : le binding D1 des previews est-il partagé avec la
  prod ? (si oui, previews fail-open = spam OTP possible sur les tables prod,
  borné par les rate-limits).
- ⛔ **C3** — go-live Creem uniquement (inchangé).
- ✅ **C4** FAIT (commit `1426275`) — TODO re-daté, `parseAllowedEmails` conservée.
- ✅ **C5** FAIT (PR #310) — PKCE S256, single-use, natif intact. Test terrain web à tracer.
- ⬜ **C6** — non commencé (le plus gros, à planifier seul).
- ✅ **C7** FAIT (PR #316 + `d1d4968`) — READ_MEDIA_AUDIO/VIDEO retirées ;
  MODIFY_AUDIO_SETTINGS RÉTABLIE après test APK KO (getUserMedia WebView exige
  cette permission — commentaire d'usage dans le manifest, ne pas re-retirer).
- ✅ **C8** FAIT (PR #311) — harnais Miniflare D1 réel, 4 zones couvertes, en CI.
- ✅ **C9** FAIT (PR #312) — `aiHttp.ts`, 4 clients migrés, SSE hors périmètre (voulu).
- ⬜ **C10** — non commencé.
- ⬜ **C11** — opportuniste (inchangé).
- ⛔ **C12** — non commencé, décision requise (Option A recommandée).
- ✅ **C13** FAIT (PR #314) — timeouts Google, allowlist relay, clamp trial.
  Rate-limit auth DÉFÉRÉ avec justification (IP partagées) ; eslint non adopté.
- ⬜ **C14** — déclencheur (abus dictée) non atteint.

## Règles d'exécution (toutes sessions)

1. **Un chantier = une PR dédiée.** Jamais deux chantiers à risque dans la
   même PR (discipline actée au CLAUDE.md après les incidents auth).
2. **Avant tout push** : `npm run typecheck` (src + functions) ET `npm test`
   verts (BUG 13 — les erreurs TS cassent le déploiement en silence).
3. **RÈGLE 6** : tout endpoint créé/modifié passe l'audit 5 points
   (auth / autorisation / abus infra / leak / Origin-CSRF) dans le message final.
4. **RÈGLE 7** : chantier non trivial → ≥2 agents relecteurs (Sonnet minimum,
   Opus pour la sécu), qui ne modifient jamais le code.
5. Tout nouveau tool LLM DOIT être classé dans le test de parité HITL
   (`src/__tests__/services/toolConfirmation.test.ts`) — sinon CI rouge, c'est voulu.
6. Les chantiers marqués **⛔ décision requise** ne se codent PAS sans réponse
   écrite de Florent.

---

## P0 — Sécurité / bloquants

### C1 (F-9) — Validation `aud` sur les chemins « peek » — PR sécu dédiée
**Effort** : ~2-3 h + test terrain. **Risque** : ÉLEVÉ (gate d'auth universel).

**État actuel** : `verifyGoogleUser(request, expectedAud?)`
(`functions/api/_lib/checkAllowedUser.ts:14-74`) valide l'audience via
`tokeninfo` UNIQUEMENT quand `expectedAud` est fourni. Tous les endpoints qui
dépensent la clé IA owner le passent déjà (proxys via `resolveProxyIdentity`,
tts, image-gen, memory-extract, whisper, voxtral, checkout, trial/init,
subscription/status — vérifié le 3 juillet). Restent SANS validation d'aud :
`checkAllowedUserPeek` (`checkAllowedUser.ts:252`) et `checkAllowedUser`
(`:270`), utilisés par `search/web.ts:61` et `fetch/url.ts:52` (qui dépensent
les clés Linkup/Brave du owner), `ai/quota/*`, `browser/weather.ts` (gratuit,
open-meteo), `geo/reverse.ts` (cappé 100/j).

**Spec** : durcir le HELPER lui-même, pas appelant par appelant — faire de
`expectedAud` un paramètre obligatoire (ou le résoudre depuis
`env.GOOGLE_CLIENT_ID` en interne), rejeter si
`aud !== GOOGLE_CLIENT_ID && azp !== GOOGLE_CLIENT_ID`.

**Pièges** :
- ⚠️ Les tokens natifs issus de `requestServerAuthCode` (BUG 21/51) peuvent
  avoir un `aud`/`azp` différent du client_id web. TESTER OBLIGATOIREMENT sur
  APK réel (login natif → recherche web, météo, quota) ET sur web AVANT merge.
- `verifyTokenViaTokeninfo` existe déjà dans le fichier — réutiliser.
- Ne pas casser le chemin email-trial (`x-arty-trial-token`) qui ne passe pas
  par Google.

**Acceptation** : un access_token Google valide mais émis pour une autre app
(audience étrangère) est rejeté sur `search/web` et `fetch/url` ; login +
recherche web fonctionnent sur web ET sur APK ; tests unitaires du helper
(mock tokeninfo) ajoutés.

### C2 (F-10) — Turnstile : vérif ops + fail-closed en production
**Effort** : 15 min ops + ~1 h code. **⛔ décision requise** sur le volet code.

**État actuel** : `verifyTurnstile` (`functions/api/_lib/emailTrial.ts:287-292`)
retourne `true` si `TURNSTILE_SECRET_KEY` n'est pas configurée (fail-open
assumé). Si la clé manque en prod, un botnet multi-IP peut faire envoyer des
emails « code Arty » à des adresses arbitraires (coût Resend + réputation du
domaine `EMAIL_FROM`), le rate-limit email/jour (5) et IP/heure (10) ne
bornant pas la diversité de destinataires.

**Spec** : (a) OPS — vérifier dans le dashboard Cloudflare que
`TURNSTILE_SECRET_KEY` est posée en production ; (b) CODE (si Florent valide) —
fail-closed conditionnel : si l'environnement est la prod (`env.CF_PAGES_BRANCH
=== 'main'` ou heuristique équivalente documentée) et que la clé manque,
refuser `request-otp` avec 503 + `console.error` explicite, au lieu d'accepter.

**Acceptation** : impossible d'envoyer un OTP sans challenge Turnstile en prod ;
les previews/dev restent fonctionnels sans clé ; test unitaire du gate.

### C3 (F-33) — Go-live Creem : IDs produits LIVE
**Effort** : 30 min. **⛔ à faire uniquement au lancement commercial.**

**État actuel** : `checkout/creem.ts:34` et `webhook/creem.ts:29` contiennent
l'ID produit TEST `prod_5ba1P24WLXkcXUnbZytWm7` (TODO `⚠️ go-live` en place).
Fail-closed : l'environnement test/live est dérivé du préfixe de la clé
(`creem_test_` / `creem_live_`) — mais une clé LIVE + ces IDs TEST = checkout
cassé ou mal crédité.

**Spec** : au go-live, remplacer les IDs dans les DEUX fichiers par les IDs
produits du dashboard Creem LIVE (mêmes montants), tester un achat réel de
bout en bout (checkout → webhook → crédit wallet visible dans l'app).

**Acceptation** : achat test en LIVE crédité correctement ; idempotence
webhook vérifiée (rejouer l'event = pas de double crédit).

### C4 (F-27) — TODO Lemon Squeezy expiré — statuer
**Effort** : 15 min. **⛔ décision requise.**

**État actuel** : `functions/api/_lib/checkAllowedUser.ts:135` — « TODO
Supprimer en juillet 2026 après validation en prod du flux Lemon Squeezy »,
au-dessus de `parseAllowedEmails`. L'échéance est atteinte.

**Spec** : demander à Florent si le flux LS est validé en prod. Si oui,
exécuter ce que le TODO visait réellement (lire le contexte git du commit qui
l'a introduit pour lever l'ambiguïté — le TODO est mal placé et pourrait viser
un autre bloc) ; si non, re-dater le TODO explicitement. Ne PAS supprimer
`parseAllowedEmails` (utilisée partout + testée depuis PR #307).

---

## P1 — Chantiers sécurité / robustesse

### C5 (F-11) — PKCE sur le flow OAuth Google web
**Effort** : ~2 h (plan validé au CLAUDE.md, confiance 80 %). **Risque** : zone
OAuth à double callback.

**État actuel** : AUCUN PKCE. `buildOAuthUrl()` (`src/services/googleAuth.ts:101-119`)
est synchrone, n'émet ni `code_challenge` ni `code_challenge_method` ;
`functions/api/auth/token.ts:18-24` ne forwarde pas de `code_verifier`.
Le `state` CSRF, lui, est correct (192 bits, single-use, vérifié au SEUL
endroit `OAuthCallback.tsx:32` — BUG 53 : ne PAS ajouter de second point de
vérification).

**Spec** :
1. `buildOAuthUrl()` devient async : générer `code_verifier` (43-128 chars,
   `crypto.getRandomValues`), le stocker en `sessionStorage` (comme le state),
   calculer `code_challenge = base64url(SHA-256(verifier))`, ajouter
   `code_challenge` + `code_challenge_method=S256` à l'URL.
2. `OAuthCallback.tsx` : lire le verifier (single-use, clear après lecture —
   MÊME piège que BUG 53 : un seul point de consommation).
3. `functions/api/auth/token.ts` : accepter `code_verifier` dans le body et le
   forwarder à `oauth2.googleapis.com/token`.
4. Le chemin NATIF (`serverAuthCode` échangé côté serveur, `redirect_uri: ''`)
   ne passe pas par ce flow — vérifier qu'il reste intact (BUG 2 : tester
   `redirect_uri === undefined/null`, pas falsy).

**Acceptation** : login Google web complet (desktop + PWA Android Chrome) avec
PKCE actif (vérifier `code_challenge` dans l'URL d'autorisation) ; login natif
APK inchangé ; refresh de page pendant le flow ne casse pas (state + verifier
persistés en sessionStorage — BUG 24) ; tests du callback.

### C6 (F-34) — Chiffrement : `CryptoKey` non-extractible en IndexedDB
**Effort** : ~1-2 jours. **Risque** : ÉLEVÉ (migration de données chiffrées).
**Priorité rehaussée** : le blob critique protégé aujourd'hui par la
passphrase PUBLIQUE `'server-provided'` est le **refresh_token Google**
(accès persistant Gmail/Drive/Calendar), pas seulement les conversations.

**État actuel** : `src/services/crypto.ts` — PBKDF2(600k) sur une passphrase
qui, pour tout user sans BYOK, est la constante publique `'server-provided'`
(`src/App.tsx:853,913,943,1071`), sel global `arty-crypto-salt` stocké à côté.
Fragilité multi-comptes documentée : `listEncryptedKeys()` (`crypto.ts:67-76`)
scanne tout le localStorage sans scoping user ; KEY_CHECK/version globaux.

**Spec cible** (déjà cadrée au CLAUDE.md) : générer une clé AES-GCM via
`crypto.subtle.generateKey({name:'AES-GCM',length:256}, /*extractable*/ false,
['encrypt','decrypt'])`, la stocker en IndexedDB (structured clone d'une
CryptoKey non-extractible), une clé PAR user scopé. Supprime
passphrase/PBKDF2/sel ET la classe de bugs de rotation (BUG 43/47/48).

**Pièges** :
- Migration : déchiffrer les blobs existants avec l'ancienne clé dérivée puis
  re-chiffrer avec la nouvelle. JAMAIS de wipe sur échec de déchiffrement
  (règle absolue depuis BUG 47) — garder le blob et retenter.
- `saveConversation` DOIT rester synchrone (BUG 16) — conserver le pattern
  cache mémoire + write-through.
- Tout state React dépendant d'une valeur chiffrée attend l'event
  `'*-storage-ready'` (BUG 43) — ne pas changer ce contrat.
- Killswitch : garder un flag type `arty-conv-encryption-disabled`.
- Tester le multi-comptes (switch A→B→A) et l'update d'app (reload à froid).

**Acceptation** : round-trip complet en navigateur réel (login → tokens+convs
chiffrés → reload → tout se déchiffre) ; switch multi-comptes sans corruption ;
migration depuis l'ancien format vérifiée avec des données réelles ; aucun
wipe possible sur échec ; tests unitaires du module.

### C7 (F-28) — Permissions Android sur-déclarées
**Effort** : ~1 h + build APK + test terrain. **Exige un appareil/émulateur.**

**État actuel** : `android/app/src/main/AndroidManifest.xml` déclare
`READ_MEDIA_AUDIO`, `READ_MEDIA_VIDEO`, `MODIFY_AUDIO_SETTINGS` sans usage
identifié dans le code (`RECORD_AUDIO` seul couvre le micro/Whisper).

**Spec** : retirer les 3 permissions, builder l'APK, tester sur appareil :
micro/dictée (BUG 44/46), caméra + pièce jointe image, partage de fichier,
notifications. Si une feature casse, documenter laquelle et remettre UNIQUEMENT
la permission nécessaire avec un commentaire d'usage.

**Acceptation** : APK testé avec la liste de permissions minimale ; checklist
de `BEFORE-PUBLISHING.md` §8 mise à jour (la case « permissions sur-déclarées »
existe déjà).

### C8 (F-5 extension) — Tests d'intégration `functions/` (D1 réel)
**Effort** : ~1 jour (setup miniflare inclus).

**État actuel** : 24 tests unitaires existent depuis PR #307
(`src/__tests__/functions/` : parseAllowedEmails, signatures webhooks,
validation d'entrées contacts/wordpress). ZÉRO test sur la logique D1 :
`consumeCapAtomic` (`checkPremiumCap.ts:176-184`), `resolveUserPlan`/gating
par plan, flux OTP complet (`emailTrial.ts`), atomicité wallet
(réserve/settle/void, `wallet.ts`).

**Spec** : introduire `@cloudflare/vitest-pool-workers` (ou miniflare) pour
exécuter les tests contre un D1 réel en mémoire. Prioriser : (1)
`consumeCapAtomic` — 2 appels concurrents ne dépassent jamais le cap ; (2)
OTP — single-use (`DELETE…RETURNING`), 5 tentatives max, rate-limits
fail-closed ; (3) wallet — réserve puis settle/void, jamais de solde négatif,
idempotence `webhook_event` ; (4) `resolveUserPlan` — matrice plan × modèle
(free/trial/pro=BYOK/subscription/vip).

**Acceptation** : suite exécutable en CI (l'ajouter à `ci.yml` si le runtime
workers y tourne) ; les 4 zones couvertes ; aucun test tautologique (assertions
sur l'état D1 réel après coup).

### C9 (F-20) — Helper commun des clients IA
**Effort** : ~½ journée. **Risque** : MOYEN (touche le streaming).

**État actuel** : `anthropicClient.ts`, `mistralClient.ts`, `geminiClient.ts`,
`openaiClient.ts` réimplémentent chacun : AbortController+timeout, header
`x-google-token` via `getValidAccessToken()` (BUG 23), garde
`apiKey !== 'server-provided'` (BUG 25), parsing SSE. BUG 23/25 ont dû être
corrigés 4 fois ; la RÈGLE 3 impose de recopier le pattern pour chaque
nouveau modèle.

**Spec** : extraire `src/services/aiHttp.ts` (nom libre) avec :
`buildAiHeaders({byokKey, extra})` (google-token + gardes),
`fetchWithTimeout(url, init, ms)`. NE Pas unifier le parsing SSE dans un
premier temps (les 3 formats diffèrent trop — Anthropic a des contraintes
strictes BUG 52 : ne JAMAIS filtrer les blocs vides). Migrer les 4 clients
appel par appel, en vérifiant à chaque étape que la suite de tests passe
(mistralClient et aiRouter ont des tests).

**Acceptation** : plus aucune duplication du trio timeout/google-token/garde
server-provided ; 525+ tests verts ; streaming vérifié en réel sur les 4
providers (skill /verify ou test manuel documenté).

---

## P2 — Qualité / perf / polish

### C10 (F-29) — Bundle : chunk principal 696 kB
**Effort** : ~½ journée. `jspdf` (390 kB) et `markdown` (513 kB) sont DÉJÀ
code-splittés — le travail porte sur `index-*.js` (696 kB pré-gzip).
**Spec** : `npx vite-bundle-visualizer` (ou rollup-plugin-visualizer) pour
identifier les gros contributeurs ; lazy-import les écrans secondaires
(costs, compare, templates, upgrade sont déjà séparés — viser SettingsModal,
i18n locales, services lourds non critiques au boot). Budget cible : < 450 kB
pré-gzip pour le chunk principal, sans casser le cold-start Capacitor.
**Acceptation** : mesure avant/après documentée, app testée (boot web + APK).

### C11 (F-26) — God files
**Effort** : itératif. `InputBar.tsx` (1524 l.), `App.tsx` (1094 l.),
`SettingsModal.tsx` (888 l.), `useConversation.ts` (872 l.), `Sidebar.tsx`
(802 l.). **Spec** : découper OPPORTUNISTEMENT (quand on touche un fichier
pour une feature, extraire les sous-composants/-hooks du périmètre touché).
Pas de big-bang. La régression a11y F-17 a été trouvée dans Sidebar.tsx :
c'est le coût concret de ces fichiers.

### C12 (F-31) — Login local email+mot de passe
**Effort** : ~2 h. **⛔ décision requise** (2 options).
**État actuel** : `LoginScreen.tsx:114-129` — `SHA-256(password+email)` non
salé, stocké en clair, gate UI de sélection de compte (ne protège aucun
chiffrement). **Option A (recommandée)** : assumer que ce n'est pas une
frontière d'auth — renommer/documenter (« verrou d'écran local »), pas de
migration. **Option B** : PBKDF2+sel — exige une migration des hashes
existants (re-prompt du mot de passe au prochain login).

### C13 — Petits durcissements LOW (regroupables en 1 PR)
- **Timeout serveur→Google** : les `fetch` vers les API Google dans
  `functions/api/{gmail,drive,calendar,contacts,sheets}/…` n'ont pas
  d'AbortController — ajouter un timeout 15-30 s (pattern BUG 47).
- **Relay computer-use** : allowlist d'actions dans
  `functions/api/computer/relay.ts:44-71` (défense en profondeur — le serveur
  local est déjà durci, commit `125dcd1`).
- **Trial counter backend** : clamp explicite dans `trial/init.ts:51-52`
  (le client est déjà protégé).
- **Rate-limit dédié** sur `auth/token`, `auth/refresh`, `license/activate`
  (D1, pattern `otp_rate`) — exploitabilité quasi nulle, hygiène.
- **eslint (optionnel)** : si adopté, config minimale + step CI ; les 17
  directives orphelines ont été purgées en PR #307, ne pas en réintroduire
  sans lint réel.

### C14 (V-2, CLAUDE.md) — Quota transcription en secondes d'audio
**Déclencheur** : SI la vigie whales montre un abus de dictée (sinon ne pas
faire). `consumeDailyQuota` compte les appels ; Voxtral/Whisper facturent à la
minute. Fix : quota journalier en `audio_seconds` (colonne déjà présente dans
`quota_model`), gate avant forward dans les 2 proxys.

---

## Ops (Florent, hors code — rien à coder)

1. **`TURNSTILE_SECRET_KEY`** posée en prod Cloudflare ? (cf. C2).
2. **Retirer `GOOGLE_VISION_API_KEY`** du dashboard Cloudflare (config morte,
   BUG 14/15) puis supprimer la ligne de `functions/env.d.ts`.
3. **Vérifier la possession des domaines** listés dans `ALLOWED_ORIGINS`
   (`functions/api/_middleware.ts:5-13`, notamment `arty.pages.dev`,
   `app.arty.fr`) — un domaine expiré = bypass Origin/CSRF.
4. **Routine mensuelle** : quotas des 3 API Google (Gmail/Drive/Calendar) —
   facturation GCP confirmée active le 12 juin.

## Chantiers pré-existants (hors audit — déjà tracés au CLAUDE.md, rappelés ici)

- **Sortir Google Auth du RC codetrix** → `@capawesome/capacitor-google-sign-in`
  (option A actée). RISQUE ÉLEVÉ, zone BUG 21/26/27/51, test APK réel
  obligatoire, PR strictement dédiée.
- **Identité user : email → `sub` Google** — ne lancer qu'avec un plan de
  migration D1 explicite (orpheline les lignes existantes sinon).
- **a11y** : vérification visuelle APK + PWA que les contrastes remontés ne
  rendent pas le design « trop dur » (reliquat du fix du 12 mai).

## Anti-objectifs (ne pas faire)

- Ne PAS réintroduire : `VITE_*_API_KEY`, `wrangler.toml`/`_redirects` racine,
  fichiers de config Netlify/Vercel, `code_execution` dans TOOLS (BUG 10),
  Service Worker sur natif (BUG 45), wipe de ciphertext sans `selfTestCrypto`
  (BUG 47).
- Ne PAS « nettoyer » les blocs SSE Anthropic vides (BUG 52).
- Ne PAS toucher aux IDs Creem avant le go-live réel (C3).
- Ne PAS implémenter une feature listée en « Anti-objectifs » du plan produit
  (`docs/audits/competitive-audit-2026-06-actions.md`) sans décision écrite.

## Ordre recommandé

C4 (15 min, débloque) → C2 (ops+code) → C1 (PR sécu) → C5 (PKCE) → C8 (tests
D1) → C7 (Android, quand un appareil est dispo) → C9 → C6 (le plus gros, à
planifier seul) → C13 → C10/C11/C12 au fil de l'eau. C3 au go-live uniquement.
