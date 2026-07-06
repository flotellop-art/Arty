# Audit complet du repo Arty — 3 juillet 2026

**Méthodologie** (RÈGLE 7) : 5 agents en parallèle, lecture seule — backend sécu
(**Opus**), auth+crypto (**Opus**), frontend/services (**Sonnet**), build/config/mobile
(**Sonnet**), qualité/tests/docs (**Sonnet**) — croisés avec des vérifications
directes : `tsc --noEmit` (src + functions), suite vitest, build prod, `npm audit`,
et inspection des headers réellement servis sur `tryarty.com`. Chaque finding HIGH
a été re-vérifié à la main (file:line) avant d'entrer dans ce rapport.

**Verdict global** : la base est saine — aucun CRIT, aucun HIGH *exploitable à
distance sans prérequis*. 502/502 tests verts, TypeScript propre sur les deux
projets, CI en place, aucune régression sur les BUG 1→60 documentés **sauf une**
(HITL WordPress, F-1). Les 4 CVE historiques (BUG 42) restent fermées partout.
Le reste est un mélange de trous HITL, de config morte trompeuse, de dette doc
et de MED sécu résiduels déjà partiellement trackés.

---

## HIGH — à corriger en priorité

### F-1 — `wp_update_post` (et `wp_create_post status:'future'`) contournent la confirmation de publication WordPress
`src/services/toolConfirmation.ts:21-46`, `src/services/tools/wordpressTools.ts:32-44,82-89`

`buildToolConfirmMessage()` est une allowlist positive : tout tool absent du
switch passe sans confirmation. Deux bypass réels :

1. **`wp_update_post`** accepte `status: 'draft'|'publish'` mais n'a aucun case.
   Chemin d'exploitation par prompt-injection (email/page/Drive lu par Arty) :
   `wp_create_post({status:'draft'})` (libre, voulu) puis
   `wp_update_post({post_id, status:'publish'})` (libre, **pas voulu**) →
   article publié en ligne sans qu'aucun `window.confirm()` n'apparaisse.
2. **`wp_create_post({status:'future'})`** : l'enum inclut `'future'`
   (publication programmée) mais le garde ne confirme que si
   `status === 'publish'` → une publication *différée* passe aussi sans
   confirmation.

C'est la seule régression trouvée vs l'intention du commit `58ddfb8` (HITL) et
du system prompt (« CONFIRMATION OBLIGATOIRE avant publication »). Angle mort
total : `toolConfirmation.test.ts` ne teste `wp_update_post` ni dans un sens ni
dans l'autre.

