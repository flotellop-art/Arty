# Arty pour Gmail — artefacts de déploiement Phase 0

Ce dossier prépare le prototype HTTP `GATE-HTTP-DRAFT-01`. Il ne déploie rien et ne contient aucun secret.

## État réel

| Élément | État |
|---|---|
| Templates JSON et validation Node | Prêts et vérifiables localement |
| Endpoints Cloudflare | Implémentés et testés sous `functions/api/workspace-addon/phase0/` ; non déployés |
| Déploiement Google Workspace | Non exécuté |
| Installation de test Gmail | Non exécutée |
| Tests Web et Android | Non exécutés |
| Résultat du gate | À produire avec `GATE-HTTP-DRAFT-01.result.template.md` |

`gcloud` n'est pas installé dans l'environnement local ayant produit ces artefacts. Toutes les commandes Google et Cloudflare ci-dessous sont donc un runbook destiné à un opérateur équipé et autorisé, pas la trace d'un déploiement déjà effectué.

## Contenu

- `deployment.template.json` : descripteur officiel `projects.deployments` pour le candidat HTTP.
- `context-card.template.json` : exemple validé de la carte contextuelle, avec nonce anti-double-clic injecté au rendu.
- `cloudflare.vars.template.json` : fragment `vars` Wrangler non sensible, aligné sur les bindings lus par le runtime.
- `render-manifest.mjs` : rendu et validation locale sans dépendance npm ni appel réseau.
- `GATE-HTTP-DRAFT-01.result.template.md` : dossier de preuve et décision HTTP/Apps Script.

## Invariants du prototype

Le manifest demande exactement quatre scopes :

```text
https://www.googleapis.com/auth/gmail.addons.current.action.compose
https://www.googleapis.com/auth/gmail.addons.current.message.action
https://www.googleapis.com/auth/userinfo.email
openid
```

Il ne contient ni scope Gmail/Drive restreint, ni `script.external_request`, ni `script.locale`, ni `gmail.addons.execute`. `useLocaleFromApp` est volontairement absent, car l'activer imposerait `script.locale` et casserait l'allowlist à quatre scopes.

Le manifest fixe aussi :

- `authorizationHeader: SYSTEM_ID_TOKEN` ;
- `granularOauthPermissionSupport: OPT_IN` ;
- un homepage trigger HTTPS ;
- un contextual trigger Gmail inconditionnel HTTPS.

### Contrat des quatre endpoints

Tous les endpoints acceptent uniquement `POST`, échouent fermés et partagent cette base exacte :

```text
https://<hôte>/api/workspace-addon/phase0
```

| Endpoint | Origine de l'appel | Rôle | Scopes requis pour l'action |
|---|---|---|---|
| `/home` | `common.homepageTrigger` | Carte d'accueil et état du prototype | `openid`, `userinfo.email` |
| `/context` | `gmail.contextualTriggers` | Carte du message ouvert, sans lire son contenu | `openid`, `userinfo.email` |
| `/read` | Bouton de `context-card.template.json` | Lire uniquement le message ouvert | identité + `current.message.action` |
| `/create-draft` | Bouton de `context-card.template.json` | Tester une nouvelle réponse en brouillon dans le bon fil | identité + `current.message.action` + `current.action.compose` |

`/read` et `/create-draft` ne sont pas des triggers de manifest. Ce sont les URLs `onClick.action.function` des deux boutons de la carte retournée par `/context`. Le validateur interdit qu'elles divergent de la base du manifest.

Pour l'appel Gmail contextuel, `/read` doit utiliser ensemble :

- `authorizationEventObject.userOAuthToken` comme bearer ;
- `gmail.accessToken` dans `X-Goog-Gmail-Access-Token` ;
- `gmail.messageId` provenant uniquement de l'événement Google authentifié.

