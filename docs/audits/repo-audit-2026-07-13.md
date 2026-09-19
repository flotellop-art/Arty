# 🔒 Audit sécurité Arty — 13 juillet 2026

Audit mensuel `/audit-secu`. 3 agents Explore en parallèle (backend Opus,
crypto/auth Google Opus, frontend/Capacitor Sonnet) + vérification directe
sur le terrain (grep/lecture de code + `git log`) des findings avant
publication. Aucune modification de code effectuée par les agents
(RÈGLE 6/7 — audit en lecture seule).

## ✅ Ce qui va bien

- **Backend (`functions/api/`)** : état excellent. Toutes les corrections
  des audits précédents tiennent — validation `aud` fail-closed sur tous
  les chemins qui dépensent la clé owner, leak upstream masqué partout,
  regex de validation sur tous les IDs interpolés, aucune requête D1 non
  paramétrée, aucune clé dans une URL, CSRF/Origin strict, webhooks HMAC
  constant-time, SSRF durci, OTP email exemplaire (CSPRNG, single-use
  atomique, rate-limit fail-closed).
- **Auth Google / crypto** : BUG 1, 3, 6, 23, 25, 41, 43, 47, 48, 51, 53
  toujours corrigés. PKCE S256 opérationnel. IV AES-GCM unique à chaque
  chiffrement. Pas de token/PII en clair dans les logs.
- **Frontend** : RÈGLE 1 respectée (aucune clé IA payante en `VITE_`),
  `rehype-sanitize` actif, allowlist stricte des boutons d'action LLM +
  confirmation HITL, permissions Android/iOS correctes, source maps off,
  pas de config Netlify/Vercel résiduelle.

## 🔴 CRIT actifs

Aucun.

## 🟠 HIGH actifs

### H1 — CSP `script-src` bloque le script de purge du Service Worker (previews + web)
**Fichiers** : `public/_headers:6`, `index.html:81-111`
**Statut** : confirmé sur le terrain (lecture directe + `git log`).

`script-src` n'a ni `'unsafe-inline'` ni nonce/hash. Le fix BUG 45 pour
les previews Cloudflare (`cf0b878 — fix(sw): désactive le Service Worker
sur les previews`) a ajouté un `<script>` inline classique (purge du SW +
reload) juste **en dessous** d'un commentaire qui dit explicitement
« Bandeau pre-launch : script externe (CSP refuse inline) » — le
développeur savait que le CSP bloque l'inline, et l'a quand même fait
pour ce nouveau bloc. Résultat : ce script ne s'exécute jamais en PWA
web/preview (bloqué par CSP), donc :
- Sur les previews, le SW périmé n'est plus purgé → régression exacte du
  symptôme historique BUG 45 (JS périmé servi indéfiniment aux testeurs).
- En web normal (tryarty.com), `navigator.serviceWorker.register('/sw.js')`
  ne s'exécute jamais non plus → pas de PWA offline ni de push
  notifications côté web (alors que `sw.js` gère les push).

**Impact** : pas une faille de sécurité exploitable par un tiers, mais un
mécanisme de sécurité/fiabilité récemment ajouté qui ne fonctionne pas en
production. Le natif Capacitor n'est pas concerné (pas de headers HTTP
Cloudflare sur le bundle local).
**Fix** : déplacer ce script dans un fichier externe `/sw-bootstrap.js`
servi depuis `self` (cohérent avec le traitement déjà fait pour
`arty-banner.js`), ou ajouter un nonce généré par Function Cloudflare.
Effort ~30 min.

### H2 — Chiffrement au repos inopérant pour les comptes non-BYOK (déjà tracké, priorité déjà relevée — F-34)
**Fichiers** : `src/services/crypto.ts`, tous les appels `initCrypto(keys.anthropic)`
(`useAuth.ts:48,88,194`, `App.tsx:796,890,950,979,1108`, `ApiKeysModal.tsx:47`)
**Statut** : confirmé sur le terrain. **Ce n'est pas un finding nouveau** —
il correspond exactement à l'item F-34 déjà noté dans la TODO Sécurité de
CLAUDE.md (« priorité rehaussée : le blob critique protégé par la
passphrase publique est le refresh_token Google, pas seulement les
conversations »). Le raisonnement du 16 mai (sandbox OS localStorage →
non-bloquant pour publication) reste valable, mais l'audit confirme que
rien n'a changé depuis.

