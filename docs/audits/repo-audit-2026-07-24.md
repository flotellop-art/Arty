# Audit repo — 24 juillet 2026

**Méthode** : 4 agents de revue contradictoire en parallèle (RÈGLE 7) — backend
Opus, vision/routage Opus, frontend Sonnet, qualité/config Sonnet — puis
vérification directe `fichier:ligne` de chaque claim par Claude avant retenue.
Aucun agent n'a modifié de code.

**Périmètre** : tout le repo, avec priorité au code livré depuis l'audit du
3 juillet (~40 PRs : sentiers OSM, vision Terra 4K, wallet, Gemini 3.6,
landing pages, watchdog de streaming).

**Baseline vérifiée** : `npm run typecheck` (src + functions) OK · `npm test`
165 fichiers / 1656 tests verts · CI complète (typecheck + coverage + build +
contrôles Android).

---

## Cadrage — ce qui n'est PAS le point faible

Deux hypothèses de départ ont été **infirmées** par les agents, vérification à
l'appui. Elles sont consignées ici pour éviter d'y revenir :

- **Le routeur n'est pas le maillon faible.** L'ordre `euOnly → privé →
  fichiers → manuel → cascade` est intact après les PRs vision
  (`src/services/router/resolveRoute.ts:63-141`) ; le carve-out photo vit
  *à l'intérieur* de la branche `hasFiles` et n'atteint jamais Gemini/hybride ;
  44 tests dont une matrice Terra dédiée. Les chemins annexes où ce type de
  fuite se cache (`promptEnhancer`, `autoMemory`, `factChecker`,
  `compressIfNeeded`, `branchConversation`) ont été vérifiés un par un.
  **Aucune fuite inter-provider trouvée.**
- **Manipuler le localStorage ne débloque aucun modèle payant.** Falsifier
  `arty-plan-cache` / `arty-allowed-families` ne donne rien : les 4 proxys
  re-résolvent le plan depuis D1 et refusent. La revalidation serveur vision ne
  fait confiance à aucune métadonnée client (dimensions et poids recalculés
  depuis les octets, `functions/api/_lib/openaiVision.ts:180-241`), et les
  4 paires de constantes client/serveur sont exactement alignées.

Le vrai point faible n'est pas l'étanchéité — c'est **la comptabilité, le cycle
de vie des requêtes, et l'application inégale des correctifs déjà écrits**.
Un motif domine ce rapport : *un bug est corrigé proprement à un endroit, et le
correctif n'est pas porté sur les 3 autres chemins équivalents.*

---

## HIGH

### H1 — Bascule de compte pendant un chiffrement en vol → écrasement de l'historique
`src/services/storage.ts:110-136`

