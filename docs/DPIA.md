# DPIA — Analyse d'impact relative à la protection des données — Arty

**Date :** 24 mai 2026
**Version :** 1 (document de travail)
**Statut :** À faire valider par un conseil juridique avant lancement public à grande échelle.
**Responsable de traitement :** Florent Pollet, personne physique, 884 chemin de la Prairie, 38270 Beaufort, France — flotellop@gmail.com. SIREN à ajouter dès l'enregistrement de l'activité (avant lancement public et premiers paiements).

> Ce document est le pendant interne (registre art. 35 RGPD) de la politique de
> confidentialité publique (`PRIVACY.md`, en ligne sur `tryarty.com/privacy`).
> En cas de divergence, **`PRIVACY.md` fait foi** : ce DPIA doit être réaligné dessus.

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
5. **Quotas, facturation, abonnements** : suivi d'usage, statut d'abonnement, paiement via Lemon Squeezy.
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
- **Paiement** : email + identifiants de transaction/abonnement (pas de coordonnées bancaires côté Arty).

### 2.4 Où vivent les données (architecture réelle — point clé)

| Donnée | Stockage | Chiffrement |
|---|---|---|
| Conversations & pièces jointes | **Appareil de l'utilisateur uniquement** (IndexedDB/localStorage) | AES-256-GCM (Web Crypto), clé dérivée localement (PBKDF2 600k), ne quitte jamais l'appareil |
| Clés API personnelles (BYOK) | **Appareil uniquement** (localStorage) | **Aucun chiffrement at-rest à ce jour** (JSON clair sous la sandbox OS de la WebView — voir CLAUDE.md BUG 1) ; **à faire** : chantier `CryptoKey` non-extractible (F-34). Transit proxy sans stockage ni journalisation |
| Email d'authentification + jeton OAuth Google | Serveur (Cloudflare) | Secrets/Workers |
| Mémoire structurée (table `memory`) | Serveur Cloudflare D1, clé = email vérifié | — |
| Quotas / abonnements | Cloudflare D1/KV | — |
| Clés API serveur (du propriétaire) | Secrets Cloudflare Workers, **jamais exposées au client** | — |

**Le serveur ne stocke jamais le contenu des conversations, les pièces jointes ni les clés BYOK.**
Les requêtes IA transitent par des proxys serveur (`functions/api/ai/*`) qui relaient sans conserver le contenu au-delà du traitement.

---

## 3. Flux de données et transferts hors UE

1. Utilisateur → app Arty (PWA / Capacitor Android).
2. App → OAuth Google (consentement) → `/api/auth/token` & `/api/auth/refresh` (échange/renouvellement de jetons).
3. App/backend → APIs Google (Gmail, Drive, Calendar, Contacts) via endpoints Cloudflare.
4. Cloudflare Pages Functions → modèles d'IA (proxys serveur) selon routage (`aiRouter` : Gemini par défaut, Claude pour données privées, Mistral en mode UE-only).
5. Cloudflare D1/KV : email d'auth, jeton OAuth, mémoire structurée, quotas.
6. Cloudflare → Lemon Squeezy : webhooks de paiement (signature HMAC vérifiée).

**Sous-traitants (art. 28) — alignés sur `PRIVACY.md` :**

| Prestataire | Rôle | Localisation | Garantie |
|---|---|---|---|
| Cloudflare | Hébergement Workers/Pages/D1/KV, proxy, CDN | UE + monde | SCC + DPA |
| Anthropic (Claude) | Génération IA | États-Unis | SCC + EU-US DPF |
| OpenAI | Génération IA (selon modèle) | États-Unis | SCC + EU-US DPF |
| Google (Gemini + Workspace) | Génération IA + connecteurs Gmail/Drive/Calendar/Contacts | UE + États-Unis | SCC + EU-US DPF |
| Mistral AI | Génération IA | France (UE) | Hébergement UE |
| Lemon Squeezy | Paiement (Merchant of Record) | États-Unis | SCC + EU-US DPF, PCI-DSS |
| Resend | E-mails transactionnels | UE | DPA |
| Tally | Formulaire waitlist | UE | DPA |

**Transferts hors EEE** (Anthropic, OpenAI, Google US, Lemon Squeezy, CDN Cloudflare) : couverts par SCC 2021/914 + EU-US Data Privacy Framework. Mesure de minimisation : routage Mistral (UE) disponible pour les données sensibles via le mode UE-only.

---

## 4. Nécessité et proportionnalité

- **Minimisation** : le serveur ne conserve que l'email + le jeton OAuth ; le contenu reste sur l'appareil. C'est un point fort structurel.
- **Réserve majeure — scopes Google trop larges** (voir aussi `docs/GOOGLE_OAUTH_VERIFICATION.md`) : `drive` (accès complet) et le doublon `calendar` + `calendar.events` dépassent le strict nécessaire. À réduire avant soumission Google.
- **Consentement IA** : l'utilisateur déclenche chaque action ; afficher clairement, avant connexion, quels connecteurs Google sont demandés.

---

## 5. Analyse des risques

Gravité (G) et vraisemblance (V) de 1 (faible) à 4 (très élevée). Risque brut = G×V. Résiduel = après mesures.