**Fix** : case `wp_update_post` symétrique à `wp_create_post`, et traiter
`'future'` comme `'publish'` (`status !== 'draft'` → confirm). Ajouter les
tests de non-régression. **Cause racine à traiter aussi** : imposer un test de
parité « chaque tool de `toolDefinitions.ts` a un test explicite
confirm/no-confirm » pour fermer cette classe de bug (chaque nouveau tool est
aujourd'hui un oubli potentiel).

### F-2 — `Permissions-Policy: geolocation=()` en prod tue la géoloc sur toute la PWA web
`public/_headers:5` — vérifié **servi en prod** sur `tryarty.com` (header live).

`geolocation=()` interdit la géolocalisation à toutes les origines, y compris
`self`. Or `src/services/native/location.ts:67,151` repose sur
`navigator.geolocation` côté web. Conséquence : tout le travail des BUG 55/56
(prompt PWA fiable, triggers itinéraires) est **inopérant sur le web** — le
navigateur bloque par policy avant même le prompt. Le natif n'est pas touché
(la WebView ne passe pas par `_headers`), ce qui explique que ça ait pu passer
inaperçu.

**Fix** : `geolocation=(self)` dans `public/_headers`. Au passage, ce fichier
prouve que la note BUG 40 du CLAUDE.md (« Cloudflare Pages ne supporte pas
`_headers` ») est fausse — voir F-19.

### F-3 — Deux tools LLM exposés appellent des routes serveur inexistantes
`src/services/tools/utilityTools.ts:114` (`calculate_distance` →
`/api/browser/search`), `src/services/browserClient.ts:24,39,50`
(`search_price` → `/api/browser/action`).

`functions/api/browser/` ne contient que `weather.ts`. Les deux tools sont bien
déclarés au modèle (`toolDefinitions.ts:12` via `utilityToolDefinitions`) →
échec garanti à chaque invocation (« Erreur calcul distance. », « Erreur:
recherche prix échouée. »). Reliquat de l'architecture pré-pivot « Phase 4
Playwright ». Troisième route morte du même lot : `browserClient.ts:12`
(`/api/wordpress/publish`) mais son tool `publish_wordpress` n'est pas déclaré
au LLM — mort inoffensif.

**Fix** : rebrancher `calculate_distance` sur `/api/search/web` (ou le retirer),
retirer `search_price` + `browserClient.ts` + le handler mort
`publish_wordpress` (+ `actionDetector.ts`, voir F-24).

### F-4 — README.md = artefact pré-pivot qui documente le pattern interdit par la RÈGLE 1
`README.md:1-3,12-13,28,122,158-168`

Le README est encore celui de « Facades Pollet - PWA » (repo `Appfacade`,
déploiement Vercel, `vercel dev`) et instruit **deux fois** de poser
`VITE_ANTHROPIC_API_KEY=sk-ant-...` dans `.env` — exactement ce que la RÈGLE 1
interdit, et il se contredit lui-même ligne 255 (« jamais de `VITE_*_API_KEY` »).
Le code, lui, est sain (aucun fallback `VITE_*` dans `src/`,
`activeApiKey.ts` vérifié). Mais tout contributeur — humain ou agent — qui
bootstrap depuis le README recrée l'exposition de clé côté client. Chemins de
fichiers cassés en prime (`api/browser/action.ts`, `api/wordpress/publish.ts`,
`api/computer/action.ts`).

**Fix** : réécrire le README pour l'architecture réelle (Arty, Cloudflare
Pages/Functions, D1, proxys serveur, clés sans préfixe). Doc-only mais
sécurité-relevant.

### F-5 — Zéro test automatisé sur `functions/` (tout le backend)
45 fichiers de test sous `src/__tests__/`, **0** sous `functions/` — alors que
c'est là que vivent la whitelist/plans (`checkAllowedUser.ts`), le cap atomique
(`checkPremiumCap.ts`), les webhooks signés (Creem, Lemon Squeezy), les quotas
et les 5 proxys IA. BUG 42 (4 CRIT live) est né précisément dans cette zone ;
la CI ne protège ici que le typage.

**Fix minimal** : tests unitaires pour `parseAllowedEmails`,
`resolveUserPlan`/gating par plan, `consumeCapAtomic`, vérification de
signature des 2 webhooks, et les regex d'IDs.

---

## MED

### Sécurité backend

- **F-6 — `ai/proxy.ts:271-276` : fuite d'erreur upstream Anthropic sur le chemin clé serveur.**
  Seul des 5 proxys IA à renvoyer le body brut d'Anthropic (état de la clé
  owner : rate-limit, crédits, invalidité) à tout user authentifié — les 4
  autres masquent (`{error:'AI service error'}`). L'endpoint le plus utilisé a
  été oublié dans le durcissement N-2. Fix : masquer quand `!isByok` (~5 lignes).
- **F-7 — `contacts/action.ts:90-106` : `resourceName` non validé/encodé + fuite d'erreurs Google** (`:50,:83,:109` renvoient `err.error.message` + status upstream). Connu (audit 14 juin), toujours actif, non touché par #300-304. Fix : `^people\/[a-zA-Z0-9_-]+$` + `encodeURIComponent` + messages génériques.
- **F-8 — `account/delete.ts` : effacement RGPD incomplet.** Ne supprime ni
  `shared_conversations` (contenu publié publiquement, `owner_email`) ni les
  sessions `email_trial_*`. Un compte supprimé laisse ses partages publics
  vivants jusqu'à expiration (30 j). Fix : purge `WHERE owner_email = ?`.
