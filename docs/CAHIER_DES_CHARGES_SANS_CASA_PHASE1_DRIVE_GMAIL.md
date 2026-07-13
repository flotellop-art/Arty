# Cahier des charges — Phase 1 sans CASA : Drive connecté (`drive.file` + Picker) et recherche Gmail améliorée

**Version :** 1.0<br>
**Date :** 13 juillet 2026<br>
**Statut :** proposé — en attente de GO de Florent Pollet<br>
**Périmètre :** application publique Arty Web (PWA `tryarty.com`) + Android (Capacitor) ; AUCUN changement au Workspace Add-on ni au canal bêta<br>
**Décideur :** Florent Pollet<br>
**Documents liés :** `CAHIER_DES_CHARGES_GMAIL_SANS_CASA.md` (Phase 0, PR #336), `ADR_GMAIL_ADDON_SANS_CASA.md`, `GOOGLE_OAUTH_VERIFICATION.md`

---

## 1. Décision exécutive

La Phase 0 (PR #336) a retiré tous les accès Gmail/Drive/Contacts du client public et remplacé la recherche Gmail par un copier-coller vers la racine de Gmail. Constat du décideur : l'expérience est trop dégradée. Ce cahier des charges définit la **Phase 1**, toujours **strictement sans scope restreint** (donc sans CASA), en deux volets indépendants :

- **Volet A — Recherche Gmail améliorée** : ouvrir Gmail **directement sur les résultats** de la requête compilée (au lieu de la racine + collage manuel), comprendre les formulations indirectes, échouer explicitement, et purger les contradictions internes (system prompt, brief vocal) qui promettent encore au LLM des outils qu'il n'a plus.
- **Volet B — Drive connecté** : réintroduire un vrai parcours Drive fondé sur le scope **non-sensible** `drive.file` + le **Google Picker** : l'utilisateur cherche dans tout son Drive via l'UI Google, sélectionne les fichiers à connecter à Arty, et Arty peut ensuite les **chercher (plein texte), lire, exporter et résumer** — pour toujours, sans nouveau consentement. Arty peut aussi **créer** des fichiers (rapports) qui restent accessibles.

**Ce que la Phase 1 ne fait pas** : elle ne rend pas la recherche Gmail exécutée par Arty (impossible sans scope restreint — vérifié §3.1) ni la recherche sur les fichiers Drive **non connectés**. Elle transforme « Arty n'a plus de Drive et un hand-off Gmail pénible » en « Arty a un Drive à périmètre choisi par l'utilisateur et un hand-off Gmail en un clic ».

Invariants hérités de la Phase 0, inchangés et non négociables :

- aucun scope restreint dans les clients publics (web, Android) ni dans aucun projet de production ;
- aucun scope Gmail dans le client public (les scopes contextuels vivent uniquement dans le manifest de l'Add-on) ;
- Arty ne reçoit jamais la liste des résultats d'une recherche Gmail ;
- consentement lisible : chaque nouveau scope est expliqué dans l'UI avant d'être demandé.

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

1. **Le Picker cherche dans tout le Drive** (recherche Google native, nom + contenu indexé) via `DocsView`/`setQuery()`, et chaque fichier sélectionné devient accessible à l'app de façon **permanente** — c'est le mécanisme documenté par Google : « files … that you open with an app or that the user shares with an app while using the Google Picker API ».
2. **`files.list` avec `q=fullText contains '...'` fonctionne sous `drive.file`** et Google filtre côté serveur sur le sous-ensemble accordé — Arty peut donc offrir une vraie recherche plein texte sur les « fichiers connectés ». Ce comportement est confirmé par recoupements communautaires mais PAS par un exemple officiel : il est re-vérifié par le spike `SPIKE-DRIVE-FULLTEXT-01` (§8.1) avant toute promesse UI.
3. **`drive.file` couvre toutes les ressources REST Drive** sur le périmètre accordé, y compris `files.export` (Docs/Sheets/Slides → texte/PDF, limite 10 Mo) et `files.get?alt=media` (binaires) — la lecture/résumé IA fonctionne à l'identique de l'ancienne version sur les fichiers connectés.
4. **Sélectionner un DOSSIER ne donne PAS accès à ses enfants** (ni actuels ni futurs) — seulement au dossier comme objet. Confirmé par un Developer Advocate Google et le ticket [issuetracker #330555392](https://issuetracker.google.com/issues/330555392). Conséquence : **pas de « dossier Arty » auto-synchronisé** ; le pattern honnête est la resélection explicite via Picker pré-navigué (`setParent(folderId)`).
5. **WebView Android** : le consentement OAuth incrémental en JS dans une WebView est bloqué (`disallowed_useragent`). Le scope `drive.file` doit être obtenu par le **plugin natif existant** (`GoogleSignInPlugin.java`, `requestScopes()`), jamais par un popup GIS dans la WebView (même famille que BUG 26/27). Le **rendu du Picker lui-même** (iframe, token déjà acquis via `setOAuthToken()`) n'est pas documenté pour ce contexte : gate terrain obligatoire (`GATE-PICKER-WEBVIEW-01`, §8.2).

### 2.3 Faits vérifiés sur le lien direct Gmail

- `https://mail.google.com/mail/u/0/#search/<requête urlencodée>` ouvre Gmail Web **directement sur les résultats**. Ce format fonctionne empiriquement mais n'est **pas un contrat public Google** → il est traité comme un enrichissement *best-effort* derrière un flag, avec le copier-coller conservé comme chemin garanti (c'était déjà la position du CDC Phase 0, GML-P1-08 : « lien direct désactivé par défaut, expérimentable en P1 sous flag » — ce flag n'a jamais été codé, c'est l'objet du volet A).
- Aucun intent de recherche documenté vers l'app Gmail **Android** ; sur mobile, l'URL peut être interceptée par l'app Gmail et perdre le fragment `#search`. Le lien direct est donc **web desktop uniquement** en Phase 1 ; le natif conserve le parcours Phase 0 (copie + ouverture générique).
- Ce volet n'ajoute **aucun scope**, aucun appel API : Arty ne voit toujours jamais les résultats.

### 2.4 Sources officielles

- [Scopes Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker — web](https://developers.google.com/workspace/drive/picker/guides/overview) ; [référence `DocsView`](https://developers.google.com/workspace/drive/picker/reference/picker.docsview)
- [`files.export`](https://developers.google.com/drive/v3/reference/files/export) ; [téléchargements](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive UI integration / « Ouvrir avec »](https://developers.google.com/workspace/drive/api/guides/enable-sdk)
- [OAuth en WebView interdit](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)
- [Opérateurs de recherche Gmail](https://support.google.com/mail/answer/7190)

Les classifications doivent être re-vérifiées dans Google Cloud Console juste avant toute soumission de vérification.

---

## 3. Volet A — Recherche Gmail améliorée

### 3.1 A1 — Lien direct vers les résultats (`GML-P1-08`, enfin implémenté)

**Comportement cible (web desktop, flag ON)** : le bouton « Chercher dans Gmail » de la `GmailSearchCard` copie la requête (inchangé) puis ouvre `https://mail.google.com/mail/u/0/#search/<encodeURIComponent(query)>` au lieu de `GMAIL_HOME_URL`.

Spécifications :

- **Flag** : `VITE_GMAIL_SEARCH_DIRECT_LINK` (pattern exact de `gmailNoCasaPhase0.ts` : `TRUE_VALUES`, défaut OFF, paramètre par défaut testable). N'a d'effet que si le profil Phase 0 est actif.
- **Plateformes** : web desktop uniquement. Sur `Capacitor.isNativePlatform()` et sur mobile web (heuristique : `matchMedia`/UA tactile), conserver `openGmailHome()` actuel. Raison : fragment perdu par l'app Gmail Android, aucun contrat.
- **Compte** : le segment `/u/0/` cible le premier compte connecté du navigateur. Si l'email Google de l'utilisateur est connu (`google-user`), utiliser la variante `https://mail.google.com/mail/u/?authuser=<email>#search/<q>` ; sinon `/u/0/`. La carte affiche un sous-texte : « Résultats ouverts dans Gmail — si ce n'est pas le bon compte, colle la requête (déjà copiée). »
- **Construction de l'URL** : réutiliser la requête déjà validée par `validateGmailSearchQuery` (opérateurs allowlistés, bidi/contrôles strippés, longueur ≤ 500) puis `encodeURIComponent`. Aucune donnée autre que la requête dans l'URL. L'email injecté dans `authuser` doit matcher `EMAIL_RE` sinon repli `/u/0/`.
- **Repli** : la copie presse-papiers reste TOUJOURS exécutée avant l'ouverture (ordre existant `copyThenOpenGmail`) — si le deep link casse un jour (refonte SPA Gmail), l'utilisateur retombe sur le parcours Phase 0 sans perte.
- **Fichiers** : `src/services/gmailSearchHandoff.ts` (nouvelle `buildGmailSearchUrl(query, email?)` + branchement dans `openGmail*`), `src/components/gmail/GmailSearchCard.tsx` (sous-texte), `src/vite-env.d.ts`, copies FR/EN.

### 3.2 A2 — Détection d'intention élargie (discipline BUG 56)

`isGmailSearchIntent` (`gmailSearchHandoff.ts:89-101`) exige aujourd'hui le mot `gmail|mail|courriel|message` : « retrouve le devis que Paul m'a envoyé en juin » ne déclenche rien et part vers Claude sans outils. C'est le piège documenté sous BUG 56 (phrasings indirects), non réappliqué ici.

- Ajouter un panel de déclencheurs indirects : `(que|qu')\s+\w+\s+m'a envoyé`, `envoyé (par|de)`, `reçu (de|en|le)`, `dans ma boîte`, `in my inbox`, `(sent|received) (me|from)`, pièces jointes (`la facture|le devis|le document) (de|que)` + marqueur d'expéditeur/date compilable.
- Règle de précision : le déclencheur indirect n'active le compilateur QUE si `compileGmailSearch` produit au moins un opérateur ciblé (`from:`/`subject:`/date) — sinon flux normal. Objectif : zéro interception de messages généraux (« montre-moi un message d'accueil sympa »).
- **Chaque cas raté remonté = un pattern ajouté + un test de non-régression** (règle de maintenance BUG 56). Test : panel FR/EN d'au moins 20 phrasings positifs et 10 négatifs dans `gmailSearchHandoff.test.ts` (à créer s'il n'existe pas, sinon étendre `gmailNoCasaPhase0.test.ts`).

### 3.3 A3 — Échec explicite du compilateur

Aujourd'hui, `compileGmailSearch` → `null` = fallthrough silencieux vers Claude (qui n'a pas d'outils Gmail). Cible :

- Si l'intention Gmail est détectée (A2) mais la compilation échoue, afficher un message assistant local (sans appel LLM ni quota, comme le succès) : « Je n'ai pas réussi à construire une recherche Gmail fiable à partir de ta demande. Reformule avec un expéditeur, un sujet ou une période — ou ouvre Gmail et colle des mots-clés. » + bouton d'ouverture Gmail générique.
- État 4-states à la façon BUG 59 : succès / échec-explicite ; jamais de silence.

### 3.4 A4 — Purge des contradictions internes (item CDC Phase 0 §13.2 non traité)

1. **`src/constants/systemPrompt.ts`** : rendre le prompt système **profil-aware**. En mode `noCasa`, les sections « TES OUTILS » ne doivent plus lister `read_emails`, `send_email`, `reply_email`, `list_drive`, `search_drive`, `read_drive_file`, `create_drive_file`, ni la « PROCÉDURE OBLIGATOIRE » de recherche en 7 étapes Gmail+Drive, ni le bouton `data-action="save_drive"`. La stratégie actuelle (préfixe « MODE GMAIL SANS CASA — PRIORITÉ ABSOLUE » prépendu à 200 lignes contradictoires par `useAppSetup.ts:35`) repose sur l'ordre d'emphase → risque d'hallucination « j'ai lu tes mails », contraire à la stratégie confiance. Implémentation : `buildSystemPrompt(profile)` avec blocs conditionnels ; le volet B réintroduit ensuite les blocs Drive adaptés (« fichiers connectés », pas « ton Drive »).
2. **`src/services/morningBriefService.ts:166-192`** : supprimer l'appel `listUnreadEmails()` (mort, le token n'a plus le scope) quand le profil noCasa est actif — aligner sur la migration propre déjà faite dans `useProactiveBrief.ts:88,120,126`.
3. **`src/services/previewDemo.ts:55-73`** : gater ou réécrire les 2 conversations de démo qui promettent encore « synthèse des mails » / « retrouvé dans ton Drive ».
4. **Hygiène** : corriger `NO_CASA_BLOCKED_TOOL_NAMES` (`gmailNoCasaPhase0.ts:13-32`) — la liste contient des noms inexistants (`modify_email`, `create_draft`) et omet les vrais (`archive_email`, `delete_email`, `star_email`, `create_draft_email`, `label_email`). Ajouter un test de parité : chaque nom de la liste DOIT exister dans les définitions d'outils, et chaque outil Gmail/Drive/Contacts défini DOIT être couvert (pattern du test de parité F-1).

---

## 4. Volet B — Drive connecté (`drive.file` + Picker)

### 4.1 Vue d'ensemble du parcours

1. L'utilisateur clique « Connecter des fichiers Drive » (Réglages, et carte contextuelle quand une demande Drive est détectée).
2. Consentement incrémental `drive.file` (web : GIS ; Android : plugin natif) — première fois seulement.
3. Le **Google Picker** s'ouvre : l'utilisateur cherche dans **tout** son Drive (UI Google, multi-sélection activée) et valide.
4. Les fichiers sélectionnés deviennent accessibles à Arty **définitivement**. Arty maintient un registre local d'affichage (« Mes fichiers connectés ») ; la **source de vérité reste Google** (`files.list`).
5. Le LLM retrouve des outils Drive **re-scopés au périmètre accordé** : recherche plein texte, lecture/export, création.
6. Si une recherche ne trouve rien, la réponse explique le modèle (« je ne vois que les fichiers que tu m'as connectés ») et propose d'ouvrir le Picker.

### 4.2 B1 — Scopes et consentement

- **Web** (`src/services/googleAuth.ts`) : ajouter `https://www.googleapis.com/auth/drive.file` à `GMAIL_NO_CASA_PHASE0_GOOGLE_SCOPES`. Décision assumée : scope demandé au login (pas de consentement incrémental séparé en Phase 1) pour éviter un second écran OAuth et le chantier PKCE-double-flux ; l'écran de consentement Google affichera « Afficher et gérer les fichiers Google Drive que vous utilisez avec cette application » — libellé Google déjà minimal et rassurant.
- **Android** (`GoogleSignInPlugin.java:54-60`) : ajouter `new Scope("https://www.googleapis.com/auth/drive.file")` dans la branche `BuildConfig.GMAIL_NO_CASA_PHASE0`.
- **Re-consentement** : les utilisateurs Phase 0 existants devront ré-autoriser (scope ajouté). Réutiliser le flux de reconnexion existant ; message dédié dans l'UI (« Arty a besoin d'une nouvelle permission pour les fichiers que tu choisis »).
- **Denylist inchangée** : aucun scope Gmail, aucun `drive`/`drive.readonly`/`drive.metadata*`. Le test de parité de scopes existant (profil Phase 0) doit être étendu pour verrouiller la nouvelle allowlist exacte.

### 4.3 B2 — Google Picker (web)

- Chargement de `https://apis.google.com/js/api.js` + `google.picker` **à la demande** (pas au boot — perf et CSP).
- Construction : `PickerBuilder` + `DocsView` (`setIncludeFolders(true)`, `setSelectFolderEnabled(false)` en P0 — cf. fait §2.2.4), `enableFeature(MULTISELECT_ENABLED)`, `setOAuthToken(<token courant>)`, `setDeveloperKey(<clé Picker>)`, `setAppId(<project number>)`, locale FR/EN.
- **Clé API Picker** : clé navigateur **non secrète mais verrouillée** — restriction referrer (`tryarty.com`, `*.appfacade.pages.dev`, `capacitor://localhost`, `https://localhost`) + restriction API (Picker API uniquement). Exposée en `VITE_GOOGLE_PICKER_API_KEY` : compatible RÈGLE 1 (ce n'est PAS une clé IA payante ; c'est une clé publique par conception, la sécurité vient des restrictions console). Documenter dans `.env.example` + `functions/env.d.ts` n'est pas requis (clé purement client).
- **CSP** (`public/_headers`) : ajouter les hôtes requis par le Picker (`apis.google.com` en script-src, frame-src Google Picker/docs). ⚠️ Leçon BUG 40/F-2 : toute modification de `public/_headers` doit être testée feature par feature en prod-like (le Picker ET la géoloc/camera/micro existants).
- À la validation du Picker : callback reçoit `{id, name, mimeType, iconUrl}` par document → enregistrement au registre local + toast de confirmation (« 3 fichiers connectés à Arty »).

### 4.4 B3 — Registre « Mes fichiers connectés » + recherche

- **Registre local d'affichage** : `scopedStorage` clé `drive-connected-files` (`setJSON` — métadonnées non sensibles : id, name, mimeType, grantedAt). PAS de base64, PAS de contenu (BUG 11). Le registre sert à l'UI (liste, retrait visuel) et aux prompts ; il n'est PAS une autorité d'accès : la vérité est `files.list` côté Google. Un écran Réglages « Fichiers connectés » liste le registre + lien vers [Google Security Checkup](https://myaccount.google.com/permissions) pour la révocation réelle.
- **Recherche** : l'outil `search_drive` est réintroduit, backend inchangé (`functions/api/drive/action.ts`, requête `files.list` avec `q` combinant `fullText contains '<terme échappé>'` / `name contains` + tri `modifiedTime desc`). Sous `drive.file`, Google restreint automatiquement au périmètre accordé. Échappement du terme (quotes/backslash) obligatoire ; IDs déjà validés par regex (BUG 32).
- **Sémantique honnête** : les descriptions d'outils et le system prompt disent « les fichiers que l'utilisateur a connectés à Arty », jamais « le Drive de l'utilisateur ». Si résultat vide : le LLM doit proposer la connexion de fichiers (bouton d'action allowlisté ouvrant le Picker — à ajouter à la liste blanche de `useAppSetup.ts`, avec la même discipline de confirmation que le lot du 14 juin).

### 4.5 B4 — Lecture, export, création

- `read_drive_file` réintroduit : Google Docs/Sheets/Slides via `files.export` (`text/plain`/`text/csv` ; limite 10 Mo → message d'erreur clair au-delà) ; binaires (PDF, images, Office) via `files.get?alt=media` avec le **pattern existant** de forwarding base64 natif à Claude (`driveTools.ts:183-197` — content blocks `document`/`image`, jamais d'extraction serveur, BUG 14). Caps par appel existants conservés (P0.9).
- `create_drive_file` réintroduit (rapports générés → Drive). Les fichiers créés par Arty sont accessibles par construction sous `drive.file`.
- `list_drive` réintroduit re-scopé (liste du périmètre accordé, tri récent).
- **Restent bloqués en Phase 1** : `delete_drive_file`, `share_drive_file`, `move_drive_file`, `rename_drive_file`, `copy_drive_file`, `create_drive_folder` (valeur faible vs surface de risque ; réévaluation P2), et tous les outils Contacts.
- **Test de parité confirm/safe** : chaque outil réintroduit DOIT être classé dans `toolConfirmation.test.ts` (pattern F-1). Proposition : `search_drive`/`read_drive_file`/`list_drive` = safe ; `create_drive_file` = confirmation (écrit chez l'utilisateur).
- **Routage IA** : `PRIVATE_DATA_TRIGGERS` (BUG 12) inchangés — « mes fichiers/mon Drive » → Claude, jamais hybride ; c'est de nouveau correct puisque Claude retrouve des outils Drive.

### 4.6 B5 — Android (Capacitor)

- Token `drive.file` obtenu par le plugin natif (§4.2) — jamais de consentement GIS dans la WebView.
- **`GATE-PICKER-WEBVIEW-01`** (§8.2) décide du rendu du Picker sur APK réel. Trois issues possibles, dans l'ordre de préférence :
  1. le Picker se rend dans la WebView avec `setOAuthToken()` → livrer tel quel ;
  2. échec de rendu → page `tryarty.com/drive-picker` hébergée (session web) ouverte en Custom Tab (`@capacitor/browser`), retour par deep link `?connected=<ids>` — les ids retournés sont revalidés côté app par `files.get` avant entrée au registre ;
  3. échec des deux → sur Android, parcours de repli « partage depuis l'app Drive vers Arty » + connexion depuis la PWA desktop ; le volet B reste livrable web-first.
- Le gate est bloquant pour la **communication** Android (ne pas promettre le Picker sur APK avant preuve) mais PAS pour la livraison web.

### 4.7 B6 — « Ouvrir avec Arty » (P2 de ce CDC, optionnel)

Déclarer l'intégration Drive UI (`drive.install`, non-sensible) : clic droit → « Ouvrir avec → Arty » dans Drive web → redirection vers `tryarty.com` avec `state={ids}` → fichier ajouté au registre + conversation pré-remplie. Effort faible, forte valeur de confiance (parcours initié depuis l'UI Google). À faire seulement après stabilisation B1-B5 ; nécessite l'Open URL configurée en console + icônes. Aucun impact CASA.

---

## 5. Contrat de scopes Phase 1 (client public)

### 5.1 Allowlist exacte

    openid
    https://www.googleapis.com/auth/userinfo.email
    https://www.googleapis.com/auth/userinfo.profile
    https://www.googleapis.com/auth/calendar
    https://www.googleapis.com/auth/drive.file
    (P2 optionnel : https://www.googleapis.com/auth/drive.install)

### 5.2 Denylist (inchangée, verrouillée par test)

Tout scope Gmail (`gmail.*`, `mail.google.com`), `drive`, `drive.readonly`, `drive.metadata`, `drive.metadata.readonly`, `drive.activity*`, `contacts`. Le test de parité de scopes doit échouer si un scope hors allowlist apparaît dans `googleAuth.ts` ou `GoogleSignInPlugin.java`.

### 5.3 Vérification Google

`drive.file` et `drive.install` sont non-sensibles : **aucune vérification renforcée, aucun CASA**. La vérification de marque standard (écran de consentement, domaines, privacy policy) reste requise comme aujourd'hui. `calendar` (sensible) est déjà dans le périmètre vérifié.

---

## 6. Sécurité et confidentialité

### 6.1 Audit RÈGLE 6 — endpoints touchés

| Endpoint | Auth | Autorisation | Abus infra | Leak | Origin/CSRF |
|---|---|---|---|---|---|
| `functions/api/drive/action.ts` (réactivé, opérations réduites : list/search/read/export/create) | `x-google-token` vérifié (`getValidAccessToken` côté client — BUG 23 ; `checkAllowedUser`/`verifyGoogleUser` + `aud` côté serveur, inchangés) | le token `drive.file` de l'utilisateur EST l'autorité — Google filtre le périmètre ; IDs validés regex (BUG 32) ; `fullText` échappé | pas de clé owner dépensée (API Drive gratuite) ; quotas/caps par appel conservés | erreurs Google masquées (générique + `console.error`, pattern N-2/PR #307) | middleware existant inchangé (Origin whitelist strict) |
| Aucun endpoint nouveau côté volet A (tout est client-local) | — | — | — | — | — |

Actions serveur à retirer de l'allowlist d'opérations du proxy Drive en Phase 1 : delete/share/move/rename/copy/folder (défense en profondeur alignée sur les outils bloqués — ne pas laisser d'opération non exposée côté UI, RÈGLE 6 « fonctionnalité non déclarée »).

### 6.2 Points spécifiques

- **Clé Picker** : publique par conception, verrouillée referrer + API (§4.3). Ne jamais la confondre avec une clé serveur ; interdiction de l'utiliser pour un autre service Google.
- **Presse-papiers** (volet A, inchangé) : la requête compilée ne contient jamais de contenu de mail, seulement les termes de l'utilisateur.
- **Registre local** : métadonnées uniquement, via `setJSON` scoped ; purgé par `logout()` (à vérifier dans la même passe que BUG 41).
- **Limited Use** : le contenu des fichiers connectés transite vers les fournisseurs IA à la demande de l'utilisateur — même cadre que l'ancienne version ; la page privacy doit mentionner « fichiers que vous connectez » (mise à jour des copies FR/EN).
- **Anciens grants restreints (rappel, hors périmètre Phase 1)** : les refresh tokens `gmail.readonly`/`drive` accordés avant la Phase 0 restent valides tant que la migration/révocation (CDC Phase 0 §13.3) n'est pas exécutée. La Phase 1 n'y touche pas mais ne doit pas être présentée comme « le client n'a plus accès » tant que ce chantier n'est pas fait.

---

## 7. Exigences fonctionnelles récapitulatives

### P0 (cette phase)

| ID | Exigence |
|---|---|
| GML-P1-08a | Lien direct résultats Gmail web desktop sous flag `VITE_GMAIL_SEARCH_DIRECT_LINK`, copie préservée, repli racine |
| GML-P1-08b | Variante `authuser=<email>` quand l'email est connu, repli `/u/0/` |
| GML-P1-09 | Panel de triggers indirects + tests de non-régression (≥20 positifs, ≥10 négatifs) |
| GML-P1-10 | Échec de compilation explicite (message local, zéro quota) |
| GML-P1-11 | System prompt profil-aware (plus aucune promesse Gmail/Drive en noCasa) |
| GML-P1-12 | `morningBriefService` sans appel Gmail mort ; `previewDemo` cohérente ; parité `NO_CASA_BLOCKED_TOOL_NAMES` |
| DRV-P1-01 | Scope `drive.file` ajouté aux deux plateformes du profil Phase 0, denylist verrouillée par test |
| DRV-P1-02 | Picker web : recherche tout-Drive, multi-sélection, clé verrouillée, CSP testée feature par feature |
| DRV-P1-03 | Registre « Mes fichiers connectés » (métadonnées seules) + écran Réglages + lien révocation Google |
| DRV-P1-04 | Outils réintroduits : `search_drive` (fullText périmètre), `read_drive_file` (export + binaire natif), `list_drive`, `create_drive_file` (confirmation) ; parité confirm/safe |
| DRV-P1-05 | Proxy Drive réduit aux opérations exposées ; erreurs génériques ; audit RÈGLE 6 documenté dans la PR |
| DRV-P1-06 | Résultat vide → pédagogie du modèle + bouton « Connecter des fichiers » allowlisté |
| DRV-P1-07 | `GATE-PICKER-WEBVIEW-01` exécuté sur APK réel avant toute promesse Android |

### P2 (après stabilisation, sans CASA)

« Ouvrir avec Arty » (`drive.install`), resélection assistée de dossier (`setParent`), lien direct Gmail sur mobile si un contrat apparaît, réintroduction éventuelle de `gmail.send`/`contacts` (sensibles — décision produit séparée, hors de ce CDC).

### Anti-objectifs

Pas de scope restreint « temporaire », pas de `drive.metadata.readonly`, pas de dossier auto-synchronisé (impossible), pas de compte de service partagé, pas d'IMAP/app-password, pas d'auto-forward — options formellement écartées (rapports d'agents du 13 juillet 2026).

---

## 8. Spikes et gates

### 8.1 `SPIKE-DRIVE-FULLTEXT-01` (½ journée, avant B3)

Sur un compte de test avec ~10 fichiers accordés via Picker : vérifier que `files.list?q=fullText contains 'terme'` sous token `drive.file` retourne les fichiers accordés qui matchent (Docs, PDF texte) et rien d'autre ; mesurer la latence d'indexation d'un fichier fraîchement créé par l'app. FAIL → la recherche retombe sur `name contains` + tri récent, et la promesse UI est ajustée (« recherche par nom »).

### 8.2 `GATE-PICKER-WEBVIEW-01` (1 jour, avant toute communication Android)

Sur APK réel (pas émulateur seul) : token `drive.file` via plugin natif → ouverture du Picker dans la WebView (`setOAuthToken`). Critères : rendu complet, recherche fonctionnelle, sélection retournée au callback, aucune interstitielle `disallowed_useragent`. FAIL → issue 2 (Custom Tab + page hébergée) ; FAIL des deux → issue 3 (web-first). Résultat annexé à ce CDC (date, appareil, captures).

### 8.3 Matrice manuelle lien direct Gmail (½ journée)

Chrome/Firefox/Safari desktop × {1 compte, multi-comptes, non connecté} : le lien ouvre les bons résultats ou échoue proprement vers la racine (la requête étant déjà copiée). Annexer la matrice à la PR.

---

## 9. Plan de tests automatisés

- `buildGmailSearchUrl` : encodage, bidi/contrôles, longueur, `authuser` validé par `EMAIL_RE`, repli.
- Panel triggers (GML-P1-09) + non-interception des messages généraux.
- Échec compilateur → message local, aucun appel réseau/quota (mock).
- Parité scopes allowlist/denylist (web + lecture du `.java` par test de chaîne, comme le test manifest Phase 0).
- Parité `NO_CASA_BLOCKED_TOOL_NAMES` ↔ définitions d'outils réelles.
- Parité confirm/safe des outils réintroduits (`toolConfirmation.test.ts`).
- `search_drive` : échappement du terme `fullText`, construction `q`, erreurs Google masquées.
- System prompt profil-aware : en noCasa, aucune occurrence de `read_emails|search_drive globale|save_drive` hors bloc « fichiers connectés ».
- `npx tsc --noEmit` + build (BUG 13/31) ; suite complète existante verte.

---

## 10. Critères d'acceptation

1. Sur web desktop, flag ON : « retrouve le mail de Paul sur le devis de juin » → carte avec requête → un clic → Gmail ouvert **sur les résultats**, requête déjà dans le presse-papiers.
2. « Le devis que Paul m'a envoyé en juin » (sans le mot « mail ») déclenche la même carte.
3. Une demande non compilable détectée comme Gmail produit un message d'explication local, jamais un silence ni une hallucination.
4. En mode noCasa, aucune réponse du LLM ne prétend avoir lu/cherché Gmail ou le Drive global (vérifié sur un panel de 10 prompts pièges).
5. L'utilisateur connecte 3 fichiers via le Picker ; « résume le doc X » et « cherche <terme> dans mes fichiers » fonctionnent ; un fichier non connecté n'est jamais visible.
6. Un rapport généré par Arty est sauvé dans Drive et reste lisible par Arty ensuite.
7. L'écran « Fichiers connectés » liste le périmètre et le retrait local fonctionne ; le lien de révocation Google est présent.
8. Les deux gates (§8.1, §8.2) sont exécutés et leurs résultats annexés.
9. Audit RÈGLE 6 coché dans la PR pour `functions/api/drive/action.ts`.

---

## 11. Découpage en PRs et estimation

| PR | Contenu | Estimation |
|---|---|---|
| PR-A1 | A2 + A3 + A4 (triggers, échec explicite, system prompt/brief/demo/hygiène) — aucun changement de scope | 1-1,5 j |
| PR-A2 | A1 lien direct sous flag + matrice manuelle | 0,5-1 j |
| PR-B1 | Scopes `drive.file` (web+Android) + spike fulltext + proxy réduit + tests parité | 1 j |
| PR-B2 | Picker web + registre + écran Réglages + CSP | 1,5-2 j |
| PR-B3 | Outils LLM réintroduits + system prompt « fichiers connectés » + routage | 1-1,5 j |
| PR-B4 | Gate WebView Android + issue retenue | 1 j |
| PR-C (optionnel) | « Ouvrir avec Arty » | 1 j |

Ordre : PR-A1 → PR-A2 (valeur immédiate, zéro risque scope) puis PR-B1 → PR-B4. Chaque PR passe `tsc`, la suite complète, et l'audit RÈGLE 6 quand un endpoint est touché.

---

## 12. Risques et questions ouvertes

| Risque | Sévérité | Mitigation |
|---|---|---|
| Le format `#search/` casse (non contractuel) | Moyen | Copie toujours faite avant ; repli racine automatique ; flag OFF en un déploiement |
| Le Picker ne se rend pas en WebView APK | Moyen | Gate 8.2 + deux replis définis ; livraison web-first |
| `fullText contains` décevant sous `drive.file` | Moyen | Spike 8.1 avant promesse ; repli `name contains` |
| Consentement `drive.file` au login jugé intrusif | Faible | Libellé Google minimal ; alternative (consentement incrémental au premier usage) documentée comme évolution si retours négatifs |
| Confusion utilisateur « pourquoi Arty ne voit pas ce fichier ? » | Élevé (UX) | Pédagogie systématique du modèle « fichiers connectés » (DRV-P1-06), écran Réglages, réponse LLM standardisée |
| Re-consentement des users Phase 0 | Faible | Peu d'utilisateurs Phase 0 (flag OFF par défaut) ; message dédié |

**Questions ouvertes pour le décideur** :
1. Consentement `drive.file` au login (proposé) ou incrémental au premier clic « Connecter » (plus propre mais second flux OAuth à construire) ?
2. `create_drive_file` avec confirmation systématique (proposé) ou silencieux comme avant ?
3. GO/NO-GO sur le P2 « Ouvrir avec Arty » dans cette phase ou plus tard ?
