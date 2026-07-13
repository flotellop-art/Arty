# ADR-001 — Remplacer l'accès Gmail global par un add-on contextuel

**Statut :** accepté pour prototype, runtime conditionné par `GATE-HTTP-DRAFT-01`<br>
**Date :** 13 juillet 2026<br>
**Décideur :** Florent Pollet<br>
**Document lié :** CAHIER_DES_CHARGES_GMAIL_SANS_CASA.md

## Contexte

Arty demande actuellement `gmail.readonly`, `gmail.send` et `gmail.modify` pour lire, envoyer et gérer Gmail, ainsi que le scope Drive complet. `gmail.readonly`, `gmail.modify` et Drive complet sont restreints. Comme les données transitent par Cloudflare et des fournisseurs d'IA, le produit public actuel entre dans le périmètre de la vérification Restricted Scopes et de CASA.

La suppression totale de Gmail réduirait la différenciation d'Arty. Il faut conserver une expérience utile et visible, sans accès global à la boîte et sans sous-déclarer les permissions réellement présentées à l'utilisateur.

Le socle produit est accepté : Arty aide à formuler une recherche que Gmail exécute, puis traite uniquement le message que l'utilisateur choisit d'ouvrir. Le choix du runtime du module reste conditionné par un prototype.

## Corrections factuelles intégrées

| ID | Formulation antérieure | Correction retenue |
|---|---|---|
| ADR-COR-01 | L'état actuel citait seulement `gmail.readonly` et `gmail.modify`. | `gmail.send` est également demandé aujourd'hui. |
| ADR-COR-02 | La décision disait que le P0 utilisait « seulement deux scopes ». | Le P0 a deux scopes Gmail fonctionnels non sensibles, mais le manifest de repli Apps Script en prévoit cinq au total avec `script.external_request`, `userinfo.email` et `openid`. Le consentement réel doit toujours afficher la liste exacte du runtime retenu. |
| ADR-COR-03 | Apps Script était présenté comme nécessaire avant prototype. | Le runtime devient HTTP-first sous gate expérimental ; Apps Script est le repli documenté si la création de réponse HTTP échoue. |
| ADR-COR-04 | La correction de `PLAY-STORE-SUBMISSION.md` n'était pas traçable dans l'ADR. | La correction de `gmail.compose`, scope restreint incompatible avec la cible sans CASA, devient une action obligatoire. |

## Décision

### Frontière produit acceptée

Construire **Arty pour Gmail** avec les invariants suivants :

- traiter uniquement le message ouvert après une action explicite ;
- afficher le fournisseur IA avant le transfert ;
- produire un brouillon ou une réponse que l'utilisateur relit et envoie lui-même ;
- ne contenir aucun chemin `messages.send`, `drafts.send`, `GmailDraft.send` ou équivalent ;
- ne demander aucun scope Gmail ou Drive restreint dans les clients et projets publics ;
- ne conserver ni jeton Gmail temporaire ni contenu brut ; un résultat généré peut rester au plus cinq minutes dans un stockage lié à l'utilisateur ;
- maintenir séparés l'application publique, le module public et la bêta historique, y compris leurs clients OAuth et leurs données.

Les deux scopes Gmail fonctionnels du P0 sont :

    https://www.googleapis.com/auth/gmail.addons.current.message.action
    https://www.googleapis.com/auth/gmail.addons.current.action.compose

Le manifest de référence du **repli Apps Script** contient cinq scopes au total :

    https://www.googleapis.com/auth/gmail.addons.current.message.action
    https://www.googleapis.com/auth/gmail.addons.current.action.compose
    https://www.googleapis.com/auth/script.external_request
    https://www.googleapis.com/auth/userinfo.email
    openid

Le prototype HTTP doit établir son allowlist exacte et la capture de son écran de consentement. Il peut réduire les scopes techniques inutiles à ce runtime, mais ne peut ajouter aucun scope restreint.

Le consentement incrémental n'est promis que si le runtime réel permet de différer chaque scope fonctionnel et de reprendre l'action sans effet double. Sinon, l'installation présente d'emblée tous les scopes exacts du manifest retenu — cinq dans le repli Apps Script — et l'interface explique leur usage.

### Gate de runtime `GATE-HTTP-DRAFT-01`

La phase 0 commence par un déploiement Marketplace HTTP réel relié à des endpoints Cloudflare. HTTP devient le runtime de production seulement si un prototype reproductible démontre sur Gmail Web et Android :

