# Résultat — GATE-HTTP-DRAFT-01

> Ne jamais coller de token, contenu d'e-mail, adresse personnelle, secret, corps HTTP brut ou `messageId` non haché dans ce dossier. Expurger aussi les captures et traces réseau.

## 1. Décision

| Champ | Valeur |
|---|---|
| Résultat global | `PENDING` / `PASS` / `FAIL` |
| Runtime retenu | `PENDING` / `HTTP` / `APPS_SCRIPT` |
| Date et heure Europe/Paris | `<YYYY-MM-DD HH:mm>` |
| Responsable du test | `<nom>` |
| Relecteur sécurité | `<nom>` |
| Motif synthétique | `<une phrase factuelle>` |

Règle de décision : HTTP est retenu seulement si tous les critères obligatoires passent sur Gmail Web **et** Android. Un seul échec après deux jours maximum impose `FAIL` et le repli Apps Script minimal. Aucun scope restreint ou mécanisme privé ne peut transformer un FAIL en PASS.

## 2. Versions et empreintes

| Élément | Valeur / preuve |
|---|---|
| Commit Git | `<sha>` |
| Google Cloud project ID | `<id non secret>` |
| Deployment ID | `<id>` |
| ETag ou version deployment | `<valeur>` |
| URL de base Phase 0 | `https://<hôte>/api/workspace-addon/phase0` |
| SHA-256 `deployment.phase0.json` | `<hash>` |
| SHA-256 `context-card.phase0.json` | `<hash>` |
| Version Worker Cloudflare | `<version id>` |
| Base D1 Phase 0 dédiée | `<database id non secret>` |
| Version Wrangler | `<4.x.y>` |
| Version gcloud | `<version>` |
| Version Gmail Web/navigateur | `<versions>` |
| Appareil et version Gmail Android | `<modèle, Android, Gmail>` |

## 3. Manifest et consentement

### Allowlist observée

- [ ] `https://www.googleapis.com/auth/gmail.addons.current.action.compose`
- [ ] `https://www.googleapis.com/auth/gmail.addons.current.message.action`
- [ ] `https://www.googleapis.com/auth/userinfo.email`
- [ ] `openid`
- [ ] Aucun scope supplémentaire dans le deployment, l'écran de consentement ou la configuration Google Cloud publique.
- [ ] `authorizationHeader` vaut `SYSTEM_ID_TOKEN`.
- [ ] `granularOauthPermissionSupport` vaut `OPT_IN`.
- [ ] `useLocaleFromApp`, `script.locale`, `script.external_request` et `gmail.addons.execute` sont absents.

| Preuve | Chemin ou référence expurgée |
|---|---|
| Manifest rendu | `<path>` |
| Description distante `gcloud` | `<path>` |
| Capture consentement initial | `<path>` |
| Capture refus partiel | `<path>` |
| Capture demande ciblée de scopes manquants | `<path>` |

Écart observé : `<aucun ou description>`

## 4. Endpoints et authentification

| Route | Méthode | `aud` système attendu | Scopes exigés | Web | Android |
|---|---|---|---|:---:|:---:|
| `/home` | POST | URL exacte `/home` | identité | ☐ | ☐ |
| `/context` | POST | URL exacte `/context` | identité | ☐ | ☐ |
| `/read` | POST | URL exacte `/read` | identité + message action | ☐ | ☐ |
| `/create-draft` | POST | URL exacte `/create-draft` | identité + message action + compose | ☐ | ☐ |

- [ ] Le bearer `systemIdToken` est vérifié par JWKS avec issuer, `RS256`, `kid`, signature, `exp`, `iat`, `sub`, `email_verified`, audience exacte de route et compte de service exact.
- [ ] `authorizationEventObject.userIdToken` est vérifié séparément avec le client OAuth exact du module.
- [ ] Une audience Web, Android, bêta, voisine ou d'une autre route est refusée avant tout effet de bord.
- [ ] Token manquant, expiré, altéré, `alg:none`, `kid` inconnu ou panne JWKS sans cache valide échoue fermé.
- [ ] Aucun fallback `tokeninfo`, simple décodage ou confiance dans l'absence d'`Origin`.
- [ ] Les quatre routes sont POST-only et toute route/méthode hors allowlist renvoie un refus.

Preuves expurgées : `<paths et observations>`

## 5. Permissions granulaires

