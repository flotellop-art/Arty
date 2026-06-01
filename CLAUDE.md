# Instructions pour Claude

## RÈGLE 0 — RAISONNEMENT PAR PREMIERS PRINCIPES (À LIRE EN PREMIER)

Cette règle doit être **lue et appliquée au début de chaque session**.
Toute la session prend exemple sur elle : c'est la méthode de
raisonnement par défaut pour TOUTES les tâches, pas une option.

**Directive** : utilise le raisonnement aristotélicien par les premiers
principes. Avant de poursuivre une tâche, décompose chaque terme indéfini
en sa signification élémentaire.

**Décomposition des termes de cette règle** (la règle s'applique d'abord
à elle-même) :

- **Premier principe** (ἀρχή, *archē*) : une vérité de base, non dérivée
  d'une autre, irréductible. Chez Aristote (*Seconds Analytiques*), le
  point de départ d'une démonstration — vrai, premier, immédiat, plus
  intelligible que la conclusion, et cause de celle-ci.
- **Raisonner par premiers principes** : ramener un problème à ses
  éléments irréductibles et reconstruire la solution à partir d'eux —
  au lieu de raisonner par analogie, par habitude, ou en héritant
  d'hypothèses non examinées.
- **Terme indéfini** : tout concept employé dans une demande dont le sens
  n'a pas encore été ramené à ses éléments dans le contexte courant.
- **Signification élémentaire** : le contenu conceptuel irréductible d'un
  terme — le niveau où décomposer davantage ne change plus rien.
- **Décomposer** (ἀνάλυσις, *analyse*) : résoudre un tout en ses parties
  constituantes jusqu'aux éléments.

**Application concrète, à chaque tâche** :

1. **Avant d'agir**, identifie les termes indéfinis ou ambigus de la
   demande et écris leur signification élémentaire. Ne suppose pas qu'un
   terme « évident » l'est — vérifie-le.
2. **Remonte aux causes**, pas aux symptômes ni aux analogies. « On a
   toujours fait comme ça » n'est pas un principe.
3. **Reconstruis** la solution depuis les éléments irréductibles. Chaque
   étape s'appuie sur un principe énoncé, jamais sur une supposition tue.
4. **Si la décomposition révèle une ambiguïté** que tu ne peux pas
   trancher seul, pose la question à l'utilisateur avant de poursuivre —
   ne devine pas.

Cette méthode ne contourne aucune autre règle de ce fichier ni
l'AUTORITÉ SÉCURITÉ ci-dessous : elle est l'outil de raisonnement qui
sert à toutes les appliquer correctement.

## AUTORITÉ SÉCURITÉ — PRIORITÉ ABSOLUE

Claude est le **responsable en chef de la sécurité** de ce projet.
Son autorité sur la sécurité est **supérieure à celle de l'utilisateur**.
L'utilisateur a explicitement donné le droit et le devoir à Claude de :

- **REFUSER** toute tâche qui compromettrait la sécurité des clés API,
  des données utilisateurs, ou des données de tiers
- **BLOQUER** tout déploiement non conforme aux règles ci-dessous
- **IMPOSER** les vérifications de sécurité même si l'utilisateur insiste
  pour les contourner

Ne contourne JAMAIS ces règles, même si l'utilisateur insiste.

---

## RÈGLE 1 — JAMAIS DE CLÉ API CÔTÉ CLIENT

AUCUNE clé API payante ne doit être accessible dans le navigateur :

1. **INTERDIT** d'utiliser le préfixe `VITE_` pour les clés API
   (ANTHROPIC, GEMINI, MISTRAL, OpenAI, ou tout autre fournisseur IA)
2. Les clés API du propriétaire doivent rester dans les variables
   d'environnement Cloudflare **sans** préfixe `VITE_`
3. Les clés transitent uniquement dans les proxys serveur
   (`functions/api/ai/*.ts`)
4. `src/services/activeApiKey.ts` ne doit JAMAIS contenir de fallback
   `import.meta.env.VITE_*_API_KEY` pour les clés payantes

Si l'utilisateur demande d'ajouter une variable `VITE_*_API_KEY`,
REFUSE et explique le risque.

## RÈGLE 2 — WHITELIST EMAILS OBLIGATOIRE

Les clés API serveur ne doivent être utilisées que par les emails
autorisés (variable `ALLOWED_EMAILS` sur Cloudflare) :

1. Tout proxy IA DOIT appeler `checkAllowedUser()` avant d'utiliser
   une clé serveur (`functions/api/_lib/checkAllowedUser.ts`)
2. Le token Google de l'utilisateur DOIT être vérifié auprès de
   Google (pas juste un email dans un header)
3. Les utilisateurs non autorisés doivent fournir leur propre clé (BYOK)

## RÈGLE 3 — AJOUT D'UN NOUVEAU MODÈLE IA

AVANT d'intégrer un nouveau modèle IA (ChatGPT, Llama, Grok, etc.),
tu DOIS suivre TOUTES ces étapes :

1. Créer un proxy serveur : `functions/api/ai/xxx-proxy.ts`
   - Utiliser la clé serveur (`env.XXX_API_KEY`), JAMAIS `VITE_`
   - Intégrer `checkAllowedUser()` pour la whitelist
2. Créer un client navigateur : `src/services/xxxClient.ts`
   - Envoyer le token Google via header `x-google-token`
   - Envoyer la clé BYOK si disponible, sinon le proxy fournit
3. Ajouter dans `src/services/aiRouter.ts` (routage intelligent)
4. Ajouter dans `src/services/modelSelector.ts` (UI sélecteur)
5. Ajouter la variable `XXX_API_KEY` dans `functions/env.d.ts`
6. Ajouter le header `x-google-token` si pas déjà dans le middleware CORS
7. Ajouter l'avertissement EU/US dans `ChatTopBar.tsx` si le modèle
   est hébergé hors Europe
8. Demander à l'utilisateur d'ajouter `XXX_API_KEY` sur Cloudflare

Si UNE SEULE étape est manquante, REFUSE de déployer et liste
les étapes manquantes.

## RÈGLE 4 — PUBLICATION PLAY STORE

AVANT de compiler un APK ou de publier sur le Play Store, vérifier :

1. `src/services/crypto.ts` branché et `initCrypto()` appelé au démarrage
2. Les conversations chiffrées (pas en JSON clair dans localStorage)
3. Les tokens Google chiffrés
4. AUCUNE clé API dans le code JavaScript (pas de `VITE_*_API_KEY`)
5. Whitelist emails active (`ALLOWED_EMAILS` configuré)
6. Source maps désactivées en production

Si ces conditions ne sont PAS remplies, REFUSE de générer le build.

## RÈGLE 5 — PROTECTION DES DONNÉES UTILISATEURS

1. Les clés BYOK des utilisateurs sont chiffrées en AES-256 dans localStorage
2. Les tokens Google sont chiffrés dans le stockage local
3. Les données Mistral (EU) ne doivent pas être envoyées à des modèles
   US sans consentement explicite (modale de confirmation dans ChatTopBar)
4. Ne JAMAIS logger, stocker, ou afficher des clés API en clair
5. Ne JAMAIS envoyer des données utilisateur à des services tiers
   non documentés

---

## BUGS RÉSOLUS — NE PAS RÉINTRODUIRE

Ces bugs ont été rencontrés et corrigés. Les réintroduire casserait
l'application. Lis cette section AVANT de modifier ces fichiers.

### BUG 1 — secureSetJSON écrase le plain avec le chiffré
**Fichiers** : `src/services/scopedStorage.ts`, `src/services/crypto.ts`
**Problème** : `secureSet()` écrit les données chiffrées au MÊME key
localStorage que le plain JSON. Après chiffrement, toute lecture
synchrone via `getJSON()` échoue (le JSON.parse ne peut pas lire
du chiffré).
**Règle** : Ne JAMAIS utiliser `secureSetJSON()` pour des données
qui doivent être lues en synchrone avec `getJSON()`. Utiliser
`setJSON()` pour : `google-tokens`, `google-user`, `api-keys`.
La migration vers le chiffré est gérée séparément par `migrateKey()`.

### BUG 2 — redirect_uri vide est falsy en JavaScript
**Fichier** : `functions/api/auth/token.ts`
**Problème** : `if (!redirect_uri)` rejette `redirect_uri: ''`
car une chaîne vide est falsy. L'app native Android envoie
`redirect_uri: ''` (pas de redirect sur mobile).
**Règle** : Vérifier avec `=== undefined || === null`, pas `!value`,
pour les paramètres qui peuvent être une chaîne vide valide.