1. la vérification distincte du `systemIdToken` Google et du `userIdToken` utilisateur ;
2. la gestion des permissions granulaires via `authorizedScopes` ;
3. la lecture du seul message courant avec le jeton contextuel et les scopes autorisés ;
4. la création d'une nouvelle réponse dans le bon fil, sans `draftId` préexistant fourni par Arty ;
5. l'absence de `gmail.compose`, `gmail.readonly`, `gmail.modify`, Drive complet ou autre scope restreint ;
6. l'absence de DOM injecté, endpoint Gmail reverse-engineeré ou API privée ;
7. un comportement stable sur un déploiement HTTP réel, documenté par traces réseau expurgées et captures du consentement ;
8. la capacité dans les limites Workspace et Cloudflare : délai et taille réels, démarrage à froid JWKS/D1, quotas Gmail, trente parcours séquentiels puis deux fois la concurrence de lancement prévue, sans `429` ni double effet, avec P95 complet inférieur ou égal à 25 secondes et 20 % de marge sur la plus petite limite de taille.

La table d'autorisation REST ordinaire de `users.drafts.create` n'accepte que des scopes Gmail restreints, qui sont interdits dans cette architecture. Le spike HTTP teste toutefois, sans présumer le résultat, si le couple de jetons contextuels remis par le runtime Workspace est accepté pour cette action précise. Le schéma HTTP `openCreatedDraftActionMarkup` ne suffit pas à lui seul : il attend déjà un `draftId`. Un refus REST, l'ajout nécessaire d'un scope restreint ou l'échec d'ouverture dans le bon fil ferme donc le gate en **FAIL** et déclenche le repli Apps Script.

Si un seul critère du gate échoue après un spike limité à deux jours, le runtime de production devient un **adaptateur Apps Script minimal** pour la lecture contextuelle, les cartes et `ComposeActionResponse`. Cloudflare conserve l'identité Arty, les quotas, la facturation et l'IA. Un seul runtime est ensuite maintenu en production.

Le résultat de `GATE-HTTP-DRAFT-01` doit être annexé à cet ADR avec la date, les appareils, le manifest exact, les scopes affichés, les réponses JSON et la raison du choix final.

### Authentification selon le runtime

- **HTTP retenu :** Cloudflare vérifie par JWKS, en échec fermé, le jeton système dont l'audience est l'URL exacte et l'email le compte de service du déploiement, puis le jeton utilisateur dont l'audience est le client OAuth du module. Pour appeler Gmail sur le message courant, il présente ensemble `authorizationEventObject.userOAuthToken` comme bearer et `gmail.accessToken` dans `X-Goog-Gmail-Access-Token`; `gmail.messageId` vient uniquement de l'événement Google authentifié. Ces jetons restent en mémoire le temps de la requête et ne sont jamais persistés ni journalisés.
- **Apps Script retenu :** le jeton Gmail reste dans Apps Script. Le spike enregistre l'audience réellement émise par `ScriptApp.getIdentityToken()` et Cloudflare exige ensuite cette valeur exacte, sans la confondre avec l'URL d'endpoint HTTP ou son client OAuth. L'appel exige aussi une signature HMAC de déploiement à secret rotatif ; seul le contenu minimisé est transmis.

Les helpers actuels fondés sur `tokeninfo` ou le client OAuth principal Arty ne doivent pas être réutilisés comme vérificateur du module.

### Recherche assistée

La recherche assistée vit dans Arty Web/Android, pas dans le panneau Workspace Add-on. Le bouton informe l'utilisateur, copie une requête et ouvre Gmail génériquement ; l'utilisateur choisit le compte si nécessaire, colle la requête et lance la recherche.

Ce parcours n'ajoute aucune permission Gmail. Arty n'utilise ni jeton, ni API Gmail, ni IMAP, ni callback et ne reçoit jamais les résultats. Un lien direct vers les résultats est désactivé par défaut et ne peut être expérimenté qu'en P1 sous feature flag, avec le copier-coller comme repli.

## Options étudiées

### A. Runtime HTTP + Cloudflare — retenu sous gate

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Forte |
| CASA | Non si le gate conserve uniquement les scopes non restreints |
| Complexité | Moyenne si le gate passe |
| Avantage | Une pile TypeScript, sécurité et quotas centralisés |
| Risque principal | Création d'une nouvelle réponse HTTP sans `draftId` non démontrée |

HTTP est préféré pour réduire la duplication et centraliser l'exécution. Cette préférence ne vaut pas preuve fonctionnelle.

### B. Adaptateur Apps Script + Cloudflare — repli accepté

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Forte |
| CASA | Non avec l'allowlist de cinq scopes ci-dessus |
| Complexité | Moyenne à forte |
| Avantage | Création contextuelle avec `ComposeActionResponse` documentée |
| Contraintes | Deux piles, HMAC rotatif, CacheService, limite et quotas Apps Script |

L'adaptateur reste mince et ne contient ni clés IA, ni tarification, ni historique métier.

### C. `gmail.send` seul dans Arty

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Moyenne |
| CASA | Non |
| Vérification | Sensitive |
| Limite principale | Aucun accès au message ou brouillon Gmail |

Cette option reste possible en P1, mais ne résout pas le contexte du message.

### D. Copier-coller, partage Android ou import `.eml`

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Faible à moyenne |
| CASA | Non |
| Vérification | Aucune permission Gmail |
| Limite principale | Friction et contexte incomplet |