`persist()` lance `persistEncrypted()` en fire-and-forget. Après l'`await
encrypt(...)` (`:127`), `scoped.setItem(ENC_KEY, blob)` (`:128`) résout la clé
localStorage via `getActiveUserId()` **au moment de l'écriture**
(`src/services/scopedStorage.ts:10`), pas au moment de l'appel.

*Scénario* : `saveConversation` est appelé toutes les ~3 s pendant un stream.
L'utilisateur bascule du compte A vers B pendant qu'un chiffrement de A est en
vol → le blob de A s'écrit dans `arty-B-conversations-enc` et écrase
l'historique réel de B. Seul `gen === writeGen` (`:132`) protège la suppression
du plain ; rien ne protège l'écriture chiffrée.

*Le bon pattern existe déjà dans le repo* : `src/services/googleAuth.ts:312`
capture `ownerAtStart = getActiveUserId()` et le revérifie après l'await. Il n'a
jamais été porté sur `storage.ts`. Même classe que BUG 6, non couverte.

**Fix** : capturer `ownerAtStart` dans `persist()`, sauter
`setItem`/`removeItem` si l'utilisateur actif a changé.

### H2 — Le correctif « spinner éternel » n'a été appliqué qu'à 1 client sur 4
`src/services/anthropicClient.ts:340` · `openaiClient.ts:294` ·
`mistralClient.ts:680` · `geminiClient.ts:399`

La PR #346 a corrigé le cas « réseau mobile qui meurt en silence (half-open TCP)
→ `reader.read()` ne se résout jamais → ni `onDone` ni `onError` → bouton Stop et
indicateur bloqués indéfiniment » via `readWithInactivityTimeout` (90 s). Cette
fonction est **privée** à `anthropicClient.ts`.

Les trois autres clients font un `while (true) { await reader.read() }` **sans
aucun timeout** — le bug corrigé reste donc entièrement ouvert sur ChatGPT,
Mistral et Gemini. Aggravant : BUG 58 documente Mistral Medium 3.5 comme défaut
des comptes payants, soit la population la plus exposée.

Symétrique inverse : Anthropic et OpenAI n'ont **aucun** timeout de connexion
initiale, contrairement à Gemini/Mistral.

**Fix** : remonter `readWithInactivityTimeout` dans `src/services/aiHttp.ts` —
créé précisément pour ça en C9/PR #312 — et l'appliquer aux 4 clients.

### H3 — Quota, cap et messages d'essai brûlés par les retries automatiques
`functions/api/ai/proxy.ts:197,213,229` · `functions/api/ai/mistral-proxy.ts`

`consumeDailyQuota` (`:197`) et `checkPremiumCap` (`:213`) s'exécutent **avant**
le `fetch` upstream (`:229`). Sur échec, seul le wallet est rendu : ni
`voidDailyQuota`, ni `voidPremiumCap`, ni `voidTrialMessage` ne sont même
importés dans ces deux fichiers.

En face, `src/services/anthropicClient.ts:280-289` retente jusqu'à **4 fois**
sur 429/529/5xx. Une surcharge Anthropic sur *un seul* message consomme donc
4 unités des 150 Sonnet/mois d'un abonné, ou 4 des 30 messages d'un essai.

L'invariant « quota consommé ⟺ réponse servie » posé par la revue C3 n'existe
que dans `openai-proxy.ts` et `gemini-proxy.ts`. **Les deux proxys les plus
utilisés ne l'ont pas.**

**Fix** : porter `scheduleUnservedRefunds()` dans `proxy.ts` et
`mistral-proxy.ts`.

### H4 — Les recherches web Anthropic sont hors comptabilité — ni tracées, ni facturées
`functions/api/_lib/trackUsage.ts:151-186` · `src/services/toolDefinitions.ts:17-20`

`createAnthropicParser` ne lit que les compteurs de tokens et ignore
`server_tool_use` / `web_search_requests` du `message_delta`. Le champ
`searchQueries` n'est alimenté que par le parser Gemini (`:253-298`).

Or `web_search_20250305` est déclaré avec `max_uses: 5` et actif par défaut sur
presque chaque message Claude. Anthropic facture ces recherches à part : un
message à 5 recherches peut coûter davantage en recherche qu'en tokens — et
`chargeForUsageMicro` ne recopie que les compteurs de tokens, donc **un
utilisateur à crédits ne paie jamais ce poste : Arty l'absorbe**.

Tout le chantier C11 a instrumenté le grounding Gemini (23 % des appels) pendant
que le provider dominant restait aveugle.

**Fix** : parser `server_tool_use` côté Anthropic, alimenter `searchQueries`
(la colonne D1 existe déjà) et trancher explicitement son entrée au settle wallet.

---

## MED

### M1 — 4 allers-retours Google sérialisés avant le premier octet IA
`functions/api/_lib/emailTrial.ts:581` · `functions/api/_lib/checkAllowedUser.ts:357,73,81`

`resolveProxyIdentity` **et** `checkAllowedUser` appellent tous deux
`verifyGoogleUserStrict` → `verifyGoogleIdentityStrict`, qui enchaîne
`tokeninfo` puis `userinfo`, chacun sous `AbortSignal.timeout(10_000)`. Soit
4 fetch Google en série, **40 s de budget pire cas**, sur les 4 proxys de chat,
sans cache ni partage du résultat.

Effet de bord du durcissement `aud` (C1/F-9) : l'identité est déjà vérifiée
~100 lignes plus haut. **Fix** : passer l'email déjà résolu à `checkAllowedUser`
au lieu de la `Request`.

*Corollaire ops* : `verifyGoogleIdentityStrict` retourne `null` si
`GOOGLE_CLIENT_ID` est absent → panne totale silencieuse de tous les endpoints
authentifiés. Et ce chemin **rejette** un token dont `tokeninfo` ne renvoie ni
`aud` ni `azp`, ce qui contredit la sémantique fail-safe documentée au CLAUDE.md
(« `aud` absent ne verrouille PAS », BUG 21/51). À valider sur APK réel.

### M2 — Les géocodeurs sont appelés avant tout quota
`functions/api/geo/trails.ts:116` (`resolveCenter`) vs `:135` (`enforceQuota`)

Le cap `osm-trails` (25/j) ne protège qu'Overpass. Les 3 géocodeurs
(`data.geopf.fr`, open-meteo, Nominatim) sont en amont, non plafonnés, avec une
clé de cache dérivée de la chaîne — donc contournable par une `location`
aléatoire. Le seul frein restant (rate-limit middleware, par isolat) est
décoratif. Risque : ban de l'IP egress Cloudflare partagée, c'est-à-dire
exactement ce que le commentaire du fichier prétend couvrir.

**Fix** : `enforceQuota` avant `resolveCenter`, ou cap `geocode` dédié.

### M3 — Body non borné sur 3 proxys de chat sur 4
`proxy.ts:105` · `mistral-proxy.ts:92` · `gemini-proxy.ts:154`

`request.text()` / `request.json()` sans limite. `openai-proxy.ts:289` est le
seul à utiliser `readRequestTextWithLimit` — le helper
(`_lib/boundedRequestBody.ts`) existe déjà, il n'est simplement pas branché
ailleurs. Aggravant sur Anthropic, qui transporte les PDF en base64 et re-parse
le même body 4 fois : pic mémoire à plusieurs multiples de la taille du body
face à la limite de 128 Mio d'un Worker. Un body de 60-80 Mio suffit à OOM le
Worker, avec réservation wallet éventuellement laissée ouverte.

### M4 — `'gemini'` contient `'mini'` : 6 fallbacks de tarification sont du code mort
`src/services/costTracker.ts:126`

```js
if (model.startsWith('gpt-5-mini') || model.includes('mini')) return 'gpt-5-mini'
```

`'gemini'.indexOf('mini') === 2`. Toutes les branches `gemini` des lignes
128-133 — dont le commentaire dit « pour ne pas perdre les futurs modèles » —
sont donc **inatteignables** (vérifié : `gemini-4-flash`, `gemini-4-pro`,
`gemini-5-flash-lite` capturés à 100 % par la règle `mini`).

Latent aujourd'hui (les modèles actuels ont un alias explicite en amont), mais
c'est le fichier touché à chaque veille modèles — la PR #389 a ajouté 2 Gemini
il y a 3 jours. Le prochain modèle sans alias sera facturé ~6× trop bas **et**
fusionné dans la ligne « gpt-5-mini » de l'écran Coûts. Le commentaire ligne 97
montre que le piège a déjà frappé une fois (`'voxtral-mini-latest'`) et n'a été
blindé que pour la transcription.

**Fix** : remonter les branches `gemini` avant la règle `includes('mini')`, et
ajouter au test de parité une assertion « toute clé de `PRICING` serveur se
normalise vers une entrée `MODEL_COSTS` ».

### M5 — Plan inconnu → Sonnet : le seul gate de la couche IA qui fail-open
`src/services/aiRouter.ts:420,436`

Le verrou Haiku ne se déclenche que si `arty-plan-cache` vaut exactement
`'free'` ou `'trial'`. Cache `null` — effacé au logout (`useAuth.ts:143`), ou
status jamais revenu — tombe sur `claude-sonnet-5`, que le serveur refuse en
403 `model_locked`, sans retry ni message dédié côté client. Premier message
après un login = erreur brute au lieu de la réponse Haiku qui aurait marché.
Le reste du routeur applique pourtant le fail-closed partout.

### M6 — Le bouton Stop ne coupe plus le flux après réception des headers
`src/services/aiHttp.ts:78-79`

Le `finally` retire l'écouteur d'abort du signal externe, et il s'exécute dès
que `fetch` résout — c'est-à-dire aux **headers**, pas au body. Passé ce point,
`controller.abort()` ne propage plus vers le signal du fetch. Mistral s'en sort
par un test explicite dans sa boucle de lecture ; **Gemini n'en a pas** → le
stream se télécharge et se facture intégralement après un Stop. Variante pire
sur l'hybride : `useConversation.ts:854` passe un `AbortController` factice et
`geminiResearch` n'accepte aucun signal.

### M7 — Bulle assistant vide persistée après un Stop
`src/services/openaiClient.ts:347` · `mistralClient.ts:542` ·
`src/hooks/useStreaming.ts:122-131,297-307`

Ces deux clients rappellent `onDone()` sur `AbortError`, alors que
`stopStreaming` a déjà finalisé synchroniquement. Le `onDone` tardif ne retrouve
plus l'entrée, prend `content = ''`, et `finalize` pousse **inconditionnellement**
un message → seconde bulle vide, sans flag `interrupted`, sauvegardée en storage.
Anthropic et Gemini ne rappellent rien : divergence entre clients, pas défaut
générique. **Fix** : garder dans `useStreaming.onDone`.

### M8 — Remboursement du message d'essai incohérent entre proxys
`functions/api/ai/openai-proxy.ts:353` vs `gemini-proxy.ts:117`

OpenAI conditionne `trialConsumedBy` à `usesVisionTransport &&` — le chemin
texte n'est donc jamais remboursé. Gemini ne conditionne pas. Et
`voidTrialMessage` n'est importé **ni** par `proxy.ts` (Anthropic, chemin
principal) **ni** par `mistral-proxy.ts`.

### M9 — Dérive de CVE dépendances, structurellement invisible
CLAUDE.md affirme (3 juillet, F-14) « `npm audit` = 0 vulnérabilité ».
**Mesuré le 24 juillet : 8 vulnérabilités au total (1 low, 3 moderate, 4 high),
dont 5 sur les dépendances de production** (`npm audit --omit=dev`) :

| paquet | sévérité | note |
|---|---|---|
| `brace-expansion` | high | DoS par expansion non bornée (OOM) |
| `react-router` / `react-router-dom` | moderate | open redirect — **bypass de CVE-2025-68470**, la CVE corrigée le 3 juillet |
| `tar` | moderate | stack-overflow non rattrapable |
| `dompurify` | low | CUSTOM_ELEMENT_HANDLING — code de sanitisation réellement utilisé |

Le point structurel importe plus que les CVE elles-mêmes : **ni la CI ni
`/audit-secu` ne lancent `npm audit`**. La dérive est invisible entre deux
audits manuels — ici 3 semaines pour passer de 0 à 8, dont un contournement du
correctif précédent.

**Fix — attention au piège du gate naïf.** `npm audit --audit-level=high`
sort en code 1 dès maintenant (vérifié) : la CI serait rouge au premier run à
cause de vulnérabilités préexistantes, principalement de build (`postcss`,
`miniflare`, `sharp`). Pire, ce seuil **ignorerait précisément la CVE
react-router citée ci-dessus**, classée `moderate`. Deux options cohérentes :
soit corriger les 5 CVE prod dans la même PR puis poser le gate à `moderate`,
soit poser d'abord un job **non bloquant** (rapport en artefact) et le rendre
bloquant une fois la dette à zéro. Dans les deux cas, viser `--omit=dev` pour
le gate bloquant et garder l'audit complet en information.

### M10 — Le seuil de couverture CI est réglé à la moitié de la couverture réelle
`vite.config.ts:38` — `thresholds: { statements: 27, branches: 24, functions: 31, lines: 28 }`

Couverture réelle mesurée : **statements 49,7 % · branches 45,8 % · functions
54,8 % · lines 51,7 %**. Le filet peut donc absorber une régression d'environ
20 points avant que `npm run verify` — le seul gate CI — ne passe au rouge.
**Fix (~15 min)** : relever les seuils **juste sous** la mesure (une marge de
2-3 points évite de rougir sur une variation normale), et compléter par des
seuils ciblés (`coverage.thresholds` par glob) sur les fichiers critiques —
wallet, quota, auth — qui sont aujourd'hui noyés dans une moyenne globale
qu'un gros fichier bien testé suffit à maintenir.

### M11 — L'endpoint qui a eu le CVE IDOR (CRIT-1) a 0 % de couverture
`functions/api/memory/action.ts`

Couverture v8 = 0 sur tout le fichier ; aucune référence dans `src/__tests__`.
C'est l'endpoint de BUG 42 CRIT-1 (`userId` spoofable depuis le body), corrigé
en avril par PR #11. **Rien ne verrouille aujourd'hui l'invariant « `userId`
vient du token vérifié, jamais du body »** — sur le fichier au passif le plus
lourd du repo. Le harnais D1 Miniflare existe déjà (C8/PR #311).

### M12 — `image-gen.ts` : argent + SSRF + gating de plan, 0 test
`functions/api/ai/image-gen.ts` (246 l., garde `isBflUrl` lignes 66-73)

Gating par plan, garde SSRF maison, `recordUsage`. Même classe de risque que
`_lib/wallet.ts` (bien testé, tests d'intégration D1) mais sans aucun filet.

### M13 — Écran sentiers : trois défauts
`src/screens/trail.tsx`

- `:64-99` — `load()` enchaîne 3 `await` puis `setState`, sans flag
  d'annulation ni cleanup dans `useEffect(() => { void load() }, [load])` :
  deux ouvertures rapides de cartes différentes peuvent laisser la première
  réponse écraser la seconde.
- `:126` — `onTileSuccess` ne lève le bandeau « connexion instable » que
  `if (navigator.onLine)`, alors que le code documente lui-même ligne 48 que
  cette API n'est pas fiable en WebView. Recevoir une tuile prouve la
  connectivité mieux que l'API ; la revérifier peut figer le bandeau.
- `:288` — `catch {}` vide sur le téléchargement GPX, sans distinguer
  l'annulation du share sheet d'un échec réel : cul-de-sac sans feedback
  (classe BUG 55).

### M14 — Double bootstrap crypto à chaque login et chaque switch
`src/hooks/useAuth.ts:89-93` et `:200-204` vs l'effet `[currentUser]` `:39-54`

`login()` fait `initCrypto` + les 3 bootstraps, puis `setCurrentUser` déclenche
l'effet qui refait la séquence entière — **deux dérivations PBKDF2 à 600 000
itérations** au lieu d'une, plus un double déchiffrement de tous les blobs.

---

## LOW / structurel

- **L1 — Coordonnées GPS à 11 cm envoyées à un miroir russe** (décision produit).
  `functions/api/geo/trails.ts:43` place `maps.mail.ru` **en premier** de la
  liste serveur. Le QL posté contient `lat.toFixed(6)/lon.toFixed(6)` (`:151`).
  Quand la recherche part de la position du téléphone, c'est le domicile au
  mètre près qui transite chez Mail.ru. Le commentaire `:38-42` dit « jamais
  l'adresse » : factuellement vrai, mais une coordonnée à 6 décimales *est*
  l'adresse. À arbitrer au regard de la RÈGLE 5 et du positionnement EU —
  reléguer le miroir en dernier et arrondir à 3 décimales (~110 m) suffirait.
- **L2 — Asymétrie SQL dans `voidReservation`** : `_lib/wallet.ts:371` filtre
  sur `user_email`, `:376` non. Si les deux divergeaient, le hold serait gelé
  définitivement (invisible du sweeper). Non atteignable aujourd'hui (UUID
  jamais exposé) — défense en profondeur, écart visiblement involontaire.
- **L3 — Bundle et god files empirent, contrairement au statut « inchangé »** :
  chunk principal **825,46 kB** (vs 696 kB documenté le 3/07, cible C10
  < 450 kB) = **+18,5 % en 3 semaines**. `InputBar.tsx` 2055 l. (+35 %),
  `useConversation.ts` 1239 l. (+42 %), `App.tsx` 1275 l. (+16,5 %). Aucun
  budget CI ne surveille ni la taille de bundle ni la taille de fichier.
- **L4 — `bytesToBase64` (BUG 50) réimplémenté 3 fois, divergemment** :
  `ai/image-gen.ts:55-62` (chunk 8192), `drive/action.ts:25-31` (0x8000),
  `workspace-addon/phase0/_lib/gmail.ts:242-249` (spread). Un futur ajustement
  appliqué à une seule copie laisse les deux autres buguées.
- **L5 — Schéma Phase 0 non versionné** (item corrigé après contre-relecture —
  voir l'errata en fin de rapport). La table
  `workspace_addon_phase0_idempotency` est créée dynamiquement au premier appel
  par `_lib/idempotency.ts:127`. Elle n'a pas à figurer dans `schema.sql` :
  elle vit dans une base D1 **séparée** (`WORKSPACE_ADDON_PHASE0_DB`,
  `functions/env.d.ts:25`, distinct du binding `DB` ligne 57) et l'y ajouter
  serait faux. Le vrai manque est qu'aucun schéma ni migration n'est versionné
  pour cette base : sa structure n'existe que dans le code qui la crée.
  **Fix** : versionner un `schema-phase0.sql` (ou une migration dédiée) pour
  la base Phase 0, sans toucher au `schema.sql` de production.
- **L6 — Le garde-fou CSP ne dérive pas du code** :
  `src/__tests__/services/headersCsp.test.ts` vérifie une liste d'hôtes codée
  en dur. Aucune dérive actuelle (vérifié : tous les hôtes appelés depuis
  `src/` sont dans `connect-src`), mais l'ajout d'un futur hôte passerait la CI
  et casserait en prod sans erreur de build — mode d'échec de BUG 62.
- **L7 — Sentiers : pipeline dupliqué client/serveur** : `trailsOsm.ts` (443 l.)
  miroite `geo/trails.ts` (612 l.) — 7 fonctions et 5 constantes en double.
  Duplication assumée et verrouillée par un vrai test comportemental
  (`trailsOsm.parity.test.ts` nourrit la même réponse Overpass aux deux).
  Signal empirique en revanche : d'après le churn des commits `fix`, c'est la
  zone la plus instable du repo — **5 PRs de correctif en 2 semaines**
  (#378 → #385) sur une feature livrée le 19 juillet.
- **L8 — `functions/tsconfig.json` moins strict que `tsconfig.json`** : le
  frontend a `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`,
  `noFallthroughCasesInSwitch` ; le backend n'a que `strict: true`. C'est
  pourtant le code qui manipule l'argent et les tokens.
- **L9 — `services/growth-orchestrator` hors des deux dispositifs de sécurité** :
  Worker de **2717 lignes en un seul fichier**, 0 test, CI limitée à
  `tsc --noEmit`. Il gère vérification HMAC de webhook, un flow OAuth Google,
  un bot Discord et un serveur MCP Gmail. `.claude/commands/audit-secu.md` ne
  mentionne jamais ce dossier. À ajouter au scope du prochain `/audit-secu`.
- **L10 — Les clients historiquement les plus accidentogènes sont les moins
  testés** : `mistralClient.ts` (758 l.) → **2,87 %** de couverture, son seul
  test (34 l.) ne couvre qu'une fonction pure. `geminiClient.ts` (500 l.) →
  **19,9 %**, sans test du flux de stream réel ni de l'exclusivité
  `google_maps`/`google_search` (BUG 5). `orchestrator.ts` → 4,3 %. Ce sont les
  fichiers où BUG 5, BUG 56 et BUG 58 sont déjà arrivés en prod.
- **L11 — Les handlers d'outils réellement invoqués par le LLM : 0 %** :
  `toolExecutor.ts`, `tools/driveTools.ts` (269 l.), `contactsTools.ts`,
  `sheetsTools.ts`. Seule la classification HITL est testée
  (`toolConfirmation.test.ts`) — pas le comportement du handler exécuté après
  confirmation.
- **L12 — HEIC accepté à la sélection, rejeté au sniffing** :
  `InputBar.tsx:125` accepte `.heic/.heif`, `imageNormalization.ts:273` ne
  connaît que JPEG/PNG/WebP et lève `unsupported_format`. Fenêtre réelle étroite
  (iOS transcode souvent en JPEG depuis la photothèque, la caméra Capacitor
  renvoie du JPEG), mais le message d'erreur est trompeur.
- **L13 — La règle BUG 37 (`.npmrc` « OBLIGATOIRE ») est périmée** : le fichier
  n'existe pas et n'a **jamais** été commité (`git log --all -- .npmrc` vide).
  `@codetrix-studio/capacitor-google-auth` a été entièrement retiré et
  `npm ci` passe sans `legacy-peer-deps`. Inoffensif, mais c'est une
  information fausse dans le fichier qui prétend documenter l'état réel.
- **L14 — Rate-limit du middleware sans éviction et par isolat** :
  `functions/api/_middleware.ts:19,30-39`. Fuite mémoire lente et bornée, mais
  surtout : ce limiteur ne doit **pas** être compté comme une défense dans les
  analyses de risque (cf. M2).
- **L15 — `consumeCapAtomic` fail-open autorise ET consomme** :
  `_lib/atomicQuota.ts:59-66`. Sur timeout 250 ms, la requête est autorisée mais
  la requête D1 n'est pas annulée et commite quelques ms plus tard : l'unité est
  débitée *et* la requête servie hors compteur. Choix assumé, mais le double
  effet n'est documenté nulle part — à comparer à `emailTrial.ts:214`, qui est
  fail-**closed** sur le même pattern.

---

## Vérifié sain — ne pas y revenir

- **Wallet** (`_lib/wallet.ts`) : `reserveCredits`, `settleCredits`,
  `creditWallet` et le drain de reversals sont des `batch()` uniques
  idempotents ; l'invariant `balance_micro >= 0` tient ; double-débit fermé ;
  index unique `idx_credit_ledger_settle_once` couvre `refund`/`chargeback`.
- **Webhook Creem** : HMAC sur les octets bruts avant tout parse, montant issu
  du catalogue figé jamais du payload, email autoritatif posé serveur, 5xx forcé
  si le produit n'est pas configuré (pas de 200 silencieux sur paiement capturé).
- **Workspace add-on** (`phase0/_lib/auth.ts`) : la meilleure vérification de
  jeton du repo — double preuve système + utilisateur, `alg` épinglé RS256,
  `jku`/`x5u`/`crit` rejetés, `aud` en égalité stricte, corrélation des deux
  preuves. Idempotence des brouillons par réservation D1 + nonce.
- **Sentiers, injection** : aucune donnée texte n'entre dans le QL Overpass —
  `kind` vient d'une map figée, les IDs sont validés `Number.isSafeInteger`,
  lat/lon passent par `toFixed`. `readBounded` borne correctement une réponse
  chunked.
- **Vision Terra** : deadline globale, admission mémoire prise après auth,
  remboursements sur chaque chemin d'échec, lots mixtes et 5e photo bloqués
  avant envoi, fail-closed sur retry/edit.
- **Frontend défensif** : `useConversation.ts` (auto-crop vision) libère son
  verrou sur toutes les branches ; `InputBar.tsx` et `SettingsModal.tsx` ont des
  gardes `writeVersion`/`active` sur quasiment chaque effet async ;
  `UserBubble.tsx` implémente focus-trap, `inert`, cleanup de blob URL et Escape.
- **Billing reconcile** : owner-only par secret partagé, 404 uniforme, réponse
  limitée à des compteurs.

---

## Ordre d'attaque suggéré

| # | Item | Effort | Pourquoi d'abord |
|---|---|---|---|
| 1 | M10 seuils de couverture | 15 min | Rend tout le reste mesurable |
| 2 | M9 job CI `npm audit` | 30 min | Ferme une classe entière d'angles morts |
| 3 | H3 remboursements quota/essai | 1 h | Argent + équité, sur les 2 proxys principaux |
| 4 | H2 watchdog partagé | 1 h | Bug live déjà survenu, 3 chemins encore ouverts |
| 5 | M2 quota avant géocodeurs | 15 min | Protège une ressource communautaire partagée |
| 6 | M3 bornes de body | 30 min | Helper déjà écrit, juste à brancher |
| 7 | H1 garde owner dans `storage.ts` | 1 h | Perte de données, pattern déjà éprouvé |
| 8 | M4 ordre des règles de tarification | 15 min | Piège récurrent à chaque veille modèles |
| 9 | H4 traçage `web_search` Anthropic | 3 h | Fuite de marge continue |
| 10 | M1 dé-duplication de l'auth | 1 h | Gros gain de latence sur le chemin le plus chaud |

**Décisions à arbitrer par Florent** (pas des bugs) : L1 (miroir Overpass russe
et précision des coordonnées), et le statut de C10/C11 dont L3 montre qu'ils se
dégradent activement.

---

## Errata — contre-relecture du rapport

Le rapport a été soumis à une relecture contradictoire après publication. Trois
corrections retenues, une objection écartée. Le détail est consigné ici parce
qu'un audit dont on ne trace pas les erreurs perd sa valeur de référence.

**Retenu — L5 était un faux positif.** L'affirmation « 4 variables de
`functions/env.d.ts` absentes de `.env.example` » est **fausse** : les quatre
y sont. Et la table `workspace_addon_phase0_idempotency` n'a pas à rejoindre
`schema.sql`, puisqu'elle vit dans une base D1 séparée. L'item a été réécrit
autour du seul manque réel (aucun schéma versionné pour la base Phase 0).
Cause de l'erreur : c'est le seul finding du rapport dont la mesure n'a pas été
re-vérifiée à la main avant retenue.

**Retenu — le gate `npm audit` proposé était mal calibré** : rouge dès le
premier run sur de la dette de build, et aveugle à la CVE `moderate` qui sert
d'exemple. Voir M9, réécrit.

**Retenu — les seuils de couverture** doivent garder une marge sous la mesure
et être complétés par des seuils ciblés sur les fichiers critiques. Voir M10.

**Écarté — « M4 est déjà corrigé dans des changements locaux non commités ».**
Vérifié : `src/services/costTracker.ts:126` contient toujours
`model.includes('mini')` à `HEAD`, `git status` est vide (aucune modification
locale), et `origin/main` est exactement `HEAD~1` — le checkout n'est pas
divergent. M4 reste ouvert.

## Deux corrections factuelles à porter au CLAUDE.md

1. **BUG 40 / F-14** : « `npm audit` = 0 vulnérabilité » n'est plus vrai
   (8 au total, 5 en prod — voir M9).
2. **BUG 37** : la règle « `.npmrc` avec `legacy-peer-deps=true` est
   OBLIGATOIRE, ne jamais le supprimer » décrit un fichier qui n'a jamais existé
   dans le repo, pour une dépendance depuis retirée (voir L13).