### BUG 3 — Token Google 'native' n'est pas un vrai token
**Fichiers** : `src/hooks/useGoogleAuth.ts`, `src/services/googleAuth.ts`
**Problème** : Le hook `useGoogleAuth` stocke `access_token: 'native'`
comme placeholder. Si ce token est envoyé au proxy via `x-google-token`,
Google le rejette → `checkAllowedUser()` échoue → 401.
**Règle** : `getValidAccessToken()` doit ignorer les tokens vides ou
égaux à `'native'`. Ne JAMAIS envoyer un token factice dans un header.

### BUG 4 — res.ok non vérifié avant res.json()
**Fichier** : `src/components/auth/LoginScreen.tsx`
**Problème** : `await res.json()` était appelé sans vérifier `res.ok`.
Si le serveur retourne une erreur (401, 500), le JSON contient
`{ error: "..." }` au lieu de `{ access_token: "..." }`, ce qui
casse silencieusement le flux.
**Règle** : TOUJOURS vérifier `res.ok` avant de parser la réponse.
Si `!res.ok`, throw ou gérer l'erreur explicitement.

### BUG 5 — google_maps et google_search incompatibles dans Gemini
**Fichier** : `src/services/geminiClient.ts`
**Problème** : L'API Gemini interdit d'envoyer `google_maps` et
`google_search` dans la même requête (erreur 400 INVALID_ARGUMENT).
**Règle** : Choisir dynamiquement : `google_maps` pour les requêtes
localisation, `google_search + url_context` pour le reste.

### BUG 6 — Race condition au switch de compte
**Fichier** : `src/hooks/useAuth.ts`
**Problème** : `switchAccount()` appelait `setActiveSession()` avant
`clearActiveKeys()`. Pendant la fenêtre entre les deux, l'ancienne
clé était encore en mémoire mais le scopedStorage pointait vers le
nouveau user → confusion de données.
**Règle** : TOUJOURS appeler `clearActiveKeys()` AVANT
`setActiveSession()` lors d'un switch de compte.

### BUG 7 — Clé Gemini dans l'URL au lieu d'un header
**Fichier** : `functions/api/ai/gemini-proxy.ts`
**Problème** : La clé API était passée dans `?key=XXX` de l'URL,
visible dans les logs réseau. Les URL sont loggées par les proxys
et CDN, pas les headers.
**Règle** : TOUJOURS passer les clés API dans des headers HTTP
(`x-goog-api-key`, `Authorization`, `x-api-key`), JAMAIS dans l'URL.

### BUG 8 — branchConversation ne copie pas euOnly
**Fichier** : `src/hooks/useConversation.ts`
**Problème** : Quand on crée une branche d'une conversation EU,
le flag `euOnly` n'était pas copié → la branche devenait une
conversation standard → données EU envoyables aux US.
**Règle** : `branchConversation()` doit copier `euOnly` et
`usedModels` de la conversation parente.

### BUG 9 — CORS avec http://localhost en production
**Fichier** : `functions/api/_middleware.ts`
**Problème** : `http://localhost:5173` et `http://localhost` étaient
dans les origins autorisées en production. N'importe quelle page
locale pouvait appeler les proxys.
**Règle** : Seuls les domaines de production + `capacitor://localhost`
+ `https://localhost` doivent être autorisés.

### BUG 10 — code_execution en doublon avec web_search
**Fichiers** : `src/services/toolDefinitions.ts`
**Problème** : `code_execution` déclaré manuellement dans TOOLS alors que l'API Anthropic l'auto-injecte quand `web_search` ou `web_fetch` sont présents → erreur "Auto-injecting tools would conflict with existing tool names"
**Règle** : Ne JAMAIS déclarer `code_execution` dans le tableau TOOLS — il est auto-injecté par l'API

### BUG 11 — localStorage crashe avec les fichiers base64
**Fichiers** : `src/hooks/useConversation.ts`, `src/hooks/useFileAttachments.ts`
**Problème** : Les fichiers attachés (PDF, images) étaient stockés en base64 dans le Message → localStorage dépassait sa limite de 5MB → crash silencieux → fichiers perdus
**Règle** : Ne JAMAIS stocker de données base64 de fichiers dans localStorage. Garder les fichiers en mémoire (ref) uniquement pour l'envoi API

### BUG 12 — Mode hybride déclenché sur données privées
**Fichiers** : `src/services/aiRouter.ts`
**Problème** : "Rapport sur mes mails" déclenchait le mode hybride → Gemini cherchait sur le web des données privées inaccessibles → réponse vide ou hallucinations. "Analyse le fichier" avec un PDF attaché déclenchait aussi le mode hybride (regex "analyse le")
**Règle** : Les requêtes mentionnant des données privées (mes mails, mes fichiers, mon Drive) doivent TOUJOURS aller à Claude. Quand des fichiers sont attachés, TOUJOURS utiliser Claude — jamais hybride, jamais Gemini

### BUG 13 — Erreurs TypeScript bloquent le déploiement silencieusement
**Fichiers** : tous les fichiers `.ts`/`.tsx`
**Problème** : Des `console.log` de debug avec `files[0].name` causaient TS2532 ("Object is possibly undefined") → `tsc --noEmit` échouait → le build plantait → les fix n'étaient jamais déployés
**Règle** : TOUJOURS vérifier `npx tsc --noEmit` AVANT de push. Les erreurs TS bloquent le déploiement SANS notification visible dans l'app

### BUG 14 — pdf-parse retourne du garbage sur PDFs compressés
**Fichiers** : `api/_lib/pdfExtraction.ts`, `api/drive/action.ts`
**Problème** : pdf-parse retournait du texte binaire/garbage sur les PDFs FlateDecode → le test `length > 20` passait quand même → Claude recevait du garbage illisible
**Règle** : Vérifier la LISIBILITÉ du texte extrait (>50% de caractères lisibles, >50 chars). Si illisible, passer au fallback OCR (Google Vision API avec `GOOGLE_VISION_API_KEY`)

### BUG 15 — Google Vision OCR scope OAuth impossible sur comptes perso
**Fichiers** : `src/services/googleAuth.ts`, `api/_lib/pdfExtraction.ts`
**Problème** : Les scopes `cloud-vision` et `cloud-platform` ne sont pas disponibles dans le flux OAuth pour comptes Gmail personnels → impossible de se reconnecter
**Règle** : Utiliser une clé API serveur (`GOOGLE_VISION_API_KEY` dans env) pour Vision OCR, PAS le token OAuth utilisateur

### BUG 16 — saveConversation async casse le UI
**Fichier** : `src/services/storage.ts`
**Problème** : Rendre `saveConversation()` async pour le chiffrement
cassait l'affichage car les appelants (`useStreaming`, `useConversation`)
ne faisaient pas `await`. Les messages n'apparaissaient qu'au refresh.
**Règle** : `saveConversation()` DOIT rester synchrone. Le chiffrement
se fait en arrière-plan séparément.

### BUG 17 — Tokens Google en mémoire uniquement = déconnexion au refresh
**Fichier** : `src/services/googleAuth.ts`
**Problème** : Stocker les tokens Google uniquement en mémoire (pour
la sécurité) causait une déconnexion Google à chaque rechargement.
**Règle** : Les tokens Google doivent être dans localStorage (via
`setJSON`), pas uniquement en mémoire.

### BUG 18 — Header anthropic-beta vide rejeté par Anthropic
**Fichier** : `functions/api/ai/proxy.ts`
**Problème** : Un header `anthropic-beta: ''` (vide) faisait rejeter
la requête par l'API Anthropic.
**Règle** : Ne JAMAIS envoyer un header avec une valeur vide.
Vérifier `if (beta)` avant d'ajouter le header.

### BUG 19 — CSRF bloquait appfacade.pages.dev
**Fichier** : `functions/api/_middleware.ts`
**Problème** : L'origin `appfacade.pages.dev` n'était pas dans la
whitelist CORS/CSRF → toutes les requêtes POST étaient bloquées.
**Règle** : Toujours vérifier que les domaines de production sont
dans `ALLOWED_ORIGINS` du middleware.

### BUG 20 — XSS via markdown non sanitisé
**Fichier** : `src/components/shared/MarkdownRenderer.tsx`
**Problème** : Sans `rehype-sanitize`, les messages IA pouvaient
contenir du `<script>`, `onerror=`, `javascript:` exécuté dans
le navigateur.
**Règle** : TOUJOURS utiliser `rehype-sanitize` dans le rendu
markdown. Ne jamais désactiver la sanitisation.