Cette option reste un secours, pas l'expérience principale.

### E. Transfert vers une adresse Arty

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Moyenne |
| CASA | Non |
| Complexité | Élevée |
| Risques | Spam, spoofing, rétention et pièces jointes |

Le transfert automatique est exclu du P0.

### F. Conserver l'intégration globale et payer CASA

| Dimension | Évaluation |
|---|---|
| Valeur utilisateur | Très forte |
| CASA | Oui, récurrent |
| Complexité conformité | Élevée |
| Limite principale | Audit, maintenance annuelle et surface de risque |

Cette option pourra être réévaluée si les usages contextuels financent et justifient l'accès global.

## Analyse des compromis

L'architecture abandonne le briefing automatique, la recherche exécutée par Arty et les actions globales de gestion. Elle conserve un parcours proche : Arty formule la recherche, Gmail affiche les résultats, l'utilisateur ouvre le bon message, puis Arty le transforme en compréhension et en réponse.

HTTP est préféré pour réduire la duplication, mais Apps Script reste le repli parce que Google y documente explicitement la création d'une réponse contextuelle. Le gate tranche sur preuve sans jamais assouplir la frontière sans CASA.

La comparaison multi-modèles reste P1 à haut risque. Elle est désactivée dans l'add-on tant que les tests de latence, de consentement Limited Use et de facturation partielle ne sont pas validés.

## Conséquences

### Ce qui devient plus simple

- publication sans évaluation CASA tant qu'aucun scope restreint ne subsiste dans toute la production ;
- explication claire du consentement ;
- surface d'accès Gmail minimale ;
- recherche assistée sans scope Gmail supplémentaire ni visibilité sur les résultats ;
- réduction du risque d'action destructive ou d'envoi erroné.

### Ce qui devient plus difficile

- deux chemins doivent être prototypés avant d'en conserver un seul ;
- un vérificateur JWT/JWKS distinct et fail-closed doit être créé ;
- l'exception Origin doit être couplée par CI à l'authentification de chaque route Add-on ;
- le trial doit résister aux comptes Google jetables et respecter un plafond global de dépense ;
- les comptes Pro BYOK doivent passer par le wallet dans l'add-on ;
- la bêta historique doit être isolée des données de production ;
- la revue Limited Use du transfert IA multi-fournisseurs reste un chemin critique indépendant de CASA.

### Ce qui devra être réévalué

- ajout du fil complet avec le scope sensitive `current.message.readonly` ;
- ajout de `gmail.send` dans l'application principale ;
- traitement des pièces jointes ;
- comparaison multi-modèles dans le panneau Gmail ;
- retour éventuel des fonctions globales avec CASA.

## Actions

1. [x] Valider la frontière sans CASA et le parcours « Arty prépare, Gmail cherche, l'utilisateur ouvre ».
2. [ ] Exécuter le spike HTTP de deux jours et archiver `GATE-HTTP-DRAFT-01` sur Web et Android.
3. [ ] Clôturer formellement le gate, annexer les preuves, inscrire le runtime retenu et remplacer le statut de cet ADR par « accepté — HTTP » ou « accepté — Apps Script ».
4. [ ] Choisir HTTP-only si le gate passe, sinon activer le repli Apps Script minimal.
5. [ ] Enregistrer le manifest exact et la capture du consentement du runtime retenu.
6. [ ] Implémenter le vérificateur JWT/JWKS distinct, l'attestation de déploiement et leurs rotations.
7. [ ] Fermer l'abus trial et définir le plafond global de dépense avant tout appel IA public.
8. [ ] Isoler la bêta des clients OAuth, audiences, secrets et données de production.
9. [ ] Router les comptes Pro BYOK vers le wallet dans le module.
10. [ ] Implémenter résumé, réponse et brouillon avec Mistral UE ; garder la comparaison désactivée.
11. [ ] Retirer Gmail global, Drive et Contacts du P0 Web/Android, migrer les scopes puis révoquer les anciens grants.
12. [ ] Corriger `PLAY-STORE-SUBMISSION.md` : retirer `gmail.compose` du plan sans CASA.
13. [ ] Retirer les outils, confirmations et promesses Gmail globales du public, y compris les copies FR/EN.
14. [ ] Exécuter les tests de sécurité, de parité des routes et de non-régression.
15. [ ] Finaliser les preuves Limited Use et soumettre le module à la revue Workspace Marketplace.

Aucune publication publique ne peut précéder la clôture du gate et l'achèvement des actions 2 à 15. Le statut « accepté pour prototype » n'autorise donc ni déploiement de production ni soumission Marketplace.

## Sources officielles structurantes

- [Classification des scopes Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Runtime HTTP des Google Workspace Add-ons](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes)
- [Création de brouillons avec Apps Script](https://developers.google.com/workspace/add-ons/gmail/compose)
- [Actions Gmail des Workspace Add-ons](https://developers.google.com/workspace/add-ons/gmail/gmail-actions)
