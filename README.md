# Facades Pollet - PWA

Assistant IA pour Facades Pollet, entreprise de ravalement a Valence (26).

PWA mobile-first connectee a l'API Anthropic (Claude Sonnet 4.6) avec streaming temps reel, integration Gmail, Google Drive, et navigation web automatisee (Playwright).

---

## 1. Installer les dependances

```bash
git clone https://github.com/flotellop-art/Appfacade.git
cd Appfacade
npm install
```

---

## 2. Configurer la cle API Anthropic

```bash
cp .env.example .env
```

Ouvrir `.env` et remplir :

```
VITE_ANTHROPIC_API_KEY=sk-ant-api03-VOTRE-CLE-ICI
```

Pour obtenir une cle : https://console.anthropic.com/settings/keys > **Create Key**

---

## 3. Configurer Google Cloud Console (Gmail + Drive)

### 3.1 Creer un projet Google Cloud

1. Ouvrir https://console.cloud.google.com
2. En haut a gauche, cliquer sur le **selecteur de projet** (a cote du logo Google Cloud)
3. Cliquer **NOUVEAU PROJET** en haut a droite de la fenetre modale
4. Nom du projet : `Facades Pollet`
5. Cliquer **CREER**
6. Attendre quelques secondes, puis selectionner le projet dans le selecteur

### 3.2 Activer les APIs

1. Dans le menu hamburger a gauche, cliquer **APIs et services** > **Bibliotheque**
2. Dans la barre de recherche, taper `Gmail API`
3. Cliquer sur le resultat **Gmail API** (par Google)
4. Cliquer le bouton bleu **ACTIVER**
5. Revenir a la bibliotheque (fleche retour ou menu > Bibliotheque)
6. Dans la barre de recherche, taper `Google Drive API`
7. Cliquer sur le resultat **Google Drive API** (par Google)
8. Cliquer le bouton bleu **ACTIVER**

### 3.3 Configurer l'ecran de consentement OAuth

1. Dans le menu a gauche, cliquer **APIs et services** > **Ecran de consentement OAuth**
2. Selectionner **Externe** comme type d'utilisateur
3. Cliquer **CREER**
4. Remplir les champs obligatoires :
   - **Nom de l'application** : `Facades Pollet`
   - **Adresse e-mail d'assistance utilisateur** : votre adresse Gmail
   - **Adresses e-mail du developpeur** (tout en bas) : votre adresse Gmail
5. Cliquer **ENREGISTRER ET CONTINUER**
6. Sur la page **Niveaux d'acces (Scopes)** :
   - Cliquer **AJOUTER OU SUPPRIMER DES CHAMPS D'APPLICATION**
   - Dans le filtre, chercher et cocher :
     - `https://www.googleapis.com/auth/gmail.readonly` (Lire les emails)
     - `https://www.googleapis.com/auth/gmail.send` (Envoyer des emails)
     - `https://www.googleapis.com/auth/drive` (Google Drive complet)
     - `https://www.googleapis.com/auth/userinfo.email` (Adresse email)
     - `https://www.googleapis.com/auth/userinfo.profile` (Profil)
   - Cliquer **METTRE A JOUR**
   - Cliquer **ENREGISTRER ET CONTINUER**