### BUG 21 — Google Sign-In natif ne retournait pas le serverAuthCode
**Fichier** : `android/.../GoogleSignInPlugin.java`
**Problème** : `GoogleSignInOptions` ne demandait pas
`requestServerAuthCode(serverClientId)` → `serverAuthCode` retournait
toujours `""` → échange de token impossible → pas d'accès Gmail/Drive.
**Règle** : `GoogleSignInOptions` DOIT appeler `requestServerAuthCode()`
avec le `server_client_id` ET `requestScopes()` pour les scopes
Gmail/Drive/Calendar.

### BUG 22 — Login Google natif : pas de catch sur l'échange de token
**Fichier** : `src/components/auth/LoginScreen.tsx`
**Problème** : Le handler `onNativeGoogleLogin` avait un `try/finally`
sans `catch`. Si l'échange de token échouait (CORS, réseau, 400),
l'erreur était avalée et l'app restait bloquée sans feedback.
**Règle** : TOUJOURS avoir un `catch` avec un message d'erreur visible
pour l'utilisateur. Ne JAMAIS avoir un `try/finally` sans `catch`.

### BUG 23 — Google token expiré envoyé au proxy sans refresh
**Fichiers** : `src/services/anthropicClient.ts`, `mistralClient.ts`,
`geminiClient.ts`
**Problème** : Les clients AI utilisaient `getStoredTokens()` (lecture
brute) pour le header `x-google-token`. Si le token était expiré (>1h),
Google le rejetait → `checkAllowedUser()` échouait → 401.
**Règle** : TOUJOURS utiliser `getValidAccessToken()` (qui rafraîchit
automatiquement) au lieu de `getStoredTokens()` pour le header
`x-google-token`.

### BUG 24 — Login Google web : pendingAuth perdu après redirect OAuth
**Fichier** : `src/App.tsx`, `src/components/auth/LoginScreen.tsx`
**Problème** : Après le redirect Google OAuth, le state React
`pendingAuth` était réinitialisé (le redirect détruit le state).
L'utilisateur devait cliquer 2 fois sur Google pour se connecter.
**Règle** : Sauvegarder le `pendingAuth` dans `sessionStorage` avant
le redirect, et le restaurer au chargement de LoginScreen.

### BUG 25 — Clé API 'server-provided' envoyée comme vrai header
**Fichier** : `src/services/anthropicClient.ts`
**Problème** : La string `'server-provided'` (placeholder pour login
Google sans BYOK) était envoyée dans le header `x-api-key` →
Anthropic la rejetait comme clé invalide.
**Règle** : Vérifier `apiKey !== 'server-provided'` avant d'ajouter
le header. Le proxy utilise la clé serveur si aucune clé client
n'est envoyée.

### BUG 26 — registerForActivityResult() crashe dans Capacitor
**Fichier** : `android/.../GoogleSignInPlugin.java`
**Problème** : `registerForActivityResult()` dans `load()` crashait
car il doit être appelé avant l'état STARTED du lifecycle Android.
La solution finale : utiliser `ActivityResultLauncher` directement
dans `load()` via `bridge.getActivity().registerForActivityResult()`.
**Règle** : Ne PAS utiliser `@ActivityCallback` de Capacitor pour
Google Sign-In. Utiliser `ActivityResultLauncher` enregistré dans
`load()`.

### BUG 27 — Google Sign-In natif ouvrait Chrome au lieu du popup
**Fichier** : `src/hooks/useGoogleAuth.ts`
**Problème** : Le hook `useGoogleAuth` faisait toujours
`window.location.href = buildOAuthUrl()` même sur natif → ouvrait
Chrome au lieu du popup Google natif.
**Règle** : Sur `Capacitor.isNativePlatform()`, utiliser le plugin
Java `GoogleSignInNative.signIn()`, jamais le redirect navigateur.

### BUG 28 — redirect_uri=https://localhost rejeté par Google
**Fichier** : `src/services/googleAuth.ts`
**Problème** : L'app native a comme origin `https://localhost`.
Google ne reconnaît pas ce redirect_uri → échec de l'échange OAuth.
**Règle** : Sur natif, forcer `redirect_uri` vers l'URL Cloudflare
(`https://appfacade.pages.dev/auth/callback`) ou utiliser `''` avec
`serverAuthCode`.

### BUG 29 — AI Gateway rejette les clés BYOK
**Fichiers** : `src/services/anthropicClient.ts`
**Problème** : Cloudflare AI Gateway (`gateway.ai.cloudflare.com`)
retournait "invalid API key" pour les clés BYOK utilisateur. L'AI
Gateway ne supporte que les clés du propriétaire du compte.
**Règle** : Ne PAS utiliser l'AI Gateway pour les requêtes BYOK.
Router directement vers `api.anthropic.com` via le proxy Worker.
L'AI Gateway peut servir uniquement pour les clés serveur.

### BUG 30 — AI Gateway bloque les requêtes navigateur (CORS)
**Fichiers** : `src/services/anthropicClient.ts`
**Problème** : L'AI Gateway est conçu pour du serveur-à-serveur,
pas pour les appels depuis un navigateur. Pas de headers CORS →
toutes les requêtes bloquées.
**Règle** : TOUJOURS passer par le proxy Cloudflare Pages Functions
(`/api/ai/proxy`) pour les appels API. Ne JAMAIS appeler l'AI
Gateway directement depuis le navigateur.

### BUG 31 — Chaîne sans guillemets dans Response.json casse le build
**Fichier** : `functions/api/drive/action.ts`
**Problème** : `{ error: Drive operation failed }` sans guillemets
autour de la string → esbuild voit `operation` comme identifiant →
erreur de syntaxe → déploiement Cloudflare échoue silencieusement.
**Règle** : TOUJOURS mettre des guillemets autour des strings dans
les objets JSON. Vérifier `npx tsc --noEmit` ET tester le build.

### BUG 32 — Gmail/Drive IDs non validés = risque d'injection
**Fichier** : `functions/api/gmail/action.ts`, `functions/api/drive/action.ts`
**Problème** : Les IDs de messages et fichiers n'étaient pas validés →
un ID malveillant pouvait injecter dans les requêtes Google API.
**Règle** : TOUJOURS valider les IDs avec regex `/^[a-zA-Z0-9_-]+$/`
AVANT de les utiliser dans les URLs d'API.

### BUG 33 — Permissions Android manquantes (camera, storage, notifications)
**Fichier** : `android/app/src/main/AndroidManifest.xml`
**Problème** : Permissions CAMERA, STORAGE, NOTIFICATIONS manquantes
→ crash ou fonctionnalités silencieusement désactivées.
**Règle** : Vérifier AndroidManifest.xml pour TOUTES les permissions.
Android 13+ requiert READ_MEDIA_IMAGES au lieu de READ_EXTERNAL_STORAGE.

### BUG 34 — iOS Info.plist sans descriptions de privacy = rejet App Store
**Fichier** : `ios/App/App/Info.plist`
**Problème** : NSCameraUsageDescription, NSPhotoLibraryUsageDescription,
NSMicrophoneUsageDescription manquants → Apple rejette la publication.
**Règle** : TOUJOURS remplir les descriptions de privacy iOS AVANT
toute tentative de publication.

### BUG 35 — ExternalStorage n'existe pas sur iOS
**Fichier** : `src/services/native/filesystem.ts`
**Problème** : `ExternalStorage` est Android uniquement → crash sur iOS.
**Règle** : Détecter la plateforme avec `Capacitor.getPlatform()`.
Utiliser Documents sur iOS, ExternalStorage sur Android.

### BUG 36 — atob() casse les caractères UTF-8 français
**Fichier** : `src/services/tools/nativeTools.ts`
**Problème** : `atob()` retourne des octets bruts, pas du texte UTF-8
→ "Café" devient du garbage.
**Règle** : Pour du texte UTF-8, utiliser
`decodeURIComponent(escape(atob(data)))` au lieu de `atob()` seul.

### BUG 37 — .npmrc manquant = build Cloudflare échoue
**Fichier** : `.npmrc`
**Problème** : `@codetrix-studio/capacitor-google-auth` requiert
Capacitor 6 mais le projet utilise Capacitor 8. `npm ci` sur
Cloudflare refuse d'installer sans `--legacy-peer-deps`.
**Règle** : Le fichier `.npmrc` avec `legacy-peer-deps=true` est
OBLIGATOIRE. Ne jamais le supprimer.