Le endpoint `/create-draft` est précisément l'objet du gate. Il effectue une tentative contrôlée sur l'endpoint Gmail public `users.drafts.create`, avec uniquement les quatre scopes du manifest et le couple de jetons contextuels documenté ; aucun scope restreint n'est ajouté. Si Google accepte la création, la réponse `hostAppAction` tente d'ouvrir le brouillon que Gmail vient de renvoyer. La forme RPC transforme expérimentalement le `Draft.id` REST `r-*` en identifiant hôte `msg-a:r-*`, conformément à l'exemple officiel ; cette conversion reste un point explicite à confirmer sur Web et Android. Si l'API refuse ces jetons, si la réponse hôte ne s'ouvre pas dans le bon fil, ou si un scope restreint devient nécessaire, le gate est **FAIL** et le runtime retenu devient Apps Script. `openCreatedDraftAction`/`openCreatedDraftActionMarkup` n'est jamais présenté comme créant seul un brouillon : il ouvre seulement celui que l'appel Gmail vient de créer.

> **Hypothèse volontaire du spike :** la table d'autorisation REST ordinaire de `users.drafts.create` ne liste que des scopes Gmail restreints. Le runtime HTTP documente toutefois un jeton contextuel permettant au module de composer des brouillons. La Phase 0 mesure précisément si ce couple de jetons contextuels suffit sur cet endpoint ; elle ne considère pas cette capacité comme acquise et n'ajoute jamais un scope restreint pour forcer le passage.

Chaque carte qui propose la création porte un `phase0_action_nonce` opaque. Le runtime réel en génère un nouveau par carte ; le rendu local du template en génère également un. Ce nonce, l'identité Google vérifiée et le message courant forment la clé du verrou d'idempotence : un replay de la même action doit rouvrir le résultat existant ou rester bloqué en état indéterminé, jamais relancer silencieusement `drafts.create`.

## Validation locale

Prérequis : Node.js 20 ou supérieur.

Depuis ce dossier :

```powershell
node .\render-manifest.mjs check-template
```

Résultat attendu :

```text
PASS: templates JSON, scopes, cartes, endpoints, audiences et granular OAuth valides.
```

### Prévisualiser le passage de relais depuis Arty

Le client Web contient un mode de test réversible, désactivé par défaut :

```powershell
$env:VITE_GMAIL_NO_CASA_PHASE0='true'
npm run dev -- --host 127.0.0.1
```

Dans Arty, envoyer par exemple :

```text
Retrouve le mail de Paul au sujet du devis de juin
```

Le compilateur local doit produire une carte éditable, sans appel LLM ni appel Gmail. « Chercher dans Gmail » copie d'abord la requête, puis ouvre uniquement `https://mail.google.com/`. L'utilisateur colle la requête, ouvre le bon message et clique lui-même sur l'icône Arty dans le panneau Gmail. Aucun résultat, identifiant de message ou état de recherche ne revient dans Arty.

Le même profil de scopes peut être activé dans un build Android de test :

```powershell
Set-Location .\android
.\gradlew assembleDebug -PartyGmailNoCasaPhase0=true
```

Ce mode ne révoque pas les anciens grants OAuth déjà stockés et ne supprime pas encore les routes globales historiques du déploiement principal. Il sert au prototype et au test UX ; il ne transforme pas à lui seul la release publique en produit validé sans CASA.

Prévisualiser un manifest rendu sans écrire de fichier :

```powershell
$BaseUrl = 'https://phase0.example.com/api/workspace-addon/phase0'
$LogoUrl = 'https://phase0.example.com/assets/arty-addon-64.png'
node .\render-manifest.mjs render --base-url $BaseUrl --logo-url $LogoUrl
node .\render-manifest.mjs render-card --base-url $BaseUrl
```

Produire des fichiers locaux, obligatoirement dans ce dossier :

```powershell
node .\render-manifest.mjs render `
  --base-url $BaseUrl `
  --logo-url $LogoUrl `
  --out .\deployment.phase0.json

node .\render-manifest.mjs render-card `
  --base-url $BaseUrl `
  --out .\context-card.phase0.json

