# Cahier des charges — remédiation de l'audit du 3 juillet 2026

Référence : `docs/audits/repo-audit-2026-07-03.md` (findings F-1 → F-34).
Branche : `claude/arty-repo-audit-80lgfz` (PR #307).

Ce document spécifie, finding par finding, ce qui est corrigé **dans cette PR**
(lots A→E), et ce qui est **différé** avec justification et plan. Principe de
découpage : tout ce qui est corrigeable sans test sur appareil réel (APK) et
sans toucher aux zones à haut risque de régression listées par le CLAUDE.md
(auth native, chiffrement) entre dans cette PR ; le reste part en PR dédiée.

---

## LOT A — HIGH

### A1 (F-1) — Fermer le bypass HITL WordPress
**Fichiers** : `src/services/toolConfirmation.ts`, `src/__tests__/services/toolConfirmation.test.ts`

**Changements** :
1. Ajouter un case `wp_update_post` dans `buildToolConfirmMessage()` : confirmation
   requise dès que `input.status` est fourni et ≠ `'draft'` (couvre `'publish'`).
   Un update sans changement de `status` (titre/contenu d'un brouillon) reste libre.
2. Durcir le case `wp_create_post`/`publish_wordpress` : confirmation dès que
   `status !== 'draft'` (couvre `'publish'` ET `'future'` — publication programmée).
3. Tests de non-régression : `wp_update_post` avec `status:'publish'` → confirm ;
   avec `status:'draft'` → libre ; sans `status` → libre ; `wp_create_post` avec
   `status:'future'` → confirm.

**Critère d'acceptation** : aucun chemin de la boucle d'outils ne peut rendre un
article public (immédiatement ou programmé) sans `window.confirm()`.

### A2 (F-16) — Test de parité anti-dérive des allowlists HITL
**Fichiers** : `src/__tests__/services/toolConfirmation.test.ts` (nouveau bloc),
commentaires croisés dans `toolConfirmation.ts` et `useAppSetup.ts`.

**Changements** :
1. Test « chaque tool déclaré doit être classé » : itérer sur TOUS les noms de
   `TOOLS` (`toolDefinitions.ts`) + tools Google/WordPress et vérifier que chaque
   nom appartient à l'union {tools gardés par `buildToolConfirmMessage`} ∪
   {allowlist explicite `SAFE_TOOLS` maintenue dans le test}. **Un nouveau tool
   non classé fait échouer la CI** → force la décision confirm/no-confirm à
   l'ajout, ferme la classe de bug F-1.
2. Commentaire dans `toolConfirmation.ts` renvoyant vers `useAppSetup.ts`
   (allowlist des boutons) et réciproquement.

**Critère d'acceptation** : ajouter un tool bidon dans `toolDefinitions.ts` sans
le classer fait échouer `npm test`.

### A3 (F-2) — Restaurer la géolocalisation sur la PWA web
**Fichier** : `public/_headers`

**Changement** : `geolocation=()` → `geolocation=(self)` dans `Permissions-Policy`.
Camera/micro restent `(self)`. Aucun autre changement de CSP.

**Critère d'acceptation** : après déploiement, `navigator.permissions.query({name:'geolocation'})`
sur tryarty.com ne retourne plus `denied` d'office ; le prompt BUG 55 refonctionne.

### A4 (F-3 + F-24) — Tools morts et code mort associé
**Fichiers** : `src/services/tools/utilityTools.ts`, `src/services/tools/wordpressTools.ts`,
`src/services/toolExecutor.ts`, `src/services/toolConfirmation.ts`,
`src/hooks/useBrowser.ts` (suppression), `src/services/browserClient.ts` (suppression),
`src/types/browser.ts` (suppression), `src/services/actionDetector.ts` (suppression),
`src/hooks/useLocalStorage.ts` (suppression), `src/hooks/usePWAInstall.ts` (suppression),
`src/utils/cn.ts` + son test (suppression), `src/components/google/BrowserBanner.tsx`
(suppression), `src/hooks/useAppSetup.ts`, `src/components/chat/ConversationScreen.tsx`,
`src/App.tsx`, tests associés.

**Changements** :
1. **`calculate_distance` : rebranché** sur `/api/search/web` (route réelle) avec
   le même pattern d'auth que `executeMistralWebSearch` (`x-google-token` via
   `getValidAccessToken()`, timeout 30 s AbortController, lecture de `answer`
   puis fallback snippets). Le tool reste exposé (utile quand le routing choisit
   Claude), il cesse d'échouer à 100 %.
2. **`search_price` : supprimé** (définition + handler). Sa route `/api/browser/action`
   n'existe pas et aucune implémentation serveur de recherche de prix n'existe.
3. **`publish_wordpress` : supprimé** (handler jamais déclaré au LLM + case de
   confirmation + test associé). La publication passe par `wp_create_post`/`wp_update_post`.
4. **Cascade** : `createUtilityHandlers` et `createWordpressHandlers` n'ont plus
   besoin de `browserActions` → signature simplifiée ; `useBrowser`/`browserClient`/
   `types/browser`/`BrowserBanner` deviennent orphelins → supprimés ; props
   `browserActions` retirées de `useAppSetup`/`ConversationScreen`/`App.tsx`/`toolExecutor`.
5. Suppression du code mort sans dépendant : `actionDetector.ts` (188 l., zéro
   import), `useLocalStorage.ts`, `usePWAInstall.ts`, `cn.ts` + `utils.test.ts`.

**Critères d'acceptation** : `tsc --noEmit` propre (avec `noUnusedLocals/Parameters`),
suite de tests verte, `grep -r "api/browser/(search|action)" src` vide,
`calculate_distance` retourne un résultat réel via `/api/search/web`.

### A5 (F-4 + F-6 doc) — Réécrire README.md
**Fichier** : `README.md` (réécriture complète)

**Contenu cible** : présentation Arty (assistant IA multi-modèles, Cloudflare
Pages + Functions + D1, Capacitor Android/iOS) ; démarrage local (`npm ci`,
`npm run dev`, `npm run typecheck`, `npm test`) ; **architecture des clés :
serveur uniquement, JAMAIS de `VITE_*_API_KEY`** (renvoi RÈGLE 1 CLAUDE.md) ;
variables d'environnement → renvoi `.env.example` + `functions/env.d.ts` ;
structure du repo (src/, functions/, android/, ios/, services/growth-orchestrator/,
local/) ; déploiement (Cloudflare Pages dashboard, CI GitHub Actions) ; renvois
PRIVACY.md / BEFORE-PUBLISHING.md / docs/audits/.
**Interdits** : toute mention de Vercel, `VITE_ANTHROPIC_API_KEY`, « Facades
Pollet », chemins de fichiers inexistants.

**Critère d'acceptation** : `grep -in "vercel\|VITE_ANTHROPIC\|Pollet" README.md` vide.

---

## LOT B — MED backend (audit sécu RÈGLE 6 fourni pour chaque endpoint touché)

### B1 (F-6) — `ai/proxy.ts` : masquer l'erreur upstream sur le chemin clé serveur
**Fichier** : `functions/api/ai/proxy.ts` (~l. 271-284)

**Changements** :
1. Branche « upstream KO » : si `isByok` → comportement inchangé (le user BYOK
   reçoit l'erreur Anthropic sur SA clé). Si `!isByok` → `console.error` du
   status + body (tronqué) côté serveur, réponse client
   `{ error: 'AI service error' }` avec le même status HTTP (aligné sur
   openai/gemini/mistral/tts).
2. Catch final : ne plus renvoyer `err.message` brut → `{ error: 'Proxy error' }`
   502 + `console.error` du détail.

### B2 (F-7) — `contacts/action.ts` : valider `resourceName` + erreurs génériques
**Fichier** : `functions/api/contacts/action.ts`

**Changements** :
1. `handleUpdate` : rejeter si `!/^people\/[a-zA-Z0-9_-]+$/.test(resourceName)`
   (400 générique), puis `encodeURIComponent` des deux segments à l'interpolation.
2. Aligner les erreurs sur la baseline N-2 : `handleSearch`/`handleCreate`/`handleUpdate`
   ne renvoient plus `err.error.message` Google → message générique
   (`'Search failed'` / `'Create failed'` / `'Update failed'`) + status upstream
   conservé + détail en `console.error`.

### B3 (F-8) — `account/delete.ts` : compléter l'effacement RGPD
**Fichier** : `functions/api/account/delete.ts`

**Changements** : ajouter (best-effort, même pattern try/catch par table) :
`DELETE FROM shared_conversations WHERE owner_email = ?` (hard delete — le
`content_json` est de la donnée personnelle publiée), `DELETE FROM email_otp
WHERE email = ?`, `DELETE FROM email_trial_sessions WHERE email = ?`,
`DELETE FROM email_trial_usage WHERE email = ?`, `DELETE FROM bg_quota WHERE
email = ?`, `DELETE FROM checkout_quota WHERE email = ?` (compteurs d'usage,
pas des pièces comptables). `wallet`/`credit_ledger`/`subscriptions`/`licenses`/
`premium_packs` restent conservés (rétention comptable, inchangé).

### B4 (F-22) — Durcissements d'URL mineurs
**Fichiers** : `functions/api/ai/gemini-proxy.ts` (~l. 133), `functions/api/drive/action.ts` (~l. 268)

**Changements** :
1. gemini-proxy : valider `model` avec `/^[a-zA-Z0-9.-]+$/` avant interpolation
   (400 sinon) — même modèle de validation que les IDs Gmail/Drive.
2. drive `handleMove` : `encodeURIComponent(previousParents)` (valeur issue de
   Google, défense en profondeur ; `id`/`folderId` déjà regex-validés).

### B5 (F-23 + F-30) — Fuites d'erreurs mineures + BUG 4 résiduel
**Fichiers** : `functions/api/memory/action.ts` (~l. 101-107),
`functions/api/sheets/append.ts` (~l. 30-33), `functions/api/wordpress/action.ts`,
`src/services/memoryService.ts` (~l. 47-53)

**Changements** :
1. memory/action : catch final → `{ error: 'Database error' }` + `console.error`
   (ne plus exposer le message D1 → schéma).
2. sheets/append : catch top-level → `{ error: 'Sheets action failed' }` + `console.error`.
3. wordpress/action : normaliser les status upstream propagés → 502 générique
   (endpoint owner-only, cosmétique mais aligne la baseline).
4. memoryService (`readMemoryD1`) : vérifier `res.ok` avant `res.json()` ;
   si `!res.ok` → `console.warn` + fallback `getDefaultData(category)` (comportement
   fonctionnel inchangé, mais la panne devient visible en console — BUG 4).

---

## LOT C — Config, dépendances, hygiène

### C1 (F-12) — Régénérer `schema.sql`
Rollup documentaire de TOUTES les tables D1 créées au runtime (extraites des
`CREATE TABLE IF NOT EXISTS` du code) : memory, quota, quota_model, trial_usage,
free_daily_quota, premium_cap, subscriptions, licenses, premium_packs, wallet,
credit_ledger, webhook_event, reservation, checkout_quota, bg_quota,
shared_conversations (+ index), email_otp, email_trial_sessions,
email_trial_usage, otp_rate. En-tête précisant : « documentation — la source de
vérité reste les `CREATE TABLE IF NOT EXISTS` du code (pattern BUG 38) ».

### C2 (F-13) — Régénérer `.env.example`
Aligné champ par champ sur `functions/env.d.ts` : toutes les variables serveur
(ALLOWED_EMAILS, quotas, secrets webhooks Creem/LS, RESEND/EMAIL_FROM/
EMAIL_TRIAL_SECRET, TURNSTILE_SECRET_KEY, RECONCILE_SECRET, SEARCH_PROVIDER/
LINKUP/BRAVE, GOOGLE_MAPS_API_KEY, COMPUTER_RELAY_*, bindings DB/KV en
commentaire), avec le bandeau RÈGLE 1 en tête. `GOOGLE_VISION_API_KEY` exclue
(config morte). Les seules variables `VITE_*` autorisées restent les non-secrets
(client_id Google, redirect URI).

### C3 (F-14) — Bumps de dépendances patchables
`react-router-dom` → ≥ 6.30.4 (CVE open redirect GHSA-2j2x-hqr9-3h42) et
`dompurify` → ^3.4.11 via `npm audit fix` / bump ciblé. Vérif : `npm ls`,
typecheck, tests, build. Pas de `--force`, pas de bump majeur.

### C4 (F-15) — Supprimer `netlify.toml`
Le site est servi par Cloudflare (vérifié en prod) ; le fichier est inerte ici
et dangereux si le repo est branché à Netlify par erreur (shadow-deploy sans
CSP ni env). La redirection www→non-www et le fallback SPA sont gérés côté
Cloudflare.

### C5 (F-17) — Régression a11y
`src/components/chat/ReflectionControl.tsx:37` : `text-theme-ink/70` → `text-theme-ink/80`.
`src/components/layout/Sidebar.tsx:465,609` : `text-theme-muted/70` → `text-theme-muted`
(couleur pleine, conforme au fix du 12 mai).

### C6 (F-25) — Purger les directives eslint orphelines
Supprimer les 17 commentaires `eslint-disable*` (aucun eslint dans le projet :
ni config, ni dep, ni step CI — directives inertes qui simulent une discipline
inexistante). L'ajout d'eslint à la CI reste une option future (hors périmètre).

---

## LOT D — Documentation

### D1 (F-18) — `BEFORE-PUBLISHING.md` + `local/install-tunnel.md`
1. PBKDF2 « 100k » → 600k (v2, migration lazy v1→v2).
2. Retirer `GOOGLE_VISION_API_KEY` de la liste des clés à configurer (morte).
3. Remplacer la section « whitelist désactivée / bloc commenté à réactiver »
   par la réalité : système de plans actif dans `checkAllowedUser.ts`
   (VIP allowlist / subscription / pro=BYOK / trial / free quota).
4. Mettre à jour les checkboxes réellement vérifiées (permissions Android/iOS).
5. `install-tunnel.md` : « Vercel » → Cloudflare Pages.

### D2 (F-19 + F-34) — Corrections CLAUDE.md
1. BUG 40 : corriger l'affirmation — Cloudflare Pages **supporte** `_headers`/
   `_redirects` ; la règle devient « pas de fichiers de config d'AUTRES
   plateformes (Netlify/Vercel) ; `_headers` est légitime et sert la CSP —
   attention, c'est lui qui avait cassé la géoloc web (F-2) ».
2. BUG 42 : `anthropic-proxy.ts` → `proxy.ts`.
3. Section TODO sécu : cocher/annoter les items traités par cette PR
   (contacts, leak ai/proxy, wordpress/contacts N-2, a11y), corriger le faux
   positif météo (open-meteo, pas de clé Maps), noter que geo/reverse est
   cappé, re-préciser le résiduel N-1 (peek paths uniquement) et rehausser la
   priorité du chantier CryptoKey non-extractible (le blob critique est le
   refresh_token Google, pas seulement les conversations).
4. Ajouter une entrée « MAJ 3 juillet 2026 — audit repo complet (PR #307) ».

---

## LOT E — Tests `functions/` (F-5, périmètre minimal)

**Nouveaux fichiers** : `src/__tests__/functions/` (inclus dans la config vitest
existante) ou `functions/__tests__/` selon ce que la config résout le plus
proprement — sans changer le runner.

**Couverture minimale visée** (fonctions pures ou mockables sans D1 réel) :
1. `parseAllowedEmails` (whitelist RÈGLE 2) : casse, espaces, vides, séparateurs.
2. Vérification de signature webhook (Creem et/ou Lemon Squeezy) : HMAC valide
   accepté, invalide rejeté, comparaison sur octets bruts (payload modifié → rejet).
3. Regex d'IDs (Gmail/Drive/Calendar/Sheets + la nouvelle `people/…` de B2 et
   le format modèle Gemini de B4) : cas valides/invalides/injection query-string.
4. `toolConfirmation` parité (voir A2 — vit côté src mais protège la RÈGLE 6).

**Hors périmètre du lot** : tests d'intégration D1 (nécessitent miniflare/wrangler
— chantier dédié), `consumeCapAtomic` (D1 réel requis pour l'atomicité).

---

## DIFFÉRÉ (hors de cette PR) — avec justification

| Finding | Décision | Justification / plan |
|---|---|---|
| **F-9** (aud sur les chemins peek) | **PR sécu dédiée** | Touche le gate d'auth universel ; exige un test web ET natif (tokens `serverAuthCode`, BUG 21/51). Plan : durcir `verifyGoogleUser`/`checkAllowedUserPeek` eux-mêmes, pas appelant par appelant. Déjà acté au CLAUDE.md. |
| **F-10** (Turnstile fail-open) | **Action ops Florent + décision** | Vérifier que `TURNSTILE_SECRET_KEY` est posée sur Cloudflare prod. Passer le code en fail-closed casserait l'OTP si la clé n'est pas configurée — à décider après vérification ops. |
| **F-11** (PKCE) | **PR dédiée** (plan existant) | « PR 2 » du CLAUDE.md : `buildOAuthUrl` async + `code_verifier` forwardé par `auth/token.ts`. Zone OAuth double-callback — tests web + deeplink requis. |
| **F-20** (helper commun clients IA) | **Chantier refactor dédié** | 4 fichiers critiques (streaming) ; un refactor transversal dans une PR fourre-tout violerait la discipline « zone à risque = PR dédiée ». |
| **F-21** (rate-limit license/activate) | Accepté / différé | Borné (paire secrète requise), décision #304 documentée dans le code. |
| **F-26** (god files) | Différé | Refactor pur, aucun gain fonctionnel immédiat ; à faire opportunément. |
| **F-27** (TODO Lemon Squeezy expiré) | **Décision Florent** | « Supprimer en juillet 2026 après validation prod » — la validation prod ne peut pas être constatée depuis le repo. |
| **F-28** (permissions Android) | Différé — **exige un test APK réel** | Retirer `READ_MEDIA_*`/`MODIFY_AUDIO_SETTINGS` peut casser des features silencieusement (classe BUG 33/44). À faire dans la passe pré-Play Store avec APK de test. |
| **F-29** (chunks > 500 kB) | Différé (perf) | jspdf/markdown déjà code-splittés ; le gros chunk restant demande une analyse bundle dédiée. |
| **F-31** (hash SHA-256 login local) | Différé | Pas une frontière d'auth ; migrer vers PBKDF2 invaliderait les hashes existants sans plan de migration. |
| **F-32** (tokeninfo en query-string) | Accepté | Interface documentée Google, token 1h ; pas d'alternative header documentée fiable. |
| **F-33** (IDs Creem TEST) | **Blocker go-live** (inchangé) | TODO `⚠️ replace at go-live` en place ; remplacer au lancement avec la clé LIVE. |
| **F-34** (CryptoKey non-extractible) | Chantier différé, **priorité rehaussée** | Documenté en D2 ; supprime passphrase/PBKDF2/sel et la classe de bugs de rotation (BUG 43/47/48). |

---

## Ordre d'exécution et vérifications

1. LOT A → LOT B → LOT C → LOT D → LOT E, commits séparés par lot.
2. Après chaque lot : `npx tsc --noEmit` + `npx tsc -p functions/tsconfig.json --noEmit`.
3. Fin de chantier : `npm test` complet, `npm run build`, revue du diff global
   par agent indépendant (RÈGLE 7), audit sécu RÈGLE 6 dans le message final
   pour chaque endpoint touché (B1→B5), push, mise à jour du descriptif PR #307.