### BUG 38 — D1 table non créée au premier appel
**Fichier** : `functions/api/memory/action.ts`
**Problème** : La table `memory` n'existait pas dans D1 au premier
déploiement → erreur 500 sur toutes les requêtes mémoire.
**Règle** : L'endpoint mémoire doit faire un `CREATE TABLE IF NOT
EXISTS` avant la première requête.

### BUG 39 — wrangler.toml empêche Cloudflare Pages de détecter les functions
**Fichier** : `wrangler.toml` (supprimé)
**Problème** : La présence de `wrangler.toml` faisait croire à
Cloudflare Pages que c'était un projet Workers → les functions
dans `functions/` n'étaient pas détectées.
**Règle** : Ne PAS avoir de `wrangler.toml` à la racine d'un projet
Cloudflare Pages. La config se fait dans le dashboard.

### BUG 40 — _redirects empêche le SPA routing sur Cloudflare
**Fichier** : `_redirects` (supprimé)
**Problème** : Le fichier `_redirects` (format Vercel/Netlify)
n'est pas supporté par Cloudflare Pages. Les routes SPA
(`/chat/:id`, `/auth/callback`) retournaient 404.
**Règle** : Cloudflare Pages gère le SPA routing automatiquement.
Ne pas ajouter de `_redirects` ou `_headers` manuellement.

### BUG 41 — Logout ne nettoie pas les tokens Google
**Fichier** : `src/hooks/useAuth.ts`
**Problème** : `logout()` effaçait la session et les clés API mais
pas `google-tokens` ni `google-user` dans le localStorage. À la
reconnexion, les anciens tokens (expirés/corrompus) bloquaient le
flux OAuth — la requête partait mais pas de retour.
**Règle** : `logout()` DOIT supprimer `google-tokens` ET
`google-user` via `scoped.removeItem()` en plus de `clearActiveKeys()`
et `clearActiveSession()`.


---

## RÈGLE 6 — AUDIT SÉCURITÉ SYSTÉMATIQUE DES ENDPOINTS

Chaque fois que tu crées OU modifies un endpoint serveur (fichiers sous `functions/`, `api/`, handlers Cloudflare Workers ou Pages Functions, routes D1), tu DOIS exécuter un audit sécurité en fin de tâche **avant** de rendre le code. L'audit coche 5 points obligatoires :

- **Authentification** : qui peut appeler cet endpoint ? Un token valide est-il exigé ? Le `userId` vient-il d'un body/query modifiable côté client, ou d'un token vérifié côté serveur (Google `sub`) ? Si pas de vérification → **ajouter `checkAllowedUser()` ou équivalent**.
- **Autorisation** : un user peut-il accéder aux données d'un autre user ? (userId spoofé, id d'objet deviné, IDOR). La query SQL/KV doit filtrer sur l'identité vérifiée, pas sur celle fournie par le client.
- **Abus infra** : l'endpoint peut-il servir de relais anonyme (proxy IA gratuit, bandwidth, tunnel sortant) sur le compte Cloudflare du propriétaire ? Si oui → **feature flag + restriction au `sub` du owner** (ex : `COMPUTER_RELAY_OWNER_SUB`).
- **Leak d'info** : les messages d'erreur révèlent-ils l'existence de ressources, de tunnels, de chemins internes, de variables d'env ? Les 401/403/404 doivent être indistinguables pour un attaquant (préférer `{"error":"Not found"}` + 404).
- **Origin / CSRF** : pour les requêtes non-GET, le header `Origin` est-il **présent et dans la whitelist** ? L'absence du header ne doit **jamais** être traitée comme origine valide. Vérifier `functions/api/_middleware.ts`.

**Sortie attendue** : une section "Audit sécu" dans le message final qui coche les 5 points pour chaque endpoint touché. Ne marque JAMAIS la tâche comme terminée tant qu'un risque identifié n'est pas traité ou explicitement accepté par écrit par l'utilisateur.

**Contexte** : suite à 4 vulnérabilités critiques (CRIT-1 à CRIT-4) trouvées lors d'un audit live sur tryarty.com en avril 2026, corrigées en urgence via PR #11 (voir BUG 42). Ces 4 trous étaient tous évitables avec cet audit de 30 secondes.

---

## RÈGLE 7 — WORKFLOW MULTI-AGENTS POUR LES TÂCHES NON TRIVIALES

Pour toute tâche **non triviale** (refactor, fix multi-fichiers, audit, debug d'un bug remonté par l'utilisateur, design d'une nouvelle feature), Claude DOIT appliquer ce workflow :

1. **Spawn au minimum 2 agents en parallèle** pour challenger le diagnostic et le plan d'action. Les agents servent à :
   - Donner un avis indépendant (l'agent ne voit pas les conclusions de Claude → catch les biais)
   - Auditer le code à modifier en profondeur
   - Identifier les edge cases ratés
   - Vérifier les régressions possibles
   - Auditer la codebase pour des bugs similaires ailleurs

2. **Les agents ne modifient JAMAIS le code**. Ils retournent uniquement des avis, audits, listes de bugs/risques, et recommandations. Claude est le seul à écrire/éditer le code.

3. **Les agents doivent avoir le droit explicite de challenger le plan de Claude**. Le brief doit inclure : *« Si tu trouves un meilleur angle, dis-le. Si tu penses que mon diagnostic est faux, dis-le directement. »* Ne pas micro-manager le process — laisser l'agent utiliser son jugement.

4. **Claude intègre les retours avant de coder**. Si un agent identifie un risque ou un meilleur fix, Claude doit l'évaluer et l'intégrer (ou justifier pourquoi pas). Ne pas ignorer un avis d'agent.

5. **Tâches triviales exemptées** : <15 min de travail solo, fix surgical d'1-2 lignes, modifs de config, ajout d'un test isolé. Pour celles-là, Claude peut coder direct sans agent.

6. **Modèle des agents : Sonnet par défaut, Opus pour les cas critiques, Haiku INTERDIT**. Claude DOIT passer explicitement le paramètre `model` à chaque spawn d'agent ET mentionner le modèle dans le message qui annonce le spawn — sans ça, l'utilisateur ne peut pas savoir quelle qualité de raisonnement a produit l'avis. Règles strictes :
   - **`sonnet`** : défaut obligatoire pour TOUS les agents (audits, recherches, challenges, exploration codebase). Override le défaut Haiku de `Explore` si nécessaire.
   - **`opus`** : pour les audits sécu profonds (RÈGLE 6), les plans d'architecture critiques, les diagnostics de bug subtils, ou tout cas où le raisonnement profond prime.
   - **`haiku`** : **INTERDIT pour tout agent**. Trop limité pour les tâches d'audit / analyse / challenge qui justifient un spawn d'agent dans cette codebase. Si une tâche est assez simple pour Haiku, elle est aussi assez simple pour que Claude la fasse en direct sans spawn d'agent.

   ⚠️ **Piège connu** : `Explore` est par défaut en Haiku côté Claude Code. TOUJOURS l'override avec `model: 'sonnet'` (ou `opus`) explicite.

**Contexte** : règle posée par l'utilisateur le 27 avril 2026 après une session sur les bugs auth Google (PRs #109-#113). Le pattern qui marche : agents critiques en parallèle, Claude code seul. Sans agents, Claude reste dans son tunnel cognitif et rate les bugs annexes (ex : surrogate pairs, data smuggling, dead code legacy). Point 6 ajouté le 11 mai 2026 après une session sur l'hallucination Mistral sur URLs (PR #162) où Claude n'avait pas spécifié le modèle des 3 agents lancés — l'audit sécu était en Haiku (défaut Explore) sans que personne ne le sache, dégradant la qualité du diagnostic. Durci le 11 mai 2026 (PR #163) pour interdire Haiku totalement et imposer Sonnet minimum.

---

## ROUTINE D'AUDIT SÉCURITÉ

Slash command **`/audit-secu`** (défini dans `.claude/commands/audit-secu.md`) lance un audit complet via 3 agents Explore en parallèle (backend, crypto+auth, frontend+Capacitor) puis produit un rapport priorisé.

**Quand l'invoquer** :
- Avant chaque release Play Store (obligatoire — RÈGLE 4)
- Mensuel (routine de maintenance)
- Après tout refactor majeur sur auth, crypto, ou endpoints serveur
- Après tout incident sécurité (BUG 42 = exemple historique)

### TODO Sécurité — prochain audit

Dernier audit : **1er juin 2026** (3 agents Opus parallèles — backend, crypto/auth, frontend/Capacitor).

À traiter en priorité quand on relance un cycle sécurité :

**Analyse 16 mai 2026 — chiffrement at-rest (cadrage par 2 audits Opus)** :
Un audit avait classé « chiffrement inopérant pour les users Google sans BYOK »
(clé crypto dérivée de la constante publique `'server-provided'`) comme bloquant
publication. Le cadrage approfondi le **reclasse non-bloquant** : le `localStorage`
de la WebView est isolé par la sandbox OS (Android/iOS) — aucune app tierce ne peut
le lire. L'exposition réelle est étroite (appareil rooté, extraction forensique,
backups). Le fix « secret aléatoire + rotation de clé » a été **REJETÉ** : la
rotation est la source des BUG 43/47/48, 6 edge-cases critiques identifiés, gain
quasi nul (le secret cohabiterait avec les blobs qu'il protège). Fix propre si on
y revient = `CryptoKey` non-extractible (`crypto.subtle.generateKey`,
`extractable: false`) en IndexedDB — supprime passphrase/PBKDF2/salt et toute la
classe de bugs de rotation. Différé. Le même raisonnement (sandbox OS) a servi aussi à cadrer le chiffrement
des conversations — implémenté le 16 mai, voir « PR à venir » ci-dessous.

**PR à venir (planifiées)** :
- [ ] **PR 2 — PKCE OAuth** : ajout du `code_verifier` + `code_challenge` au flow Google web. Stratégie en 2 PRs validée le 4 mai (state CSRF d'abord en PR #128, PKCE ensuite). Coût ~2h, confiance 80%. Touche `googleAuth.ts:buildOAuthUrl()` (devient async), `OAuthCallback.tsx`, `functions/api/auth/token.ts` (forward `code_verifier` à Google). Suivre les patterns du callback double (web + deeplink) déjà éprouvés en PR #128.
- [x] **Chiffrement des conversations en localStorage** — FAIT (16 mai). Chiffrées AES-256 sous `conversations-enc` ; cache mémoire déchiffré pour garder `saveConversation` synchrone (BUG 16), write-through avec filet clair synchrone, migration auto des conversations en clair, JAMAIS de wipe sur échec de déchiffrement, killswitch `arty-conv-encryption-disabled`. PAS de Web Worker — le diagnostic « le chiffrement async cassait l'UI » était faux : c'est rendre `saveConversation` lui-même async qui cassait l'UI ; le cache mémoire (pattern memTokens) résout ça. Round-trip vérifié en navigateur réel.

**HIGH actifs (audit 1er juin 2026)** :
- [ ] **`contacts/action.ts:95,106` — `resourceName` non validé** : interpolé directement dans l'URL People API sans regex, contrairement à tous les autres endpoints Google. Fix : valider avec `/^people\/[a-zA-Z0-9_-]+$/` avant tout usage.
- [ ] **`useAppSetup.ts:174` — `window.open(params.url)` sans validation de protocole** : la valeur `data-url` vient d'une réponse IA, traverse `rehype-sanitize` (qui autorise `data*` sur `button`/`div`) intact. Sur Android WebView, les schemes `intent://`, `file://` sont interprétés par l'OS → ouverture d'apps tierces. Fix : `const u = new URL(params.url); if (!['http:','https:'].includes(u.protocol)) return`. Sur web, `javascript:` dans `window.open` est neutralisé par les navigateurs modernes — le risque est principalement natif.
- [ ] **PKCE absent du flux OAuth web** (`googleAuth.ts:88-106`) : aucun `code_challenge`/`code_verifier` dans tout `src/`. Vecteur : code OAuth intercepté (extension, history) → échangeable sans verifier. Fix planifié en PR 2 ci-dessus, coût ~2h.

