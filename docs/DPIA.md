# DPIA — Analyse d'impact relative à la protection des données — Arty

**Date :** 10 juillet 2026
**Version :** 1 (archive de l'ancien périmètre Gmail/Drive)
**Statut : ARCHIVÉ / SUPERSEDED le 13 juillet 2026. À ne pas utiliser comme état actuel du produit.**
**Responsable de traitement :** Florent Pollet, personne physique, 884 chemin de la Prairie, 38270 Beaufort, France — flotellop@gmail.com. SIREN à ajouter dès l'enregistrement de l'activité (avant lancement public et premiers paiements).

> Ce document est le pendant interne (registre art. 35 RGPD) de la politique de
> confidentialité publique (`PRIVACY.md`, en ligne sur `tryarty.com/privacy`).
> En cas de divergence, **`PRIVACY.md` fait foi** : ce DPIA doit être réaligné dessus.

> ⚠️ L'application publique n'accède plus à Gmail ni au Drive global. Elle
> traite un email uniquement lorsque l'utilisateur colle, joint ou partage son
> contenu. Le profil OAuth actif est limité à l'identité et à Calendar, sans
> scope restreint. Voir [`PLAY-STORE-SUBMISSION.md`](../PLAY-STORE-SUBMISSION.md)
> et [`PRIVACY.md`](../PRIVACY.md). Une nouvelle version du DPIA devra repartir
> de ce périmètre ; les sections ci-dessous restent un historique, pas une
> instruction d'architecture ou de configuration.

---

## 1. Pourquoi une DPIA

Arty connecte le compte Google de l'utilisateur (Gmail, Drive, Calendar, Contacts) et
traite des contenus de messagerie et de fichiers via des modèles d'IA. Trois critères
de la liste CNIL sont réunis (traitement de données à grande échelle, données
potentiellement sensibles issues de boîtes mail/fichiers, scopes Google « Restricted »).
**Une DPIA est donc requise au titre de l'article 35 RGPD avant lancement public large.**

---

## 2. Description du traitement

### 2.1 Finalités

1. **Compte & authentification** : connexion Google, identification, session.
2. **Assistant IA** : génération de réponses, synthèse, rédaction, extraction, planification.
3. **Connecteurs Google** (sur demande explicite de l'utilisateur) :
   - **Gmail** : lecture/recherche/synthèse, préparation et envoi d'e-mails, modification de labels/statut, corbeille.
   - **Drive** : recherche, lecture et exploitation de fichiers dans les réponses.
   - **Calendar** : lecture et gestion d'événements.
   - **Contacts** : identification de destinataires et contexte.
   - **Sheets** : ajout de lignes ponctuel (voir réserve §6 — scope non déclaré).
4. **Mémoire structurée** : faits utiles mémorisés pour personnaliser l'assistant (table D1 `memory`, par catégorie : profil/clients/projets/notes).
5. **Quotas, facturation, abonnements** : suivi d'usage, statut d'abonnement, paiement via Lemon Squeezy et packs de crédits via Creem.
6. **Sécurité / anti-abus** : anti-CSRF, rate-limit, logs techniques.
7. **Support & droits RGPD**.

### 2.2 Base légale (art. 6 RGPD)

| Traitement | Base légale |
|---|---|
| Compte, authentification, fourniture du service | 6(1)(b) exécution du contrat |
| Accès Google via OAuth | 6(1)(a) consentement (OAuth, révocable) + 6(1)(b) contrat |
| Traitement IA de contenus Gmail/Drive/Calendar/Contacts | 6(1)(b) — action demandée par l'utilisateur |
| Réponses géolocalisées | 6(1)(a) consentement (localisation activée par l'utilisateur) |
| Facturation, comptabilité | 6(1)(c) obligation légale + 6(1)(b) |
| Logs de sécurité, anti-abus | 6(1)(f) intérêt légitime |
| Waitlist pré-lancement | 6(1)(a) consentement (formulaire Tally) |

### 2.3 Catégories de données

- **Compte** : email Google, nom, photo de profil (`userinfo.email`, `userinfo.profile`), plan/statut d'abonnement, quotas.
- **Jetons OAuth Google** : access token, refresh token, expiration ; `state` anti-CSRF.
- **Contenus utilisateur** : messages, fichiers et pièces jointes envoyés à l'assistant.
- **Données Google Workspace** (selon connecteurs activés) : corps et métadonnées d'e-mails, fichiers Drive, événements Calendar, contacts.
- **Données IA** : prompts, réponses, extraits transmis aux modèles.
- **Mémoire structurée D1** : faits/préférences par catégorie.
- **Localisation** : position approximative (GPS, si activée).
- **Paiement** : email du compte, offre ou pack choisi, identifiants et statut de transaction/abonnement (pas de coordonnées bancaires côté Arty).

### 2.4 Où vivent les données (architecture réelle — point clé)

| Donnée | Stockage | Chiffrement |
|---|---|---|
| Conversations & pièces jointes | **Appareil de l'utilisateur uniquement** (IndexedDB/localStorage) | AES-256-GCM (Web Crypto), clé dérivée localement (PBKDF2 600k), ne quitte jamais l'appareil |
| Rapports générés | **Appareil uniquement** (localStorage) | AES-256-GCM |
| Clés API personnelles (BYOK) | **Appareil uniquement** (localStorage) ; transit ponctuel par le proxy API | Aucun chiffrement applicatif au repos ; HTTPS en transit ; aucune persistance ni journalisation côté serveur Arty |
| Jetons OAuth Google | **Appareil uniquement** (localStorage) ; transit ponctuel pour authentifier les appels | AES-256-GCM au repos ; aucune persistance ni journalisation côté serveur Arty |
| Identités et sessions email | Serveur Cloudflare D1 | Jetons de session stockés sous forme de hash |
| Mémoire structurée (table `memory`) | Serveur Cloudflare D1, clé = email vérifié | — |
| Conversations partagées et signalements volontaires | Serveur Cloudflare D1 | — |
| Facturation, wallet, quotas et compteurs techniques | Cloudflare D1/KV | — |
| Clés API serveur (du propriétaire) | Secrets Cloudflare Workers, **jamais exposées au client** | — |

Les jetons Google, les clés BYOK et le contenu courant des requêtes IA transitent par les endpoints Cloudflare nécessaires, sans persistance ni journalisation applicative côté Arty. Le contenu des conversations et les pièces jointes restent sur l'appareil, sauf conversation partagée ou signalement soumis volontairement par l'utilisateur.

---

## 3. Flux de données et transferts hors UE

1. Utilisateur → app Arty (PWA / Capacitor Android).
2. App → OAuth Google (consentement) → `/api/auth/token` & `/api/auth/refresh` (échange/renouvellement de jetons).
3. App/backend → APIs Google (Gmail, Drive, Calendar, Contacts) via endpoints Cloudflare.
4. Cloudflare Pages Functions → modèles d'IA (proxys serveur) selon routage (`aiRouter` : Gemini par défaut, Claude pour données privées, Mistral en mode UE-only).
5. Cloudflare D1/KV : identités/sessions email, mémoire structurée explicite, partages/signalements volontaires, facturation/wallet, quotas et compteurs techniques. Les jetons OAuth Google n'y sont pas persistés.
6. App/Cloudflare ↔ Lemon Squeezy et Creem : pages de paiement puis webhooks signés. Pour Creem, Arty transmet uniquement l'email Google vérifié, le produit/pack choisi, un identifiant de requête aléatoire et l'URL de retour ; les coordonnées bancaires sont saisies directement chez Creem.

**Sous-traitants (art. 28) — alignés sur `PRIVACY.md` :**

| Prestataire | Rôle | Localisation | Garantie |
|---|---|---|---|
| Cloudflare | Hébergement Workers/Pages/D1/KV, proxy, CDN | UE + monde | SCC + DPA |
| Anthropic (Claude) | Génération IA | États-Unis | SCC + EU-US DPF |
| OpenAI | Génération IA (selon modèle) | États-Unis | SCC + EU-US DPF |
| Google (Gemini + Workspace) | Génération IA + connecteurs Gmail/Drive/Calendar/Contacts | UE + États-Unis | SCC + EU-US DPF |
| Mistral AI | Génération IA | France (UE) | Hébergement UE |
| Lemon Squeezy | Paiement (Merchant of Record) | États-Unis | SCC + EU-US DPF, PCI-DSS |
| Creem | Merchant of Record et paiement hébergé des packs de crédits | Estonie (UE) | RGPD, DPA Creem ; SCC pour ses sous-traitants hors EEE |
| Resend | E-mails transactionnels | UE | DPA |
| Tally | Formulaire waitlist | UE | DPA |

**Transferts hors EEE** (Anthropic, OpenAI, Google US, Lemon Squeezy, CDN Cloudflare) : couverts par SCC 2021/914 + EU-US Data Privacy Framework. Mesure de minimisation : routage Mistral (UE) disponible pour les données sensibles via le mode UE-only.

---

## 4. Nécessité et proportionnalité

- **Minimisation** : les jetons Google et BYOK ne sont pas persistés côté serveur. La persistance serveur est limitée aux identités/sessions email, mémoire explicite, partages/signalements volontaires, facturation/wallet et compteurs techniques ; le reste du contenu demeure sur l'appareil.
- **Réserve majeure — scopes Google trop larges** (voir aussi `docs/GOOGLE_OAUTH_VERIFICATION.md`) : `drive` (accès complet) et le doublon `calendar` + `calendar.events` dépassent le strict nécessaire. À réduire avant soumission Google.
- **Consentement IA** : l'utilisateur déclenche chaque action ; afficher clairement, avant connexion, quels connecteurs Google sont demandés.

---

## 5. Analyse des risques

Gravité (G) et vraisemblance (V) de 1 (faible) à 4 (très élevée). Risque brut = G×V. Résiduel = après mesures.

| Risque | G | V | Brut | Mesures (existantes / à faire) | Résiduel |
|---|--:|--:|--:|---|--:|
| Vol de jeton OAuth → accès e-mails/fichiers | 4 | 3 | 12 | `state` anti-CSRF, jeton chiffré côté client, transit sans persistance serveur, révocation, CSP (`public/_headers`) | 6 |
| Surcollecte via scopes larges (`drive`, `calendar`, `contacts`) | 4 | 4 | 16 | **À faire** : réduire les scopes, consentement granulaire | 8 |
| Transmission de contenus à un LLM hors UE | 4 | 3 | 12 | SCC + DPF, routage Mistral UE pour données sensibles, minimisation des prompts ; **à faire** : no-training/zero-retention contractuel | 7 |
| Envoi / corbeille Gmail non souhaité (action automatisée) | 4 | 2 | 8 | **À faire** : confirmation explicite avant envoi/modif/corbeille, journal d'actions | 4 |
| Fuite de clés BYOK (accès local, sauvegarde appareil ou XSS) | 4 | 3 | 12 | Existant : isolation applicative du système, HTTPS, transit proxy sans persistance ni journalisation, suppression au logout. **À faire** : chiffrement au repos avec une `CryptoKey` non extractible ou le keystore natif, avec migration non destructive. | 8 tant que le chiffrement dédié n'est pas déployé |
| Hallucination IA → décision préjudiciable | 3 | 3 | 9 | Avertissements UX, validation humaine avant action ; **à faire** : clause CGU (pas de conseil juridique/médical/financier) | 5 |
| Non-conformité OAuth Restricted Scopes | 4 | 4 | 16 | **À faire** : vérification OAuth Google + CASA Tier 2 (voir doc dédié) | 8 (jusqu'à validation) |
| Abus / relais anonyme du proxy IA | 3 | 2 | 6 | `verifyGoogleUser` (token vérifié), whitelist `ALLOWED_EMAILS`, origin strict, rate-limit 60/min/IP | 3 |
| Conservation excessive de la mémoire structurée | 3 | 2 | 6 | **À faire** : panneau mémoire (consultation/suppression/export), purge | 3 |

---

## 6. Mesures techniques

### 6.1 Existant (vérifié dans le code)

- Chiffrement local AES-256-GCM (Web Crypto), clé dérivée PBKDF2 600k itérations (`src/services/crypto.ts`) pour conversations, pièces jointes, rapports et jetons Google.
- Clés BYOK stockées dans le `localStorage` du compte sans chiffrement applicatif ; elles transitent via le header `x-api-key` du proxy uniquement pour l'appel fournisseur, sans persistance ni journalisation côté serveur Arty.
- Clés IA serveur conservées dans les secrets Cloudflare Workers, jamais exposées au client.
- `verifyGoogleUser` (vérification du token Google côté serveur) + whitelist `ALLOWED_EMAILS` sur le proxy IA.
- Middleware : CORS origines strictes (égalité, pas `startsWith`), rate-limit 60/min/IP, CSRF par `Origin`, exemption webhook authentifiée par HMAC.
- CSP + en-têtes de sécurité dans `public/_headers`.
- Webhook Lemon Squeezy : signature HMAC-SHA256 vérifiée (`functions/api/webhook/lemonsqueezy.ts`).
- Rendu Markdown durci par `rehype-sanitize` (anti-XSS).
- `state` OAuth anti-CSRF vérifié côté `OAuthCallback`.

### 6.2 À mettre en place avant lancement public

1. **Chiffrer les clés BYOK au repos** avec une `CryptoKey` non extractible et, sur natif, le keystore du système ; prévoir une migration non destructive et un mécanisme de récupération explicite.
2. **Réduire les scopes Google** : `drive` → `drive.readonly`/`drive.file` ; conserver un seul scope Calendar ; justifier ou différer `contacts`.
3. **Consentement granulaire** affiché avant connexion Google.
4. **Confirmation explicite** avant toute action Gmail send/modify/corbeille et toute écriture Calendar/Drive.
5. **Journal d'activité utilisateur** (action, date, connecteur).
6. **Panneau mémoire** : consultation, suppression unitaire, export, purge.
7. **Suppression de compte** : flux complet (identités/sessions email, mémoire, partages/signalements) sous 30 jours.
8. **No-training / zero-retention** contractualisé chez les fournisseurs IA quand disponible.
9. **Plan d'incident RGPD 72 h** (détection, qualification, notification CNIL/personnes).

---

## 7. Mesures organisationnelles

- Registre des traitements tenu à jour.
- DPA signés et archivés avec Cloudflare, Google, Anthropic, Mistral, OpenAI, Lemon Squeezy, Creem, Resend, Tally.
- Transfer Impact Assessment (TIA) pour chaque transfert hors UE.
- Support : ne jamais demander de refresh token ni de clé BYOK en clair.
- Accès admin restreint au besoin d'en connaître.

---

## 8. Droits des personnes

Accès, rectification, effacement, limitation, opposition (intérêt légitime), portabilité, retrait du consentement (déconnexion Google), réclamation CNIL. Délai de réponse : 1 mois (prolongeable 2 mois si complexité). Contact : flotellop@gmail.com.

---

## 9. Verdict & plan d'action

**DPIA : favorable sous conditions.** L'architecture (contenu principal chiffré côté appareil, persistance serveur limitée) est un atout, mais l'absence actuelle de chiffrement applicatif des clés BYOK maintient un risque résiduel important. Les autres risques significatifs sont concentrés sur **les scopes Google trop larges** et **la conformité OAuth Restricted**.

Actions prioritaires avant lancement public :
1. Chiffrer les clés BYOK au repos avec une clé non extractible/keystore et migrer les installations existantes sans perte.
2. Réduire les scopes Google et soumettre la vérification OAuth (voir `docs/GOOGLE_OAUTH_VERIFICATION.md`).
3. Ajouter confirmation explicite + journal pour les actions Gmail/Calendar/Drive.
4. Implémenter suppression/export de compte et panneau mémoire.
5. Signer/archiver DPA + SCC ; rédiger les TIA.
6. Ajouter le SIREN dès enregistrement, faire relire ce DPIA et les CGU par un conseil.
