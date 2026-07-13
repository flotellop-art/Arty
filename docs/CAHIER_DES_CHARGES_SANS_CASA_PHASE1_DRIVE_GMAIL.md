# Cahier des charges — Phase 1 sans CASA : Drive connecté (`drive.file` + Picker) et recherche Gmail améliorée

**Version :** 1.4 — troisième verdict du décideur intégré (13 juillet 2026)<br>
**Date :** 13 juillet 2026<br>
**Statut :** architecture sans CASA confirmée viable (`drive.file` non-sensible, Gmail = transfert d'interface sans API) ; **implémentation EN PAUSE** jusqu'au GO sur cette v1.4. Aucun code n'est écrit d'ici là.<br>
**Périmètre :** application publique Arty Web (PWA `tryarty.com`) + Android (Capacitor) ; AUCUN changement au Workspace Add-on ni au canal bêta<br>
**Décideur :** Florent Pollet<br>
**Documents liés :** `CAHIER_DES_CHARGES_GMAIL_SANS_CASA.md` (Phase 0, PR #336), `ADR_GMAIL_ADDON_SANS_CASA.md`, `GOOGLE_OAUTH_VERIFICATION.md`

---

## 0. Verdict du décideur (13 juillet 2026) et décisions actées

**GO sur l'idée, NO-GO sur l'implémentation v1.1.** La stratégie `drive.file` reste hors CASA (scope non-sensible) ; le volet Gmail reste hors CASA (aucun scope Gmail). Les corrections exigées sont intégrées dans cette v1.2 :

| # | Décision actée |
|---|---|
| D1 | **Autorisation Drive uniquement au clic « Connecter des fichiers »**, isolée de l'authentification principale (politique d'autorisation contextuelle de Google). Le login Arty n'accorde JAMAIS Drive. |
| D2 | **Android : parcours natif officiel** `AuthorizationClient` + `PICKER_OAUTH_TRIGGER` (jeton contenant uniquement `drive.file`). Plus de combinaison Drive+Calendar au sign-in, plus de test préalable du Picker JavaScript en WebView. |
| D3 | **Révocation/migration des anciens accès larges = prérequis P0**, avec contrôle serveur strict (`drive.file` obligatoire, rejet des scopes Gmail/Drive restreints, vérification du client public). |
| D4 | **Le registre doit réellement filtrer** `list`/`search`/`read` — sinon l'action s'appelle « Masquer localement ». Retenu : filtrage effectif. |
| D5 | **`resourceKey`** : conserver `id + resourceKey` et envoyer `X-Goog-Drive-Resource-Keys` sur les lectures/exports. |
| D6 | **Confirmation avant `create_drive_file`** (déplacement SAFE → CONFIRM). |
| D7 | **`drive.install` (« Ouvrir avec ») reporté** après stabilisation. |
| D8 | **Clé Picker web autorisée explicitement comme clé publique restreinte** — par amendement écrit de la RÈGLE 1, PAS par renommage cosmétique destiné à contourner le scanner. |
| D9 | Remplacer « pour toujours / définitivement » par « **tant que l'autorisation, le fichier et les règles administrateur restent valides** ». |
| D10 | **Prouver que `services/growth-orchestrator` (scopes Gmail restreints) utilise un projet OAuth entièrement séparé** du client public. Prérequis P0. |
| D11 | Volet Gmail : résultat discriminé `not_gmail \| ready \| needs_details`, correction de la double navigation `window.open(..., 'noopener')`, validateur email strict non-global pour `authuser`, repli honnête (non automatique), flag du lien direct indépendant du profil Phase 0. |

**Second verdict (v1.3) — « très nette amélioration », 3 blocages Drive restants + corrections Gmail ciblées :**

| # | Décision actée (v1.3) |
|---|---|
| D12 | **Isolation réelle du jeton web** : GIS agrège par défaut les permissions déjà accordées → imposer `include_granted_scopes: false` ET exiger côté serveur que le jeton contextuel contienne **exactement `drive.file`**, sans aucun scope supplémentaire. |
| D13 | **Deux justificatifs séparés au proxy** : identité/session Arty + jeton Drive contextuel. Le serveur vérifie les deux et confirme qu'ils appartiennent au **même compte Google** (`sub` identique) — sinon Arty connecté avec le compte A pourrait connecter le Drive du compte B. L'audience accepte les **clients web ET Android de production** (ensemble de client IDs), pas un unique « client public ». |
| D14 | **Cycle de vie Android complet** : `play-services-auth` 21.3.0 → **21.6.0** ; récupération d'un nouveau jeton après expiration/redémarrage **sans rouvrir le Picker** ; ne PAS attendre de `resourceKey` du résultat Android — Google ne garantit que `picked_file_ids` → appeler ensuite `files.get(fields=...resourceKey...)`. |
| D15 | **Navigation Gmail fiabilisée** : un lien `<a>` ne garantit pas que la copie asynchrone soit terminée avant l'ouverture → **réserver un onglet vide** (`window.open` synchrone dans le geste utilisateur) puis le **naviguer après la copie**. |
| D16 | **Affirmations du validateur corrigées** : `validateGmailSearchQuery` ne rejette pas tous les `#`, et la requête est **éditable par l'utilisateur** dans la carte — la sécurité vient de la **re-validation au clic puis `encodeURIComponent`** de la valeur finale, pas d'une propriété supposée du validateur amont. |
| D17 | **Faux positifs exclus** de la détection d'intention : colis, SMS, WhatsApp, « message d'accueil »… ; et retrait des noms Contacts fantômes `update_contact`/`delete_contact` de la blocklist. |
| D18 | **Contrôles sans-CASA réécrits sémantiquement** : les tests actuels matchent des sous-chaînes (`includes('/auth/drive')` rejetterait `drive.file` ; le test « racine Gmail nue » refuse l'URL de résultats légitime) → comparaison d'identifiants **exacts** (ensembles de scopes canoniques, URLs construites validées), jamais de sous-chaînes. |

**Troisième verdict (v1.4) — NO-GO v1.3, corrections ciblées ; le choix sans CASA n'est pas remis en cause :**

| # | Décision actée (v1.4) |
|---|---|
| D19 | **Cycle des jetons honnête** : PAS de promesse de renouvellement web silencieux — GIS exige un geste utilisateur après expiration → état UI + CTA **« Reconnecter mes fichiers »**. Android : le renouvellement conserve `setOptOutIncludingGrantedScopes(true)`, SANS Picker ni `Prompt.CONSENT` ; si Google répond « interaction requise » → même CTA. |
| D20 | **Double contrôle serveur précis** : `tokeninfo` d'un access token documente `user_id`, `audience`/`aud`, `issued_to`, `scope`, `expires_in` — PAS un `sub` garanti. Comparer l'**identité stable réellement documentée** entre jeton web et jeton Android, **échec fermé** si le champ manque. Ajouter **`x-drive-token` aux DEUX listes `Access-Control-Allow-Headers`** du middleware (`functions/api/_middleware.ts:92` préflight ET `:127` réponse — vérifié absent) sinon le web échoue au préflight avant d'atteindre le proxy. Jeton principal : **allowlist exacte des scopes publics** au lieu d'une denylist partielle. |
| D21 | **D18 appliqué aux VRAIS contrôles CI** : le scanner `scripts/check-public-google-access.mjs` + les trois inspections APK/AAB + `npm run no-casa:check` (qui échoue déjà sur l'URL Gmail légitime) — pas seulement les deux tests unitaires. Renommer les références `gmailNoCasaPhase0` vers `PUBLIC_GOOGLE_SCOPES`, `PUBLIC_GOOGLE_OAUTH_PROFILE`, `BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES`. |
| D22 | **Migration & stockage** : le login natif (`src/App.tsx:957`, `onNativeGoogleLogin`) stocke les jetons en `setJSON` brut sans `oauth_profile` → ils seraient rejetés ensuite ; passer par **`storeTokens`/`storeUser`**. Le registre Drive ne reste PAS en `setJSON` clair : **noms de fichiers et `resourceKey` chiffrés**, purgés au logout ET au changement de compte. **Borner réellement le proxy** : taille du corps, nom/contenu, MIME, IDs, `folderId`, `resourceKey`, pagination, délais. |
| D23 | **Origines OAuth sans wildcard** : les *Authorized JavaScript origins* Google n'acceptent pas les jokers → **alias preview fixe** ou **GIS désactivé sur les previews dynamiques**. |
| D24 | **Parcours Gmail complets** : D15 couvre TOUS les parcours web, y compris **flag OFF et mobile web**. Valider/construire l'URL AVANT de réserver l'onglet ; **fermer l'onglet vide si la copie échoue** ; tests popup bloquée, presse-papiers refusé, onglet fermé. Tests adverses appariés : « retrouve le **colis** que Paul m'a envoyé » = négatif, « retrouve le **mail** de suivi de livraison » = positif. |

> ⚠️ **Prérequis de synchronisation du dépôt** : plusieurs références du troisième verdict (`scripts/check-public-google-access.mjs`, `npm run no-casa:check`, `PUBLIC_GOOGLE_SCOPES`/`PUBLIC_GOOGLE_OAUTH_PROFILE`/`BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES`, `oauth_profile`, inspections APK/AAB) proviennent de la **migration locale du décideur (« Project Arty NoCasa Migration »), non poussée sur `origin` au 13 juillet**. Sur `origin/main`, les équivalents actuels restent `gmailNoCasaPhase0.ts`/`.test.ts` — et les points `_middleware.ts:92`/`App.tsx:957` sont, eux, **vérifiés présents sur `origin`**. Cette migration locale DOIT être poussée avant le démarrage des PRs de cette phase (PR-0 ci-dessous), sinon les références de ce CDC ne correspondent pas au code.

---

## 1. Décision exécutive

La Phase 0 (PR #336) a retiré tous les accès Gmail/Drive/Contacts du client public et remplacé la recherche Gmail par un copier-coller vers la racine de Gmail. Constat du décideur : l'expérience est trop dégradée. Cette Phase 1, toujours **strictement sans scope restreint** (donc sans CASA), comporte deux volets indépendants :

- **Volet A — Recherche Gmail améliorée** : ouvrir Gmail **directement sur les résultats** de la requête compilée (au lieu de la racine + collage manuel), comprendre les formulations indirectes, échouer explicitement (`needs_details`), et purger les contradictions internes (system prompt, brief vocal) qui promettent encore au LLM des outils qu'il n'a plus.
- **Volet B — Drive connecté** : réintroduire un parcours Drive fondé sur le scope **non-sensible** `drive.file`, accordé **contextuellement au clic « Connecter des fichiers »** (D1) : l'utilisateur cherche dans tout son Drive via l'UI Google (Picker), sélectionne les fichiers à connecter, et Arty peut ensuite les **chercher (plein texte), lire, exporter et résumer** — tant que l'autorisation, le fichier et les règles administrateur restent valides (D9). Arty peut aussi **créer** des fichiers (rapports), qui restent accessibles dans les mêmes conditions.

**Ce que la Phase 1 ne fait pas** : elle ne rend pas la recherche Gmail exécutée par Arty (impossible sans scope restreint — §2.1) ni la recherche sur les fichiers Drive **non connectés**.

Invariants non négociables :

- aucun scope restreint dans les clients publics (web, Android) ni dans aucun projet de production ;
- aucun scope Gmail dans le client public (les scopes contextuels vivent uniquement dans le manifest de l'Add-on) ;
- **le login principal n'accorde jamais Drive** ; l'autorisation `drive.file` est contextuelle (D1) ;
- **le serveur rejette tout jeton portant un scope restreint hérité** (D3) ;
- Arty ne reçoit jamais la liste des résultats d'une recherche Gmail ;
- consentement lisible : chaque autorisation est expliquée dans l'UI avant d'être demandée.

---

## 2. Base réglementaire et technique vérifiée (13 juillet 2026)

### 2.1 Classification des scopes Drive

Vérifiée sur [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) :

| Scope | Classe Google | Capacité | CASA |
|---|---|---|---|
| `drive.file` | **Non-sensible (recommandé)** | Fichiers créés par l'app OU ouverts/sélectionnés par l'utilisateur via le Picker | Non |
| `drive.install` | **Non-sensible** | Apparaître dans « Ouvrir avec » / « Nouveau » de l'UI Drive | Non |
| `drive.appdata` | Non-sensible | Dossier caché applicatif | Non |
| `drive.apps.readonly` | Sensible | Liste des apps Drive autorisées | Non |
| `drive.readonly`, `drive`, `drive.metadata`, **`drive.metadata.readonly`**, `drive.activity(.readonly)`, `drive.scripts` | **Restreint** | — | **Oui** |

⚠️ `drive.metadata.readonly` est **restreint** : il n'existe AUCUN raccourci « métadonnées seules sur tout le Drive » hors CASA. Toute proposition future fondée dessus est à rejeter d'office.

### 2.2 Faits vérifiés sur le couple `drive.file` + Picker

1. **Le Picker cherche dans tout le Drive** (recherche Google native, nom + contenu indexé) via `DocsView`/`setQuery()`, et chaque fichier sélectionné devient accessible à l'app — accès qui persiste **tant que l'autorisation, le fichier et les règles administrateur restent valides** (D9).
2. **`files.list` avec `q=fullText contains '...'` fonctionne sous `drive.file`** et Google filtre côté serveur sur le sous-ensemble accordé. Ce comportement est confirmé par recoupements communautaires mais PAS par un exemple officiel : il est re-vérifié par le spike `SPIKE-DRIVE-FULLTEXT-01` (§8.1) avant toute promesse UI.
3. **`drive.file` couvre toutes les ressources REST Drive** sur le périmètre accordé, y compris `files.export` (Docs/Sheets/Slides → texte/PDF, limite 10 Mo) et `files.get?alt=media` (binaires).
4. **Sélectionner un DOSSIER ne donne PAS accès à ses enfants** (ni actuels ni futurs) — seulement au dossier comme objet. Confirmé par un Developer Advocate Google et le ticket [issuetracker #330555392](https://issuetracker.google.com/issues/330555392). Conséquence : **pas de « dossier Arty » auto-synchronisé** ; le pattern honnête est la resélection explicite via Picker pré-navigué (`setParent(folderId)`).
5. **Android — parcours natif officiel (D2)** : Google documente désormais l'intégration du Picker dans les apps mobiles via l'API d'autorisation Google Identity Services : `AuthorizationRequest` portant le `ResourceParameter` **`PICKER_OAUTH_TRIGGER`**, scope **strictement `drive.file`**, `setOptOutIncludingGrantedScopes(true)` (le jeton retourné ne contient QUE `drive.file` — pas de cumul avec Calendar), `AuthorizationRequest.Prompt = CONSENT` (optionnellement `OR SELECT_ACCOUNT`), paramètres optionnels `PICKER_ALLOW_MULTIPLE`, `PICKER_MIMETYPES`, `PICKER_FILE_IDS`, `PICKER_ALLOW_FOLDER_SELECTION`. Le flux d'autorisation AFFICHE le Picker lui-même : la sélection de fichiers fait partie du parcours système, **aucun Picker JavaScript en WebView n'est requis ni testé** ([doc officielle](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)). Validation terrain sur APK réel : `GATE-PICKER-ANDROID-01` (§8.2).
6. **`resourceKey` (D5/D14)** : certains fichiers partagés par lien exigent la paire `id + resourceKey` ; les lectures/exports/téléchargements de ces fichiers doivent envoyer l'en-tête **`X-Goog-Drive-Resource-Keys: <id1>/<key1>,<id2>/<key2>`** ([doc officielle](https://developers.google.com/workspace/drive/api/guides/resource-keys)). Le Picker **web** retourne la `resourceKey` quand elle existe ; le résultat **Android** ne garantit que `picked_file_ids` → la `resourceKey` est récupérée par `files.get(fields=...resourceKey...)` (D14). Elle est stockée au registre avec l'id.

### 2.3 Faits vérifiés sur le lien direct Gmail

- `https://mail.google.com/mail/u/0/#search/<requête urlencodée>` ouvre Gmail Web **directement sur les résultats**. Format empiriquement fonctionnel mais **non contractuel** → enrichissement *best-effort* derrière un flag.
- **Le repli n'est PAS automatique** : si le deep link casse (refonte SPA, fragment ignoré), rien ne « retombe » tout seul — c'est la **requête déjà copiée** dans le presse-papiers qui permet le collage manuel. Les copies UI doivent le dire tel quel (D11).
- Aucun intent de recherche documenté vers l'app Gmail **Android** ; sur mobile, l'URL peut être interceptée par l'app Gmail et perdre le fragment. Le lien direct est donc **web desktop uniquement** en Phase 1 ; le natif conserve le parcours Phase 0 (copie + ouverture générique).
- Ce volet n'ajoute **aucun scope**, aucun appel API : Arty ne voit toujours jamais les résultats.

### 2.4 Sources officielles

- [Scopes Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker — web](https://developers.google.com/workspace/drive/picker/guides/overview) ; [référence `DocsView`](https://developers.google.com/workspace/drive/picker/reference/picker.docsview)
- [Picker dans les apps desktop/mobiles — `PICKER_OAUTH_TRIGGER`](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
- [Resource keys — `X-Goog-Drive-Resource-Keys`](https://developers.google.com/workspace/drive/api/guides/resource-keys)
- [`files.export`](https://developers.google.com/drive/v3/reference/files/export) ; [téléchargements](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive UI integration / « Ouvrir avec »](https://developers.google.com/workspace/drive/api/guides/enable-sdk) (reporté, D7)
- [GIS token model — `TokenClientConfig`, `include_granted_scopes`, expiration et geste utilisateur](https://developers.google.com/identity/oauth2/web/reference/js-reference) (D12/D19)
- [Validation d'access token — schéma `tokeninfo` (`aud`/`user_id`/`issued_to`/`scope`)](https://developers.google.com/identity/protocols/oauth2) (D20)
- [Règles OAuth — Authorized JavaScript origins sans wildcard](https://support.google.com/cloud/answer/15549257) (D23)
- [Autorisation Android — `AuthorizationClient`/`AuthorizationRequest`](https://developers.google.com/identity/authorization/android) (D14)
- [OAuth en WebView interdit](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)
- [Opérateurs de recherche Gmail](https://support.google.com/mail/answer/7190)

Les classifications doivent être re-vérifiées dans Google Cloud Console juste avant toute soumission de vérification.

---

## 3. Volet A — Recherche Gmail améliorée

### 3.1 A1 — Lien direct vers les résultats

**Comportement cible (web desktop, flag ON)** : le bouton « Chercher dans Gmail » de la `GmailSearchCard` copie la requête (inchangé) puis ouvre `https://mail.google.com/mail/u/0/#search/<encodeURIComponent(query)>` au lieu de `GMAIL_HOME_URL`.

Spécifications :

- **Flag** : `VITE_GMAIL_SEARCH_DIRECT_LINK` (pattern de `gmailNoCasaPhase0.ts` : `TRUE_VALUES`, défaut OFF, paramètre par défaut testable). **Indépendant du profil Phase 0** (D11) : le profil sans CASA a vocation à devenir l'état permanent du client public, le lien direct est un réglage d'expérience autonome — aucune dépendance de flag à flag.
- **Plateformes** : web desktop uniquement. Sur `Capacitor.isNativePlatform()` et sur mobile web, conserver `openGmailHome()` actuel.
- **Compte** : segment `/u/0/` par défaut. Si l'email Google de l'utilisateur est connu (`google-user`), variante `https://mail.google.com/mail/u/?authuser=<email>#search/<q>`. **Validateur email dédié** (D11) : regex **ancrée `^...$`, NON globale** (l'`EMAIL_RE` existante est en `/gi` — un `.test()` sur une regex globale est stateful via `lastIndex` et une regex non ancrée matche une sous-chaîne : les deux défauts sont disqualifiants pour une valeur injectée dans une URL), longueur bornée ; échec → repli `/u/0/`.
- **Navigation « onglet réservé »** (D15, complété par D24) : le code actuel `window.open(url, '_blank', 'noopener,noreferrer')` retourne `null` MÊME en cas de succès → double navigation possible avec le repli `location.assign()`. Un simple lien `<a>` corrigerait la double navigation mais ne garantit PAS que la **copie presse-papiers asynchrone** soit terminée avant l'ouverture. Correctif retenu : (1) **valider et construire l'URL AVANT toute réservation d'onglet** — si la re-validation échoue, aucun onglet n'est ouvert (message `needs_details`) ; (2) au clic (synchrone, dans le geste utilisateur), **réserver un onglet vide** `const tab = window.open('', '_blank')` (sans `noopener` dans les features pour obtenir la référence, puis `tab.opener = null`) ; (3) `await` la copie ; (4) **naviguer l'onglet réservé** (`tab.location.href = url`). Cas d'échec (D24) : popup bloqué (`tab === null`) → copie quand même tentée + indication de collage manuel ; **copie refusée/échouée → fermer l'onglet vide réservé** (`tab.close()`) + message explicite ; onglet fermé par l'utilisateur avant navigation → no-op silencieux. JAMAIS de `location.assign()` automatique sur l'onglet courant. **Ce durcissement s'applique à TOUS les parcours web (D24)** : flag ON (deep link), flag OFF et mobile web (ouverture de la racine `GMAIL_HOME_URL` via le même mécanisme onglet-réservé — l'implémentation actuelle de `openGmailHome()` a le même bug `noopener`/double navigation).
- **Repli honnête** (D11) : en cas d'échec du deep link, il n'y a **pas de repli automatique** — la carte l'explique : « La requête est copiée : si Gmail ne s'ouvre pas sur les résultats, colle-la dans la barre de recherche Gmail. »
- **Construction de l'URL** (D16) : la requête affichée dans la carte est **éditable par l'utilisateur** — la valeur naviguée n'est donc PAS garantie par la compilation amont. Garantie réelle, dans l'ordre, au moment du clic : (1) **re-validation** de la valeur finale par `validateGmailSearchQuery` (opérateurs allowlistés, bidi/contrôles strippés, longueur ≤ 500 — sans lui prêter des propriétés qu'il n'a pas : il ne rejette pas tout `#`) ; (2) **`encodeURIComponent`** de la requête validée, qui neutralise tout caractère de structure d'URL (`#`, `/`, `?`) dans le fragment. Échec de re-validation → pas de navigation, message `needs_details`. Aucune donnée autre que la requête dans l'URL.
- **Fichiers** : `src/services/gmailSearchHandoff.ts` (nouvelle `buildGmailSearchUrl(query, email?)`), `src/components/gmail/GmailSearchCard.tsx` (lien + sous-texte), `src/vite-env.d.ts`, copies FR/EN.

### 3.2 A2 + A3 — Compilation à résultat discriminé `not_gmail | ready | needs_details` (D11)

Le couple v1.1 « déclencheur indirect actif seulement si la compilation produit un opérateur » (A2) + « message d'échec quand l'intention est détectée mais que la compilation échoue » (A3) était **circulaire** (la détection dépendait de la compilation qui dépendait de la détection). Remplacé par un pipeline à résultat discriminé :

```
compileGmailSearch(text) : { status: 'not_gmail' }
                         | { status: 'ready', payload: GmailSearchPayload }
                         | { status: 'needs_details', reason: 'no_operator' | 'invalid_value' | ... }
```

- **Étape 1 — détection d'intention** (indépendante de la compilation) : déclencheurs directs actuels (`gmail|mails?|e-?mails?|courriels?|messages?` + verbe de recherche) **élargis** aux formulations indirectes (discipline BUG 56) : `(que|qu')\s+\w+\s+m'a envoyé`, `envoyé (par|de)`, `reçu (de|en|le)`, `dans ma boîte`, `in my inbox`, `(sent|received) (me|from)`, etc. **Anti-collision volet B** : un phrasing indirect contenant un substantif fichier/Drive (`fichier|document|doc|pdf|feuille|classeur|présentation|drive|dossier`) SANS substantif mail est classé `not_gmail`. **Exclusions de faux positifs (D17, précisées par D24)** : les canaux et objets non-Gmail neutralisent la détection en présence du seul mot « message » — `colis|livraison|suivi`, `SMS|texto`, `WhatsApp|Telegram|Signal|Messenger|Slack|Discord`, `message vocal|répondeur`, et les usages génériques type « message d'accueil », « message d'erreur », « message de bienvenue ». **Règle de précédence (D24)** : un substantif mail EXPLICITE (`mail|gmail|e-mail|courriel`) l'emporte sur l'exclusion — paire de tests adverses canonique : « retrouve le **colis** que Paul m'a envoyé » = `not_gmail` ; « retrouve le **mail** de suivi de livraison » = positif. Panel de tests négatifs couvrant formulations Drive ET ces faux positifs, obligatoire.
- **Étape 2 — compilation** : si l'intention est détectée, le compilateur retourne `ready` (payload validé → carte de recherche) ou `needs_details` (raison précise). `not_gmail` → flux LLM normal, aucun message.
- **Rendu `needs_details`** : message assistant local (sans appel LLM ni quota) : « Je n'ai pas réussi à construire une recherche Gmail fiable à partir de ta demande. Reformule avec un expéditeur, un sujet ou une période — ou ouvre Gmail et colle des mots-clés. » + bouton d'ouverture Gmail générique. Jamais de fallthrough silencieux vers un LLM sans outils.
- **Tests** : panel FR/EN d'au moins 20 phrasings positifs (directs + indirects), 10 négatifs généraux (dont colis/SMS/WhatsApp/« message d'accueil », D17) et 5 négatifs Drive ; chaque cas raté remonté en usage = un pattern ajouté + un test de non-régression (règle BUG 56).

### 3.3 A4 — Purge des contradictions internes (item CDC Phase 0 §13.2 non traité)

1. **`src/constants/systemPrompt.ts`** : rendre le prompt système **profil-aware** (`buildSystemPrompt(profile)`). En mode `noCasa`, les sections « TES OUTILS » ne doivent plus lister `read_emails`, `send_email`, `reply_email`, `list_drive`, `search_drive`, `read_drive_file`, `create_drive_file`, ni la « PROCÉDURE OBLIGATOIRE » en 7 étapes Gmail+Drive, ni le bouton `data-action="save_drive"`. La stratégie actuelle (préfixe « PRIORITÉ ABSOLUE » prépendu par `useAppSetup.ts:35` à ~200 lignes contradictoires) repose sur l'ordre d'emphase → risque d'hallucination « j'ai lu tes mails ». Le volet B réintroduit ensuite les blocs Drive adaptés (« fichiers connectés », pas « ton Drive »).
2. **`src/services/morningBriefService.ts:166-192`** : supprimer l'appel `listUnreadEmails()` (mort — le token n'a plus le scope) quand le profil noCasa est actif — aligner sur `useProactiveBrief.ts:88,120,126`.
3. **`src/services/previewDemo.ts:52-74`** : gater ou réécrire les 2 conversations de démo qui promettent « synthèse des mails » / « retrouvé dans ton Drive ». Portée limitée (previews Cloudflare, gate `isDemoAllowed`) — cosmétique, priorité basse.
4. **Hygiène** : corriger `NO_CASA_BLOCKED_TOOL_NAMES` (`gmailNoCasaPhase0.ts:13-32`) — noms inexistants (`modify_email`, `create_draft`, et côté Contacts les fantômes **`update_contact`/`delete_contact`**, D17) et omissions (`archive_email`, `delete_email`, `star_email`, `create_draft_email`, `label_email` côté Gmail ; `rename_drive_file`, `move_drive_file`, `create_drive_folder`, `copy_drive_file` côté Drive). Test de parité : chaque nom de la liste DOIT exister dans les définitions d'outils, chaque outil Gmail/Drive/Contacts défini DOIT être couvert (pattern F-1). La liste évolue avec le volet B (les outils réintroduits en sortent) — le test suit chaque PR.

### 3.4 A5 — Réécriture sémantique des contrôles automatiques sans CASA (D18)

Les contrôles actuels matchent des **sous-chaînes** et produiraient des faux positifs bloquants pour cette phase :

- `src/__tests__/services/gmailNoCasaPhase0.test.ts:13-33` : `scopes.some(s => s.includes('/auth/drive'))` — rejetterait `https://www.googleapis.com/auth/drive.file` (qui contient `/auth/drive`). Réécriture : comparaison d'**ensembles de scopes canoniques exacts** — `expect(new Set(scopes)).toEqual(new Set(LOGIN_ALLOWLIST))` pour l'allowlist, et denylist exprimée en **chaînes complètes** (`https://www.googleapis.com/auth/drive`, `.../auth/drive.readonly`, …) comparées par égalité stricte, jamais par inclusion.
- `src/__tests__/services/gmailSearchHandoff.test.ts:90-95` : impose `pathname === '/'`, `search === ''`, `hash === ''` — refuse l'URL de résultats légitime du volet A. Réécriture : le test devient conditionnel au flag — flag OFF : racine nue (inchangé) ; flag ON : l'URL construite DOIT être `origin === 'https://mail.google.com'`, path conforme (`/mail/u/0/` ou `/mail/u/`), fragment strictement de la forme `#search/<encodeURIComponent(requête validée)>`, `authuser` seul paramètre autorisé — une **allowlist sémantique de l'URL construite**, pas une interdiction de tout hash.
- **Périmètre réel des contrôles (D21)** : la réécriture sémantique ne se limite PAS aux deux tests unitaires ci-dessus. Elle couvre les **contrôles CI effectifs de la migration locale du décideur** : le scanner `scripts/check-public-google-access.mjs` (qui refuse encore `drive.file`, l'URL Gmail légitime, et exige que Drive reste désactivé), les **trois inspections APK/AAB** (même défaut de matching par sous-chaînes), et `npm run no-casa:check` — dont l'échec actuel sur l'URL Gmail légitime est la preuve du problème. Même principe partout : identifiants exacts, jamais d'`includes()`.
- **Renommages (D21)** : les références `gmailNoCasaPhase0` migrent vers les noms cibles `PUBLIC_GOOGLE_SCOPES`, `PUBLIC_GOOGLE_OAUTH_PROFILE` et `BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES` (migration locale à pousser — voir l'encadré de synchronisation, §0).
- **Principe général (à inscrire dans chaque contrôle)** : tout contrôle « sans CASA » compare des identifiants exacts (scopes canoniques, URLs décomposées via `new URL()`), JAMAIS des sous-chaînes — un contrôle qui refuse une valeur légitime sera contourné ou supprimé sous pression de livraison, ce qui est pire que pas de contrôle.

---

## 4. Volet B — Drive connecté (`drive.file` + Picker)

### 4.0 Prérequis P0 — à terminer AVANT toute réintroduction d'outil Drive

**P0-a — Révocation/migration des anciens accès larges + contrôle serveur strict (D3).** Les refresh tokens `gmail.readonly`/`gmail.modify`/`drive` accordés avant la Phase 0 restent pleinement fonctionnels : le proxy actuel les accepterait tels quels, ce qui rendrait « sans CASA » déclaratif et non effectif. Obligatoire avant le volet B :

1. **Contrôle serveur à DEUX justificatifs (D13, précisé par D20)** : le proxy Drive ne reçoit pas seulement le jeton Drive — chaque requête porte : (a) l'**identité/session Arty** (jeton Google du login principal, header existant) et (b) le **jeton Drive contextuel** (header dédié `x-drive-token` — à ajouter aux DEUX listes `Access-Control-Allow-Headers` du middleware, `_middleware.ts:92` préflight ET `:127` réponse, vérifié absent aujourd'hui : sans ça le web échoue au préflight). Le serveur valide les deux via `tokeninfo` (cache court) et exige : (i) jeton Drive : `scope` == **exactement `drive.file`**, sans aucun scope supplémentaire (D12) ; (ii) jeton d'identité : **allowlist exacte des scopes publics** (l'ensemble du login §5.1, comparaison stricte — PAS une denylist partielle, D20) ; (iii) `aud`/`audience` de chaque jeton ∈ **ensemble des clients de production** (client ID web ET client ID Android) ; (iv) **identité stable identique entre les deux jetons** — sur les champs que `tokeninfo` documente réellement pour un access token (`user_id`, `audience`, `issued_to` ; PAS un `sub` garanti, D20) : comparer `user_id` quand présent, **échec fermé (403)** si le champ d'identité manque sur l'un des deux jetons — sinon un utilisateur connecté à Arty avec le compte A pourrait connecter le Drive du compte B. Tout jeton non conforme → 403 avec message de reconnexion actionnable. Ce contrôle force mécaniquement la migration des anciens jetons.
2. **Révocation/migration** : exécuter le chantier CDC Phase 0 §13.3 (révocation des anciens grants larges côté Google + parcours de reconnexion) — il passe de « différé » à **prérequis P0 de cette phase**.

**P0-a-bis — Stockage des jetons natifs conforme (D22).** `src/App.tsx:957` (`onNativeGoogleLogin`) écrit encore les jetons Google en `setJSON('google-tokens', ...)` brut — sans passer par `storeTokens`/`storeUser`, donc sans le champ `oauth_profile` de la migration : ces jetons seraient **rejetés** par les contrôles ci-dessus dès leur activation. Correction obligatoire avant PR-B1 : remplacer les deux `setJSON` par `storeTokens`/`storeUser` (qui gèrent aussi le chiffrement au repos et la préservation du `refresh_token`, BUG 51).

**P0-b — Preuve de séparation du `growth-orchestrator` (D10).** `services/growth-orchestrator/src/index.ts:2125-2127` demande `gmail.readonly` + `gmail.compose` (**deux scopes restreints**). Livrable : document (annexé à ce CDC) prouvant que son client OAuth vit dans un **projet GCP entièrement séparé** du projet du client public Arty — n° de projet, client ID, capture de l'écran de consentement du projet public sans aucun scope restreint. Si les deux partagent un projet : blocage — la présence de scopes restreints sur le projet partagé entraînerait tout le projet dans la vérification restricted, et la migration devient le préalable absolu.

### 4.1 Vue d'ensemble du parcours

1. L'utilisateur clique « Connecter des fichiers Drive » (Réglages, et carte contextuelle quand une demande Drive est détectée).
2. **Autorisation contextuelle `drive.file`** (D1) — déclenchée par CE clic, jamais au login : web via GIS (§4.2), Android via `AuthorizationClient` + `PICKER_OAUTH_TRIGGER` (§4.6).
3. Le **Picker** s'affiche : l'utilisateur cherche dans **tout** son Drive (UI Google, multi-sélection) et valide.
4. Les fichiers sélectionnés deviennent accessibles à Arty **tant que l'autorisation, le fichier et les règles administrateur restent valides** (D9). Arty maintient un registre « Mes fichiers connectés » qui **filtre réellement** les outils (D4).
5. Le LLM retrouve des outils Drive **re-scopés au périmètre du registre** : recherche plein texte, lecture/export, création (avec confirmation, D6).
6. Si une recherche ne trouve rien : la réponse explique le modèle (« je ne vois que les fichiers que tu m'as connectés ») et propose d'ouvrir le Picker.

### 4.2 B1 — Autorisation contextuelle (web)

- **Le login n'accorde jamais Drive** : `GMAIL_NO_CASA_PHASE0_GOOGLE_SCOPES` (`googleAuth.ts:31-36`) reste SANS `drive.file`. Idem côté Android : `requestScopes()` du sign-in principal (`GoogleSignInPlugin.java:54-60`) reste Calendar-only (D2).
- **Web** : au clic « Connecter des fichiers », autorisation incrémentale via **GIS `google.accounts.oauth2.initTokenClient`** demandant uniquement `drive.file` (popup Google, conforme à la politique d'autorisation contextuelle), avec **`include_granted_scopes: false` OBLIGATOIRE (D12)** — sans quoi GIS agrège par défaut les permissions précédemment accordées et le jeton « contextuel » cumulerait Calendar (voire d'anciens scopes larges) avec `drive.file`. Le serveur vérifie de son côté que le jeton contient exactement `drive.file` (§4.0 P0-a) — la config cliente n'est jamais la seule garantie. `login_hint` = email du compte de session Arty (limite les sélections de mauvais compte en amont du contrôle `sub` serveur). Conséquences assumées (revirement vs v1.1, imposé par D1) : enregistrement des *Authorized JavaScript origins* et ajout CSP `accounts.google.com` — budgétés en PR-B1. **Les origins Google n'acceptent PAS de wildcard (D23)** : `tryarty.com` + `https://localhost` + un **alias preview FIXE** (ex. `preview.tryarty.com` pointé sur le dernier preview) — ou GIS **désactivé sur les previews dynamiques** `*.appfacade.pages.dev` (bouton « Connecter » masqué avec explication). Le token contextuel (courte durée) sert au Picker (`setOAuthToken`) et aux appels Drive via `x-drive-token` (D13) ; il vit en mémoire, jamais persisté en clair. **Cycle de vie honnête (D19)** : GIS exige un geste utilisateur pour ré-émettre un jeton après expiration — AUCUNE promesse de renouvellement silencieux web ; à expiration, l'UI passe en état « fichiers déconnectés » avec CTA **« Reconnecter mes fichiers »** (un clic → `requestAccessToken()` → retour à l'état connecté ; le registre, lui, persiste).
- **Utilisateurs Phase 0 existants** : aucun mécanisme de « re-consentement au login » n'est nécessaire — l'autorisation contextuelle EST le mécanisme : premier clic → consentement. Tout 403 Drive côté proxy remonte un message actionnable (« Reconnecte tes fichiers Drive ») — jamais d'échec silencieux.
- **Tests de verrouillage** : le test TS existant (`gmailNoCasaPhase0.test.ts`) vérifie que `drive.file` n'apparaît PAS dans les scopes de login ; un test **à créer** lit `GoogleSignInPlugin.java` par chaîne (précédent : `workspaceAddonPhase0Runtime.test.ts` via `readFileSync`) et échoue si un scope Drive/Gmail y apparaît.

### 4.3 B2 — Google Picker (web)

- Chargement de `https://apis.google.com/js/api.js` + `google.picker` **à la demande** (pas au boot).
- Construction : `PickerBuilder` + `DocsView` (`setIncludeFolders(true)`, `setSelectFolderEnabled(false)` en P0 — §2.2.4), `enableFeature(MULTISELECT_ENABLED)`, `setOAuthToken(<token contextuel GIS>)`, `setDeveloperKey(<clé Picker>)`, `setAppId(794968525529)` (même projet GCP que le client OAuth public), locale FR/EN.
- **Clé navigateur Picker — exception RÈGLE 1 actée (D8)** : le décideur autorise explicitement une **clé publique restreinte** (restrictions console : referrer `tryarty.com` + `*.appfacade.pages.dev` + `capacitor://localhost` + `https://localhost` ; API « Google Picker API » uniquement ; clé **distincte** de la clé Maps de `geo/reverse`). Modalités : (i) l'amendement est inscrit dans `CLAUDE.md` RÈGLE 1 au moment de l'implémentation (« exception explicite : clés Google navigateur non-secrètes, referrer- et API-restreintes, listées nominativement ») ; (ii) le nom reste **honnête** (`VITE_GOOGLE_PICKER_API_KEY`) — PAS de renommage destiné à contourner le scanner (D8) : c'est l'exception documentée qui couvre le grep d'audit, pas un nom qui l'esquive.
- À la validation du Picker : callback par document `{id, name, mimeType, resourceKey?}` → registre + toast (« 3 fichiers connectés à Arty »). **La `resourceKey` est stockée avec l'id quand elle est présente** (D5).
- **CSP** (`public/_headers`) — set de départ : `script-src` + `https://apis.google.com` (loader `gapi`) et `https://accounts.google.com` (GIS) ; `frame-src` + `https://docs.google.com` et `https://accounts.google.com` (en plus du `challenges.cloudflare.com` existant) ; `connect-src` + `https://content.googleapis.com` si les XHR du widget l'exigent. `frame-ancestors`/`X-Frame-Options` gouvernent qui embarque Arty, pas Arty embarquant le Picker — aucun changement de ce côté. ⚠️ Leçon BUG 40/F-2 : `public/_headers` est traître — tester feature par feature en prod-like (Picker ET géoloc/caméra/micro) ; le loader `gapi` sous `script-src` strict est un time-sink connu, budgété dans PR-B2.

### 4.4 B3 — Registre « Mes fichiers connectés » : filtre RÉEL (D4)

- **Stockage CHIFFRÉ (D22)** : le registre ne reste PAS en `setJSON` clair — les noms de fichiers sont des données personnelles et la `resourceKey` est un secret d'accès. Stockage sous `drive-connected-files-enc` (AES-256 au repos) avec **cache mémoire déchiffré** pour les lectures synchrones (pattern conversations/BUG 16 — PAS `secureSetJSON` sur une clé lue en synchrone, BUG 1) ; bootstrap async + event `*-storage-ready` (pattern BUG 43). Contenu : `id`, `name`, `mimeType`, `resourceKey?`, `grantedAt` — PAS de base64, PAS de contenu de fichier (BUG 11). **Purgé au `logout()` ET au changement de compte** (ordre `clearActiveKeys()` avant `setActiveSession()`, BUG 6 ; même passe que BUG 41). Toute écriture dispatch un `CustomEvent` **`drive-connected-files-updated`** (pattern BUG 54), écouté par l'écran Réglages et la carte contextuelle.
- **Le registre filtre réellement les outils (D4)** — pas un affichage cosmétique :
  - `list_drive` et `search_drive` : les résultats de `files.list` sont **intersectés avec les ids du registre** avant d'être rendus au LLM. (Google retourne tout le périmètre accordé au scope, qui peut être plus large que le registre après un « Retirer d'Arty ».)
  - `read_drive_file` : **refus** de tout id absent du registre (« Ce fichier n'est pas connecté à Arty — ouvre le Picker pour le connecter »).
  - Les fichiers **créés par Arty** sont ajoutés automatiquement au registre à la création.
  - Dérive : un id du registre qui renvoie 404/410 côté Google est retiré du registre (avec event).
- **Honnêteté du wording** : « Retirer d'Arty » est ainsi vrai côté produit (les outils ne voient plus le fichier). L'écran Réglages précise néanmoins : « L'autorisation Google reste accordée à l'application — pour la révoquer entièrement : [Google Security Checkup](https://myaccount.google.com/permissions) ».
- **Recherche** : `search_drive` réintroduit — `files.list` avec `q` combinant `fullText contains '<terme échappé>'` / `name contains`, tri `modifiedTime desc`, puis filtre registre. Échappement du terme (quotes/backslash) obligatoire ; IDs validés regex (BUG 32).
- **Sémantique** : descriptions d'outils et system prompt disent « les fichiers que l'utilisateur a connectés à Arty », jamais « le Drive de l'utilisateur ». Résultat vide → le LLM propose la connexion de fichiers (bouton d'action allowlisté ouvrant le Picker, discipline de la liste blanche de `useAppSetup.ts`).

### 4.5 B4 — Lecture, export, création

- `read_drive_file` : Google Docs/Sheets/Slides via `files.export` (`text/plain`/`text/csv` ; >10 Mo → erreur claire) ; binaires via `files.get?alt=media` avec le pattern existant de forwarding base64 natif à Claude (`driveTools.ts:183-197` — content blocks `document`/`image`, jamais d'extraction serveur, BUG 14). Caps par appel conservés (P0.9). **Pour tout fichier du registre porteur d'une `resourceKey`, le proxy envoie `X-Goog-Drive-Resource-Keys`** (D5).
- `create_drive_file` : réintroduit **avec confirmation utilisateur** (D6) — déplacement `SAFE_TOOLS` → `CONFIRM_REQUIRED` dans `toolConfirmation.ts` + `case` dédié dans `buildToolConfirmMessage` + mise à jour de `toolConfirmation.test.ts` (la justification « écritures réversibles » y est remplacée par la décision D6).
- `list_drive` : réintroduit, filtré registre (§4.4).
- **Restent bloqués en Phase 1** : `delete_drive_file`, `share_drive_file`, `move_drive_file`, `rename_drive_file`, `copy_drive_file`, `create_drive_folder`, et tous les outils Contacts.
- **Routage IA** : `PRIVATE_DATA_TRIGGERS` (BUG 12) inchangés — « mes fichiers/mon Drive » → Claude, jamais hybride.

### 4.6 B5 — Android (Capacitor) : parcours natif officiel (D2) et cycle de vie complet (D14)

- **Prérequis de dépendance (D14)** : `play-services-auth` **21.3.0 → 21.6.0** (`android/app/build.gradle:80`) — l'API `AuthorizationClient`/`PICKER_OAUTH_TRIGGER` relève des versions récentes. Bump isolé et testé (zone auth native — BUG 21/26/27/51 : jamais en lot avec autre chose).
- **Connexion de fichiers** : **`AuthorizationClient.authorize()`** avec `AuthorizationRequest` portant : scope `drive.file` uniquement, `setOptOutIncludingGrantedScopes(true)` (jeton limité à `drive.file`, PAS de cumul avec Calendar), `ResourceParameter` **`PICKER_OAUTH_TRIGGER`** (+ `PICKER_ALLOW_MULTIPLE` ; `PICKER_MIMETYPES` selon besoin), `Prompt.CONSENT` (+ `SELECT_ACCOUNT` si multi-comptes). Le flux système affiche le Picker.
- **Résultat honnête (D14)** : Google ne garantit que **`picked_file_ids`** dans le résultat — ne PAS attendre de `resourceKey` ni de métadonnées. Pour chaque id : appel **`files.get(fileId, fields=id,name,mimeType,resourceKey)`** avec le jeton obtenu, puis entrée au registre (nom, type, `resourceKey` si présente). Même chemin de revalidation que le web.
- **Renouvellement de jeton SANS Picker (D14, précisé par D19)** : après expiration du jeton ou redémarrage de l'app, relancer `AuthorizationClient.authorize()` avec le scope `drive.file`, **sans** `PICKER_OAUTH_TRIGGER`, **sans `Prompt.CONSENT`**, et **en conservant `setOptOutIncludingGrantedScopes(true)`** (sinon le jeton renouvelé ré-agrégerait les scopes accordés). Pour un scope déjà accordé, le flux ré-émet normalement un jeton sans UI ; **si Google répond « interaction requise », afficher le CTA « Reconnecter mes fichiers »** (même état UI que le web, D19) — jamais d'échec silencieux. Le Picker n'est rouvert QUE pour connecter de nouveaux fichiers.
- **Aucun Picker JavaScript en WebView** — l'ancien gate WebView de la v1.1 est supprimé. Nouveau plugin/méthode dans le code natif (extension de `GoogleSignInPlugin.java` ou plugin dédié `DrivePickerPlugin.java`), résultat transmis à la couche JS (ids + jeton) pour la revalidation `files.get` et le registre.
- **`GATE-PICKER-ANDROID-01`** (§8.2) valide le parcours sur APK réel avant toute communication Android. FAIL → volet B livré web-first, Android suit dans une PR dédiée.

### 4.7 « Ouvrir avec Arty » — REPORTÉ (D7)

L'intégration Drive UI (`drive.install`) est **reportée après stabilisation** des volets A+B. Conservée ici comme piste documentée (aucun impact CASA), à re-proposer dans un CDC ultérieur.

---

## 5. Contrat de scopes Phase 1 (client public)

### 5.1 Scopes du LOGIN (inchangés par rapport à la Phase 0)

    openid
    https://www.googleapis.com/auth/userinfo.email
    https://www.googleapis.com/auth/userinfo.profile
    https://www.googleapis.com/auth/calendar

### 5.2 Scope CONTEXTUEL (accordé au clic « Connecter des fichiers », D1)

    https://www.googleapis.com/auth/drive.file

### 5.3 Denylist (verrouillée par tests)

Tout scope Gmail (`gmail.*`, `mail.google.com`), `drive`, `drive.readonly`, `drive.metadata`, `drive.metadata.readonly`, `drive.activity*`, `contacts`. Tests : parité TS (`gmailNoCasaPhase0.test.ts`, étendue : `drive.file` ABSENT du login) + test `.java` à créer (§4.2) + **contrôle runtime serveur** (§4.0 P0-a : rejet des jetons porteurs de scopes restreints).

### 5.4 Vérification Google

`drive.file` est non-sensible : **aucune vérification renforcée, aucun CASA**. La vérification de marque standard reste requise. `calendar` (sensible) est déjà dans le périmètre vérifié. **Prérequis P0-b (D10)** : preuve documentée que les scopes restreints du `growth-orchestrator` vivent dans un projet OAuth entièrement séparé.

---

## 6. Sécurité et confidentialité

### 6.1 Audit RÈGLE 6 — endpoints touchés

| Endpoint | Auth | Autorisation | Abus infra | Leak | Origin/CSRF |
|---|---|---|---|---|---|
| `functions/api/drive/action.ts` (réactivé, opérations réduites : `list`, `read`, `download`, `create` — la « recherche » est `list`+`q`, l'« export » vit dans `read`/`download`) | **DEUX justificatifs (D13)** : identité/session Arty (header existant) + jeton Drive contextuel (`x-drive-token`) ; `tokeninfo` sur les deux : jeton Drive == **exactement `drive.file`** (D12), aucun scope restreint hérité (chaînes exactes, D18), `aud` ∈ {client web prod, client Android prod}, **`sub` identique** entre les deux jetons (§4.0 P0-a) | le token de l'utilisateur EST l'autorité — Google filtre le périmètre du scope ; le **registre** filtre en plus côté app (D4) ; IDs validés regex (BUG 32) ; terme `fullText` échappé ; `X-Goog-Drive-Resource-Keys` uniquement pour les ids du registre (D5) | pas de clé owner dépensée (API Drive gratuite) ; quotas/caps par appel conservés | erreurs Google masquées (générique + `console.error`, pattern N-2/PR #307) | middleware existant inchangé (Origin whitelist strict) |
| Aucun endpoint nouveau côté volet A (tout est client-local) | — | — | — | — | — |

Opérations du proxy Drive (`drive/action.ts:45-59`) en Phase 1 : **conservées = `list`, `read`, `download`, `create`** ; **retirées = `update`, `delete`, `rename`, `move`, `create_folder`, `share`, `copy`** (RÈGLE 6 « pas de fonctionnalité non déclarée »).

**Bornes du proxy (D22)** — chaque opération conservée est explicitement bornée : taille du corps de requête (cap global, `create` de rapport borné séparément), longueur du nom et du contenu à la création, **allowlist MIME** (types exportables + binaires supportés par la lecture native), validation regex des `fileId`/`folderId` (BUG 32) ET de la `resourceKey` avant toute interpolation, **pagination bornée** (`pageSize` max + nombre de pages max par appel d'outil), délais `googleFetch` 20 s (pattern C13/PR #314). Toute valeur hors borne → 400 générique, jamais d'appel Google.

### 6.2 Points spécifiques

- **Clé Picker** : publique par conception, exception RÈGLE 1 actée (D8) — restrictions referrer + API, clé dédiée, amendement inscrit dans `CLAUDE.md` à l'implémentation.
- **Jeton contextuel web (GIS)** : courte durée, en mémoire, jamais persisté en clair, jamais loggé.
- **Registre local** : métadonnées uniquement, `setJSON` scoped, purge au `logout()`, event BUG 54.
- **Limited Use** : le contenu des fichiers connectés transite vers les fournisseurs IA à la demande de l'utilisateur — la page privacy mentionne « fichiers que vous connectez » (copies FR/EN).
- **Anciens grants restreints** : traités en **prérequis P0-a** (§4.0) — plus un « rappel hors périmètre ».

---

## 7. Exigences fonctionnelles récapitulatives

### Prérequis P0 (bloquants, avant tout outil Drive)

| ID | Exigence |
|---|---|
| DRV-P1-00a | Contrôle serveur à deux justificatifs : jeton Drive == exactement `drive.file` (D12), scopes restreints rejetés (chaînes exactes), `aud` ∈ clients prod web+Android, `sub` identique entre identité et jeton Drive (D3/D13) |
| DRV-P1-00b | Révocation/migration des anciens grants larges (chantier Phase 0 §13.3 exécuté) (D3) |
| DRV-P1-00c | Preuve documentée de séparation OAuth du `growth-orchestrator` (D10) |

### P0 (cette phase)

| ID | Exigence |
|---|---|
| GML-P1-08a | Lien direct résultats Gmail web desktop sous flag `VITE_GMAIL_SEARCH_DIRECT_LINK` **indépendant du profil Phase 0**, navigation « onglet réservé » : copie terminée AVANT navigation, un seul onglet, jamais de `location.assign` automatique (D11/D15) |
| GML-P1-08b | Variante `authuser=<email>` avec validateur ancré non-global, repli `/u/0/` (D11) |
| GML-P1-09 | Détection élargie aux phrasings indirects + anti-collision Drive + tests (≥20 positifs, ≥10 négatifs, ≥5 négatifs Drive) |
| GML-P1-10 | Compilateur à résultat discriminé `not_gmail \| ready \| needs_details` ; `needs_details` → message local explicite, zéro quota (D11) |
| GML-P1-11 | System prompt profil-aware (plus aucune promesse Gmail/Drive en noCasa) |
| GML-P1-12 | `morningBriefService` sans appel Gmail mort ; `previewDemo` cohérente ; parité `NO_CASA_BLOCKED_TOOL_NAMES` (fantômes `update_contact`/`delete_contact` retirés, D17) |
| GML-P1-13 | Contrôles sans-CASA réécrits sémantiquement : scopes comparés en chaînes exactes (plus de `includes('/auth/drive')`), test d'URL Gmail conditionnel au flag avec allowlist sémantique (D18, §3.4) |
| DRV-P1-01 | Autorisation `drive.file` contextuelle au clic (web GIS, Android AuthorizationClient) — jamais au login (D1/D2) ; denylist login verrouillée par tests (TS + `.java` à créer) |
| DRV-P1-02 | Picker web : recherche tout-Drive, multi-sélection, clé publique restreinte dédiée (D8), CSP testée feature par feature |
| DRV-P1-03 | Registre « Mes fichiers connectés » : métadonnées + `resourceKey` (D5), event BUG 54, purge logout, **filtrage réel** de `list`/`search`/`read` (D4), wording honnête + lien révocation Google |
| DRV-P1-04 | Outils réintroduits : `search_drive` (fullText périmètre + filtre registre), `read_drive_file` (export + binaire natif + `X-Goog-Drive-Resource-Keys`), `list_drive`, `create_drive_file` **avec confirmation** (D6) |
| DRV-P1-05 | Proxy Drive réduit aux opérations exposées ; erreurs génériques ; audit RÈGLE 6 documenté dans la PR |
| DRV-P1-06 | Résultat vide → pédagogie du modèle + bouton « Connecter des fichiers » allowlisté |
| DRV-P1-07 | `GATE-PICKER-ANDROID-01` exécuté sur APK réel avant toute promesse Android (D2) |
| DRV-P1-08 | Cycle de vie Android complet : `play-services-auth` 21.6.0, renouvellement de jeton silencieux sans réouverture du Picker, métadonnées + `resourceKey` via `files.get` après `picked_file_ids` (D14) |

### Reportés (décisions actées)

« Ouvrir avec Arty » (`drive.install`) — reporté après stabilisation (D7). Resélection assistée de dossier (`setParent`). Lien direct Gmail mobile si un contrat apparaît. `gmail.send`/`contacts` (sensibles — décision produit séparée).

### Anti-objectifs

Pas de scope restreint « temporaire », pas de `drive.metadata.readonly`, pas de dossier auto-synchronisé (impossible), pas de compte de service partagé, pas d'IMAP/app-password, pas d'auto-forward — options formellement écartées (rapports d'agents du 13 juillet 2026).

---

## 8. Spikes et gates

### 8.1 `SPIKE-DRIVE-FULLTEXT-01` (½ journée, avant B3)

Sur un compte de test avec ~10 fichiers accordés via Picker : vérifier que `files.list?q=fullText contains 'terme'` sous token `drive.file` retourne les fichiers accordés qui matchent (Docs, PDF texte) et rien d'autre ; mesurer la latence d'indexation d'un fichier fraîchement créé par l'app. FAIL → repli `name contains` + tri récent, promesse UI ajustée (« recherche par nom »).

### 8.2 `GATE-PICKER-ANDROID-01` (1 jour, avant toute communication Android)

Sur APK réel (pas émulateur seul), avec `play-services-auth` **21.6.0** : `AuthorizationClient` + `AuthorizationRequest` (`drive.file` seul, `setOptOutIncludingGrantedScopes(true)`, `PICKER_OAUTH_TRIGGER`, `Prompt.CONSENT`). Critères : l'écran de consentement n'affiche QUE `drive.file` ; le Picker système s'affiche et la recherche fonctionne ; la sélection retourne `picked_file_ids` et **`files.get(fields=...resourceKey...)` complète les métadonnées** ; le couple identité+jeton Drive est accepté par le proxy (contrôle §4.0 P0-a : scope exact, `aud`, `sub` identique) ; **renouvellement silencieux** après expiration/kill de l'app SANS réouverture du Picker ; comportement multi-comptes sain (`SELECT_ACCOUNT` + rejet `sub` divergent). FAIL → volet B livré web-first ; Android dans une PR dédiée ultérieure. Résultat annexé à ce CDC (date, appareil, captures).

### 8.3 Matrice manuelle lien direct Gmail (½ journée)

Chrome/Firefox/Safari desktop × {1 compte, multi-comptes, non connecté} : le lien ouvre les bons résultats ou échoue proprement (la requête étant copiée, collage manuel possible — pas de « repli automatique » à valider, mais vérifier l'ABSENCE de double navigation). Annexer la matrice à la PR.

---

## 9. Plan de tests automatisés

- `buildGmailSearchUrl` : encodage (y compris `#`/`/`/`?` dans la requête → neutralisés par `encodeURIComponent`), bidi/contrôles, longueur, **re-validation au clic de la requête éditée** (D16), validateur `authuser` ancré non-global (cas : email valide, sous-chaîne malveillante, appels répétés — pas d'état `lastIndex`), repli.
- Compilateur discriminé : `not_gmail`/`ready`/`needs_details` sur le panel complet (≥20 positifs, ≥10 négatifs dont colis/SMS/WhatsApp/« message d'accueil », ≥5 négatifs Drive) ; `needs_details` → aucun appel réseau/quota (mock).
- Navigation « onglet réservé » (D15/D24) : URL validée/construite AVANT réservation ; onglet ouvert dans le geste utilisateur, navigué APRÈS résolution de la copie, un seul onglet, `opener` nul ; cas adverses testés : popup bloquée (copie + indication), **presse-papiers refusé (onglet vide fermé + message)**, onglet fermé avant navigation (no-op) ; jamais de `location.assign` automatique ; mêmes tests pour flag OFF et mobile web (racine Gmail).
- Contrôles sémantiques (D18) : réécriture de `gmailNoCasaPhase0.test.ts` (ensembles exacts — `drive.file` accepté, `https://www.googleapis.com/auth/drive` refusé) et de `gmailSearchHandoff.test.ts:90-95` (allowlist sémantique d'URL conditionnelle au flag).
- Parité scopes : `drive.file` ABSENT des scopes de login (TS) + test `.java` (nouveau, `readFileSync`).
- Contrôle serveur à deux justificatifs : jeton Drive avec scope surnuméraire → 403 ; `drive.file` manquant → 403 ; jeton d'identité hors allowlist exacte des scopes publics → 403 ; `aud` hors ensemble prod {web, Android} → 403 ; **identité stable (`user_id`) divergente entre les deux jetons → 403 ; champ d'identité ABSENT sur l'un des jetons → 403 (échec fermé, D20)** (mocks tokeninfo, pattern `audValidation.test.ts`).
- CORS : test de préflight OPTIONS vérifiant que `x-drive-token` figure dans les deux listes `Access-Control-Allow-Headers` (`_middleware.ts:92` et `:127`) — parité anti-dérive.
- Registre chiffré : round-trip chiffrement/déchiffrement, aucune trace du nom de fichier ni de la `resourceKey` en clair dans localStorage, purge au logout ET au switch de compte, bootstrap async avec event ready (BUG 43).
- Bornes proxy : corps trop grand → 400 ; MIME hors allowlist → 400 ; `resourceKey`/`folderId` malformés → 400 ; pagination au-delà des caps → tronquée + signalée.
- Cycle de vie jetons : web expiré → état « Reconnecter mes fichiers » (pas de tentative silencieuse) ; Android « interaction requise » → même CTA ; renouvellement Android mocké → vérifie `setOptOutIncludingGrantedScopes(true)` conservé, ni Picker ni `Prompt.CONSENT`.
- Registre : filtrage effectif de `list`/`search`/`read` (fichier hors registre invisible/refusé) ; ajout auto à la création ; retrait sur 404 ; event `drive-connected-files-updated` dispatché ; purge au logout.
- `search_drive` : échappement `fullText`, construction `q`, intersection registre, erreurs masquées.
- `read_drive_file` : header `X-Goog-Drive-Resource-Keys` présent ssi `resourceKey` au registre.
- `create_drive_file` : confirmation exigée (déplacement CONFIRM_REQUIRED + message dédié) — mise à jour `toolConfirmation.test.ts`.
- System prompt profil-aware : en noCasa, aucune occurrence des outils retirés hors bloc « fichiers connectés ».
- Parité `NO_CASA_BLOCKED_TOOL_NAMES` ↔ définitions réelles.
- `npx tsc --noEmit` + build (BUG 13/31) ; suite complète verte.

---

## 10. Critères d'acceptation

1. Sur web desktop, flag ON : « retrouve le mail de Paul sur le devis de juin » → carte avec requête → un clic → **la copie est terminée avant la navigation**, Gmail ouvert **sur les résultats**, **un seul onglet** ouvert.
2. « Le devis que Paul m'a envoyé en juin » (sans le mot « mail ») déclenche la même carte ; « le document Drive que Paul a partagé », « retrouve le colis que Paul m'a envoyé », « réponds à ce WhatsApp » et « écris un message d'accueil » ne sont PAS interceptés — mais « retrouve le **mail** de suivi de livraison » L'EST (paire adverse D24).
3. Une demande Gmail non compilable produit le message `needs_details` local — jamais un silence ni une hallucination. Une requête **éditée** dans la carte est re-validée puis encodée au clic.
4. En mode noCasa, aucune réponse du LLM ne prétend avoir lu/cherché Gmail ou le Drive global (panel de 10 prompts pièges).
5. Un jeton portant un ancien scope large (`drive`, `gmail.readonly`) est **refusé** par le proxy Drive ; un jeton Drive portant un scope EN PLUS de `drive.file` est **refusé** ; un jeton Drive d'un compte différent du compte de session (`sub` divergent) est **refusé** — chaque cas avec message de reconnexion actionnable.
5-bis. Cycle de vie des jetons (D19) : sur Android, après kill/redémarrage, la lecture d'un fichier connecté fonctionne **sans réouverture du Picker** quand Google ré-émet le jeton, et affiche le CTA « Reconnecter mes fichiers » quand une interaction est requise — jamais d'échec silencieux ; sur web, un jeton expiré affiche le même CTA (aucune promesse de renouvellement silencieux). Un fichier partagé par lien sélectionné sur Android obtient sa `resourceKey` via `files.get`.
5-ter. Le préflight CORS passe avec `x-drive-token` (les deux listes du middleware à jour) ; le registre est illisible en clair dans localStorage (noms + `resourceKey` chiffrés) et disparaît au logout comme au changement de compte.
6. L'utilisateur connecte 3 fichiers via le Picker ; « résume le doc X » et « cherche <terme> dans mes fichiers » fonctionnent ; un fichier non connecté n'est jamais visible ; un fichier **retiré d'Arty** disparaît de `list`/`search` et son `read` est refusé (D4).
7. Un fichier partagé par lien avec `resourceKey` se lit correctement (header envoyé) (D5).
8. Un rapport généré par Arty est sauvé dans Drive **après confirmation** (D6) et reste lisible ensuite.
9. Les gates §8.1 et §8.2 sont exécutés et annexés ; la preuve P0-b (growth-orchestrator) est annexée.
10. Audit RÈGLE 6 coché dans la PR pour `functions/api/drive/action.ts`.

---

## 11. Découpage en PRs et estimation

| PR | Contenu | Estimation |
|---|---|---|
| **PR-0** | **Synchronisation : pousser la migration locale du décideur** (renommages `PUBLIC_GOOGLE_*`, scanner `check-public-google-access.mjs`, `no-casa:check`, `oauth_profile`, inspections APK/AAB) — prérequis de TOUTES les PRs suivantes (encadré §0) | ops décideur |
| PR-A1 | Compilateur discriminé + triggers élargis/anti-collision/faux positifs + paire adverse colis/mail (D17/D24) + system prompt/brief/demo/hygiène + **réécriture sémantique des contrôles CI réels : scanner + 3 inspections APK/AAB + tests unitaires (D18/D21)** | 2 j |
| PR-A2 | Lien direct sous flag indépendant + navigation « onglet réservé » durcie (validation avant réservation, fermeture sur échec de copie, flag OFF + mobile web couverts, D15/D24) + re-validation au clic (D16) + validateur authuser + matrice | 1-1,5 j |
| **PR-B0** | **Prérequis D3/D10/D12/D13/D20/D22 : contrôle serveur à deux justificatifs (scope exact, allowlist jeton principal, multi-aud, identité stable fail-closed) + `x-drive-token` au CORS (les 2 listes) + bornes du proxy + fix `App.tsx:957` (`storeTokens`/`storeUser`) + révocation/migration anciens grants + preuve growth-orchestrator** | 2-2,5 j + ops |
| PR-B1 | Autorisation contextuelle web (GIS `include_granted_scopes: false`, origins SANS wildcard — alias preview fixe ou GIS off en preview (D23), CSP accounts.google.com) + état/CTA « Reconnecter mes fichiers » (D19) + spike fulltext + tests parité (TS + `.java`) | 1,5-2 j |
| PR-B2 | Picker web + registre **chiffré** filtrant (D22) + resourceKeys + CSP Picker | 2-2,5 j |
| PR-B3 | Outils LLM réintroduits + confirmation `create_drive_file` + prompt « fichiers connectés » | 1-1,5 j |
| PR-B4 | Android natif : bump `play-services-auth` 21.6.0 (isolé), `AuthorizationClient` + `PICKER_OAUTH_TRIGGER`, renouvellement sans Picker/CONSENT avec opt-out conservé + CTA sur interaction requise (D19), `files.get` post-sélection + `GATE-PICKER-ANDROID-01` (D14) | 2 j |

Ordre : PR-A1 → PR-A2 (valeur immédiate, zéro changement de permission), puis **PR-B0 obligatoirement avant PR-B1→B4**. Chaque PR passe `tsc`, la suite complète, et l'audit RÈGLE 6 quand un endpoint est touché.

---

## 12. Risques

| Risque | Sévérité | Mitigation |
|---|---|---|
| Le format `#search/` casse (non contractuel) | Moyen | Copie toujours faite avant ; collage manuel documenté dans l'UI (pas de repli automatique) ; flag OFF en un déploiement |
| Le parcours natif `PICKER_OAUTH_TRIGGER` se comporte différemment sur appareil réel (API récente) | Moyen | Gate §8.2 bloquant pour la communication Android ; livraison web-first |
| `fullText contains` décevant sous `drive.file` | Moyen | Spike §8.1 avant promesse ; repli `name contains` |
| GIS (origins, CSP, popup bloqué) sur web | Moyen | Budgété PR-B1 ; test prod-like feature par feature (leçon F-2) ; le Picker n'est jamais promis avant validation |
| Contrôle serveur des scopes trop strict → lockout d'utilisateurs légitimes en transition | Moyen | Message 403 actionnable (« reconnecte tes fichiers ») ; déploiement de PR-B0 AVANT l'UI Drive (aucun utilisateur ne dépend encore du parcours) |
| Confusion « pourquoi Arty ne voit pas ce fichier ? » | Élevé (UX) | Pédagogie systématique (DRV-P1-06), écran Réglages, réponse LLM standardisée |

Aucune question ouverte : les décisions D1-D24 (§0) couvrent les questions de la v1.1 et les blocages des deuxième et troisième verdicts. Une seule dépendance externe : **la migration locale du décideur doit être poussée sur `origin` (PR-0)** avant le début de l'implémentation. L'implémentation reste **en pause** jusqu'au GO explicite du décideur sur cette v1.4.