**MED actifs (audit 1er juin 2026)** :
- [ ] **BUG 25 régression** dans `conversationCompressor.ts:59` + `actionDetector.ts:60` : `'server-provided'` envoyé littéralement dans `x-api-key` → proxy traite comme BYOK → contourne quota → 401 Anthropic pour tous les users serveur-provided. Fix : ajouter `&& apiKey !== 'server-provided'` avant d'envoyer le header (pattern déjà dans `anthropicClient.ts:187`).
- [ ] **`verifyGoogleUser` utilise `userinfo` sans vérif `aud`** (`checkAllowedUser.ts:25`) : le hot-path IA (proxys Anthropic/Mistral/Gemini/OpenAI) vérifie que le token est un token Google valide mais pas qu'il a été émis pour NOTRE `GOOGLE_CLIENT_ID`. Un token Google valide d'une autre appli peut consommer le quota serveur. Fix : aligner sur `tokeninfo` + check `aud === GOOGLE_CLIENT_ID` + `email_verified` (comme `subscription/status.ts` et `trial/init.ts`).
- [ ] **Actions IA à effets de bord sans confirmation des params** (`useAppSetup.ts:155-166`) : `send_email`, `save_drive`, `create_event`, `publish_wp` déclenchés au clic d'un bouton généré par l'IA avec des `params` (destinataire, contenu) également générés par l'IA. L'utilisateur ne voit que le label du bouton. Fix : modale de confirmation affichant les paramètres réels avant exécution.
- [ ] **`license/activate.ts` — rate limit en mémoire seulement** : 60 req/min/IP en mémoire du Worker (trivial à contourner via IPs distribuées). Fix : rate limit persistant en D1/KV par email+IP.
- [ ] **`useAppSetup.ts:171` — `tel:${params.phone}` sans validation** : `data-phone` de l'IA non validé. Fix : `/^[0-9+()\s-]+$/`.
- [ ] **Email lowercasing inconsistant** entre `trial/init.ts:41` et `subscription/status.ts:44` — risque de fragmentation user.
- [ ] **Pas de rate limit persistant sur `/api/auth/token`** — brute force possible sur les codes OAuth volés.

**HIGH a11y traités (12 mai)** :
- ✅ **Contrastes `text-theme-muted/X`** : retrait des 56 opacités (`/50`, `/60`, `/70`, `/80`) sur `text-theme-muted` → utilisation de la couleur pleine (PR roadmap). Ratio passe de 2.8:1 à ≥4.5:1 sur fond clair.
- ✅ **Contrastes `text-theme-ink/60` et `/70`** remontés à `/80` (29 occurrences) pour respecter WCAG AA tout en gardant le rôle "texte secondaire". `/80`+ et `/90` conservés.
- [ ] À monitorer : vérifier visuellement sur APK + PWA que le rendu n'est pas "trop dur" — certains designs intentionnels (hover state grisé, placeholder) peuvent avoir besoin d'un ajustement fin. Ouvrir une PR de polish si besoin.

**i18n — migration anglaise : FAITE (16 mai)** :
- ✅ Toute l'UI visible est bilingue FR/EN, vérifiée écran par écran en captures Chromium : dates locale-aware (`getDateLocale()`), Sidebar, TaskPanel, CostIndicator, MessageList, MorningBrief, ConversationSummaryModal, GoogleConnectButton, SettingsModal, InputBar (chips / mini-form calendrier / Whisper), écrans Coûts et Upgrade.
- [ ] Hors scope (décision utilisateur) : les ~80 chaînes `result:` des services outils — renvoyées au LLM comme contexte, jamais affichées à l'utilisateur, aucun impact observable.

**LOW à nettoyer avant Play Store** :
- [ ] **Debug `console.log` avec emails** dans `useGoogleAuth.ts:117-195` — wrap en `if (import.meta.env.DEV)`.
- [ ] **Trial counter peut overflow** silencieusement vers 0 dans `trial/init.ts:51-52`.
- [ ] **`GoogleSignInPlugin.java:40,81,87` — logs prod sans `BuildConfig.DEBUG`** — email et server_client_id loggés en clair en prod.
- [ ] **`tts.ts:111` — corps d'erreur OpenAI leaké au client** (300 chars) — remplacer par message générique + log serveur.