| Scénario | Web | Android | Preuve |
|---|:---:|:---:|---|
| Autoriser uniquement l'identité, refuser les scopes Gmail | ☐ | ☐ | `<path>` |
| `/read` retourne seulement la demande du scope message manquant | ☐ | ☐ | `<path>` |
| `/create-draft` retourne seulement les scopes manquants | ☐ | ☐ | `<path>` |
| Après accord, Google reprend la dernière action | ☐ | ☐ | `<path>` |
| La reprise ne crée aucun double brouillon (débit/facturation : N/A dans le spike 0A sans IA) | ☐ | ☐ | `<path>` |
| Même nonce rejoué : un seul `drafts.create`, résultat réutilisé ou état `pending` | ☐ | ☐ | `<path>` |
| Un refus persistant reste utilisable en mode dégradé | ☐ | ☐ | `<path>` |

Scopes réellement présents dans `authorizedScopes` par étape :

```text
Installation : <liste>
Avant /read : <liste>
Après /read : <liste>
Avant /create-draft : <liste>
Après /create-draft : <liste>
```

## 6. Lecture contextuelle

- [ ] `/context` construit la carte sans lire le contenu du message.
- [ ] Le bouton « Lire ce message » appelle exactement `/api/workspace-addon/phase0/read`.
- [ ] `/read` prend l'identifiant uniquement depuis `gmail.messageId` de l'événement authentifié.
- [ ] L'appel Gmail exige ensemble `authorizationEventObject.userOAuthToken` comme bearer et `gmail.accessToken` dans `X-Goog-Gmail-Access-Token`.
- [ ] L'absence, l'inversion ou la réutilisation d'un des deux jetons est refusée.
- [ ] Une substitution de `messageId` est refusée.
- [ ] Aucun autre message ou fil complet ne peut être lu.
- [ ] Les jetons et le contenu ne sont ni persistés ni journalisés.

| Test négatif | Résultat attendu | Web | Android | Preuve |
|---|---|:---:|:---:|---|
| `messageId` d'un autre message | Refus avant Gmail/IA | ☐ | ☐ | `<path>` |
| `gmail.accessToken` absent | Refus | ☐ | ☐ | `<path>` |
| `userOAuthToken` absent | Refus | ☐ | ☐ | `<path>` |
| Jeton contextuel rejoué | Refus | ☐ | ☐ | `<path>` |

## 7. Création de la réponse en brouillon

Critère central : une action explicite doit ouvrir une **nouvelle réponse** modifiable dans le fil du message courant, sans envoi et sans `draftId` préexistant fourni par Arty.

- [ ] Le bouton « Créer un brouillon de réponse » appelle exactement `/api/workspace-addon/phase0/create-draft`.
- [ ] Le brouillon s'ouvre dans le bon fil sur Gmail Web.
- [ ] Le brouillon s'ouvre dans le bon fil sur Gmail Android.
- [ ] Le texte est modifiable avant envoi.
- [ ] Aucun `messages.send`, `drafts.send`, `GmailDraft.send` ou équivalent n'existe.
- [ ] L'unique tentative `users.drafts.create` utilise seulement les scopes contextuels du manifest, le bearer utilisateur et `X-Goog-Gmail-Access-Token` ; aucun scope restreint n'est ajouté et le statut Google est archivé.
- [ ] Aucun `draftId` n'est reçu d'Arty avant la création.
- [ ] Aucun DOM injecté, endpoint Gmail reverse-engineeré ou API privée.
- [ ] La réponse Google réellement utilisée et son statut documentaire sont archivés.
- [ ] En forme RPC, le `Draft.id` REST `r-*` devient bien l'identifiant hôte documenté `msg-a:r-*` ; en forme legacy, l'ID REST brut reste utilisé.
- [ ] Deux appels concurrents avec le même nonce n'effectuent qu'un seul `users.drafts.create`.
- [ ] Une panne D1 après création ne libère jamais la réservation `pending` et ne déclenche aucun retry d'écriture automatique.

### Parcours réellement démontré

```text
1. <événement initial>
2. <action utilisateur>
3. <appel/primitive Google documentée>
4. <réponse JSON expurgée>
5. <preuve du brouillon dans le bon fil>
```

Primitive Google utilisée : `<nom + URL officielle>`

Pourquoi ce parcours ne dépend pas d'un `draftId` préexistant : `<preuve>`

## 8. Absence de scope restreint et de mécanisme privé

- [ ] Aucun des scopes suivants dans manifest, consentement, clients ou projet public : `mail.google.com`, `gmail.readonly`, `gmail.modify`, `gmail.compose`, `gmail.metadata`, `gmail.insert`, Drive complet/read-only.
- [ ] Aucun appel n'est autorisé avec l'un de ces scopes. La tentative expérimentale sur l'endpoint public `users.drafts.create` reste limitée aux jetons contextuels et son éventuel refus ne déclenche aucune extension de permission.
- [ ] Aucun cookie/session Gmail capturé.
- [ ] Aucun scraping, DOM injecté, deep link non documenté ou endpoint privé.
- [ ] Aucun token ou contenu brut dans Cloudflare logs, analytics, erreurs, D1, KV, R2 ou captures.
- [ ] `WORKSPACE_ADDON_PHASE0_DB` est une base dédiée, distincte de prod/bêta ; les IDs complétés sont expurgés après 24 h, les tombes restent non réutilisables et les états incertains attendent une réconciliation explicite.

