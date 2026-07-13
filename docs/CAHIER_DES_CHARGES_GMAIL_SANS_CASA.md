# Cahier des charges — Arty pour Gmail sans évaluation CASA

**Version :** 1.2<br>
**Date :** 13 juillet 2026<br>
**Statut :** GO pour la phase 0 ; production conditionnée par les gates runtime, sécurité et Limited Use<br>
**Périmètre :** application publique Arty Web/Android + Google Workspace Add-on Gmail ; runtime HTTP-first à prouver, Apps Script en repli<br>
**Décideur :** Florent Pollet

## 1. Décision exécutive

Construire un module complémentaire Google Workspace nommé **Arty pour Gmail** qui :

- transforme une demande en langage naturel en requête Gmail éditable, puis laisse Gmail exécuter la recherche sans montrer les résultats à Arty ;
- traite uniquement l'e-mail actuellement ouvert par l'utilisateur ;
- n'accède au contenu qu'après une action explicite dans le panneau Arty ;
- résume le message, extrait les actions et propose une réponse ; la comparaison reste P1 dans Web/Android et demeure désactivée dans le panneau Gmail jusqu'à un gate séparé ;
- crée une réponse dans le brouillon natif de Gmail via le runtime retenu par le gate de phase 0 ;
- laisse toujours l'utilisateur relire et envoyer lui-même le message.

Le manifest de référence du repli Apps Script utilisera cinq scopes au total :

    https://www.googleapis.com/auth/gmail.addons.current.message.action
    https://www.googleapis.com/auth/gmail.addons.current.action.compose
    https://www.googleapis.com/auth/script.external_request
    https://www.googleapis.com/auth/userinfo.email
    openid

Les deux scopes fonctionnels Gmail sont classés **non sensibles** par Google au 13 juillet 2026. Ils ne donnent aucun accès global ou en arrière-plan à la boîte et ne déclenchent pas d'évaluation CASA.

La phase 0 teste d'abord un déploiement HTTP réel. HTTP n'est retenu en production que si `GATE-HTTP-DRAFT-01` démontre la lecture contextuelle et la création d'une nouvelle réponse dans le bon fil, sur Gmail Web et Android, sans `draftId` préexistant fourni par Arty et sans scope restreint. En cas d'échec après un spike de deux jours, le runtime de production devient l'adaptateur Apps Script minimal. Un seul chemin sera ensuite maintenu.

Le parcours de recherche assistée ne demande, lui, **aucun scope Gmail supplémentaire** et n'utilise pas les scopes contextuels du module : Arty prépare seulement une chaîne utilisant les opérateurs documentés par Gmail, l'affiche à l'utilisateur, la copie et ouvre Gmail. Gmail effectue la recherche dans sa propre interface. Arty ne reçoit ni liste de résultats, ni extrait, ni identifiant de message. Ce parcours n'entre donc pas, en lui-même, dans le périmètre CASA ; la conclusion globale sans CASA reste vraie seulement si aucun appel de recherche Gmail et aucun scope restreint ne sont présents dans les clients ou projets de production.

Le scope gmail.addons.execute, encore visible dans certains exemples, est volontairement omis : les notes de version Google indiquent qu'il n'est plus requis et qu'il est ignoré s'il est présent.

Le produit public ne demandera aucun scope Gmail ou Drive restreint. Le P0 retire entièrement Drive, y compris le scope complet et le connecteur public ; un éventuel parcours futur fondé sur `drive.file` sera une décision P1 séparée. Retirer seulement gmail.readonly et gmail.modify ne suffirait pas à éviter CASA.

## 2. Problème à résoudre

La valeur actuelle d'Arty repose en partie sur sa capacité à lire, rechercher, envoyer et gérer Gmail depuis plusieurs modèles d'IA. Cette intégration demande aujourd'hui gmail.readonly, gmail.send et gmail.modify, transmet le contenu par l'infrastructure Cloudflare et par des fournisseurs d'IA, et entre donc dans le périmètre de la vérification Restricted Scopes et de l'évaluation CASA annuelle.

Supprimer Gmail entièrement ferait perdre un différenciateur important. Le besoin est donc de conserver une expérience Gmail visible et utile, tout en remplaçant l'accès global à la boîte par deux mécanismes limités : Arty aide d'abord l'utilisateur à formuler la recherche que Gmail exécutera, puis accède temporairement au seul message que l'utilisateur choisit d'ouvrir.

## 3. Base réglementaire et technique vérifiée

### 3.1 Classification actuelle des scopes Gmail

| Scope | Classe Google | Capacité | OAuth public | CASA pour Arty |
|---|---|---|---|---|
| gmail.addons.current.message.action | Non sensible | Lire le message ouvert après interaction | Configuration basique + revue Marketplace | Non |
| gmail.addons.current.action.compose | Non sensible | Créer un brouillon ou une réponse depuis l'add-on | Configuration basique + revue Marketplace | Non |
| gmail.addons.current.message.metadata | Sensible | Lire temporairement les métadonnées du message ouvert | Vérification sensitive | Non |
| gmail.addons.current.message.readonly | Sensible | Lire le message et les autres messages du fil ouvert | Vérification sensitive | Non |
| gmail.send | Sensible | Envoyer un e-mail, sans lire la boîte ni créer un brouillon | Vérification sensitive | Non |
| gmail.compose | Restreint | Gérer les brouillons et envoyer | Vérification restricted | Oui dans l'architecture cloud d'Arty |
| gmail.readonly | Restreint | Lire les messages et paramètres Gmail | Vérification restricted | Oui |
| gmail.modify | Restreint | Lire et modifier la boîte | Vérification restricted | Oui |
| gmail.metadata | Restreint | Lire globalement les en-têtes, labels et métadonnées | Vérification restricted | Oui |
| mail.google.com | Restreint | Accès Gmail maximal | Vérification restricted | Oui |

**Correction obligatoire :** gmail.compose n'est pas une solution sans CASA. La mention inverse dans PLAY-STORE-SUBMISSION.md doit être corrigée avant toute soumission.

### 3.2 Ce que Google permet

Google cite les améliorations de productivité, dont les résumés génératifs d'e-mails, comme cas d'usage Gmail accepté. Le transfert à un fournisseur d'IA reste soumis aux exigences Limited Use :

- le traitement doit fournir une fonctionnalité visible demandée par l'utilisateur ;
- le transfert doit être annoncé clairement et consenti ;
- les e-mails ne doivent jamais servir à entraîner ou améliorer un modèle généraliste ;
- aucun usage publicitaire, revente, scoring ou création de base permanente n'est permis ;
- l'accès humain doit rester interdit hors exceptions étroites et documentées.

### 3.3 Ce qui reste obligatoire sans CASA

- Revue publique du module sur Google Workspace Marketplace.
- Écran de consentement, identité de l'éditeur et URLs publiques cohérents.
- Politique de confidentialité et information dans le produit.
- Scopes minimaux et demandés dans leur contexte.
- Sécurité des jetons et des données, HTTPS et procédure de suppression.
- Respect des politiques anti-spam.
- Vérification sensitive si une phase ultérieure ajoute gmail.addons.current.message.readonly ou gmail.send.

### 3.4 Sources officielles