node .\render-manifest.mjs validate --file .\deployment.phase0.json
node .\render-manifest.mjs validate-card --file .\context-card.phase0.json
```

Le script refuse les URLs non HTTPS, les queries/fragments, une base autre que `/api/workspace-addon/phase0`, tout scope supplémentaire, un autre mode d'authentification, `OPT_OUT`, des actions de carte différentes et toute sortie hors de ce dossier.

## Configuration Cloudflare

Ce dépôt héberge aujourd'hui des **Cloudflare Pages Functions** et ne contient aucun `wrangler.jsonc` reproductible pour un Worker Phase 0. `cloudflare.vars.template.json` est donc seulement un fragment de configuration non sensible : il ne constitue ni une configuration Pages, ni un Worker déployable.

Avant le gate externe, l'équipe doit choisir et versionner l'un des deux chemins suivants :

1. un projet Pages isolé qui ne publie que le candidat Phase 0, avec sa D1 et ses variables dédiées ;
2. un Worker dédié avec un entrypoint/router explicite et son propre `wrangler.jsonc`.

Tant que ce choix et sa configuration ne sont pas présents, le code est vérifiable localement mais le déploiement Cloudflare n'est **pas reproductible depuis ce dépôt**. Ne pas lancer `wrangler deploy` depuis la racine du projet en supposant qu'il publiera les Pages Functions.

Les variables ne sont pas héritées automatiquement par les environnements Wrangler. Définir explicitement les cinq bindings `WORKSPACE_ADDON_PHASE0_*` dans l'environnement Phase 0. `WORKSPACE_ADDON_PHASE0_BASE_URL` est l'origine HTTPS seule (par exemple `https://phase0.example.com`) ; les routes sont une allowlist statique dans le code.

Après activation de l'API Google Workspace Add-ons, récupérer les deux identifiants non secrets :

```powershell
$Authorization = gcloud workspace-add-ons get-authorization `
  --project $ProjectId `
  --format json | ConvertFrom-Json

$OAuthClientId = $Authorization.oauthClientId
$ServiceAccountEmail = $Authorization.serviceAccountEmail
```

Rendre le fragment Cloudflare :

```powershell
node .\render-manifest.mjs render-cloudflare `
  --base-url $BaseUrl `
  --oauth-client-id $OAuthClientId `
  --service-account-email $ServiceAccountEmail `
  --enabled false `
  --host-action-shape rpc `
  --out .\cloudflare.vars.phase0.json

node .\render-manifest.mjs validate-cloudflare `
  --file .\cloudflare.vars.phase0.json