| Risque | G | V | Brut | Mesures (existantes / à faire) | Résiduel |
|---|--:|--:|--:|---|--:|
| Vol de jeton OAuth → accès e-mails/fichiers | 4 | 3 | 12 | `state` anti-CSRF, jeton chiffré côté client, stockage serveur minimal, révocation, CSP (`public/_headers`) | 6 |
| Surcollecte via scopes larges (`drive`, `calendar`, `contacts`) | 4 | 4 | 16 | **À faire** : réduire les scopes, consentement granulaire | 8 |
| Transmission de contenus à un LLM hors UE | 4 | 3 | 12 | SCC + DPF, routage Mistral UE pour données sensibles, minimisation des prompts ; **à faire** : no-training/zero-retention contractuel | 7 |
| Envoi / corbeille Gmail non souhaité (action automatisée) | 4 | 2 | 8 | **À faire** : confirmation explicite avant envoi/modif/corbeille, journal d'actions | 4 |
| Fuite de clés BYOK | 4 | 2 | 8 | Stockage restreint à l'appareil (sandbox OS), jamais stockées côté serveur, non-journalisation ; **à faire** : chiffrement at-rest (chantier `CryptoKey` non-extractible, F-34) | 6 (4 après F-34) |
| Hallucination IA → décision préjudiciable | 3 | 3 | 9 | Avertissements UX, validation humaine avant action ; **à faire** : clause CGU (pas de conseil juridique/médical/financier) | 5 |
| Non-conformité OAuth Restricted Scopes | 4 | 4 | 16 | **À faire** : vérification OAuth Google + CASA Tier 2 (voir doc dédié) | 8 (jusqu'à validation) |
| Abus / relais anonyme du proxy IA | 3 | 2 | 6 | `verifyGoogleUser` (token vérifié), whitelist `ALLOWED_EMAILS`, origin strict, rate-limit 60/min/IP | 3 |
| Conservation excessive de la mémoire structurée | 3 | 2 | 6 | **À faire** : panneau mémoire (consultation/suppression/export), purge | 3 |

---

## 6. Mesures techniques

### 6.1 Existant (vérifié dans le code)

- Chiffrement local AES-256-GCM (Web Crypto), clé dérivée PBKDF2 600k itérations (`src/services/crypto.ts`) — couvre conversations, pièces jointes, tokens Google et mémoire locale ; **ne couvre pas** le blob `api-keys` (clés BYOK), stocké en clair (voir §2.4 et chantier F-34).
- Conversations/pièces jointes/clés BYOK **jamais stockées** côté serveur (les requêtes IA et les clés BYOK transitent par les proxys sans être conservées ni journalisées).
- Proxys serveur pour toutes les clés IA (jamais exposées au client) ; BYOK via header `x-api-key`.
- `verifyGoogleUser` (vérification du token Google côté serveur) + whitelist `ALLOWED_EMAILS` sur le proxy IA.
- Middleware : CORS origines strictes (égalité, pas `startsWith`), rate-limit 60/min/IP, CSRF par `Origin`, exemption webhook authentifiée par HMAC.
- CSP + en-têtes de sécurité dans `public/_headers`.
- Webhook Lemon Squeezy : signature HMAC-SHA256 vérifiée (`functions/api/webhook/lemonsqueezy.ts`).
- Rendu Markdown durci par `rehype-sanitize` (anti-XSS).
- `state` OAuth anti-CSRF vérifié côté `OAuthCallback`.

### 6.2 À mettre en place avant lancement public

1. **Réduire les scopes Google** : `drive` → `drive.readonly`/`drive.file` ; conserver un seul scope Calendar ; justifier ou différer `contacts`.
2. **Consentement granulaire** affiché avant connexion Google.
3. **Confirmation explicite** avant toute action Gmail send/modify/corbeille et toute écriture Calendar/Drive.
4. **Journal d'activité utilisateur** (action, date, connecteur).
5. **Panneau mémoire** : consultation, suppression unitaire, export, purge.
6. **Suppression de compte** : flux complet (email + jeton serveur, mémoire D1) sous 30 jours.
7. **No-training / zero-retention** contractualisé chez les fournisseurs IA quand disponible.
8. **Plan d'incident RGPD 72 h** (détection, qualification, notification CNIL/personnes).

---

## 7. Mesures organisationnelles

- Registre des traitements tenu à jour.
- DPA signés et archivés avec Cloudflare, Google, Anthropic, Mistral, OpenAI, Lemon Squeezy, Resend, Tally.
- Transfer Impact Assessment (TIA) pour chaque transfert hors UE.
- Support : ne jamais demander de refresh token ni de clé BYOK en clair.
- Accès admin restreint au besoin d'en connaître.

---

## 8. Droits des personnes

Accès, rectification, effacement, limitation, opposition (intérêt légitime), portabilité, retrait du consentement (déconnexion Google), réclamation CNIL. Délai de réponse : 1 mois (prolongeable 2 mois si complexité). Contact : flotellop@gmail.com.

---

## 9. Verdict & plan d'action

**DPIA : favorable sous conditions.** L'architecture (contenu chiffré côté appareil, serveur minimal) est un atout fort. Les risques résiduels significatifs sont concentrés sur **les scopes Google trop larges** et **la conformité OAuth Restricted**.

Actions prioritaires avant lancement public :
1. Réduire les scopes Google et soumettre la vérification OAuth (voir `docs/GOOGLE_OAUTH_VERIFICATION.md`).
2. Ajouter confirmation explicite + journal pour les actions Gmail/Calendar/Drive.
3. Implémenter suppression/export de compte et panneau mémoire.
4. Signer/archiver DPA + SCC ; rédiger les TIA.
5. Ajouter le SIREN dès enregistrement, faire relire ce DPIA et les CGU par un conseil.