- **F-9 — N-1 `aud` : résiduel sur les chemins « peek ».** Le gros est corrigé
  (commit `cb8f222` : les 6 endpoints qui dépensent la clé IA owner passent
  `env.GOOGLE_CLIENT_ID`, y compris `image-gen.ts:113` — vérifié). Restent
  **sans validation d'aud** : `search/web.ts:61` et `fetch/url.ts:52` (qui
  dépensent les clés Linkup/Brave du owner), `ai/quota/*`, `weather.ts`,
  `geo/reverse.ts` (borné par cap journalier). Fix propre : durcir
  `verifyGoogleUser`/`checkAllowedUserPeek` eux-mêmes plutôt qu'appelant par
  appelant — la couverture partielle actuelle donne un faux sentiment de
  complétude. ⚠️ tester web ET natif (BUG 21/51).
- **F-10 — OTP email : Turnstile fail-open si `TURNSTILE_SECRET_KEY` absente**
  (`emailTrial.ts:287-292`). Le flux OTP lui-même est solide (HMAC keyed,
  CSPRNG, single-use atomique, rate-limits D1 fail-closed) mais sans Turnstile,
  un botnet multi-IP peut faire envoyer des emails « code Arty » à des adresses
  arbitraires (coût Resend + réputation du domaine `EMAIL_FROM`). **Action ops :
  vérifier que la clé est bien posée en prod** ; idéalement, refuser de
  démarrer sans en production.
- **F-11 — PKCE toujours absent** (`googleAuth.ts:101-119`, `auth/token.ts:18-24`).
  La « PR 2 » planifiée au CLAUDE.md n'a jamais été faite. Le state CSRF, lui,
  est présent et correct (192 bits, single-use, un seul point de vérif — BUG 53
  respecté). Défense en profondeur, à faire comme prévu.

### Config / dépendances

- **F-12 — `schema.sql` périmé** : ne définit que `memory` et `quota` alors que
  la prod utilise ~15 tables de plus (subscriptions, licenses, wallet,
  credit_ledger, webhook_event, email_otp, shared_conversations…), toutes
  auto-créées au runtime. Un provisioning D1 neuf depuis `schema.sql` raterait
  tout le stack monétisation. Fix : régénérer ou supprimer le fichier.