```

Après avoir versionné la cible Pages ou Worker dédiée, reporter les cinq entrées de `vars` dans **cette configuration isolée**. Ne placer aucun jeton Google, clé fournisseur ou autre secret dans `vars` ou dans ce dossier. Le rendu laisse volontairement `WORKSPACE_ADDON_PHASE0_ENABLED=false` : ne le passer à `true` qu'après le dry-run, la vérification des audiences et le déploiement HTTPS des quatre endpoints.

Créer ou sélectionner en plus une base D1 **dédiée exclusivement à la Phase 0**, puis la lier sous le nom `WORKSPACE_ADDON_PHASE0_DB`. Ne jamais réutiliser le binding `DB`, la base de production ou celle de la bêta. Le runtime y crée seulement la table technique `workspace_addon_phase0_idempotency` : clé SHA-256 opaque, jeton propriétaire, état et identifiants du brouillon créé. Après 24 h, les identifiants d'un résultat complété sont effacés et seule une tombe opaque non réutilisable subsiste ; un état `pending` incertain reste bloqué jusqu'à réconciliation explicite. Aucun email, corps, token, `user.sub`, nonce ou identifiant du message source n'y est stocké en clair.

Exemple de création à exécuter uniquement par l'opérateur Cloudflare autorisé :

```powershell
npx wrangler d1 create arty-workspace-addon-phase0
```

Reporter ensuite l'identifiant obtenu dans le binding D1 de l'environnement `phase0`. L'absence ou la panne de ce binding bloque `/create-draft` avant toute écriture Gmail.

Si le chemin Worker dédié est retenu et que son vrai `wrangler.jsonc` a été ajouté/revu, exécuter dans ce projet :

```powershell
npx wrangler --version
npx wrangler deploy --dry-run --env phase0
```

Utiliser une version Wrangler 4.x épinglée par la cible de déploiement. La commande réelle ci-dessous ne s'applique **pas** au dépôt actuel sans cette configuration et modifie un système externe :

```powershell
npx wrangler deploy --env phase0
```

### Vérifications serveur obligatoires

Pour chacune des quatre routes statiques sous `/api/workspace-addon/phase0/` :

1. Refuser toute méthode autre que `POST` et tout chemin hors allowlist.
2. Vérifier le bearer `systemIdToken` par JWKS Google avec `aud` égal à l'URL exacte de la route appelée et `email` égal à `googleServiceAccountEmail`.
3. Vérifier séparément `authorizationEventObject.userIdToken` avec `aud` égal à `googleUserAudience`.
4. Vérifier issuer, `RS256`, `kid`, signature, `exp`, `iat`, `sub`, `email` et `email_verified=true` ; aucun fallback `tokeninfo`.
5. Comparer `authorizationEventObject.authorizedScopes` aux scopes de la route. Retourner `requesting_google_scopes` pour les seuls scopes manquants.
6. Ne jamais journaliser les ID tokens, OAuth tokens, jetons Gmail contextuels, message IDs bruts ou contenu.
7. Construire toute idempotence à partir du contexte authentifié et empêcher une reprise d'autorisation de doubler un débit ou un brouillon.
8. Si `Origin` est présent, le refuser sauf politique CORS explicite ; son absence ne remplace jamais les preuves Google.
9. Appliquer le rate-limit Workspace après OIDC, par `user.sub` vérifié ; ne pas partager un quota sur l'IP de sortie Google.

## Runbook Google Workspace externe

### Prérequis opérateur

- `gcloud` récent installé et authentifié ; il n'est pas disponible dans l'environnement local actuel.
- Projet Google Cloud dédié au prototype, distinct de la production et de la bêta historique.
- Droits IAM pour activer les API et gérer/installer les deployments Workspace Add-ons.
- Endpoints Phase 0 déjà accessibles en HTTPS sur Cloudflare.
- Logo HTTPS stable ; aucune URL temporaire ou protégée par authentification.
- Compte de test autorisé par l'écran de consentement OAuth.

### 1. Préparer le projet

```powershell
$ProjectId = '<GOOGLE_CLOUD_PROJECT_ID>'
$DeploymentId = 'arty-gmail-phase0'
gcloud config set project $ProjectId
gcloud services enable `
  gsuiteaddons.googleapis.com `
  appsmarket-component.googleapis.com `
  gmail.googleapis.com `
  --project $ProjectId
```

Configurer ensuite dans Google Cloud l'écran de consentement, les testeurs et le Google Workspace Marketplace SDK. Ne pas ajouter de scope hors des quatre scopes du manifest.

### 2. Rendre et relire les artefacts

```powershell
node .\render-manifest.mjs check-template
node .\render-manifest.mjs render `
  --base-url $BaseUrl `
  --logo-url $LogoUrl `
  --out .\deployment.phase0.json
node .\render-manifest.mjs validate --file .\deployment.phase0.json
```

Comparer manuellement `deployment.phase0.json` à la liste de scopes affichée dans Google Cloud. Calculer et archiver son SHA-256 :

```powershell
Get-FileHash .\deployment.phase0.json -Algorithm SHA256
```

### 3. Créer ou remplacer le deployment de test

Première création :

```powershell
gcloud workspace-add-ons deployments create $DeploymentId `
  --deployment-file .\deployment.phase0.json `
  --project $ProjectId
```

Mise à jour contrôlée d'un deployment existant :

```powershell
gcloud workspace-add-ons deployments replace $DeploymentId `
  --deployment-file .\deployment.phase0.json `
  --project $ProjectId
```

Relire la ressource distante avant installation :

```powershell
gcloud workspace-add-ons deployments describe $DeploymentId `
  --project $ProjectId `
  --format json
```

### 4. Installer uniquement pour le compte de test

```powershell
gcloud workspace-add-ons deployments install $DeploymentId `
  --project $ProjectId

gcloud workspace-add-ons deployments install-status $DeploymentId `
  --project $ProjectId
```

Rafraîchir Gmail Web et redémarrer Gmail Android si l'icône n'apparaît pas. Capturer l'écran de consentement exact, y compris un refus partiel.

## Checklist du gate Web et Android

Exécuter chaque scénario dans les deux colonnes et reporter les preuves dans le modèle de résultat.