7. Sur la page **Utilisateurs tests** :
   - Cliquer **+ AJOUTER DES UTILISATEURS**
   - Entrer votre adresse Gmail (celle qui utilisera l'app)
   - Cliquer **AJOUTER**
   - Cliquer **ENREGISTRER ET CONTINUER**
8. Verifier le resume, puis cliquer **RETOUR AU TABLEAU DE BORD**

### 3.4 Creer les identifiants OAuth 2.0

1. Dans le menu a gauche, cliquer **APIs et services** > **Identifiants**
2. En haut, cliquer **+ CREER DES IDENTIFIANTS**
3. Selectionner **ID client OAuth**
4. Remplir :
   - **Type d'application** : `Application Web`
   - **Nom** : `Facades Pollet PWA`
5. Dans la section **URI de redirection autorises**, cliquer **+ AJOUTER UN URI** :
   - Ajouter : `http://localhost:5173/auth/callback`
   - Cliquer **+ AJOUTER UN URI** a nouveau
   - Ajouter : `https://VOTRE-DOMAINE.vercel.app/auth/callback`
     (remplacer `VOTRE-DOMAINE` par votre vrai domaine Vercel)
6. Cliquer **CREER**
7. Une fenetre modale affiche votre **ID client** et votre **Code secret du client**
8. Copier ces deux valeurs dans votre `.env` :

```
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
```

### 3.5 Configurer l'URI de redirection

Dans `.env`, ajouter :

```
# Developpement local
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback

# OU pour la production Vercel (changer selon votre domaine)
# VITE_GOOGLE_REDIRECT_URI=https://VOTRE-DOMAINE.vercel.app/auth/callback
```

### 3.6 Fichier .env complet

```env
# Anthropic
VITE_ANTHROPIC_API_KEY=sk-ant-api03-VOTRE-CLE

# Google OAuth (cote client — visible dans le navigateur)
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback

# Google OAuth (cote serveur — JAMAIS expose au navigateur)
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# WordPress (cote serveur)
WP_URL=https://facadespollet.fr
WP_USERNAME=votre-login-wp
WP_PASSWORD=votre-mot-de-passe-wp
```

> **Important** : `GOOGLE_CLIENT_SECRET` n'a PAS de prefixe `VITE_`.
> Il est uniquement utilise par les Vercel Serverless Functions (`/api/`),
> jamais dans le code client React.

---

## 4. Lancer en local

```bash
npm run dev
```

L'application est accessible sur http://localhost:5173

> **Note** : les fonctions serverless (`/api/`) ne fonctionnent qu'en
> production sur Vercel. En local, l'OAuth Google ne sera pas fonctionnel
> sauf si vous utilisez `vercel dev` a la place de `npm run dev`.

Pour tester l'OAuth en local avec les serverless functions :

```bash
npm i -g vercel
vercel dev
```

---

## 5. Deployer sur Vercel

### 5.1 Connecter le repo

1. Aller sur https://vercel.com/new
2. Cliquer **Import** a cote de votre repo `Appfacade`
3. Framework Preset : **Vite** (detecte automatiquement)

### 5.2 Ajouter les variables d'environnement

Dans les settings du projet avant de deployer (ou apres dans Settings > Environment Variables) :

| Variable | Valeur | Environnement |
|----------|--------|---------------|
| `VITE_ANTHROPIC_API_KEY` | `sk-ant-api03-...` | Production |
| `VITE_GOOGLE_CLIENT_ID` | `123...apps.googleusercontent.com` | Production |
| `VITE_GOOGLE_REDIRECT_URI` | `https://VOTRE-DOMAINE.vercel.app/auth/callback` | Production |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | Production |
| `WP_URL` | `https://facadespollet.fr` | Production |
| `WP_USERNAME` | login WordPress | Production |
| `WP_PASSWORD` | mot de passe WordPress | Production |

### 5.3 Deployer

Cliquer **Deploy**. Le build prend environ 30 secondes.

### 5.4 Verifier

1. Ouvrir l'URL Vercel sur mobile
2. Cliquer **Connecter Google** sur l'ecran d'accueil
3. Autoriser l'application
4. Verifier que l'indicateur passe a "Google connecte"
5. Taper "Lire mes emails" dans le chat
6. Taper "Chercher un fichier Drive" dans le chat

---

## Stack technique

- React 18 + TypeScript
- Vite + Vercel Serverless Functions
- Tailwind CSS
- react-markdown + remark-gfm
- API Anthropic (claude-sonnet-4-6, streaming SSE)
- Google OAuth 2.0 + Gmail API + Google Drive API
- Playwright + @sparticuz/chromium (navigation web headless sur Vercel)
- PWA installable (manifest.json + service worker)

---

## Fonctionnalites

### Phase 1 — Chat IA
- Chat avec streaming token par token
- Historique des conversations (localStorage)
- Sidebar avec liste des conversations
- Rendu Markdown (gras, listes, tableaux)
- Suggestions rapides sur l'ecran d'accueil
- PWA installable sur iOS et Android
- Design mobile-first, responsive desktop

### Phase 3 — Gmail + Google Drive + Google Calendar + Google Contacts
- Connexion OAuth Google (bouton sur l'ecran d'accueil)
- Indicateur "Google connecte" / "Non connecte"
- Lecture des 10 derniers emails non lus
- Affichage en cartes structurees (expediteur, objet, extrait)
- Envoi d'email avec double confirmation obligatoire
- Liste des fichiers Google Drive
- Lecture du contenu des Google Docs et fichiers texte
- Creation de nouveaux documents sur Drive
- **Google Calendar** : lister / creer / modifier / supprimer des RDV (via outils Claude)
- **Google Contacts** : rechercher et creer des contacts (People API)
- Apercu agenda 7 jours directement sur l'ecran d'accueil (CalendarView)
- Bandeaux d'action dans le chat ("Lecture emails...", "Acces Drive...")
- System prompt enrichi avec contexte Gmail/Drive
- Suggestions contextuelles ("Lire mes mails", "Agenda de la semaine", "Planifie un RDV demain")
- Routage IA : toute requete agenda/contacts est forcee vers Claude (seul modele avec outils)

### Phase 4 — Navigation web automatisee (Playwright)
- Publication WordPress sur facadespollet.fr (avec confirmation obligatoire)
- Recherche prix fournisseurs (Point P, Gedimat) avec tableau comparatif
- Remplissage automatique de formulaires en ligne
- Capture d'ecran de pages web
- Bandeau anime dans le chat pendant la navigation
- Detection automatique de CAPTCHA (arret + notification)
- Toute soumission requiert une confirmation explicite de Florent

---

## Securite

- **Aucune cle API payante cote client** — jamais de `VITE_*_API_KEY` pour Anthropic/Gemini/Mistral.
  Les cles serveur restent dans Cloudflare Pages env (sans prefixe `VITE_`) et sont utilisees
  uniquement par les proxys (`functions/api/ai/*.ts`).
- **Whitelist emails `ALLOWED_EMAILS`** + verification du token Google via `checkAllowedUser()`
  avant tout usage d'une cle serveur (les utilisateurs non whitelistes doivent passer leur propre
  cle BYOK).
