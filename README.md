# Facades Pollet - PWA

Assistant IA pour Facades Pollet, entreprise de ravalement a Valence (26).

PWA mobile-first connectee a l'API Anthropic (Claude Sonnet 4.6) avec streaming temps reel, integration Gmail et Google Drive.

## Installation

```bash
npm install
```

## Configuration

Creer un fichier `.env` a la racine du projet :

```bash
cp .env.example .env
```

Editer `.env` :

```
# Anthropic
VITE_ANTHROPIC_API_KEY=sk-ant-...

# Google OAuth (cote client)
VITE_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback

# Google OAuth (cote serveur — NE PAS prefixer avec VITE_)
GOOGLE_CLIENT_SECRET=xxx
```

## Configurer Google Cloud Console

1. Aller sur https://console.cloud.google.com
2. Creer un nouveau projet (ex: "Facades Pollet")
3. Dans le menu lateral, aller dans **APIs & Services > Library**
4. Activer **Gmail API** : chercher "Gmail API" > cliquer > **Enable**
5. Activer **Google Drive API** : chercher "Google Drive API" > cliquer > **Enable**
6. Aller dans **APIs & Services > Credentials**
7. Cliquer **+ CREATE CREDENTIALS > OAuth client ID**
8. Si demande, configurer d'abord l'ecran de consentement OAuth :
   - User Type : **External**
   - App name : "Facades Pollet"
   - User support email : votre email
   - Scopes : ajouter `gmail.readonly`, `gmail.send`, `drive`, `userinfo.email`, `userinfo.profile`
   - Test users : ajouter votre adresse Gmail
   - Sauvegarder
9. Revenir dans Credentials > Create OAuth client ID :
   - Application type : **Web application**
   - Name : "Facades Pollet PWA"
   - Authorized redirect URIs :
     - `http://localhost:5173/auth/callback` (dev)
     - `https://votre-domaine.vercel.app/auth/callback` (prod)
   - Cliquer **Create**
10. Copier le **Client ID** et le **Client Secret** dans votre `.env`

## Lancer en local

```bash
npm run dev
```

L'application est accessible sur `http://localhost:5173`.

## Build production

```bash
npm run build
```

Les fichiers sont generes dans le dossier `dist/`.

## Deployer sur Vercel

1. Connecter le repo GitHub a Vercel
2. Framework Preset : **Vite**
3. Ajouter les variables d'environnement dans les settings Vercel :
   - `VITE_ANTHROPIC_API_KEY`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_GOOGLE_REDIRECT_URI` (= `https://votre-domaine.vercel.app/auth/callback`)
   - `GOOGLE_CLIENT_SECRET`
4. Deployer

## Stack technique

- React 18 + TypeScript
- Vite + Vercel Serverless Functions
- Tailwind CSS
- react-markdown + remark-gfm
- API Anthropic (claude-sonnet-4-6, streaming SSE)
- Google OAuth 2.0 + Gmail API + Google Drive API
- PWA installable (manifest.json + service worker)

## Fonctionnalites

### Phase 1 — Chat IA
- Chat avec streaming token par token
- Historique des conversations (localStorage)
- Sidebar avec liste des conversations
- Rendu Markdown (gras, listes, tableaux)
- Suggestions rapides sur l'ecran d'accueil
- PWA installable sur iOS et Android
- Design mobile-first, responsive desktop

### Phase 3 — Gmail + Google Drive
- Connexion OAuth Google (bouton sur l'ecran d'accueil)
- Indicateur "Google connecte" / "Non connecte"
- Lecture des 10 derniers emails non lus
- Affichage en cartes structurees (expediteur, objet, extrait)
- Envoi d'email avec double confirmation obligatoire
- Liste des fichiers Google Drive
- Lecture du contenu des Google Docs et fichiers texte
- Creation de nouveaux documents sur Drive
- Bandeaux d'action dans le chat ("Lecture emails...", "Acces Drive...")
- System prompt enrichi avec contexte Gmail/Drive
- Suggestions contextuelles ("Lire mes emails", "Chercher un fichier Drive")

### Securite
- Le `GOOGLE_CLIENT_SECRET` n'est JAMAIS expose cote client
- Les echanges OAuth passent par des Vercel Serverless Functions (`/api/`)
- Aucun email n'est envoye sans double confirmation explicite de l'utilisateur