Commande/test statique utilisé : `<commande>`

Résultat : `<PASS/FAIL + preuve>`

## 9. Stabilité et capacité

### Limites observées

| Limite | Valeur observée | Charge maximale du test | Marge | PASS |
|---|---:|---:|---:|:---:|
| Taille événement Google | `<octets>` | `<octets>` | `<%>` | ☐ |
| Taille réponse/carte Google | `<octets>` | `<octets>` | `<%>` | ☐ |
| Limite corps Cloudflare | `<octets>` | `<octets>` | `<%>` | ☐ |
| CPU Worker | `<ms>` | `<ms>` | `<%>` | ☐ |
| Temps mural | `<ms>` | `<ms>` | `<%>` | ☐ |
| Sous-requêtes | `<n>` | `<n>` | `<%>` | ☐ |

La plus petite limite de taille conserve au moins 20 % de marge : `OUI / NON`.

### Mesures de latence

| Parcours | n | P50 | P95 | Max | 429 | Double effet | PASS |
|---|---:|---:|---:|---:|---:|---:|:---:|
| `/home` | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<n>` | ☐ |
| `/context` | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<n>` | ☐ |
| `/read` | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<n>` | ☐ |
| `/create-draft` | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<n>` | ☐ |
| Parcours complet | `<n>` | `<ms>` | `<ms>` | `<ms>` | `<n>` | `<n>` | ☐ |

- [ ] Trente parcours séquentiels terminés.
- [ ] Charge à deux fois la concurrence de lancement terminée.
- [ ] P95 complet inférieur ou égal à 25 secondes.
- [ ] Aucun `429` non géré.
- [ ] Aucun brouillon ou effet Gmail dupliqué (débit/facturation : N/A en 0A).
- [ ] Démarrage à froid JWKS/D1 inclus.
- [ ] Fautes D1 et Gmail testées en échec fermé (fournisseur IA : N/A en 0A).

## 10. Matrice finale des critères obligatoires

| # | Critère | Web | Android | Global | Preuve |
|---:|---|:---:|:---:|:---:|---|
| 1 | `systemIdToken` et `userIdToken` vérifiés séparément | ☐ | ☐ | ☐ | `<path>` |
| 2 | Permissions granulaires via `authorizedScopes` | ☐ | ☐ | ☐ | `<path>` |
| 3 | Lecture du seul message courant | ☐ | ☐ | ☐ | `<path>` |
| 4 | Nouvelle réponse dans le bon fil sans `draftId` préexistant | ☐ | ☐ | ☐ | `<path>` |
| 5 | Aucun scope restreint | ☐ | ☐ | ☐ | `<path>` |
| 6 | Aucun DOM, endpoint privé ou API reverse-engineerée | ☐ | ☐ | ☐ | `<path>` |
| 7 | Déploiement HTTP réel stable, consentement et traces archivés | ☐ | ☐ | ☐ | `<path>` |
| 8 | Capacité, P95, marge taille et absence de double effet | ☐ | ☐ | ☐ | `<path>` |

## 11. Anomalies

| ID | Gravité | Plateforme | Étapes | Attendu | Observé | Statut |
|---|---|---|---|---|---|---|
| `<id>` | `<bloquante/majeure/mineure>` | `<Web/Android/les deux>` | `<étapes>` | `<attendu>` | `<observé>` | `<ouvert/clos>` |

## 12. Conclusion à annexer à l'ADR

### Si PASS

```text
GATE-HTTP-DRAFT-01 PASS le <date>. HTTP est retenu comme unique runtime de production.
Manifest SHA-256 : <hash>. Scopes affichés : <liste exacte>. Tests Web/Android et
preuves : <référence>. Statut ADR à remplacer par « accepté — HTTP ».
```

### Si FAIL

```text
GATE-HTTP-DRAFT-01 FAIL le <date> sur le critère <n° et libellé>. Aucune extension de
scope ni API privée n'est autorisée. Le runtime de production devient l'adaptateur
Apps Script minimal. Statut ADR à remplacer par « accepté — Apps Script ».
```

Signatures de revue :

- Responsable du test : `<nom/date>`
- Relecteur sécurité : `<nom/date>`
- Décideur : `<nom/date>`