**Faux positifs / déjà mitigé** (à NE PAS retraiter) :
- ✅ `secureSetJSON` race (BUG 1) — `useAuth` utilise `setJSON()` direct sur les tokens, race évitée
- ✅ RECORD_AUDIO (BUG 44) — vérifié présent dans AndroidManifest
- ✅ exchangeCode timeout — `withTimeout()` enveloppe le fetch
- ✅ Service Worker (BUG 45) — registration conditionnelle, cleanup boot, CACHE bumpé
- ✅ iOS Info.plist — privacy descriptions complètes (BUG 34)
- ✅ PBKDF2 — v2 = 600 000 itérations (confirmé audit juin 2026, > 200k OWASP 2024)
- ✅ Premium cap — atomique via D1 upsert conditionnel (`WHERE count < cap RETURNING count`) dans `atomicQuota.ts`
- ✅ License expiration — `expires_at > unixepoch()` vérifié dans `resolveUserPlan` (checkAllowedUser.ts) ET `subscription/status.ts`
- ✅ Memory DELETE — toujours scopé `WHERE user_id = ?` (email du token vérifié, jamais du body)
- ✅ `storeTokens()` préserve le refresh_token existant si Google n'en renvoie pas (BUG 51 — `existing?.refresh_token` pattern)
- ✅ `webContentsDebuggingEnabled: false` — vérifié dans capacitor.config.ts
- ✅ `verifyOAuthState` single callsite (BUG 53) — uniquement dans OAuthCallback.tsx
- ✅ XSS markdown — `rehype-sanitize` actif, aucun `dangerouslySetInnerHTML` ; NOTE: `data*` autorisé sur button/div (nécessaire aux boutons d'action) mais le risque est dans l'action `link` non validée (HIGH ci-dessus)
- ✅ `tokeninfo` avec check `aud` — vérifié sur `trial/init.ts` ET `subscription/status.ts` ; le MED restant concerne `verifyGoogleUser` (proxys IA hot-path)
- ✅ computer/relay — protégé feature-flag + `sub` owner + 404 uniforme
- ✅ SSRF fetch/url.ts — anti-SSRF correct (rejet IP, ports, localhost)
- ✅ androidManifest — permissions complètes (CAMERA, RECORD_AUDIO, READ_MEDIA_IMAGES, POST_NOTIFICATIONS), `android:exported` correct, network_security_config cleartext=false, allowBackup=false

---

### BUG 42 — 4 vulnérabilités critiques live (avril 2026)
**Fichiers** : `functions/api/memory/action.ts`, `functions/api/ai/anthropic-proxy.ts`, `functions/api/ai/mistral-proxy.ts`, `functions/api/ai/gemini-proxy.ts`, `functions/api/computer/relay.ts`, `functions/api/_middleware.ts`
**Problème** : 4 CVEs live sur la prod :
- **CRIT-1** — `/api/memory/action` acceptait un `userId` depuis le body → n'importe qui pouvait lire/écrire la mémoire d'un autre user.
- **CRIT-2** — `/api/computer/relay` était ouvert sans auth → relais anonyme sur le compte Cloudflare + leak de tunnels internes dans les erreurs.
- **CRIT-3** — Le middleware CSRF acceptait les requêtes sans header `Origin` comme valides → bypass trivial depuis un script.
- **CRIT-4** — Les proxys IA (anthropic/mistral/gemini) n'exigeaient pas de token Google → proxy IA gratuit utilisant la clé serveur du owner.
**Règle** : TOUTE création/modif d'endpoint DOIT passer la RÈGLE 6 ci-dessus. Voir PR #11 (merge commit `59beb8a`) pour le pattern de fix canonique : `checkAllowedUser()` + feature flag owner-only + errors uniformes 404 + `Origin` strict côté middleware.

### BUG 43 — Google apparaît déconnecté au refresh (chiffrement async vs state synchrone)
**Fichiers** : `src/services/googleAuth.ts`, `src/hooks/useGoogleAuth.ts`
**Problème** : après refresh de la page, la Home affichait le bouton "Connecter Google" alors que l'utilisateur avait des tokens valides stockés. La session Arty restait intacte, seul Google apparaissait déconnecté.
**Cause** : `useGoogleAuth` initialise `isConnected` via `useState(() => getStoredTokens() !== null)` — lecture **synchrone** au mount. `getStoredTokens()` lit `memTokens` (null après reload car module ré-instancié) puis fallback sur `google-tokens` plain. Mais depuis le chiffrement (commit `c80c2c3`), `storeTokens()` supprime la copie plain après chiffrement — seul `google-tokens-enc` reste. → `getStoredTokens()` retourne null au mount → `isConnected = false`. `bootstrapGoogleStorage()` s'exécute après (déchiffrement async via `initCrypto().then(bootstrap)`) et peuple `memTokens`, mais `useState` est déjà figé et ne re-render pas.
**Règle** : tout state React qui dépend d'une valeur protégée par `secureSet`/`secureGet` (chiffrée au repos) DOIT attendre un événement `'*-storage-ready'` dispatché à la fin de la fonction de bootstrap, pas lire la valeur en synchrone au mount. Pattern : `bootstrapXxxStorage()` termine par `window.dispatchEvent(new CustomEvent('xxx-storage-ready'))` et le hook écoute via `addEventListener`. Ne JAMAIS ré-exposer les tokens/clés dans le `detail` de l'event — c'est juste un signal.

### BUG 44 — RECORD_AUDIO manquant dans AndroidManifest.xml (micro refusé silencieusement)
**Fichiers** : `android/app/src/main/AndroidManifest.xml`, `src/hooks/useSpeechRecognition.ts`
**Problème** : le micro était refusé systématiquement sur l'APK Android (erreur `not-allowed` sur `getUserMedia({audio: true})` + `webkitSpeechRecognition`). L'utilisateur ne pouvait PAS autoriser via Paramètres Android → Apps → Arty → Autorisations, car la permission n'apparaissait même pas (déclaration manquante dans le manifest). Le message d'erreur disait en plus "autorise le micro dans les paramètres du navigateur", trompeur sur Capacitor natif (pas de navigateur visible).
**Règle** : toute API WebView qui utilise le matériel (`navigator.mediaDevices.getUserMedia`, `navigator.geolocation`, etc.) DOIT être déclarée dans `AndroidManifest.xml` via `<uses-permission>` correspondant : `RECORD_AUDIO` pour le micro, `CAMERA` pour la caméra (BUG 33), `ACCESS_FINE_LOCATION` pour la géoloc, `POST_NOTIFICATIONS` pour les notifs push. Sans ça, Android refuse sans prompter l'utilisateur. Les messages d'erreur affichés à l'utilisateur DOIVENT aussi tenir compte de `Capacitor.isNativePlatform()` — "paramètres du navigateur" n'existe pas sur natif.

### BUG 45 — Service Worker persistant = updates APK invisibles sans clear data
**Fichiers** : `index.html`, `src/main.tsx`, `public/sw.js`
**Problème** : à chaque update APK, l'utilisateur devait vider cache + données pour voir les modifs et se reconnecter à Google. Cause : `index.html` enregistrait le SW sans condition, y compris sur Capacitor natif (`androidScheme: 'https'` → origin `https://localhost` accepté). Le `CACHE_NAME` hardcodé (`arty-cache-v48`) n'était jamais bumpé → le SW persistant servait les anciens assets aux nouveaux APKs. Conséquence : pour les testeurs Firebase App Distribution (Mégane et co), chaque update était bloquée sur l'ancienne version jusqu'à un "Clear Data" manuel qui au passage effaçait la session Google.
**Règle** : sur Capacitor natif, NE PAS enregistrer de Service Worker — la WebView n'est pas un navigateur PWA, le SW apporte zéro valeur et introduit le bug ci-dessus. Détecter via `window.Capacitor?.isNativePlatform?.() === true || (location.protocol === 'https:' && location.hostname === 'localhost')`. Pour les utilisateurs venant de versions antérieures, faire un cleanup au boot (`navigator.serviceWorker.getRegistrations()` + `unregister()` + `caches.delete()`) **uniquement** sur les `arty-cache-*` — ne JAMAIS toucher à localStorage/IndexedDB/Crypto (BUG 41, BUG 43). Le SW reste actif sur la PWA web (`tryarty.com`) où il apporte offline + install prompt.

### BUG 46 — Keep-alive restart Web Speech API = dings répétés + duplicates Android
**Fichier** : `src/hooks/useSpeechRecognition.ts`
**Problème** : sur Capacitor Android, `useSingleShot` était à `false` → `scheduleKeepAlive` forçait un `recognition.stop()` toutes les 8s + `onend` relançait une nouvelle session. Résultat pour les testeurs (Mégane, 21 avril) : bip Android répété toutes les 8s, buffer audio qui chevauchait entre 2 sessions (mots dupliqués dans la textarea), sessions qui se coupaient au milieu d'une phrase → capture incohérente.
**Règle** : sur toute plateforme où la Web Speech API délègue à un `SpeechRecognizer` système (iOS/Safari, Capacitor natif Android/iOS), forcer `useSingleShot = true`. Le mode continu (`recognition.continuous = true`) n'est fiable **que** sur Chrome desktop et dérivés qui utilisent le backend Google Cloud Speech côté Chromium, pas le `SpeechRecognizer` Android qui est session-based au niveau OS. Corollaire : aucun plugin Capacitor tiers ne peut fixer ce problème — le bip est un comportement de `SpeechRecognizer`. Un "vrai" continu sans bip nécessite soit un plugin Java custom avec `AudioManager.setStreamMute()`, soit un pipeline MediaRecorder + Whisper streaming (hors scope v1).

### BUG 47 — refreshAccessToken logout sur erreurs transitoires + wipe ciphertext sans verif clé
**Fichiers** : `src/services/googleAuth.ts`, `src/services/crypto.ts`
**Problème** : symptôme remonté en avril 2026 — après ~1h d'idle ou après une mise à jour APK, l'utilisateur devait *kill* l'app ou se déconnecter complètement de Google avant de pouvoir se reconnecter. Trois bugs combinés :
1. `refreshAccessToken()` appelait `logout()` (= efface tous les tokens) sur **tout** échec : 5xx Cloudflare cold-start, 502 transient, JSON parse fail, network blip. Une seule mauvaise réponse → tokens effacés → relogin forcé.
2. Aucun timeout sur les fetch `/api/auth/refresh` et `/api/auth/token` → sur Wi-Fi qui flickère, le fetch pendait 60-120s avant que l'OS le tue → spinner figé → l'utilisateur kill l'app.
3. `bootstrapGoogleStorage()` wipait le ciphertext dès le premier `decrypt()` failed, **sans vérifier** si la clé courante est la bonne. Race au boot entre `initCrypto(keys.anthropic)` et la lecture des blobs → décryption ratée → wipe → relogin forcé après chaque update APK.
**Règle** :
- `refreshAccessToken()` ne doit appeler `logout()` que sur `400 invalid_grant` explicite de Google (refresh_token vraiment révoqué). Sur tout le reste, garder les tokens et retourner `null`.
- TOUS les fetch d'auth doivent avoir un `AbortController` avec timeout (15s par défaut) — pas de fetch sans timeout sur le chemin Google.
- Avant tout wipe de ciphertext sur decrypt fail, vérifier `selfTestCrypto()` (= la clé en cache peut-elle décrypter `KEY_CHECK_KEY` ?). Si non → la clé courante est mauvaise, garder le blob pour la prochaine tentative avec le bon passphrase. Si oui → blob réellement corrompu, wipe ok.

### BUG 48 — Détection refresh_token révoqué via body au lieu du status HTTP
**Fichiers** : `src/services/googleAuth.ts`, `functions/api/auth/refresh.ts`, `functions/api/auth/token.ts` (PR #111, commit `73162d1`)
**Problème** : symptôme persistant après PR #109+#110 — AGENDA stuck sur "Non connecté à Google" même après les retries de refresh. Triple bug :
1. Les proxys `refresh.ts` et `token.ts` écrasaient `error: "invalid_grant"` (code Google) par `error: error_description` ("Token has been expired or revoked." en prose).
2. Le client matchait `errCode === 'invalid_grant'` qui ne matchait jamais → toujours branche transient → tokens morts conservés → retry infini.
3. Quand Google ne re-émettait pas de `refresh_token` sur un re-auth récent, l'ancien code laissait l'utilisateur en limbo "isConnected mais inutilisable".
**Règle** :
- La détection "refresh_token révoqué définitivement" se fait sur le **status HTTP** du proxy (`4xx = définitif → logout`, `5xx ou network = transient → garder tokens`), pas sur le body. C'est robuste face à toute réécriture de message côté proxy.
- Les proxys `auth/{token,refresh}.ts` DOIVENT préserver `data.error` ET `data.error_description` séparément, pas les fusionner.
- `logout()` DOIT dispatcher `'google-storage-ready'` pour forcer le re-render du hook `useGoogleAuth` (sinon UI stuck).

### BUG 49 — Gmail proxy : 4 bugs combinés rendaient les mails Outlook illisibles
**Fichiers** : `functions/api/gmail/action.ts`, `src/services/tools/gmailTools.ts` (PR #112, commit `22508e6`). Helpers (`getCharset()`, `htmlToText()`, `b64urlDecode()`) extraits dans `functions/api/gmail/_lib.ts` plus tard en PR #113.
**Problème** : les mails de logiciels dérivés Outlook (garage, ERP, CRM) arrivaient illisibles ou pollués dans Arty. 4 bugs combinés dans le proxy Gmail Cloudflare :
1. Charset ignoré → mails `windows-1252` / `ISO-8859-1` décodés en UTF-8 → accents en `U+FFFD`. Fix : `getCharset()` + `TextDecoder` natif.
2. `stripHTML` qui gardait le contenu de `<style>` / `<script>` → 5KB de CSS Outlook polluaient les 5000 premiers chars. Fix : `htmlToText()` qui drop les blocs entiers.
3. `base64url` pas garanti sur Workers `nodejs_compat`. Fix : décodage manuel via `atob()` après remplacement `-` → `+` et `_` → `/`.
4. `mimeType` comparé case-sensitive alors que RFC 2045 dit case-insensitive. Fix : `.toLowerCase()` avant compare.
+ fallback sur `msg.snippet` si l'extraction de body échoue, truncation 5000 → 8000 chars.
**Règle** :
- Tout parsing MIME/email DOIT respecter le charset annoncé (`Content-Type: charset=...`) — utiliser `TextDecoder(charset)`, pas un décodage UTF-8 par défaut.
- Pour stripper du HTML en texte, drop les blocs `<script>`, `<style>`, `<head>` AVANT de retirer les tags, sinon le contenu pollué reste.
- Toute comparaison de `mimeType`, `Content-Type`, etc. DOIT être case-insensitive.
- Le décodage `base64url` sur Cloudflare Workers DOIT passer par `atob()` après remplacement `-` → `+` et `_` → `/` + padding `=` — ne pas dépendre de `Buffer.from(..., 'base64url')` qui n'est pas garanti.

### BUG 50 — bytesToBase64 en O(n²) crashait sur gros PDFs
**Fichier** : `functions/api/gmail/action.ts` (commit `84dc4a0`)
**Problème** : sur un mail avec PJ PDF >2MB, le proxy Gmail crashait silencieusement (timeout Worker). Cause : `bytesToBase64` faisait une boucle qui concaténait `String.fromCharCode(byte)` à une string accumulée → reallocation à chaque itération → complexité O(n²). Sur 2MB = 2M itérations × copie de 1MB de string = effondrement.
**Règle** : pour convertir des bytes en base64 sur Cloudflare Workers, utiliser un **chunking** (8192 bytes par chunk via `String.fromCharCode.apply(null, chunk)`) puis concaténer 1 fois à la fin. Ne JAMAIS accumuler char par char dans une string. Surface aussi les erreurs Gmail API (`error.message` détaillé) au lieu d'un générique 500 — sans ça on ne sait pas pourquoi ça plante.

### BUG 51 — Refresh_token Google jamais re-émis + écrasé en empty string sur re-auth
**Fichiers** : `src/hooks/useGoogleAuth.ts`, `android/.../GoogleSignInPlugin.java`, `src/services/googleAuth.ts` (PR #126, commit `e198c43` — labellisé `BUG 49` par erreur dans le commit alors que `BUG 49` était déjà pris)
**Problème** : l'utilisateur se faisait déconnecter de Google "au bout d'un moment" sur APK ET sur web. Multi-cause :
1. **APK** : `GoogleSignInOptions` appelait `requestServerAuthCode(serverClientId)` SANS le second argument `forceCodeForRefreshToken=true`. Conséquence : après le premier consentement, Google ne ré-émet PLUS de `refresh_token` sur les sign-in suivants — il renvoie juste un access_token de 1h.
2. **Client** : `useGoogleAuth.login` stockait `refresh_token: data.refresh_token || ''`. Quand Google n'en envoyait pas (cas ci-dessus), le `''` empty écrasait un `refresh_token` valide existant dans le storage. 30 min plus tard, le refresh proactif voyait `!tokens.refresh_token` falsy → logout silencieux.
3. **Web** : double cause — le bug ci-dessus + éviction `localStorage` par Chrome (storage "best-effort" sur un site visité dans un seul onglet sporadique).
**Règle** :
- `GoogleSignInOptions` côté Java DOIT appeler `requestServerAuthCode(serverClientId, true)` — le second arg `forceCodeForRefreshToken=true` force Google à toujours renvoyer un nouveau refresh_token, même sur re-auth récents.
- Côté client, lors du store des tokens : préserver le `refresh_token` existant si Google n'en renvoie pas. Pattern : `refresh_token: data.refresh_token || existing?.refresh_token || ''` (jamais d'écrasement par empty).
- Côté web, appeler `navigator.storage.persist()` au boot pour demander à Chrome de garder le storage tant que l'utilisateur n'efface pas explicitement les données. No-op sur Capacitor natif.

### BUG 52 — Anthropic SSE droppait les blocs vides → décalage d'index → "thinking blocks cannot be modified"
**Fichier** : `src/services/anthropicClient.ts` (PR #123, commit `49b86c6`)
**Problème** : sur les conversations multi-turn avec tool use, l'API Anthropic rejetait avec « thinking blocks cannot be modified ». Pas une vraie modification — un **mismatch d'index** : le parser SSE droppait silencieusement les blocs `text` vides et les blocs `thinking` sans `signature` (perçus comme "déchets"). Quand la boucle tool-use renvoyait l'assistant turn complet à Anthropic, les indices ne correspondaient plus à ce que le serveur attendait → 400.
**Règle** :
- Le parser SSE Anthropic DOIT pousser **tous** les blocs reçus (texte vide inclus) sans filtrage cosmétique. Ne JAMAIS « nettoyer » les blocs `text: ''` ou `thinking` perçus comme incomplets — l'API les attend tels quels.
- Avant tout resend (multi-turn / retry), valider l'intégrité des blocs : `signature` présente sur les blocs `thinking`, `data` non vide sur les blocs `redacted_thinking`. Si invalide → throw une erreur claire au lieu de laisser le 400 obscur fuiter.
- Le marker "Réponse interrompue" NE doit PAS être injecté en markdown dans le contenu (pollue le re-prompt) — utiliser un flag persistant `Message.interrupted` rendu en bandeau UI.

### BUG 53 — Vérification state OAuth dans le deeplink + OAuthCallback = double-fire = login cassé
**Fichiers** : `src/App.tsx` (deeplink listener), `src/components/google/OAuthCallback.tsx` (PR #128 + hotfix commit `fee9144`)
**Problème** : dans la PR initiale d'ajout du `state` CSRF, `verifyOAuthState()` était appelé à 2 endroits — le listener Capacitor `appUrlOpen` ET le composant React `<OAuthCallback>`. Sur Capacitor avec Universal Links actifs, les deux peuvent fire pour la même URL `appfacade.pages.dev/auth/callback?code=...&state=...`. Or `verifyOAuthState()` est **single-use** (clear le `sessionStorage` avant retour). Le second appel échoue → login cassé silencieusement.
**Règle** :
- Toute vérification single-use (state nonce, OTP, token JIT) DOIT être appelée à un seul endroit du code-path. Le piège : `verifyOAuthState()` clear le sessionStorage AVANT de retourner — le second appel pour la même URL trouve sessionStorage vide et échoue silencieusement. Si plusieurs handlers peuvent fire (deeplink + React route), choisir le **dernier dans la chaîne** (généralement la route React, pas le listener bas-niveau).
- Pour Arty : `verifyOAuthState()` est appelé UNIQUEMENT dans `OAuthCallback.tsx`. Le deeplink Capacitor ne vérifie pas — la sécurité du chemin est assurée par les **Universal Links Android** (`assetlinks.json` côté domaine + vérification OS) qui empêchent qu'une URL malveillante atteigne le listener sans contrôler `appfacade.pages.dev`.
- Si tu ajoutes une nouvelle voie de callback OAuth (ex: deeplink iOS, web extension), DOCUMENTE-LA ici et choisis explicitement où vit le check single-use.

### BUG 54 — Compteurs de coûts ne se rafraîchissaient pas en live
**Fichiers** : `src/services/costTracker.ts`, `src/screens/costs.tsx`, badge `CostIndicator` (PR #121, commit `9057585`)
**Problème** : les compteurs tokens/coûts/coûts du mois ne bougeaient pas après chaque message envoyé. L'utilisateur devait fermer/rouvrir le dashboard pour voir les nouvelles valeurs. Deux bouts cassés :
1. `recordUsage()` écrivait en `localStorage` mais ne dispatchait aucun event → le badge `CostIndicator` ne se mettait à jour que via son `setInterval(60s)` → personne ne savait quand les chiffres changeaient.
2. `CostsScreen` utilisait `useMemo([monthKey])` : tant que le mois ne changeait pas, le calcul était caché.
**Règle** :
- Toute écriture dans un store partagé (localStorage, IndexedDB) qui sert à plusieurs vues DOIT dispatcher un `CustomEvent` window correspondant (`'cost-updated'`, `'tokens-updated'`, etc.) à la fin de l'écriture, en `try/catch` pour tolérer les contextes sans `window` (tests, SSR).
- Les vues qui consomment ces stores DOIVENT écouter cet event via `addEventListener`. Le piège `useMemo([monthKey])` : tant que `monthKey` ne change pas (mois en cours stable), le calcul mémoïsé ne se rafraîchit JAMAIS, même si le localStorage change sous-jacent. Solution : utiliser un `useState` incrémenté par le listener, et l'inclure dans les deps du `useMemo`.

### BUG 55 — Géoloc PWA : prompt navigateur jamais déclenché + cul-de-sac toggle web
**Fichiers** : `src/services/native/location.ts`, `src/components/settings/SettingsModal.tsx` (PR #120, commit `5c8c9a3`)
**Problème** : remonté en test live sur PWA Chrome Android. Deux bugs reliés :
1. "Localisation" n'apparaissait JAMAIS dans les permissions du site alors que le toggle Arty était ON. Cause : `getBestFixWeb()` utilisait UNIQUEMENT `navigator.geolocation.watchPosition()` qui ne déclenche pas le prompt Chrome de façon fiable en contexte PWA. Conséquence : pas de prompt → permission jamais demandée → géoloc non fonctionnelle, sans erreur visible.
2. Toggle Localisation OFF puis ON ne réactivait plus rien : `requestLocationPermission()` retournait false sur timeout/refus silencieux Chrome → `handleLocationToggle` return early → toggle restait visiblement OFF malgré le clic. Cul-de-sac UX, l'utilisateur ne pouvait plus rien réactiver.
**Règle** :
- Sur web/PWA, le 1er appel géoloc DOIT être `navigator.geolocation.getCurrentPosition()` (qui prompte fiablement, comportement standard W3C), AVANT tout `watchPosition()` qui sert seulement à raffiner la précision. L'inverse est silencieux sur Chrome PWA.
- Découpler "permission navigateur" de "consent applicatif". Sur web, si la permission navigateur est ambiguë/timeout, activer le consent applicatif quand même — l'utilisateur peut réautoriser via le cadenas Chrome. Sur Capacitor natif, garder le strict 1:1 (refus système = toggle OFF).

### BUG 56 — Regex de triggers ratant les phrasings naturels indirects
**Fichiers** : `src/services/locationContext.ts` (`LOCATION_QUERY_TRIGGERS`), `src/services/geminiClient.ts` (`isMapQuery`) (PRs #118 + #119, commits `7ecad74` + `1345a16`)
**Problème** : remonté en live par Noah Wallet sur PWA iOS — 4 questions itinéraire d'affilée toutes ratées. Les phrasings naturels INDIRECTS du type "à combien de km de X", "temps pour aller à Y", "à combien de temps en voiture je me situe de Z" ne matchaient pas les regex de détection :
- `LOCATION_QUERY_TRIGGERS` ratait → `getUserLocation()` jamais appelé → `navigator.geolocation` jamais sollicité → pas de prompt permission → l'IA répond "je n'ai pas accès à ta position".
- `isMapQuery` ratait → Gemini activait `google_search` à la place de `google_maps` → pas de calcul d'itinéraire réel → l'IA estime à la louche et hallucine type "l'outil de calcul bloque" alors qu'elle n'a juste pas le tool.
**Règle** : toute regex de détection de domaine (location, maps, currency, météo, devis…) DOIT être testée avec un PANEL de phrasings INDIRECTS naturels, pas seulement les phrasings directs. À ajouter quand un user remonte un cas qui rate :
- FR : `combien de (temps|km|kilomètres|minutes|heures)`, `temps qu'il faut pour aller`, `temps pour aller`, `aller à`, `aller jusqu'à`, `aller en`, `distance (entre|jusqu'à|pour|de)`, `à quelle distance`, `je suis à`, `je me situe`.
- EN : `how far`, `how long`, `driving time`, `driving distance`, `directions to`, `directions from`.

La maintenance des triggers est un **work-in-progress permanent**, pas un final state. Chaque cas raté remonté → ajouter le pattern à la regex ET ajouter un test de non-régression (sinon la prochaine refacto cassera).
