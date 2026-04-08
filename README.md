# Facades Pollet - PWA

Assistant IA pour Facades Pollet, entreprise de ravalement a Valence (26).

PWA mobile-first connectee a l'API Anthropic (Claude Sonnet 4.6) avec streaming temps reel.

## Installation

```bash
npm install
```

## Configuration

Creer un fichier `.env` a la racine du projet :

```bash
cp .env.example .env
```

Editer `.env` et ajouter votre cle API Anthropic :

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

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
3. Ajouter la variable d'environnement `VITE_ANTHROPIC_API_KEY` dans les settings Vercel
4. Deployer

## Stack technique

- React 18 + TypeScript
- Vite
- Tailwind CSS
- react-markdown + remark-gfm
- API Anthropic (claude-sonnet-4-6, streaming SSE)
- PWA installable (manifest.json + service worker)

## Fonctionnalites

- Chat avec streaming token par token
- Historique des conversations (localStorage)
- Sidebar avec liste des conversations
- Rendu Markdown (gras, listes, tableaux)
- 3 suggestions rapides sur l'ecran d'accueil
- PWA installable sur iOS et Android
- Design mobile-first, responsive desktop