| Contrôle | Gmail Web | Gmail Android |
|---|:---:|:---:|
| Installation non publiée visible après rafraîchissement/redémarrage | ☐ | ☐ |
| Écran de consentement conforme aux quatre scopes exacts | ☐ | ☐ |
| Refus partiel géré sans boucle OAuth | ☐ | ☐ |
| `/home` s'affiche sans accès au contenu d'un message | ☐ | ☐ |
| `/context` s'affiche sur un message ouvert sans le lire | ☐ | ☐ |
| Le bouton « Lire ce message » cible exactement `/read` | ☐ | ☐ |
| La lecture ne porte que sur `gmail.messageId` authentifié | ☐ | ☐ |
| Un autre `messageId` injecté est refusé | ☐ | ☐ |
| Le couple `userOAuthToken` + `X-Goog-Gmail-Access-Token` est obligatoire | ☐ | ☐ |
| Le bouton brouillon cible exactement `/create-draft` | ☐ | ☐ |
| Une nouvelle réponse s'ouvre dans le bon fil sans `draftId` fourni par Arty | ☐ | ☐ |
| Le brouillon est modifiable et aucun envoi automatique n'existe | ☐ | ☐ |
| Refus puis accord d'un scope reprend l'action sans double brouillon (débit N/A en 0A) | ☐ | ☐ |
| `systemIdToken` : audience de route et compte de service exacts | ☐ | ☐ |
| `userIdToken` : client OAuth du module exact | ☐ | ☐ |
| Mauvaise audience, signature ou expiration refusée avant effet de bord | ☐ | ☐ |
| Aucun token ni contenu brut dans logs, traces ou captures | ☐ | ☐ |
| Aucun scope restreint, API privée, DOM injecté ou URL Gmail reverse-engineerée | ☐ | ☐ |

Compléter ensuite les mesures de capacité prévues par le gate : trente parcours séquentiels, charge à deux fois la concurrence de lancement, absence de `429` et de double effet, P95 complet inférieur ou égal à 25 secondes, et marge d'au moins 20 % sur la plus petite limite de taille observée.

Un seul échec obligatoire donne un résultat global **FAIL**. Ne pas « corriger » le prototype en ajoutant `gmail.compose`, `gmail.readonly`, `gmail.modify`, Drive complet ou une API non documentée.

## Rollback et nettoyage

Retirer immédiatement l'installation de test en cas d'échec de sécurité ou à la fin du spike :

```powershell
gcloud workspace-add-ons deployments uninstall $DeploymentId `
  --project $ProjectId
```

Le deployment peut rester archivé pour preuve sans être installé. Si sa suppression est décidée :

```powershell
gcloud workspace-add-ons deployments delete $DeploymentId `
  --project $ProjectId
```

Pour Cloudflare, utiliser le mécanisme propre à la cible qui aura été choisie. Les commandes suivantes ne valent que pour un Worker dédié effectivement configuré ; un projet Pages doit documenter son rollback séparément :

```powershell
npx wrangler versions list --env phase0
npx wrangler rollback <VERSION_ID> --env phase0
```

Ne jamais supprimer ou modifier les ressources de production/bêta depuis ce runbook Phase 0.

## Sources officielles vérifiées le 13 juillet 2026

- [Construire un add-on Workspace avec des endpoints HTTP](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes)
- [Ressource `projects.deployments` et `HttpOptions`](https://developers.google.com/workspace/add-ons/reference/rest/v1/projects.deployments)
- [Scopes Google Workspace Add-ons](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes)
- [Référence des cartes et actions HTTP](https://developers.google.com/workspace/add-ons/reference/rpc/google.apps.card.v1)
- [Création d'un deployment avec gcloud](https://docs.cloud.google.com/sdk/gcloud/reference/workspace-add-ons/deployments/create)
- [Installation d'un deployment avec gcloud](https://docs.cloud.google.com/sdk/gcloud/reference/workspace-add-ons/deployments/install)
- [Informations d'autorisation du projet](https://developers.google.com/workspace/add-ons/reference/rest/v1/projects/getAuthorization)
- [Configuration Wrangler et variables JSON](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Commandes Wrangler et dry-run](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
