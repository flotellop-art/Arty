# Instructions pour Claude

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

**Contexte** : règle posée par l'utilisateur le 27 avril 2026 après une session sur les bugs auth Google (PRs #109-#113). Le pattern qui marche : agents critiques en parallèle, Claude code seul. Sans agents, Claude reste dans son tunnel cognitif et rate les bugs annexes (ex : surrogate pairs, data smuggling, dead code legacy).

---

## ROUTINE D'AUDIT SÉCURITÉ

Slash command **`/audit-secu`** (défini dans `.claude/commands/audit-secu.md`) lance un audit complet via 3 agents Explore en parallèle (backend, crypto+auth, frontend+Capacitor) puis produit un rapport priorisé.

**Quand l'invoquer** :
- Avant chaque release Play Store (obligatoire — RÈGLE 4)
- Mensuel (routine de maintenance)
- Après tout refactor majeur sur auth, crypto, ou endpoints serveur
- Après tout incident sécurité (BUG 42 = exemple historique)

### TODO Sécurité — prochain audit

Dernier audit : **4 mai 2026** (PR #127 + PR #128).

À traiter en priorité quand on relance un cycle sécurité :

**PR à venir (planifiées)** :
- [ ] **PR 2 — PKCE OAuth** : ajout du `code_verifier` + `code_challenge` au flow Google web. Stratégie en 2 PRs validée le 4 mai (state CSRF d'abord en PR #128, PKCE ensuite). Coût ~2h, confiance 80%. Touche `googleAuth.ts:buildOAuthUrl()` (devient async), `OAuthCallback.tsx`, `functions/api/auth/token.ts` (forward `code_verifier` à Google). Suivre les patterns du callback double (web + deeplink) déjà éprouvés en PR #128.
- [ ] **Chiffrement des conversations en localStorage** : aujourd'hui en clair (BUG 16 a forcé `saveConversation` synchrone, le chiffrement async cassait l'UI). Solution propre = Web Worker pour chiffrer en arrière-plan sans bloquer le main thread. Coût ~1 jour. Risque = ouverture d'un téléphone volé permet de lire toutes les conversations (mais pas de faire des requêtes — tokens chiffrés).

**HIGH backend non traités (audit du 4 mai)** :
- [ ] **License expiration jamais vérifiée** dans `functions/api/subscription/status.ts:117-128` — query `licenses WHERE status = 'active'` sans `expires_at > NOW()`. Risque = perte de revenu, pas sécu directe.
- [ ] **Premium cap non-atomique** dans `functions/api/_lib/checkPremiumCap.ts` — KV décrément vulnérable à la concurrence, quota bypass possible (CAP=150 → 300+).
- [ ] **DELETE memory sans filtre `WHERE user_id = ?` strict** dans `functions/api/memory/action.ts` — défense en profondeur (déjà protégé par auth mais à durcir).

**MED non traités** :
- [ ] **PBKDF2 itérations à 100k** dans `crypto.ts:38-44` — OWASP 2024 recommande 200k+. Bump simple (+100ms au login).
- [ ] **`storeTokens()` réécrit le plain en fallback** après chaque refresh dans `googleAuth.ts:93-108` — devrait laisser le chiffré en place au lieu de revenir en plain.
- [ ] **Email lowercasing inconsistant** entre `trial/init.ts:41` et `subscription/status.ts:44` — risque de fragmentation user.
- [ ] **`tokeninfo` au lieu de `userinfo`** pour vérifier les tokens dans `trial/init.ts:34-44` — moins fiable.
- [ ] **Pas de rate limit sur `/api/auth/token`** — brute force possible sur les codes OAuth volés.

**LOW à nettoyer avant Play Store** :
- [ ] **Debug `console.log` avec emails** dans `useGoogleAuth.ts:117-195` — wrap en `if (import.meta.env.DEV)`.
- [ ] **Trial counter peut overflow** silencieusement vers 0 dans `trial/init.ts:51-52`.
- [ ] **Re-vérifier `webContentsDebuggingEnabled: false`** en prod sur `capacitor.config.ts`.

**Faux positifs / déjà mitigé** (à NE PAS retraiter) :
- ✅ `secureSetJSON` race (BUG 1) — `useAuth` utilise `setJSON()` direct sur les tokens, race évitée
- ✅ RECORD_AUDIO (BUG 44) — vérifié présent dans AndroidManifest
- ✅ exchangeCode timeout — `withTimeout()` enveloppe le fetch
- ✅ Frontend XSS — `rehype-sanitize` actif, aucun `dangerouslySetInnerHTML`
- ✅ Service Worker (BUG 45) — registration conditionnelle, cleanup boot, CACHE bumpé
- ✅ iOS Info.plist — privacy descriptions complètes (BUG 34)

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