- **Chiffrement AES-256-GCM au repos** (Web Crypto API) pour les tokens Google, les cles BYOK
  et les conversations. Cle derivee via PBKDF2 100k iterations a partir de la cle Anthropic.
  `initCrypto()` est appele au boot dans `App.tsx` + `useAuth`.
- **Tokens Google** : chiffres dans localStorage sous `google-tokens-enc`, cache en memoire
  apres decryption pour conserver la lecture synchrone (voir `bootstrapGoogleStorage()`).
- **`getValidAccessToken()`** systematique pour le header `x-google-token` — rafraichit
  automatiquement avant expiration (bug 23).
- **CORS/CSRF** : origines whitelistees dans `functions/api/_middleware.ts`.
- **XSS** : `rehype-sanitize` actif sur tout rendu markdown.
- **Sourcemaps desactives** en production (`vite.config.ts` → `build.sourcemap = false`).
- Aucun email envoye, aucun RDV cree, aucune publication WordPress sans confirmation explicite.
- Detection automatique de CAPTCHA et arret immediat.

---

## Architecture des API routes (Cloudflare Pages Functions)

```
functions/api/
├── _lib/
│   └── checkAllowedUser.ts  # Whitelist email + verif token Google (oauth2/v2/userinfo)
├── _middleware.ts           # CORS/CSRF whitelist d'origines
├── ai/
│   ├── proxy.ts             # Proxy Anthropic (clé serveur ou BYOK)
│   ├── gemini-proxy.ts      # Proxy Gemini
│   └── mistral-proxy.ts     # Proxy Mistral EU
├── auth/
│   ├── token.ts             # Echange code OAuth → access_token + refresh_token
│   └── refresh.ts           # Rafraichit un access_token expire
├── gmail/action.ts          # list / read / send / search / archive / delete / star / draft / label
├── drive/action.ts          # list / read / create (+ OCR via GOOGLE_VISION_API_KEY)
├── calendar/action.ts       # list / create / update / delete (Google Calendar v3)
├── contacts/action.ts       # search / create / update (People API v1)
├── browser/action.ts        # Playwright — recherche prix / screenshot / fill-form
├── wordpress/publish.ts     # Publication WordPress (avec confirmation)
├── computer/action.ts       # Outils Claude computer use
└── memory/action.ts         # Memoire long-terme (D1)
```

## Clients TypeScript cote navigateur

```
src/services/
├── anthropicClient.ts    # Streaming SSE Claude (via proxy CF)
├── geminiClient.ts       # Gemini (web_search + google_maps)
├── mistralClient.ts      # Mistral EU
├── gmailClient.ts        # list / read / send → /api/gmail/action
├── driveClient.ts        # list / read / create → /api/drive/action
├── calendarClient.ts     # list / create / update / delete → /api/calendar/action
├── contactsClient.ts     # search / create / update → /api/contacts/action
├── googleAuth.ts         # OAuth + tokens chiffres (bootstrapGoogleStorage)
├── crypto.ts             # AES-256-GCM + PBKDF2 (Web Crypto)
└── aiRouter.ts           # Route agenda/contacts/private → Claude, web → Gemini, report → hybrid
```