- **F-13 — `.env.example` incomplet** : ~15 variables déclarées dans
  `functions/env.d.ts` absentes, dont **`ALLOWED_EMAILS`** (la variable la plus
  critique de l'app), les secrets webhooks Creem/LS, `RESEND_API_KEY`,
  `TURNSTILE_SECRET_KEY`, `RECONCILE_SECRET`. Fix : régénérer depuis `env.d.ts`.
- **F-14 — CVE avec patchs disponibles dans les deps prod** :
  `react-router-dom` 6.30.3 (open redirect GHSA-2j2x-hqr9-3h42, patché en
  6.30.4, dans la range `^6.28.0` → `npm audit fix` suffit) ; `dompurify` 3.4.1
  (advisories XSS/pollution, patché 3.4.11, exploitabilité faible sur notre
  usage mais bump trivial). Les 3 « high » de `npm audit` (xmldom, undici,
  vite) sont outillage dev uniquement — rien de shippé.
- **F-15 — `netlify.toml` mort et trompeur.** `tryarty.com` est servi par
  Cloudflare (vérifié en live) ; Cloudflare ne lit pas ce fichier → sa
  redirection www→non-www et son fallback SPA ne s'appliquent pas par ce biais.
  Risque secondaire : brancher le repo sur Netlify par accident créerait un
  shadow-deploy sans CSP ni env vars. Fix : supprimer.

### Frontend / UX / doc

- **F-16 — Deux allowlists HITL maintenues séparément sans lien**
  (`useAppSetup.ts:160-225` pour les boutons vs `toolConfirmation.ts` pour la
  boucle d'outils, noms d'actions différents pour la même opération). C'est le
  pattern qui a produit F-1. Fix : test de parité + commentaires croisés.
- **F-17 — Régression a11y (contraste) dans du code de juin** :
  `ReflectionControl.tsx:37` (`text-theme-ink/70`), `Sidebar.tsx:465,609`
  (`text-theme-muted/70`, commit `9589bc7` du 16 juin) — le pattern exact que
  le fix du 12 mai avait éradiqué (~2.8-3:1 vs WCAG AA 4.5:1). Vérifié présent.
- **F-18 — `BEFORE-PUBLISHING.md` désynchronisé** (gate Play Store !) : dit
  PBKDF2 100k (réel : 600k v2), liste `GOOGLE_VISION_API_KEY` comme clé à
  configurer (config morte), décrit une « whitelist désactivée / bloc commenté
  à réactiver » qui n'existe plus (le vrai système de plans est en place),
  checkboxes périmées. `install-tunnel.md` renvoie aussi vers « Vercel ».
- **F-19 — CLAUDE.md : 3 corrections factuelles à faire** :
  (a) BUG 40 affirme que Cloudflare Pages ne supporte pas `_headers`/`_redirects`
  — faux, le `_headers` du repo est servi en prod (et c'est lui qui cause F-2) ;
  (b) BUG 42 cite `functions/api/ai/anthropic-proxy.ts` — le fichier réel est
  `functions/api/ai/proxy.ts` ;
  (c) le TODO sécu liste « météo/géoloc accessibles aux free → abus clé Google
  Maps owner » — **faux positif pour la météo** : `weather.ts` utilise
  open-meteo (gratuit, sans clé) ; et `geo/reverse.ts` a maintenant un cap
  journalier par email. Mettre à jour la section TODO (N-1 aussi : largement
  corrigé, résiduel = F-9).
- **F-20 — Duplication structurelle des 4 clients IA**
  (`anthropicClient/mistralClient/geminiClient/openaiClient`) : chacun
  réimplémente timeout+AbortController, header `x-google-token`, garde
  `server-provided`, parsing SSE. BUG 23/25 ont dû être corrigés 4 fois. Fix :
  helper commun pour que les fixes sécu se propagent.

---

## LOW

- **F-21** — `license/activate.ts` : pas de rate-limit (épuisement des 3
  activations si la paire clé+email fuite). Choix « pas de token Google »
  re-décidé et documenté en #304 ; impact borné par Pro=BYOK. Acceptable, tracké.
- **F-22** — `gemini-proxy.ts:133` : `model` (body) non validé dans l'URL ;
  `drive/action.ts:266-268` : `previousParents` non encodé (source = réponse
  Google). Regex/encodage triviaux à ajouter.
- **F-23** — `wordpress/action.ts` : `r.status` upstream encore propagé — mais
  endpoint owner-only, fuite vers soi-même. Divers `catch` renvoyant
  `err.message` (`memory/action.ts:103`, `sheets/append.ts:31`…).
- **F-24** — Code mort : `src/services/actionDetector.ts` (188 lignes, zéro
  import, référence le `search_price` cassé de F-3), handler `publish_wordpress`
  (jamais déclaré au LLM), hooks `useLocalStorage.ts` / `usePWAInstall.ts`,
  helper `cn.ts` (testé mais jamais utilisé).
- **F-25** — 17 commentaires `eslint-disable` alors qu'**aucun eslint n'existe**
  dans le projet (ni config, ni dep, ni step CI) — fausse impression de lint.
  Soit ajouter eslint à la CI, soit purger les directives.
- **F-26** — God files : `InputBar.tsx` (1524 l.), `App.tsx` (1094 l.),
  `SettingsModal.tsx` (888 l.), `useConversation.ts` (872 l.), `Sidebar.tsx`
  (802 l.) — F-17 a été trouvée précisément dans l'un d'eux.
- **F-27** — TODO expiré : `checkAllowedUser.ts:135` (« supprimer en juillet
  2026 après validation Lemon Squeezy ») — échéance atteinte, à statuer.
- **F-28** — Permissions Android sur-déclarées (`READ_MEDIA_AUDIO/VIDEO`,
  `MODIFY_AUDIO_SETTINGS`) — déjà tracké, reconfirmé, à nettoyer avant Play Store.
- **F-29** — Perf : chunk principal 696 kB + markdown 513 kB + jspdf 390 kB
  (pré-gzip). Lazy-import jspdf/html2canvas au moins.
- **F-30** — `memoryService.ts:47-53` : seul `fetch` du codebase qui parse
  `res.json()` sans vérifier `res.ok` (BUG 4) — impact bénin (fallback default)
  mais une panne serveur devient indiscernable d'une mémoire vide.
- **F-31** — Login local email+mdp : `SHA-256(password+email)` non salé stocké
  en clair (`LoginScreen.tsx:114-129`). Pas une frontière d'auth réelle (gate
  UI), mais mauvais signal — clarifier ou passer en PBKDF2+sel.
- **F-32** — `checkAllowedUser.ts:20,94` : `access_token` en query-string vers
  `tokeninfo` (interface documentée Google, token 1h) — à migrer vers le header
  si Google le permet, sinon accepté.

## ⚠️ GO-LIVE blocker (pas une faille)

- **F-33** — IDs produits Creem en mode TEST toujours en dur
  (`checkout/creem.ts:34`, `webhook/creem.ts:29`). Fail-closed, TODO présent —
  à remplacer impérativement au lancement.

## À rehausser dans la file des chantiers

- **F-34** — Chiffrement at-rest `'server-provided'` : le classement
  non-bloquant (sandbox OS) tient, mais le blob réellement critique est le
  **`refresh_token` Google** (accès persistant Gmail/Drive/Calendar), pas
  seulement les conversations. Le chantier `CryptoKey` non-extractible en
  IndexedDB mérite de remonter dans la file. Noté aussi : fragilité
  multi-comptes de la migration v1→v2 (KEY_CHECK/sel globaux, fenêtre qui se
  referme), sans perte de données possible (pas de wipe).

---

## Ce qui est sain (vérifié, pour la confiance)

- `tsc --noEmit` propre (src + functions), **502/502 tests verts**, build prod
  OK, **zéro source map** en dist, CI typecheck+tests sur chaque PR.
- **Aucun secret committé** (grep complet sk-ant-/AIza/whsec_/PEM/creem_ —
  seuls des placeholders README). `.gitignore` correct.
- **Aucune régression** sur les BUG 1→60 hors F-1 : sanitize markdown (BUG 20 +
  durcissement 14 juin), SSE Anthropic (BUG 52), `server-provided` (BUG 25),
  fichiers jamais en localStorage (BUG 11), `saveConversation` synchrone
  (BUG 16), chaîne Google auth complète (BUG 2/3/17/23/24/41/43/47/48/51/53
  tous OK file:line), `requestServerAuthCode(id, true)` (BUG 51),
  SW conditionnel + cache v52 (BUG 45), routing IA (BUG 5/10/12/58).
- **Webhooks Creem + Lemon Squeezy** : HMAC sur octets bruts, constant-time,
  idempotence par event_id, montants issus du payload signé. **Wallet** :
  réservation/settle/void atomiques, corrélation anti-IDOR.
- **Flux OTP email** très propre (HMAC keyed, CSPRNG + rejection sampling,
  single-use `DELETE…RETURNING`, rate-limits fail-closed, pas d'oracle
  d'énumération).
- **SSRF durci** (`urlSafety`), IDOR néant (identité toujours du token vérifié),
  Origin/CSRF strict (absence d'Origin = 403), anti-relais anonyme partout,
  Pro=BYOK effectif, caps atomiques D1.
- Android : signing par env vars, `minify+shrink`, `allowBackup=false`,
  `webContentsDebuggingEnabled:false`, plugin GoogleSignIn conforme BUG 21/26/51.
  iOS : 5 descriptions privacy présentes (BUG 34).
- `services/growth-orchestrator/` : Worker séparé légitime, bien isolé, pas de
  secrets — ne pas le confondre avec le pattern BUG 39 (son `wrangler.toml`
  n'est pas à la racine).
- i18n : sondage de 7 composants récents — tout passe par react-i18next,
  clés FR et EN présentes.

## Ordre d'attaque recommandé

1. **F-1** (HITL WordPress) + test de parité F-16 — ~1 h, ferme le seul vrai trou prompt-injection.
2. **F-2** (`geolocation=(self)`) — 1 ligne, restaure une feature entière en prod web.
3. **F-6** (masquage erreur `ai/proxy.ts`) + **F-7** (contacts) + **F-8** (RGPD delete) — petite PR sécu backend.
4. **F-3** (tools morts) + **F-24** (dead code associé) — nettoyage cohérent.
5. **F-14** (`npm audit fix` + bump dompurify) — 10 min.
6. **F-4/F-12/F-13/F-18/F-19** (dette doc/config) — une PR doc.
7. **F-9** (aud sur peek) et **F-11** (PKCE) — 2 PR sécu dédiées comme déjà planifié.
8. **F-33** au go-live ; **F-5** (tests functions) en tâche de fond.