Pour tout utilisateur sans clé BYOK, `initCrypto()` reçoit la constante
littérale `'server-provided'`, présente en clair dans le bundle JS livré.
La clé AES-256-GCM qui « protège » le `refresh_token` Google (accès
Gmail/Drive/Calendar/Contacts) est dérivée d'un secret connu de tous, avec
un sel lisible dans le même localStorage. Le chiffrement n'apporte aucune
confidentialité additionnelle pour ces comptes face à un accès local
(device rooté, extraction forensique).

**Fix propre (déjà identifié, différé)** : `CryptoKey` non-extractible via
`crypto.subtle.generateKey({extractable:false})` stockée en IndexedDB —
supprime toute la classe passphrase/sel/PBKDF2. Gros chantier, à
planifier en PR dédiée (déjà en tête de la liste des chantiers ouverts).

## 🟡 MED

- **M1 — `trial/init.ts` redéfinit localement `verifyTokenViaTokeninfo`**
  avec un garde plus faible que le helper central (`checkAllowedUser.ts`).
  Confirmé : la copie locale (`trial/init.ts:35-61`) fait
  `expectedAud && info.aud && info.aud !== expectedAud && ...` (le `&&
  info.aud` en trop laisse passer un token sans claim `aud`), alors que le
  helper central durci ne l'a plus. Impact limité (crée au pire une ligne
  `trial` squattée, aucune dépense de clé owner — les proxys re-vérifient
  strictement). **Fix** : supprimer la copie, importer la fonction
  centrale. ~15 min.
- **M2 — Fuite résiduelle de `err.message` dans 6 proxys IA** (mistral,
  gemini, openai, tts, whisper, voxtral) sur les exceptions `fetch`
  réseau — confirmé (`mistral-proxy.ts:255-257` et 5 autres). `ai/proxy.ts`
  (Anthropic) a déjà été durci en message générique ; les 6 autres non.
  Impact faible (le message d'un fetch qui échoue côté Workers est
  générique), mais incohérent avec la baseline. **Fix** : aligner sur le
  pattern `ai/proxy.ts`. ~30 min pour les 6 fichiers.
- **M3 — Scopes OAuth Drive/Gmail larges** (`drive` complet,
  `gmail.modify`) — amplifie l'impact de H2 si jamais exploité. À arbitrer
  selon les features réellement utilisées (`drive.file` réduirait
  fortement la surface).
- **M4 — `window.open` sans `noopener,noreferrer`** dans le fallback
  calendrier (`HomeScreen.tsx:85`), incohérent avec le reste du code qui
  applique systématiquement cette protection. ~5 min.

## 🟢 LOW

- Pas de timeout sur les fetch serveur → Google dans `auth/token.ts`,
  `auth/refresh.ts`, `checkAllowedUser.ts` (contrairement au reste du
  backend qui utilise `googleFetch` avec timeout 20s). ~20 min.
- `image-gen.ts` décrémente le compteur trial avant de vérifier
  `image_plan_locked` — auto-préjudice mineur pour l'utilisateur trial,
  pas un risque sécu.
- Sel PBKDF2 legacy partagé sur les devices déjà installés avant
  passage au sel per-user (couplage limité aux vieux devices).
- Deux balises `<link rel="canonical">` dupliquées dans `index.html`
  (cosmétique, signale un manque de revue sur ce fichier récemment
  modifié).
- Déjà connus et toujours différés volontairement : pas de rate-limit
  dédié sur `/api/auth/token` (C13, différé), IDs produits Creem en mode
  TEST (TODO go-live explicite dans le code).

## Faux positifs / déjà mitigé

Tous les points de la checklist RÈGLE 6 sur les 60 fichiers
`functions/api/` : IDOR, injection SQL, clés en URL, headers vides,
CORS/CSRF, premium cap atomique, license expirée — vérifiés OK.
`/api/license/activate` sans token Google : par design, barrière = clé
secrète + email, impact réduit par Pro=BYOK (PR #287) — accepté.

## Plan d'action

**Priorité 1 (cette semaine, effort cumulé ~1h30)**
- H1 : sortir le script de purge SW du inline (fichier externe ou nonce)
- M1 : dédupliquer `verifyTokenViaTokeninfo` dans `trial/init.ts`
- M2 : généraliser le masquage `err.message` aux 6 proxys restants
- M4 : `noopener,noreferrer` sur le `window.open` calendrier

**Priorité 2 (ce sprint)**
- Timeout sur les fetch Google des endpoints auth (LOW mais cohérence)
- Réévaluer les scopes Drive/Gmail (M3) si le produit le permet

**Priorité 3 (chantier majeur, déjà tracké F-34, non urgent selon le
cadrage du 16 mai)**
- `CryptoKey` non-extractible en IndexedDB — corrige structurellement H2,
  supprime toute la classe de bugs passphrase/sel/rotation.