- [Classification officielle des scopes Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Demande de scopes minimaux et scopes dédiés aux add-ons](https://support.google.com/cloud/answer/13807380)
- [Scopes Google Workspace Add-ons](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes)
- [Créer un brouillon depuis un add-on Gmail](https://developers.google.com/workspace/add-ons/gmail/compose)
- [Étendre l'interface d'un message Gmail](https://developers.google.com/workspace/add-ons/gmail/extending-message-ui)
- [Effectuer une recherche dans Gmail](https://support.google.com/mail/answer/6593?co=GENIE.Platform%3DDesktop&hl=fr)
- [Opérateurs de recherche Gmail](https://support.google.com/mail/answer/7190?co=GENIE.Platform%3DDesktop&hl=fr)
- [Construire un add-on avec des endpoints HTTP](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes)
- [Vérifier un Google ID token côté serveur](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Note officielle sur gmail.addons.execute](https://developers.google.com/workspace/add-ons/release-notes)
- [Jeton d'identité OIDC Apps Script](https://developers.google.com/apps-script/reference/script/script-app)
- [Connecter Apps Script à un service cloud](https://developers.google.com/apps-script/guides/services/cloud-run)
- [Permissions granulaires Apps Script](https://developers.google.com/apps-script/concepts/scopes)
- [Quotas et durée d'exécution Apps Script](https://developers.google.com/apps-script/guides/services/quotas)
- [Allowlists d'URL Apps Script](https://developers.google.com/apps-script/manifest/allowlist-url)
- [Gestion sécurisée du presse-papiers Android](https://developer.android.com/privacy-and-security/risks/secure-clipboard-handling)
- [Installation Marketplace par les administrateurs Workspace](https://support.google.com/a/answer/172482?hl=fr-fr)
- [Politique Google Workspace API et Limited Use](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Exigences de vérification OAuth](https://support.google.com/cloud/answer/13464321)
- [Évaluation de sécurité CASA](https://support.google.com/cloud/answer/13465431)
- [Revue Google Workspace Marketplace](https://developers.google.com/workspace/marketplace/about-app-review)

Les classifications devront être revérifiées dans Google Cloud Console juste avant la soumission.

## 4. Positionnement produit

### 4.1 Promesse

> Demandez à Arty de vous aider à retrouver un e-mail : il prépare une recherche que Gmail exécute, puis résume et transforme en réponse le message que vous choisissez d'ouvrir. Arty ne voit jamais la liste des résultats et n'analyse jamais votre boîte en arrière-plan.

### 4.2 Utilisateurs cibles

1. Indépendants et professions libérales recevant beaucoup d'e-mails professionnels.
2. Créateurs, consultants et formateurs qui rédigent des réponses longues ou délicates.
3. Utilisateurs de plusieurs IA qui veulent, dans la phase suivante, comparer deux réponses sans copier-coller.
4. Utilisateurs sensibles à la confidentialité qui veulent contrôler précisément le message transmis.

### 4.3 Objectifs

- Donner une valeur Gmail perceptible en moins de trois minutes après l'installation.
- Lors d'un test d'utilisabilité chronométré, permettre à au moins 80 % des participants de passer de la demande Arty aux résultats Gmail en moins de 40 secondes, avec une médiane cible de 30 secondes.
- Permettre de transformer un e-mail ouvert en brouillon de réponse en moins de 45 secondes.
- Ne demander aucun scope restreint dans le produit public.
- Ne conserver ni jeton Gmail temporaire ni contenu brut d'e-mail sur les serveurs Arty.
- Fermer `GATE-HTTP-DRAFT-01` avant toute implémentation de production et archiver les preuves du runtime retenu.
- Transformer le module Gmail en canal d'acquisition vers l'essai Arty de 30 messages.

### 4.4 Non-objectifs

- Lire ou résumer toute la boîte de réception.
- Appeler l'API Gmail pour rechercher un ancien e-mail, lire la liste des résultats ou sélectionner un message à la place de l'utilisateur.
- Produire un briefing automatique des non-lus.
- Surveiller Gmail en arrière-plan ou recevoir des notifications push sur les messages.
- Archiver, supprimer, étoiler, labelliser ou déplacer des e-mails.
- Envoyer automatiquement une réponse.
- Traiter des campagnes, séquences ou envois commerciaux de masse.
- Lire les pièces jointes dans la première version.
- Mémoriser automatiquement les e-mails dans Arty.

## 5. Architecture cible

### 5.1 Vue d'ensemble

Parcours de recherche sans accès à la boîte :

    Demande dans Arty : « Retrouve le devis envoyé par Paul en juin »
              |
              v
    Requête Gmail proposée et éditable
    from:paul devis after:2026/06/01 before:2026/07/01
              |
              | clic « Chercher dans Gmail »
              v
    Copie de la requête + ouverture générique de Gmail
              |
              | choix du compte si nécessaire,
              | collage dans la barre et lancement par l'utilisateur
              |
              v
    Gmail exécute la recherche et affiche ses résultats
              |
              | l'utilisateur choisit et ouvre un message
              v
    Parcours contextuel Arty ci-dessous

Ce premier parcours vit dans **Arty Web/Android**, pas dans le panneau Workspace Add-on. Il n'utilise ni Gmail API, ni jeton Gmail, ni contenu récupéré dans la boîte. Le contrat P0 est : afficher la requête, la copier, ouvrir Gmail génériquement, laisser l'utilisateur choisir son compte si nécessaire, puis la coller et lancer la recherche. Si la copie échoue, Arty conserve le texte visible et sélectionnable et n'ouvre pas Gmail automatiquement.

Un lien direct vers la page de résultats peut réduire la friction, mais Google ne documente pas de contrat public stable pour préremplir une recherche Gmail par URL. Il est donc désactivé par défaut, absent de la définition de fini P0 et limité à une expérimentation P1 sous feature flag après tests de bout en bout.

Parcours d'analyse du message choisi :

    Message ouvert dans Gmail
              |
              | clic explicite sur une action Arty
              v
    Runtime choisi par GATE-HTTP-DRAFT-01
       |                              |
       | HTTP retenu                  | repli Apps Script
       | Google appelle Cloudflare    | lecture/minimisation locale,
       | avec jetons système,         | puis JWT utilisateur + HMAC
       | utilisateur et contextuel    | vers Cloudflare
       +---------------+--------------+
                       |
                       v
    Gateway Workspace Add-on Cloudflare
              |
              | authentification fail-closed, scopes,
              | compte, consentement, quota et facturation
              v
    Orchestrateur IA serveur Arty
              |
              | réponse ponctuelle, sans outil ni action automatique
              v
    Cache utilisateur éphémère + carte Gmail
              |
              | clic « Créer le brouillon »
              v
    Brouillon natif dans le fil Gmail
              |
              v
    Relecture et envoi manuel par l'utilisateur

### 5.2 Choix d'exécution

La cible est **HTTP-first sous condition de prototype**. Le déploiement HTTP reçoit les événements Google directement sur Cloudflare et renvoie les cartes JSON. Il est retenu seulement si le gate décrit dans l'ADR démontre le brouillon contextuel sans scope restreint, sans API privée et sans dépendance à un `draftId` déjà créé.

Google documente officiellement les cartes, les jetons d'identité et les réponses Gmail pour le runtime HTTP, mais le schéma `openCreatedDraftActionMarkup` attend déjà un `draftId`. L'API REST `users.drafts.create` exige un scope restreint. La création d'une nouvelle réponse HTTP n'est donc pas considérée comme acquise avant `GATE-HTTP-DRAFT-01`.

Si le gate échoue, le repli est un **adaptateur Apps Script minimal** pour les cartes Gmail, l'accès contextuel et `ComposeActionResponse`. Aucune clé IA, règle tarifaire ou historique métier n'y est implémentée. Il appelle Cloudflare par `UrlFetchApp` avec une identité vérifiée et une signature HMAC de déploiement.

Dans les deux cas, Cloudflare reste responsable de l'association au compte Arty, du consentement, des quotas, de la facturation, de l'IA et de la politique de conservation. Un seul runtime est conservé après le spike.

Le module aura obligatoirement son propre projet Google Cloud standard, son propre client et son propre déploiement Marketplace. Les trois domaines de confiance sont séparés :

1. application Arty publique Web/Android ;
2. module Arty pour Gmail public ;
3. bêta historique privée avec scopes restreints.

Ils ne partagent ni client OAuth, ni secret, ni refresh token. Cette séparation correspond à des intégrations réelles et ne doit jamais servir à contourner un plafond ou une vérification.

La bêta utilise en plus une base D1, des namespaces KV/R2, des secrets et des bindings physiquement distincts. Elle ne possède aucun accès à la production. L'application publique et le module public peuvent partager les droits métier compte/trial/wallet via un repository serveur étroit, mais leurs nonces, caches et clés d'idempotence sont namespacés par `securityDomain` et par le `sub` Google vérifié.

Une politique serveur mappe chaque route vers ses méthodes d'authentification, issuers, audiences exactes et domaines de sécurité autorisés. L'audience bêta est absente de toutes les allowlists de production, y compris hors des routes `/auth/refresh`.

### 5.3 Composants à créer

| Composant | Responsabilité |
|---|---|
| Déploiement HTTP de phase 0 | Déclare manifest, triggers, scopes et endpoints ; fournit les preuves de `GATE-HTTP-DRAFT-01` |
| Adaptateur Apps Script conditionnel | Repli limité aux cartes, à la lecture contextuelle, à la minimisation et à `ComposeActionResponse` |
| `verifyWorkspaceAddonRequest` | Vérifie par JWKS les jetons propres au runtime, en échec fermé, sans réutiliser `tokeninfo` ni les helpers Web/Android |
| Garde de scopes | Compare `authorizedScopes` aux besoins de l'action et produit la demande granulaire adaptée au runtime |
| Attestation de déploiement | HTTP : `systemIdToken` Google ; Apps Script : JWT utilisateur + HMAC rotatif, timestamp et nonce |
| Décodeur Gmail contextuel | Lit uniquement le message courant, extrait le texte utile, supprime HTML dangereux et exclut les pièces jointes |
| Garde de confidentialité | Consentement fournisseur, taille maximale, absence de logs de contenu |
| Garde d'idempotence | Empêche les doubles traitements et doubles brouillons |
| Adaptateur compte/quota/facturation | Mappe le `sub` Google vérifié au compte, au trial partagé, à l'abonnement ou au wallet |
| Orchestrateur IA serveur | Réutilise les règles métier après identité déjà vérifiée ; n'appelle jamais directement les proxys authentifiés par le client Arty |
| Générateur de cartes JSON | Produit les cartes Gmail web/mobile et les états erreur/chargement pour le runtime retenu |
| Générateur de requête Gmail Web/Android | Convertit la demande en opérateurs autorisés, affiche un aperçu modifiable, copie la requête et ouvre Gmail sans appeler son API |

Dans le runtime HTTP, l'identifiant courant provient exclusivement de `gmail.messageId` dans l'événement Google authentifié. Pour lire ce message avec l'API Gmail, Cloudflare doit présenter simultanément `authorizationEventObject.userOAuthToken` dans `Authorization: Bearer …` et `gmail.accessToken` dans `X-Goog-Gmail-Access-Token`; aucun des deux jetons ne suffit seul et aucun ne sert d'identité Arty. Ils restent en mémoire pendant la requête puis sont détruits. Dans le repli Apps Script, `GmailApp.setCurrentMessageAccessToken()` est appelé localement et le jeton contextuel ne quitte jamais Apps Script. Dans les deux cas, aucun jeton n'atteint le fournisseur d'IA, aucun `messageId` libre fourni par un autre client n'est accepté et aucun jeton n'est persisté.

En HTTP, le résultat IA est conservé dans un stockage Cloudflare chiffré, à usage unique, TTL maximal cinq minutes, lié au `securityDomain`, au `sub` et au message par identifiant HMAC non réversible. En repli Apps Script, `CacheService.getUserCache()` est préféré si les tests de taille et d'isolation passent ; le stockage Cloudflare chiffré reste le repli. Le corps brut n'est jamais mis en cache et le résultat est supprimé après création du brouillon ou à l'expiration.

### 5.4 Endpoints proposés

| Méthode | Endpoint | Usage |
|---|---|---|
| POST | /api/workspace-addon/ai/analyze | Résumé, actions ou proposition de réponse |
| POST | /api/workspace-addon/account/status | Plan, quota et état d'association, sans mutation |
| POST | /api/workspace-addon/account/link | URL à usage unique vers le parcours Web protégé d'association/activation |
| GET | /api/workspace-addon/health | Santé technique, sans donnée utilisateur |

Le P0 ne crée ni route ni carte de comparaison. Toute tentative sur `/api/workspace-addon/ai/compare` retourne `404` avant lecture du corps ; l'endpoint ne pourra apparaître qu'après le gate P1 dédié.

Le parcours de recherche Web/Android peut appeler `POST /api/gmail-search/compile` lorsqu'une ambiguïté ne peut être résolue localement. Cette route utilise l'authentification Arty Web/Android existante, la politique Origin browser normale, le consentement et le cycle reserve/settle/void ; elle n'accepte aucun jeton Gmail, n'appelle aucune API Gmail et renvoie seulement un schéma structuré que le compilateur déterministe doit encore valider.

Chaque endpoint métier doit :

1. appartenir à une allowlist exacte de routes et méthodes `/api/workspace-addon/` ; l'absence d'`Origin` n'est jamais une authentification ;
2. vérifier avant tout accès métier soit `systemIdToken` + `userIdToken` en HTTP, soit JWT utilisateur + HMAC/timestamp/nonce dans le repli Apps Script ;
3. vérifier les scopes autorisés, le schéma, la taille, le compte associé, le consentement versionné, le plan, la réservation atomique et les limites de débit ;
4. construire toutes les clés métier depuis un contexte séparant utilisateur et déploiement : `{securityDomain, userIssuer, userSubject, userAudience, userEmail, systemAudience, deploymentServiceAccount}` en HTTP ; le repli remplace les deux derniers champs par le `deploymentId` attesté par HMAC. Les clés compte/trial/D1 utilisent toujours `userSubject`, jamais le `sub` du compte de service ;
5. ne jamais appeler directement un proxy IA en contournant les gardes compte/trial/wallet ;
6. ne jamais écrire jeton, secret, contenu, requête Gmail ou dérivation dans les logs ;
7. renvoyer un JSON minimal compatible avec le runtime retenu.

Le endpoint de santé est traité séparément : il ne renvoie ni configuration, ni audience, ni version de secret, ni état fournisseur. Un test de parité CI échoue si une nouvelle route Add-on n'appelle pas le vérificateur et les gardes métier obligatoires.

Après le spike, une table normative route × méthode × runtime fige la politique Origin. Par défaut, les routes Add-on sont non-browser : `Origin` absent est admis seulement avec toutes les preuves du runtime ; tout `Origin` présent est refusé et aucun en-tête `Access-Control-Allow-Origin` n'est renvoyé. Si les traces Google imposent une exception, elle doit être exacte, annexée au gate et testée. Le endpoint de santé conserve sa politique séparée.

## 6. Parcours utilisateurs

### 6.1 Installation et activation

1. L'utilisateur installe Arty pour Gmail depuis Workspace Marketplace.
2. Google présente la liste exacte des scopes du runtime retenu, archivée avec le gate de phase 0.
3. Arty identifie l'utilisateur par `issuer + sub` à partir du contexte cryptographiquement vérifié.
4. L'association à un compte existant exige une session Arty ou une confirmation hors bande ; une égalité d'adresse e-mail ne suffit jamais.
5. Si aucun droit n'existe, une carte explique l'essai partagé de 30 messages, la confidentialité et les fournisseurs.
6. « Associer mon compte / Activer l'essai » ouvre un parcours Web Arty à usage unique, protégé par Turnstile et rate limits. La carte seule ne crée jamais trente messages de trial.
7. Après confirmation, le module relit l'état du compte et affiche les actions autorisées.

### 6.2 Résumer un e-mail

1. L'utilisateur ouvre un message et le panneau Arty.
2. Il choisit le modèle ou conserve Mistral UE par défaut.
3. La carte affiche le fournisseur qui recevra le contenu.
4. Il clique « Résumer ».
5. Arty lit uniquement le message ouvert, retire les citations et signatures quand possible, puis produit :
   - résumé en trois points ;
   - niveau d'urgence ;
   - prochaine action suggérée.
6. Aucun résultat n'est enregistré dans l'historique Arty par défaut.

### 6.3 Préparer une réponse

1. L'utilisateur choisit « Proposer une réponse ».
2. Il sélectionne un ton : concis, chaleureux, formel ou direct.
3. Arty produit une réponse sans effectuer d'action Gmail.
4. L'utilisateur peut modifier une consigne courte ou régénérer.
5. Il clique « Créer le brouillon ».
6. Gmail ouvre une réponse dans le fil avec le texte prérempli.
7. L'utilisateur relit et clique lui-même sur « Envoyer ».

### 6.4 Retrouver un e-mail sans donner accès à la boîte — P0

1. Dans Arty, l'utilisateur écrit par exemple : « Retrouve le mail de Paul au sujet du devis de juin ».
2. Arty répond qu'il va **préparer** la recherche et que Gmail l'exécutera.
3. Arty propose une requête visible et modifiable, par exemple `from:paul devis after:2026/06/01 before:2026/07/01`. Il n'invente jamais une adresse e-mail inconnue et rend visible toute hypothèse, par exemple « juin 2026 » si l'année n'était pas précisée.
4. L'utilisateur clique sur « Chercher dans Gmail ».
5. Arty copie la requête. En cas de succès, il affiche « Recherche copiée » et ouvre Gmail génériquement. En cas d'échec, il garde la requête visible et sélectionnable et n'effectue aucune navigation automatique.
6. Dans Gmail, l'utilisateur choisit son compte si nécessaire, colle la requête dans la barre et lance la recherche.
7. Gmail effectue la recherche. Arty ne lit ni le nombre, ni les titres, ni les extraits des résultats.
8. L'utilisateur choisit et ouvre le bon message.
9. Il ouvre ensuite le panneau Arty pour résumer ce message ou préparer une réponse selon les parcours 6.2 et 6.3.

Le raccourci ouvrant directement des résultats est hors contrat P0. Il peut être testé en P1 sous feature flag désactivé par défaut, sans supprimer le copier-coller de secours.

Les libellés autorisés sont « Préparer la recherche », « Copier la recherche » et « Chercher dans Gmail ». Les formulations « Arty cherche dans votre boîte », « Résultats trouvés par Arty » ou équivalentes sont interdites.

### 6.5 Comparer deux IA — P1 à haut risque, hors add-on par défaut

1. La comparaison est d'abord disponible dans Arty Web/Android. Son activation dans le panneau Gmail exige un gate séparé de latence et de conformité Limited Use.
2. L'utilisateur choisit deux modèles.
3. L'interface nomme les deux fournisseurs et indique que le même message leur sera transmis.
4. L'utilisateur confirme.
5. Les deux appels partent en parallèle avec une échéance indépendante.
6. Deux versions courtes sont affichées avec le nom réel du modèle. Si un seul modèle répond, la réponse réussie reste utilisable et seul l'appel réussi est débité.
7. L'utilisateur choisit une version et crée le brouillon.
8. L'action consomme un débit par appel réussi.

### 6.6 Mobile et secours

- Le parcours résumé + brouillon doit fonctionner dans Gmail Android via le module Workspace.
- Sur Gmail mobile, le P0 repose uniquement sur les déclencheurs contextuels pris en charge ; aucune fonctionnalité critique ne dépend d'une homepage non contextuelle.
- Le parcours de recherche copie la requête avant d'ouvrir Gmail génériquement sur le Web et Android ; l'utilisateur ne doit jamais perdre la requête si Gmail est absent, déconnecté ou si le changement d'application échoue.
- Le partage Android déjà présent dans Arty reste un parcours de secours, sans promesse de récupérer automatiquement le corps complet.
- Le copier-coller et l'import manuel d'un fichier .eml pourront être proposés si Gmail ne fournit pas le contenu attendu sur un appareil.
- Aucun contenu d'e-mail ne doit être placé dans une URL mailto ou un paramètre de deep link.

## 7. User stories

### Utilisateur Gmail

- En tant que professionnel, je veux résumer l'e-mail que j'ai ouvert afin de comprendre rapidement la demande.
- En tant que professionnel, je veux demander à Arty de préparer une recherche Gmail afin de retrouver un ancien message sans lui ouvrir toute ma boîte.
- En tant que professionnel, je veux extraire les tâches et échéances afin de ne rien oublier.
- En tant que professionnel, je veux obtenir une réponse adaptée à mon ton afin de répondre plus vite.
- En tant qu'utilisateur multi-IA, je veux comparer deux réponses afin de choisir la meilleure.
- En tant qu'utilisateur prudent, je veux savoir quel fournisseur recevra mon e-mail avant le traitement.
- En tant qu'utilisateur prudent, je veux relire le brouillon dans Gmail ; cette version d'Arty ne contient aucun chemin d'envoi.
- En tant qu'utilisateur mobile, je veux utiliser les mêmes actions dans Gmail Android.

### Utilisateur sans abonnement

- En tant que nouvel utilisateur, je veux comprendre les 30 messages d'essai avant d'activer le traitement.
- En tant qu'utilisateur ayant épuisé son quota, je veux voir une explication et un lien de mise à niveau sans perdre mon brouillon.

### Exploitant Arty

- En tant qu'exploitant, je veux mesurer l'activation et la latence sans collecter de contenu d'e-mail.
- En tant qu'exploitant, je veux empêcher un scope restreint de revenir dans un build public.
- En tant qu'exploitant, je veux désactiver rapidement le traitement Gmail sans casser le reste d'Arty.

## 8. Exigences fonctionnelles

### 8.1 P0 — indispensable au lancement

| ID | Exigence | Critère principal |
|---|---|---|
| GML-P0-00 | Fermer `GATE-HTTP-DRAFT-01` avant le code de production | Preuves Web/Android archivées ; HTTP retenu seulement si tous les critères passent, sinon repli Apps Script |
| GML-P0-01 | Lire seulement le message ouvert après clic utilisateur | Le trigger peut afficher la carte, mais aucune lecture du contenu Gmail n'a lieu avant une action explicite |
| GML-P0-02 | Résumer le message | Résumé, urgence et prochaine action affichés |
| GML-P0-03 | Extraire tâches, dates et éléments à répondre | Résultat structuré, sans invention silencieuse |
| GML-P0-04 | Générer une réponse avec quatre tons | Texte éditable avant création du brouillon |
| GML-P0-05 | Créer un brouillon dans le bon fil Gmail | Gmail ouvre la fenêtre de réponse préremplie |
| GML-P0-06 | Afficher fournisseur et région avant traitement | Changement de fournisseur = nouveau consentement |
| GML-P0-07 | Proposer Mistral UE par défaut pour les e-mails | Le libellé UE n'est affiché que pour un routage effectivement UE |
| GML-P0-08 | Appliquer trial partagé, abonnement et wallet via le service serveur commun | Une action simple = une réservation atomique ; un compte Pro sans clé serveur utilise le wallet ou reçoit une explication avant appel |
| GML-P0-09 | Supporter Gmail web et Gmail Android | Parcours critique validé sur les deux |
| GML-P0-10 | Gérer refus de scope, quota, timeout et message trop long | Carte d'erreur avec action de résolution |
| GML-P0-11 | Produire uniquement un brouillon | Aucun appel à `messages.send`, `drafts.send`, `GmailDraft.send` ou équivalent n'existe dans cette version |
| GML-P0-12 | Transformer une demande en requête Gmail éditable et passer la main à Gmail | Compilateur et post-filtre déterministes ; aucune adresse absente de la demande ; aucun scope ou appel API Gmail ; aucun retour des résultats vers Arty |
| GML-P0-13 | Authentifier chaque route Add-on avec le schéma exact du runtime | HTTP : deux jetons Google vérifiés ; Apps Script : JWT + HMAC rotatif ; aucune réutilisation de `tokeninfo` ni fallback vers l'auth Web |
| GML-P0-14 | Associer le compte et activer le trial hors de la carte | Lien Web à usage unique, confirmation du compte, Turnstile, limites anti-abus et aucun crédit créé par simple égalité d'e-mail |
| GML-P0-15 | Fonder droits et facturation sur un `account_id` canonique | `issuer+sub` résout une identité externe unique ; changement d'e-mail sans perte, aucune association silencieuse ni droit dupliqué |
| GML-P0-16 | Bloquer tout fournisseur sans dossier Limited Use valide | Registre serveur versionné, preuve non expirée et consentement compatible exigés avant construction du payload ; un flag seul ne suffit jamais |
| GML-P0-17 | Retirer Drive du produit public P0 | Aucun scope, route, outil, hook, promesse ou import Drive dans le bundle ; `drive.file` reporté à une spec P1 |

### 8.2 P1 — après validation du P0, toujours sans CASA

| ID | Exigence | Impact conformité |
|---|---|---|
| GML-P1-01 | Analyser tout le fil ouvert | Ajouter gmail.addons.current.message.readonly ; vérification sensitive, pas CASA |
| GML-P1-02 | Assistant dans la fenêtre de composition | Scope contextuel compose ; mise à jour du brouillon courant |
| GML-P1-03 | Import .eml et partage Android durci | Pas de scope Gmail ; traitement manuel |
| GML-P1-04 | Envoi de nouveaux e-mails depuis Arty web/mobile | Ajouter gmail.send ; vérification sensitive, pas CASA |
| GML-P1-05 | Sauvegarde volontaire du résultat dans une conversation Arty | Consentement distinct et règles de conservation existantes |
| GML-P1-06 | Traitement d'une pièce jointe sélectionnée | Consentement dédié, limites MIME/taille, analyse antimalware |
| GML-P1-07 | Comparer deux modèles | Web/Android d'abord ; add-on désactivé tant qu'un gate de latence et la revue Limited Use des deux fournisseurs ne passent pas |
| GML-P1-08 | Tester un raccourci direct vers une recherche Gmail | Feature flag désactivé par défaut ; aucun scope supplémentaire, aucun `/u/0/`, repli copier-coller toujours disponible |

### 8.3 P2 — exclu tant qu'une décision CASA n'est pas prise

- Recherche globale exécutée par Arty via l'API Gmail ou avec lecture des résultats. L'assistant de requête P0 reste autorisé, car Gmail exécute la recherche et Arty n'en voit pas les résultats.
- Triage de non-lus.
- Briefing matinal.
- Analyse en lot.
- Automatisation de labels, archive, corbeille ou étoile.
- Veille ou mémoire automatique de la boîte.

Ces fonctions nécessitent des scopes restreints et constituent un produit différent, à évaluer ultérieurement avec son propre dossier coût/valeur.

## 9. Contrat de scopes

### 9.1 Allowlist P0

Les deux scopes Gmail fonctionnels autorisés, quel que soit le runtime, sont :

    https://www.googleapis.com/auth/gmail.addons.current.message.action
    https://www.googleapis.com/auth/gmail.addons.current.action.compose

Le manifest de référence du repli Apps Script contient cinq scopes au total :

    https://www.googleapis.com/auth/gmail.addons.current.message.action
    https://www.googleapis.com/auth/gmail.addons.current.action.compose
    https://www.googleapis.com/auth/script.external_request
    https://www.googleapis.com/auth/userinfo.email
    openid

Le candidat HTTP déclare l'allowlist minimale nécessaire aux deux actions et à son identité. `GATE-HTTP-DRAFT-01` doit enregistrer la liste exacte, expliquer toute différence avec les cinq scopes ci-dessus et joindre une capture du consentement. `script.external_request` n'est conservé que si Apps Script est retenu. Toute addition est bloquée en CI jusqu'à validation explicite.

Les scopes du module ne doivent apparaître ni dans googleAuth.ts ni dans GoogleSignInPlugin.java. L'application principale P0 ne demande aucun scope Gmail ; gmail.send ne peut être ajouté qu'en P1 après sa vérification sensitive.

La génération et le transfert d'une requête de recherche Gmail n'ajoutent aucun scope. Un test réseau doit prouver qu'ils ne déclenchent aucun appel à `gmail.googleapis.com`, `GmailApp.search`, `messages.list`, `threads.list`, IMAP ou service équivalent.

### 9.2 Denylist publique

Le build public et sa configuration Google Cloud ne doivent contenir aucun des scopes suivants :

    https://mail.google.com/
    https://www.googleapis.com/auth/gmail.readonly
    https://www.googleapis.com/auth/gmail.modify
    https://www.googleapis.com/auth/gmail.compose
    https://www.googleapis.com/auth/gmail.metadata
    https://www.googleapis.com/auth/gmail.insert
    https://www.googleapis.com/auth/drive
    https://www.googleapis.com/auth/drive.readonly

### 9.3 Reste de l'écosystème Google

- Retirer entièrement Drive du P0 : scopes, connecteur, outils, routes, hooks, copies UI, démos et tests. `drive.file` reste une option P1 distincte, sans droit acquis dans ce cahier des charges.
- Supprimer le doublon calendar + calendar.events et conserver le scope minimal validé.
- Retirer Contacts du consentement et du bundle public P0 : aucun parcours 6.2 à 6.4 ne l'exige. Une réintroduction ultérieure passe par un consentement incrémental séparé et jamais par le manifest Gmail.
- Distinguer « identité Google connectée » des capacités Gmail, Calendar, Contacts et Drive.

### 9.4 Permissions granulaires

Le module doit gérer le cas où l'utilisateur n'accorde qu'une partie des scopes :

- en HTTP, vérifier `authorizationEventObject.authorizedScopes` à chaque action et renvoyer `requesting_google_scopes` pour la liste strictement manquante ;
- dans le repli Apps Script, vérifier les scopes requis avec `ScriptApp.requireScopes()` ou `getAuthorizationInfo()` ;
- différer le scope de lecture jusqu'à l'analyse et le scope compose jusqu'au premier brouillon **seulement si** le runtime et le flux Google validés pendant la phase 0 permettent réellement ce consentement incrémental ;
- sinon, afficher dès l'installation les cinq scopes exacts du manifest Apps Script et expliquer leur usage sans promettre un consentement différé ;
- afficher une carte d'autorisation ciblée lorsqu'un scope manque ;
- reprendre l'action après autorisation sans dupliquer le débit ni le brouillon ;
- rester fonctionnel pour les actions dont les scopes ont été accordés.

## 10. Exigences de sécurité et confidentialité

### 10.1 Jetons

Le module utilise un nouveau vérificateur `verifyWorkspaceAddonRequest`. Les helpers actuels Web/Android fondés sur `tokeninfo`, une session ou `GOOGLE_CLIENT_ID` ne sont jamais utilisés en fallback.

Règles communes :

- vérifier cryptographiquement les JWT avec les clés Google du JWKS officiel épinglé ; ignorer tout `jku`, `x5u` ou URL fourni par le client ;
- autoriser seulement `RS256`, vérifier `kid`, signature, issuer exact, audience exacte définie par la politique du runtime, `exp`, `iat`, `sub`, `email` et `email_verified === true` ;
- utiliser `issuer + sub` comme identité externe stable. L'e-mail est un attribut d'affichage, jamais une preuve d'association à un compte ;
- mettre les JWKS en cache selon les en-têtes Google ; sur `kid` inconnu, tenter un seul rafraîchissement. Sans clé valide ou en cas d'ambiguïté, échouer fermé avant D1, quota ou fournisseur ;
- interdire `alg:none`, le simple décodage, `tokeninfo` en production et tout comportement permissif sur `aud` ou `azp` ;
- produire après validation deux sous-contextes immuables : identité utilisateur `{userIssuer, userSubject, userAudience, userEmail}` et attestation du déploiement `{runtime, securityDomain, systemAudience, deploymentServiceAccount ou deploymentId}`. `securityDomain` provient uniquement de la politique serveur de la route ; aucune valeur ne vient du corps ;
- ne jamais persister ou journaliser jeton d'identité, jeton contextuel ou clé JWKS brute, ni les renvoyer à Arty Web ou au fournisseur d'IA.

En runtime HTTP :

- vérifier le bearer `systemIdToken` avec l'audience égale à l'URL exacte de l'endpoint et l'e-mail égal au compte de service du déploiement ;
- vérifier séparément `authorizationEventObject.userIdToken` contre le client OAuth du module ;
- prendre le `messageId` uniquement depuis `gmail.messageId` de l'événement authentifié, jamais depuis une propriété de substitution du client ;
- pour chaque appel contextuel à l'API Gmail, envoyer ensemble `authorizationEventObject.userOAuthToken` comme bearer et `gmail.accessToken` dans `X-Goog-Gmail-Access-Token`. Un jeton manquant, inversé, altéré ou réutilisé hors de la requête courante entraîne un refus ; aucun des deux ne prouve l'identité Arty et aucun n'est conservé.

En repli Apps Script :

- utiliser le jeton contextuel Gmail seulement dans l'exécution courante et ne jamais l'envoyer à Cloudflare ;
- mesurer pendant le spike l'audience réellement émise par `ScriptApp.getIdentityToken()`, l'enregistrer comme `WORKSPACE_ADDON_APPS_SCRIPT_AUDIENCE` et exiger ensuite cette valeur exacte ; ne pas supposer qu'elle est l'URL de route ou le client du runtime HTTP ;
- appeler Cloudflare avec `ScriptApp.getIdentityToken()` **et** une signature HMAC de déploiement. Un HMAC valide ne compense jamais un JWT invalide, ni l'inverse ;
- signer une chaîne canonique comprenant version, méthode, chemin normalisé, SHA-256 du corps exact, timestamp, nonce, `kid` et identifiant du déploiement ; comparaison en temps constant, dérive maximale ±120 secondes et nonce à usage unique ;
- stocker les secrets seulement dans les propriétés protégées du script et les secrets Cloudflare, jamais dans Git, D1, KV, CacheService, bundle, logs ou réponse ;
- maintenir deux emplacements `current` et `previous`. Cloudflare accepte `previous` pendant au plus 24 heures ; après validation du nouveau `kid`, l'ancien est supprimé. Une compromission impose une révocation immédiate sans grâce ;
- documenter un runbook de rotation : charger le nouveau vérificateur, déployer le signataire, observer, promouvoir puis retirer l'ancien.

La politique multi-audiences est une table serveur par route. Chaque entrée suit le cycle `current` → `next` → `retired` avec `validFrom` et `validUntil`. Les audiences Web/Android, Add-on et migration ne sont jamais interchangeables ; une audience `retired` ou bêta est refusée en production. Un JWT multi-audiences est refusé sauf prise en charge explicite et test de `azp`.

### 10.2 Contenu

- Lire seulement le messageId fourni par le contexte Gmail courant.
- Exclure les pièces jointes au P0.
- Ne charger aucune image distante.
- Convertir en texte, retirer scripts, styles, pixels et URLs d'images.
- Tenter de retirer historique cité, signature et avertissements répétitifs.
- Limiter à 30 000 caractères utiles ; afficher clairement toute troncature.
- Traiter le message comme une donnée tierce non fiable.
- Encadrer le contenu avec la protection existante contre la prompt injection.
- Ne donner aucun outil, action Gmail ou secret au modèle utilisé pour le résumé.
- Traiter la demande de recherche comme une saisie volontaire de l'utilisateur, jamais comme une donnée lue dans Gmail. Elle peut néanmoins contenir des données personnelles et reste soumise à la politique de confidentialité, à la minimisation et au RGPD.
- Le modèle renvoie des champs structurés, jamais une URL ni une requête exécutable libre. Un compilateur déterministe construit la requête à partir d'une allowlist d'opérateurs Gmail documentés, échappe les contrôles et encode toute valeur placée dans un lien.
- Appliquer un post-filtre déterministe : toute adresse contenant `@` doit apparaître à l'identique dans la demande utilisateur ou provenir d'une sélection explicite ; sinon elle est supprimée et signalée. Aucun nom inventé n'est converti silencieusement en adresse.
- Afficher et rendre éditable la requête avant de quitter Arty. Toute année, date ou précision déduite est marquée comme hypothèse modifiable.
- Si un modèle est utilisé pour convertir la demande, appliquer le même consentement fournisseur que dans le reste d'Arty. Aucun résultat Gmail ne lui est transmis.
- Limiter l'ouverture P0 à la racine HTTPS de Gmail en allowlist ou à un intent Gmail explicitement ciblé, sans `/u/0/`, jeton, identifiant de compte, contenu d'e-mail ni callback vers Arty. Le parcours ne doit utiliser ni WebView injectée ni lecture du DOM Gmail.
- Sur Android, avertir que la requête va être placée dans le presse-papiers et peut être visible du système ou du clavier. Proposer « Afficher seulement » sans copie pour une recherche sensible ; ne jamais y placer le corps d'un e-mail. Effacer la valeur créée par Arty après un délai court lorsque la plateforme le permet sans supprimer un contenu plus récent de l'utilisateur.

### 10.3 Fournisseurs d'IA

L'absence de CASA ne dispense pas Arty de la revue Google Limited Use. Le transfert IA multi-fournisseurs est un gate de publication indépendant.

- Utiliser le message, le prompt et toute dérivation — résumé, tâches, réponse ou feedback associé — uniquement pour la fonctionnalité visible demandée.
- Interdire à Arty, aux fournisseurs et sous-traitants d'utiliser ces données pour publicité, revente, profilage, scoring, constitution d'une base permanente, entraînement, évaluation ou amélioration d'un modèle généraliste.
- Avant le premier transfert à chaque fournisseur, afficher les données envoyées, la finalité, le fournisseur, la région et la rétention, puis recueillir un consentement affirmatif versionné. Redemander l'accord si l'un de ces éléments change.
- Utiliser uniquement un fournisseur dont DPA, sous-traitants, localisation, no-training, rétention, accès humain et suppression ont fait l'objet d'une preuve contractuelle datée. Sans preuve, son feature flag reste désactivé.
- Maintenir un registre canonique versionné par fournisseur et modèle avec `evidenceVersion`, `reviewedAt`, `validUntil`, région, rétention, no-training, accès humain, mécanisme de suppression et `consentVersion`. Le registre est livré côté serveur et modifiable seulement par le processus d'administration/revue, jamais par une requête utilisateur.
- Avant de construire le payload, le serveur exige un feature flag actif, une preuve présente et non expirée, une région/rétention conformes et un consentement de version compatible. Un flag seul ne peut jamais activer un fournisseur.
- Désactiver la rétention fournisseur lorsque l'option existe et documenter toute durée résiduelle ; ne jamais promettre « zéro rétention » sans preuve.
- Interdire l'accès humain hors obligation légale, nécessité de sécurité strictement bornée ou consentement explicite portant sur les données concernées ; journaliser et revoir toute exception.
- En mode Europe, router exclusivement vers un fournisseur et une infrastructure effectivement européens.
- Une comparaison exige un consentement distinct pour chacun des deux fournisseurs et reste hors du panneau Gmail tant que son gate Limited Use et latence n'est pas validé.
- La politique publique doit déclarer le respect de la Google API Services User Data Policy, « including the Limited Use requirements », et décrire la gestion/suppression des données.
- Le runbook incident inclut l'investigation des caches et fournisseurs ainsi que la notification Google requise en cas d'accès connu ou suspect aux Google Data.

### 10.4 Journalisation et métriques

Autorisés :

- type d'action ;
- modèle et fournisseur ;
- statut HTTP ou catégorie d'erreur ;
- latence ;
- tranche de taille ;
- nombre de tokens/coût ;
- identifiant utilisateur pseudonymisé ;
- version de consentement et résultat du gate fournisseur, sans contenu ;
- événement `gmail_search_handoff` sans la requête brute.

Interdits :

- sujet, expéditeur, destinataires ;
- messageId ou threadId brut ;
- corps, extrait, pièce jointe ;
- prompt ou réponse ;
- toute dérivation Gmail en clair, y compris résumé, tâches et feedback ;
- jeton Google ;
- secret HMAC `current` ou `previous`, signature complète, nonce réutilisable ou `sub` brut ;
- adresse email en logs applicatifs ;
- requête de recherche Gmail brute ou mots saisis pour la construire.

### 10.5 Anti-abus et idempotence

- Le trial de 30 messages est un droit serveur unique partagé entre les canaux. Il est lié au compte Arty canonique et à `issuer + sub`, jamais seulement à l'e-mail ou à l'audience.
- Réinstallation, révocation, nouvel appareil, changement de client OAuth ou dissociation ne recréent jamais le trial. Plusieurs identités liées au même compte partagent le même solde ; une identité ne peut activer la même campagne sur deux comptes.
- L'activation s'effectue sur le Web avec Turnstile, limites par IP du navigateur, `sub`, compte et campagne. Ne jamais utiliser l'IP de sortie Google/Apps Script comme identité utilisateur.
- Le lien `/account/link` porte un jeton aléatoire d'au moins 256 bits, TTL maximal dix minutes, dont seul le hash est stocké. Il est lié à `securityDomain + userIssuer + userSubject`, à un `state` anti-CSRF et à une URL de retour en allowlist ; `Referrer-Policy: no-referrer` s'applique.
- La consommation du jeton est atomique et unique dans une session Arty authentifiée. L'association à un compte existant exige une réauthentification ; changement de session, de `userSubject`, de compte, de domaine de sécurité, replay, token expiré ou open redirect sont refusés sans créer de droit.
- Imposer un plafond global quotidien de dépense trial et une alerte, configurés avant publication. Si le ledger, le plafond ou D1 est indisponible, le canal Add-on échoue fermé sans appel fournisseur.
- Utiliser un ledger D1 atomique par enfant `{action_id, provider, model}` : réserver avant l'appel, régler seulement une réponse 2xx exploitable effectivement rendue à l'utilisateur et annuler une erreur ou un timeout certain.
- Après envoi au fournisseur sans résultat terminal, passer à `pending_uncertain` pendant au plus quinze minutes. Aucun nouvel appel fournisseur n'est lancé. Une réconciliation idempotente règle seulement si une réponse exploitable a été enregistrée comme livrée ; sinon elle annule la réservation à l'échéance et comptabilise l'éventuel coût fournisseur comme perte opérationnelle, jamais comme débit utilisateur.
- Un crash ou redémarrage reprend la même ligne de ledger. Une tentative avec la même clé retourne l'état existant ; une nouvelle clé reste bloquée pour la même action tant que `pending_uncertain` n'est pas terminal.
- Appliquer contraintes uniques et clés d'idempotence à l'activation, à la consommation et au brouillon. Vingt requêtes concurrentes sur le dernier crédit ne peuvent produire qu'une seule réservation facturable.
- Limites initiales : 10 actions par cinq minutes et par `sub`/compte, 5 actions sur le même message en dix minutes avec identifiant HMAC non réversible, plus limites par déploiement et plafond global.
- Les signaux antifraude sont minimisés, pseudonymisés et soumis à TTL ; aucun contenu Gmail ne sert de signal.
- Nonce signé à usage unique, durée maximale deux minutes. Une seconde requête avec le même nonce est refusée avant tout débit.
- Aucun retry automatique si la création du brouillon a un état incertain ; le bouton reste désactivé pendant l'action.

## 11. Contraintes de performance

Le budget fonctionnel interne reste identique pour les deux runtimes, mais la limite Google de 30 secondes concerne le repli Apps Script. Le runtime HTTP doit démontrer ses propres limites réelles pendant le gate.

| Étape | Budget P95 |
|---|---:|
| Affichage de la carte contextuelle | 1,5 s |
| Validation et récupération Gmail | 3 s |
| Nettoyage du message | 1 s |
| Appel IA simple | 18 s |
| Réponse complète de l'action | 25 s |

L'orchestrateur impose une échéance globale et annule l'appel IA vers 18–20 secondes afin de rendre une carte avant 25 secondes. À l'échéance, il s'arrête proprement et propose un modèle rapide. Aucun traitement asynchrone ne conserve le jeton Gmail.

`GATE-HTTP-DRAFT-01` inclut un volet capacité, pas seulement un test fonctionnel. Le dossier archive la limite de réponse réellement observée côté Workspace, les limites de taille événement/carte, le comportement des deux jetons Gmail temporaires, les quotas Gmail rencontrés, ainsi que les limites Cloudflare Worker de CPU, temps mural, mémoire, sous-requêtes et corps. Il mesure aussi démarrage à froid du vérificateur/JWKS, accès D1 et récupération Gmail.

Le volet capacité passe seulement si :

- trente parcours séquentiels puis un test à deux fois la concurrence de lancement prévue terminent sans `429`, dépassement de plateforme, fuite inter-utilisateur ni double effet ; la cible de concurrence est chiffrée avant le test, sinon le gate reste ouvert ;
- le P95 complet reste inférieur ou égal à 25 secondes et validation + récupération Gmail à 3 secondes, y compris après démarrage à froid et rotation JWKS ;
- événement et réponse gardent au moins 20 % de marge sous la plus petite limite publiée ou mesurée ;
- l'expiration, l'absence ou la permutation de l'un des deux jetons Gmail échoue proprement sans retry fournisseur ni débit ;
- une panne D1/JWKS/fournisseur et une rafale à la limite retournent un état utilisateur borné dans le budget.

La comparaison de deux fournisseurs cumule deux risques de latence et ne dispose pas de streaming dans une carte. Elle reste désactivée dans l'add-on tant qu'un test spécifique ne démontre un succès partiel utile dans le budget.

Si Apps Script est retenu, les valeurs Google suivantes, constatées au 13 juillet 2026, doivent être revérifiées juste avant publication et surveillées :

- 30 secondes par exécution Workspace Add-on ;
- 30 exécutions simultanées par utilisateur et 1 000 par script ;
- `UrlFetch` : 20 000 appels/jour pour un compte grand public et 100 000 pour Workspace ;
- opérations Gmail lecture/écriture : 20 000/50 000 par jour selon le type de compte ;
- Properties : 50 000/500 000 lectures-écritures par jour, 9 Ko par valeur et 500 Ko par store ;
- CacheService : 100 Ko par clé, 1 000 entrées ; TTL indicatif avec éviction anticipée possible.

CacheService ne sert jamais de source de vérité pour la facturation, l'idempotence ou le consentement. Toute erreur de quota produit une catégorie explicite et un repli sans boucle de retry. Le dashboard Apps Script et les dépenses Cloudflare/fournisseurs sont monitorés avant l'ouverture publique.

Pour la recherche assistée, la requête doit être visible en P95 sous 15 secondes. Le compilateur IA expire après 10 secondes et rend un formulaire éditable de secours ; la copie et le lancement de l'intent doivent rester sous une seconde P95. Le temps total jusqu'aux résultats Gmail est évalué manuellement en test d'utilisabilité, pas par télémétrie intrusive.

## 12. Modèle économique du module

Le module ne peut pas utiliser directement les clés BYOK conservées uniquement sur l'appareil dans Arty.

Le P0 utilisera donc :

- le trial de 30 messages partagé entre l'application Arty et le module Gmail ;
- l'abonnement Arty ;
- le wallet de crédits ;
- les comptes VIP.

L'association au compte Arty exige un clic explicite « Associer ce compte » ou « Activer l'essai » ; aucune création de compte silencieuse par simple correspondance d'adresse n'est autorisée. La fiche Marketplace doit expliquer que le module consomme le trial, l'abonnement ou les crédits serveur.

L'activation du trial ne se fait pas directement dans la carte : elle ouvre le parcours Web protégé décrit au §10.5. Le droit est partagé entre Web, Android et Add-on et n'est jamais recréé par réinstallation.

Dans le module, le BYOK local n'est jamais disponible. Un compte Pro est donc éligible au wallet serveur : si son solde suffit, l'orchestrateur réserve puis règle les crédits ; sinon il renvoie l'état `pro_addon_credits_required` et propose l'achat de crédits. Le canal Add-on ne doit jamais renvoyer `pro_byok_required`. Le stockage serveur de clés BYOK reste hors périmètre.

L'orchestrateur Add-on ne réutilise pas `checkAllowedUser()` tel quel, car le code actuel décrémente le trial avant l'appel. Il expose un cycle dédié `reserveAddonEntitlement` → `settleAddonEntitlement` ou `voidAddonEntitlement`, commun au trial, à l'abonnement et au wallet, avec un enfant par fournisseur/modèle.

Règles de décompte :

- compilation locale déterministe d'une recherche Gmail : 0 message ; recours à un modèle pour lever une ambiguïté : 1 message après consentement et affichage du coût ;
- résumé, extraction ou génération simple : 1 débit réglé seulement si une réponse exploitable est produite ;
- comparaison de deux modèles : 0, 1 ou 2 débits, un par réponse exploitable ; zéro si les deux échouent ;
- création du brouillon à partir d'un résultat existant : 0 message ;
- régénération : nouveau message.

## 13. Migration depuis l'intégration actuelle

### 13.1 État actuel

Le produit public demande actuellement :

- gmail.readonly, gmail.send et gmail.modify dans src/services/googleAuth.ts ;
- les mêmes scopes dans android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java ;
- drive complet, qui suffit à maintenir le périmètre CASA ;
- onze outils Gmail de lecture, recherche, pièces jointes, envoi et modification ;
- un chargement automatique des non-lus et un briefing proactif ;
- des helpers d'identité fondés sur des access tokens et `tokeninfo`, incompatibles avec les JWT du module ;
- un débit trial effectué avant l'appel fournisseur et quatre proxys qui refusent le plan Pro avant d'atteindre le wallet ;
- une bêta qui partage encore des ressources de données avec la production et doit être isolée avant le lancement.

Changer uniquement la constante SCOPES laisserait donc des outils visibles qui échoueraient en production.

### 13.2 Travaux de migration obligatoires

| Zone | Changement |
|---|---|
| `google-workspace-addon/` | Créer le manifest et le spike HTTP ; ne créer l'adaptateur Apps Script qu'en cas d'échec de `GATE-HTTP-DRAFT-01`. Allowlists strictes `urlFetchWhitelist` et `openLinkUrlPrefixes`, sans `*` |
| `functions/api/workspace-addon/**` | Créer les endpoints, le vérificateur de runtime, la garde de scopes, l'orchestrateur et les réponses JSON dédiées |
| `src/services/googleAuth.ts` | Retirer Gmail, Drive complet et Contacts du P0 principal ; versionner les scopes et exposer les capacités réellement accordées |
| `android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java` | Appliquer le même retrait et aligner strictement les scopes Android |
| `src/types/google.ts`, `functions/api/auth/token.ts` | Ajouter `grantedScopes` et capacités ; retourner les scopes réellement accordés |
| `functions/api/auth/refresh.ts` et tous les gardes d'auth | Utiliser le nouveau client public ; rejeter l'audience bêta partout, pas uniquement au refresh |
| `functions/api/_middleware.ts` | Autoriser l'absence d'Origin seulement pour l'allowlist exacte de routes/méthodes Add-on ; aucune règle approximative ni fallback d'auth |
| `functions/env.d.ts`, `.env.example`, secrets Cloudflare | Ajouter client Add-on, compte de service, audiences/URLs, HMAC `current/previous`, `kid` et plafond trial ; aucun secret ou binding bêta dans la production |
| `package.json` | Ajouter une bibliothèque JWT/JWKS compatible Workers ; ne pas réutiliser les appels `tokeninfo` |
| `schema.sql` et migrations D1 | Ajouter `accounts` et `external_identities(account_id, security_domain, issuer, subject)` avec unicité sur le domaine et l'identité ; faire référencer quotas, trials, abonnements, licences, wallet, réservations et consentements par `account_id` avec FK/contraintes explicites |
| Bindings D1/KV/R2 | Ajouter ledger reserve/settle/void, nonces, idempotence, plafond global et cache chiffré TTL cinq minutes ; environnement bêta physiquement séparé |
| `functions/api/_lib/checkAllowedUser.ts`, `_lib/wallet.ts`, `_lib/quota.ts`, `_lib/freeQuota.ts`, `_lib/checkPremiumCap.ts`, `_lib/emailTrial.ts`, `trial/init.ts`, `subscription/status.ts`, `wallet/**`, `billing/**`, `checkout/creem.ts`, `webhook/{creem,lemonsqueezy}.ts`, `license/activate.ts`, `auth/email/**` | Résoudre d'abord l'identité externe vers `account_id`, puis lire/écrire les droits par cet identifiant. Les métadonnées de paiement portent un identifiant opaque de compte, jamais l'e-mail comme clé métier. Déployer par dual-read/dual-write contrôlé, backfill vérifié, puis contraintes `NOT NULL`/FK et retrait de l'ancien chemin |
| `src/App.tsx`, `src/hooks/useAppSetup.ts` | Retirer prop/hook Gmail, auto-fetch et initialisation des outils globaux |
| `src/components/home/HomeScreen.tsx`, `src/components/chat/ConversationScreen.tsx` | Retirer actions/bandeaux Gmail et Drive devenus faux ; intégrer le point d'entrée de recherche sans scope Gmail |
| `src/components/home/MorningBrief.tsx`, `src/services/morningBriefService.ts`, `src/hooks/useProactiveBrief.ts`, `src/services/proactiveBriefActions.ts`, `src/components/home/ProactiveBriefCard.tsx`, `src/services/proactiveBriefSettings.ts`, `src/components/settings/SettingsModal.tsx` | Supprimer la lecture des non-lus et les actions view/reply ; retirer le brief ou le rendre Calendar-only |
| `src/constants/slashCommands.ts` | Remplacer `/email` « lire les non-lus » par « préparer une recherche Gmail » |
| `src/services/aiRouter.ts`, `src/services/router/resolveRoute.ts`, `src/hooks/useConversation.ts`, `src/constants/systemPrompt.ts` | Router « retrouve/cherche un mail » vers le compilateur avant le routeur IA normal ; supprimer triggers, outils et promesses Gmail/Contacts globaux |
| `src/services/toolDefinitions.ts`, `src/services/toolExecutor.ts`, `src/services/tools/gmailTools.ts`, `src/hooks/useGmail.ts`, `src/services/gmailClient.ts`, `functions/api/gmail/action.ts` | Retrait public complet des outils Gmail ; la création de brouillon Add-on n'est jamais un tool LLM/local |
| `src/services/toolConfirmation.ts`, son test et `SAFE_TOOLS` | Retirer les règles orphelines Gmail/Contacts et conserver le test de parité « aucun garde fantôme » |
| `src/services/contactsClient.ts`, `src/services/tools/contactsTools.ts`, `functions/api/contacts/action.ts`, routeur et tests associés | Retirer Contacts du P0, du consentement, du bundle et des suggestions |
| `src/components/auth/GoogleLoginTab.tsx`, `src/components/onboarding/OnboardingChoice.tsx`, `src/components/shared/SettingsGuide.tsx`, `src/components/google/GoogleConnectButton.tsx`, `src/components/google/GoogleStatus.tsx`, `index.html` | Ne plus présenter la connexion Google comme donnant accès à Gmail ou au Drive complet |
| `src/components/google/EmailCard.tsx` | Supprimer s'il devient mort après retrait du client Gmail global |
| `src/i18n/locales/fr.json`, `src/i18n/locales/en.json` | Auditer login, onboarding, suggestions, routage privé, bandeaux, confirmations, briefs, réglages et partage ; ajouter le namespace `gmailSearch` complet |
| `src/services/previewDemo.ts`, `src/__tests__/services/previewDemo.test.ts` | Remplacer le devis prétendument retrouvé dans Drive et la synthèse globale des mails par le parcours honnête ; ajouter une denylist de promesses globales |
| `src/services/gmailSearchQuery.ts`, tests | Ajouter AST/schéma, renderer, allowlist, bornes, nettoyage CRLF/bidi et post-filtre déterministe avant copie ; ne jamais réutiliser `search_emails` |
| `functions/api/gmail-search/compile.ts` et compilateur serveur partagé | Lever seulement les ambiguïtés que le parseur local signale ; auth Web/Android, consentement fournisseur, sortie JSON structurée, timeout dix secondes, reserve/settle/void et aucun appel Gmail. Le renderer/post-filtre client reste l'autorité finale |
| `src/services/gmailSearchHandoff.ts`, `src/components/gmail/GmailSearchCard.tsx`, tests | Aperçu éditable, hypothèses, validation, copie/ouverture et repli sélectionnable |
| `src/types/index.ts`, `src/components/chat/MessageList.tsx`, `src/components/chat/AssistantBubble.tsx`, `src/hooks/useConversation.ts` | Introduire un payload typé `gmail_search`, rendu comme composant de confiance et jamais comme HTML, Markdown exécutable ou tool call ; intégrer le parcours aux messages actuels et à leurs états d'erreur |
| `src/services/storage.ts` | Conserver localement le payload typé et la requête pendant au plus une heure afin de survivre au basculement d'application ; aucune synchronisation serveur ou analytics de contenu, suppression à l'expiration ou sur action de l'utilisateur |
| `android/.../GmailHandoffPlugin.java`, `MainActivity.java` | Ajouter un pont natif de presse-papiers sensible et un intent Gmail générique ; n'effacer que la valeur encore posée par Arty |
| `src/services/gmailSearchMetrics.ts` et endpoint agrégé | Émettre seulement les événements sans contenu autorisés ; aucune prétention de mesurer les résultats Gmail |
| `functions/api/_lib/checkAllowedUser.ts`, `trial/init.ts`, `_lib/walletBilling.ts` | Extraire le service après identité vérifiée ; remplacer le débit anticipé par reserve/settle/void et fermer l'abus trial |
| Les quatre proxys IA | Extraire un orchestrateur serveur commun ; dans l'Add-on, router Pro vers le wallet avant le retour `pro_byok_required` |
| Comparaison multi-modèles | Backlog P1 uniquement : aucune route, carte, branche activable ou test fonctionnel `flag=true` livré dans le P0 |
| `src/services/toolDefinitions.ts`, `src/services/toolExecutor.ts`, `src/hooks/useDrive.ts`, `src/services/driveClient.ts`, `src/services/tools/driveTools.ts`, `functions/api/drive/action.ts`, UI/i18n/prompts/tests Drive | Retirer le scope, le connecteur et tous les parcours Drive du P0. Une éventuelle réintroduction `drive.file` exigera une spec et un consentement incrémental P1 séparés |
| `PRIVACY`, DPIA, Play Data Safety, registre sous-traitants | Décrire runtime final, données et dérivations, consentements, fournisseurs, TTL, suppression et Limited Use |
| `PLAY-STORE-SUBMISSION.md` | Corriger explicitement `gmail.compose` : scope restreint, exclu du plan sans CASA |
| CI | Interdire la denylist de scopes ; tester la parité route/auth/gardes, les promesses FR/EN et l'absence de binding bêta en production |

### 13.3 Anciens jetons

Retirer un scope du code ne réduit pas les privilèges des refresh tokens déjà accordés.

La migration doit :

1. créer un client OAuth pour l'application publique et un client/déploiement distinct pour l'Add-on ; leurs audiences diffèrent de la bêta ;
2. utiliser une version locale uniquement pour détecter les anciennes sessions et guider la migration, jamais comme contrôle de sécurité ;
3. proposer puis exécuter la révocation Google des anciens grants ;
4. supprimer les copies locales ;
5. forcer une nouvelle autorisation avec les scopes minimaux de l'application principale ;
6. vérifier les scopes réellement retournés par le nouveau flux ;
7. appliquer la table de politique d'audiences à toutes les routes et refuser l'audience bêta dans toute la production ;
8. garder les scopes gmail.addons.* exclusivement dans le manifest du module, jamais dans googleAuth.ts ou GoogleSignInPlugin.java.
9. migrer l'identité métier vers `issuer + sub` sans recréer de trial et sans associer silencieusement par e-mail ;
10. déplacer la bêta vers une base, des namespaces et des secrets physiquement distincts, puis supprimer tout binding de production vers ces ressources.

La bêta historique peut rester sur un environnement privé de test, mais aucun endpoint, jeton, secret ou binding de données de cette bêta ne doit être accepté par la production publique.

## 14. Critères d'acceptation

### 14.1 Fonctionnels

- Étant donné le spike de phase 0, HTTP n'est choisi que si `GATE-HTTP-DRAFT-01` passe intégralement sur Web et Android ; sinon le repli Apps Script est sélectionné et un seul runtime continue.
- Étant donné un e-mail ouvert, quand l'utilisateur clique « Résumer », alors seul ce message est lu et un résumé apparaît.
- Étant donné une proposition de réponse, quand l'utilisateur clique « Créer le brouillon », alors Gmail ouvre une réponse dans le bon fil.
- Étant donné un brouillon créé, aucun appel `messages.send`, `drafts.send`, `GmailDraft.send` ou équivalent n'est disponible dans cette version.
- Étant donné une version P0, aucune carte, route ou branche activable de comparaison n'est livrée ; `/api/workspace-addon/ai/compare` retourne `404` avant lecture du corps. Le comportement à deux fournisseurs appartient aux critères d'une future version P1.
- Étant donné un quota épuisé, le contenu n'est pas transmis et une carte de mise à niveau apparaît.
- Étant donné un message trop long, la troncature est visible.
- Étant donné un scope refusé, le module reste utilisable dans un mode dégradé ou explique l'action à effectuer.
- Étant donné « retrouve le mail de Paul sur le devis de juin », Arty affiche une requête Gmail modifiable sans inventer l'adresse de Paul.
- Étant donné une ambiguïté que le parseur local ne peut résoudre, `/api/gmail-search/compile` renvoie seulement le schéma autorisé après auth, consentement et réservation ; le client applique encore le renderer et le post-filtre déterministes, et aucun jeton ou appel Gmail n'intervient.
- Étant donné qu'un modèle propose une adresse absente de la demande, le post-filtre la retire, affiche l'hypothèse et bloque la copie tant que la requête n'est pas valide. Le même filtre s'applique après édition.
- Étant donné un clic sur « Chercher dans Gmail », Arty informe que la requête est placée dans le presse-papiers, la copie avant l'ouverture de Gmail et la laisse récupérable si l'ouverture de Gmail échoue.
- Étant donné un refus ou un échec du presse-papiers, la requête reste visible et sélectionnable dans Arty et aucune navigation automatique ne se produit.
- Étant donné plusieurs comptes Gmail, Arty n'impose jamais `/u/0/` et laisse l'utilisateur choisir le compte qui doit effectuer la recherche.
- Étant donné que Gmail est absent ou déconnecté, la requête reste récupérable au retour dans Arty.
- Étant donné un basculement Arty → Gmail → Arty, la carte typée et la requête restent récupérables localement pendant au plus une heure, puis sont supprimées sans synchronisation serveur.
- Étant donné que Gmail affiche les résultats, aucun titre, extrait, identifiant ou nombre de résultats n'est renvoyé à Arty ; seul le message ensuite ouvert volontairement peut être analysé.
- Étant donné un compte Pro sans BYOK accessible, un wallet suffisant permet l'action ; sinon `pro_addon_credits_required` apparaît avant tout appel. `pro_byok_required` n'est jamais renvoyé dans l'Add-on.
- Étant donné une activation de trial depuis la carte, l'utilisateur passe par le parcours Web protégé et une réinstallation ou une seconde identité ne recrédite jamais le compte.

### 14.2 Conformité

- Aucun scope de la denylist n'est présent dans le manifest, le Web, Android ou Google Cloud public.
- Tous les scopes, outils, routes et parcours Drive sont absents du P0 public ; `drive.file` n'y est pas demandé.
- Les anciens jetons sont révoqués ou techniquement inutilisables en production.
- Le manifest et la capture de consentement du runtime retenu correspondent exactement à l'allowlist archivée par le gate.
- Aucune fonctionnalité publique ne prétend qu'Arty exécute une recherche dans la boîte ou voit ses résultats ; la promesse autorisée est la préparation d'une requête exécutée par Gmail.
- La politique de confidentialité nomme les fournisseurs, les données dérivées et les règles Limited Use ; `PLAY-STORE-SUBMISSION.md` ne classe plus `gmail.compose` hors CASA.
- L'utilisateur est informé avant le premier transfert à chaque fournisseur.
- Chaque fournisseur activé possède une entrée non expirée du registre serveur versionné concernant DPA, sous-traitants, région, no-training, rétention, accès humain et suppression, compatible avec la version de consentement. Une preuve absente/expirée ou un consentement incompatible bloque l'appel même si le feature flag est actif.
- Aucun message, prompt, résumé, réponse ou feedback Gmail n'alimente entraînement, évaluation générale ou programme de feedback d'un fournisseur.
- Une revue Marketplace publique est préparée avec compte de test, vidéo, captures, support et suppression.

### 14.3 Sécurité

- En HTTP, toute route métier exige `systemIdToken` et `userIdToken` valides ; dans le repli Apps Script, elle exige JWT utilisateur et HMAC/timestamp/nonce valides. Chaque preuve reste obligatoire indépendamment de l'autre.
- En HTTP, l'appel Gmail exige en plus le couple exact `userOAuthToken` bearer + `gmail.accessToken` dans `X-Goog-Gmail-Access-Token`; jeton manquant, permuté, altéré, expiré ou réutilisé hors requête est refusé sans débit ni appel fournisseur.
- Signature altérée, `alg:none`, mauvais `kid`, issuer voisin, audience Web/bêta, expiration, `iat` futur, `email_verified=false`, panne JWKS sans cache valide ou fallback `tokeninfo` sont refusés avant tout effet de bord.
- Une rotation JWKS, HMAC et audience a été simulée ; `next` n'est pas admise avant `validFrom`, `retired` est refusée après `validUntil`, le secret `previous` est refusé après sa fenêtre de grâce et aucun secret n'apparaît dans le bundle ou les logs.
- La matrice route/méthode/Origin/auth/audience est verte : par défaut, `Origin` absent n'est admis que pour l'appel Google possédant toutes les preuves ; tout `Origin` présent est refusé sans CORS. Toute route Add-on sans garde obligatoire fait échouer la CI.
- Le Worker de production ne possède aucun binding, secret ou audience bêta. Les tests croisés inter-utilisateurs et inter-domaines ne lisent ni ne modifient les données d'un autre contexte.
- Le trial résiste aux réinstallations, associations multiples et courses concurrentes ; D1 ou plafond indisponible entraîne un refus sans appel IA.
- Le lien d'association est aléatoire 256 bits, stocké sous forme de hash, lié à l'identité et au domaine de sécurité, expire en dix minutes, exige `state`, session authentifiée et réauthentification pour un compte existant, puis devient inutilisable atomiquement.
- Un changement d'e-mail ne fait perdre aucun droit ; une identité externe ne peut appartenir à deux comptes et chaque webhook de paiement crédite uniquement l'`account_id` attendu après la migration/backfill.
- Un appel fournisseur au résultat incertain reste `pending_uncertain` au plus quinze minutes, bloque tout doublon, puis devient terminal : règlement seulement si une réponse exploitable est prouvée livrée, sinon annulation du débit utilisateur et coût éventuel enregistré comme perte opérationnelle.
- Toute tentative de substituer un messageId différent du contexte courant est refusée.
- Aucun token ou contenu n'apparaît dans les logs applicatifs contrôlés par Arty pendant les tests.
- Le modèle Add-on n'a aucun outil ; sa sortie est structurée et toute action Gmail exige un nouveau clic utilisateur. Le corpus de prompt injection confirme cette isolation.
- HTML, MIME invalide, caractères de contrôle et message surdimensionné sont traités proprement.
- Deux clics rapides ne créent pas deux brouillons.
- Un timeout ne déclenche aucun retry caché.
- Une requête contenant guillemets, parenthèses, dièses, slashs, caractères Unicode ou tentative d'injection d'URL reste du texte correctement encodé et ne change jamais de domaine de destination.
- Le passage vers Gmail ne contient ni URL de retour, ni callback, ni WebView injectée, et ne permet pas à Arty de lire le DOM ou l'URL des résultats.
- Aucun endpoint, script, WebView ou callback Arty ne post-filtre la liste des résultats Gmail, même localement. Le seul post-filtre de recherche porte sur la requête avant copie.

### 14.4 Qualité

- Gmail web : résumé, extraction, réponse et brouillon validés avec le runtime retenu ; comparaison absente du P0.
- Gmail Android : résumé et brouillon validés sur appareil réel.
- Le volet capacité du gate respecte les critères du §11, y compris démarrage à froid, deux fois la concurrence de lancement, P95 à 25 secondes et marge de taille de 20 %.
- Web et Android : préparation, aperçu, copie, ouverture générique de Gmail et collage validés avec tous les liens directs de recherche désactivés.
- npm run verify passe.
- Un test CI échoue si un scope restreint réapparaît.
- Les métriques d'activation fonctionnent sans contenu ni PII en logs.
- Les états `user_scope_denied`, `admin_blocked`, `marketplace_install_disabled` et `quota_exceeded` sont distincts et ne déclenchent aucune boucle OAuth.
- Si Apps Script est retenu, une éviction CacheService ou un quota journalier atteint ne peut ni perdre un débit ni créer un double brouillon.

## 15. Plan de tests

### Automatisés

- Spike `GATE-HTTP-DRAFT-01` sur un déploiement HTTP Marketplace réel, avec archive des scopes, événements, réponses JSON, traces réseau et limites observées ; trente parcours séquentiels puis charge à deux fois la concurrence de lancement, démarrage à froid, rotation JWKS, taille maximale et fautes D1/fournisseur. Repli Apps Script testé si le gate échoue.
- Test exact de l'allowlist de scopes.
- Test séparé des scopes de l'app Web/Android et du manifest Add-on ; aucun mélange entre les deux.
- Tests du cycle d'audience par route : `next` avant/après `validFrom`, `current`, `retired` avant/après `validUntil`, audience Web/Add-on inversée, multi-audiences sans `azp` attendu et rejet de la bêta.
- Tests de permissions granulaires : refus partiel, carte d'autorisation puis reprise sans double débit.
- Matrice middleware : route et méthode Add-on/Web × Origin absent/présent/hostile × preuves valides/invalides ; pour les routes Add-on non-browser, tout `Origin` présent est refusé sans en-tête CORS et l'absence seule ne donne aucun droit. Aucune wildcard ou fallback d'auth.
- Test de parité CI : chaque route Add-on appelle authentification, scopes, schéma/taille, compte, consentement, entitlement et rate limit avant fournisseur.
- Test de rejet de tous les anciens types d'action Gmail.
- Tests JWT/JWKS : signature, `RS256`, `kid`, issuer, audience/`azp`, expiration, `iat`, `sub`, email et `email_verified`; rejet `alg:none`, audience Web/bêta et simple décodage.
- Tests HTTP Gmail : `gmail.messageId` vient seulement de l'événement ; couple `Authorization: Bearer <userOAuthToken>` + `X-Goog-Gmail-Access-Token: <gmail.accessToken>` exigé. Tester absence, permutation, altération, expiration, replay et destruction après requête, sans effet de bord.
- Rotation JWKS : nouveau `kid` après refresh ; panne avec cache valide acceptée, panne sans cache valide refusée sans effet de bord.
- Repli Apps Script : matrice HMAC `current/previous/unknown/expired`, altération méthode/chemin/corps/timestamp/nonce/audience et rotation sans interruption.
- Tests d'isolation D1 entre utilisateurs, domaines et environnements ; aucun binding ou secret bêta dans le Worker de production.
- Tests de migration `account_id` : dual-read/write, backfill, rollback avant contrainte, changement d'e-mail sans perte de droits, unicité d'identité externe, refus d'une association à deux comptes et routage exact des webhooks abonnement/licence/wallet.
- Tests du lien d'association : entropie/stockage hashé, TTL, consommation atomique, replay, mauvais `state`, changement de session/identité/domaine, absence de réauthentification et tentative d'open redirect.
- Tests MIME/base64url/HTML/signatures/citations.
- Tests du compilateur/post-filtre avant et après édition : `from:`, `to:`, `subject:`, guillemets, dates, pièces jointes, non-lus, labels, opérateur inconnu, longueur, CRLF, contrôles et bidi.
- Tests de `/api/gmail-search/compile` : auth Web/Android, consentement, schéma strict, timeout/repli local, reserve/settle/void, absence de jeton/appel Gmail et rejet d'opérateur, adresse ou URL hors allowlist.
- Tests de dates en langage naturel, hypothèses visibles, rejet de toute adresse absente de l'entrée et blocage de la copie en cas d'échec de validation.
- Tests d'intégration du payload `gmail_search` dans `MessageList`/`AssistantBubble` : aucun rendu HTML/tool call, retour d'application sans perte, TTL local d'une heure, suppression et absence de synchronisation/analytics du contenu.
- Test garantissant que le parcours copie la requête avant toute navigation et conserve un repli si l'ouverture de Gmail échoue.
- Tests Web/Android du presse-papiers : marquage sensible lorsque disponible, mode « Afficher seulement », refus, Gmail absent, utilisateur déconnecté, plusieurs comptes, retour sans perte et effacement seulement si la valeur Arty est encore présente.
- Test P0 complet avec le feature flag de lien direct désactivé.
- Tests de prompt injection.
- Tests trial : réinstallation, deux identités/un compte, une identité/deux comptes, audience migrée et 20 appels concurrents sur le dernier crédit ; aucune réinitialisation ou double dépense.
- Tests du ledger après crash : même clé idempotente, nouvelle clé bloquée, timeout fournisseur → `pending_uncertain`, réconciliation avec preuve de livraison, expiration à quinze minutes sans preuve → annulation utilisateur et perte opérationnelle.
- Tests Pro + wallet sur les quatre fournisseurs : réservation, règlement, annulation et `pro_addon_credits_required` sans retour `pro_byok_required`.
- Test statique P0 de comparaison : carte, route et branche activable absentes ; l'URL réservée retourne `404` avant lecture du corps. Les tests fonctionnels à deux modèles sont reportés au gate P1 et ne conditionnent pas la release P0.
- Tests d'idempotence des actions et brouillons.
- Test statique et réseau prouvant l'absence de messages.send, drafts.send, messages.list, threads.list, GmailApp.search, IMAP et équivalent.
- Tests de redaction des logs.
- Tests Limited Use E2E : aucun contenu ou dérivation dans logs, analytics, erreurs, D1 ou sauvegardes après TTL ; aucun appel avant consentement versionné. Flag actif avec preuve absente/expirée, région ou rétention incompatible, accès humain non approuvé ou `consentVersion` obsolète reste bloqué avant construction du payload.
- Test statique d'absence de Drive P0 : aucun scope `drive*`, route, outil, hook, promesse UI/i18n ou import client Drive dans le bundle public.
- Test de timeout à 25 secondes.
- Si Apps Script est retenu : éviction CacheService, quotas journaliers et simultanés, sans perte comptable ni retry en boucle.
- Conservation des tests d'injection MIME déjà présents.

### Manuels et terrain

- Installation depuis un compte gmail.com.
- Installation depuis un compte Google Workspace avec restrictions admin.
- Tests par OU Workspace : Marketplace autorisé, app installée par l'admin, installation interdite, app révoquée et permission « Specific Google data » refusée.
- Consentement initial et refus partiel.
- Gmail web, Gmail Android, compte avec conversation longue.
- Recherche assistée P0 sur Gmail web et Android : copie, ouverture générique, collage, compte Gmail non connecté et plusieurs comptes ouverts.
- Recherche assistée P1 sous feature flag : lien direct fonctionnel et lien direct non pris en charge, avec même repli manuel.
- Message HTML, texte brut, langue française et anglaise.
- Révocation dans le compte Google puis réinstallation.
- Trial, abonnement, wallet, Pro BYOK sans crédits.
- Android réel API 24–28 et API 29+ : avertissement/marquage presse-papiers, IME, retour dans Arty et effacement sûr. La release tranche explicitement entre relever `minSdk` à 29 ou conserver l'avertissement renforcé.
- Modèle indisponible, API lente, quota dépassé.
- Analyse réseau confirmant l'absence de messages.list, threads.list, GmailApp.search, recherche globale par Arty et messages.modify.

## 16. Indicateurs de succès

### Indicateurs précoces

- 60 % des installations effectuent une première analyse sous trois minutes.
- 70 % des utilisateurs qui analysent un message créent au moins un brouillon dans les sept jours.
- 95 % des actions simples terminent en moins de 25 secondes.
- Moins de 3 % d'erreurs techniques hors erreurs de quota.
- Zéro envoi automatique et zéro scope restreint détecté.
- Recherche assistée : requête visible en P95 sous 15 secondes ; copie et lancement de Gmail réussis dans 95 % des tentatives observables.
- Test d'utilisabilité : 80 % des participants atteignent les résultats Gmail en moins de 40 secondes, médiane cible 30 secondes.

Événements autorisés, sans contenu : `prepare_started`, `query_ready` avec tranche de latence, `edited` booléen, `copy_outcome` et `open_outcome`. Arty ne mesure pas le collage, la recherche exécutée par Gmail, le nombre de résultats, le bon message trouvé ou un taux de succès de recherche. Aucune corrélation Web/Android → message Gmail n'est présentée comme certaine.

### Indicateurs à 30–90 jours

- 25 % des utilisateurs activés reviennent chaque semaine.
- 10 % des utilisateurs du trial Gmail passent à un abonnement ou achètent des crédits.
- Aucun incident de confidentialité ou rejet Google lié à une promesse trompeuse.
- Aucun fournisseur activé sans dossier Limited Use complet et aucun dépassement du plafond global trial.

## 17. Phasage indicatif pour un développeur

| Phase | Contenu | Charge indicative |
|---|---|---:|
| 0A | Spike HTTP réel et dossier `GATE-HTTP-DRAFT-01` Web/Android | 2 jours maximum |
| 0B | Seulement si le gate échoue : prototype Apps Script minimal et manifest exact | 2–3 jours |
| 1 | Gateway, JWT/JWKS, attestation runtime, rotation, isolation et tests de parité | 5–8 jours |
| 2 | Cartes, assistant de requête, résumé, extraction et brouillon | 5–7 jours |
| 3 | Compte, consentement Limited Use, trial, wallet, cache et facturation atomique | 5–8 jours |
| 4 | Migration scopes, UI, outils, Contacts, Drive, i18n et anciens jetons | 5–8 jours |
| 5 | Tests terrain, quotas, documentation, assets et dossier Marketplace | 5–8 jours |

Total arithmétique révisé : **27 à 44 jours-développeur, soit environ 5,5 à 9 semaines de développement solo** selon le runtime retenu, hors comparaison multi-modèles, délai de revue Google et finalisation juridique/contractuelle. Si HTTP passe, la phase 0B conditionnelle disparaît ; les autres fourchettes ne sont pas supposées se chevaucher.

## 18. Questions à trancher

### Bloquantes

1. `GATE-HTTP-DRAFT-01` passe-t-il intégralement, ou faut-il figer le repli Apps Script ?
2. Quel est le manifest exact et l'écran de consentement du runtime retenu ?
3. Si Apps Script est retenu, CacheService et les quotas journaliers passent-ils les tests de charge sans devenir source de vérité métier ?
4. Le trial partagé, son plafond global de dépense et le parcours Web Turnstile sont-ils validés commercialement ?
5. Le compte Pro sans BYOK accessible utilise-t-il uniquement le wallet selon la règle `pro_addon_credits_required` ?
6. Mistral UE est-il le fournisseur P0 et son dossier Limited Use/no-training/rétention est-il complet ?
7. Les garanties contractuelles de chaque fournisseur activable sont-elles documentées ; les autres flags restent-ils désactivés ?
8. La bêta est-elle physiquement isolée de D1/KV/R2/secrets production et toutes les audiences sont-elles cartographiées par route ?
9. Android relève-t-il `minSdk` à 29 ou conserve-t-il le support 24–28 avec avertissement presse-papiers renforcé ?
10. L'éditeur Marketplace sera-t-il déclaré trader ou non-trader dans l'EEE, et le SIREN sera-t-il disponible avant publication ?

### Non bloquantes pour le prototype

1. Ajouter le fil complet en P1 avec vérification sensitive ?
2. Conserver gmail.send dans l'app principale en P1 ?
3. Permettre la sauvegarde volontaire d'une analyse dans une conversation Arty ?
4. Ajouter les pièces jointes après un audit de coût et de sécurité ?
5. Réactiver Contacts avec consentement incrémental dans une version ultérieure ?

## 19. Définition de fini

Le projet est prêt à publier lorsque :

- `GATE-HTTP-DRAFT-01` est annexé à l'ADR et un seul runtime, son manifest et son consentement sont figés ;
- Arty transforme une demande en requête Gmail visible, la copie, ouvre Gmail et ne reçoit aucun résultat de recherche ;
- le module traite un e-mail ouvert et crée un brouillon sur Gmail web et Android ;
- aucun scope restreint Gmail ou Drive n'est demandé ou accepté en production ;
- aucun scope, connecteur, outil, route ou parcours Drive n'est livré dans le P0 ;
- aucun ancien jeton ne permet de réactiver les fonctions supprimées ;
- l'audience et les données bêta sont absentes de tout Worker et binding de production ;
- les matrices JWT/JWKS, HMAC si applicable, Origin, audiences, isolation D1, trial concurrent et Pro-wallet sont vertes ;
- une rotation réelle des clés, secrets et audiences a été simulée et les anciens éléments sont effectivement refusés ;
- les données sont minimisées, éphémères et exclues des logs ;
- chaque fournisseur actif possède une entrée de registre non expirée, ses preuves contractuelles, son consentement versionné et son dossier Limited Use ; le flag seul ne permet aucun appel ;
- `PLAY-STORE-SUBMISSION.md`, les deux langues, les démos et les écrans ne promettent plus `gmail.compose`, la lecture globale, les non-lus ou le Drive complet ;
- Contacts est absent du P0 public et les règles de confirmation orphelines sont supprimées ;
- tous les tests automatisés et terrain sont verts ;
- le dossier Workspace Marketplace est complet ;
- la communication commerciale décrit exactement l'accès contextuel et non une lecture globale de la boîte.
