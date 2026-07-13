# Arty

Assistant IA personnel multi-modèles (Claude, Mistral, Gemini, OpenAI) avec
connexion Google et agenda, disponible en PWA web
([tryarty.com](https://tryarty.com)) et en application Android/iOS
(Capacitor). L'application publique n'accède pas à la boîte Gmail : pour
résumer un message ou préparer une réponse, l'utilisateur colle, joint ou
partage lui-même son contenu avec Arty.

## Architecture

| Couche | Techno | Dossier |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind | `src/` |
| Backend | Cloudflare Pages Functions (+ D1) | `functions/api/` |
| Mobile | Capacitor 8 (Android + iOS) | `android/`, `ios/` |
| Worker annexe | growth-orchestrator (projet Cloudflare Workers séparé) | `services/growth-orchestrator/` |
| Outillage local owner | serveur computer-use + tunnel | `local/` |

Le site et l'API sont déployés sur **Cloudflare Pages** (projet `appfacade`,
domaine `tryarty.com`) — le déploiement se configure dans le dashboard
Cloudflare, pas par fichier de config à la racine (voir BUG 39/40 dans
`CLAUDE.md`).

## ⚠️ Règle de sécurité n°1 — les clés API restent côté serveur

**AUCUNE clé API payante ne doit être exposée au navigateur.** Jamais de
variable `VITE_*_API_KEY` : le préfixe `VITE_` inline la valeur dans le bundle
JavaScript public. Les clés (Anthropic, Mistral, Gemini, OpenAI…) vivent dans
les variables d'environnement Cloudflare **sans** préfixe et ne sont utilisées
que par les proxys serveur (`functions/api/ai/*`). Le navigateur appelle ces
proxys, authentifié par token Google vérifié côté serveur
(`functions/api/_lib/checkAllowedUser.ts`).

Les seules variables `VITE_*` légitimes sont des identifiants publics
(ex. `VITE_GOOGLE_CLIENT_ID`). Référence complète : RÈGLE 1 de `CLAUDE.md`.

## Démarrage local

```bash
npm ci                 # .npmrc force legacy-peer-deps (requis, voir BUG 37)
npm run dev            # Vite en local (les routes /api nécessitent un déploiement CF)
npm run typecheck      # tsc sur src/ ET functions/
npm test               # vitest (obligatoire avant push — la CI le rejoue)
npm run build          # tsc + vite build (ce que Cloudflare exécute)
```

Variables d'environnement : voir `.env.example` (liste alignée sur
`functions/env.d.ts`, qui fait foi). En production, tout se configure dans le
dashboard Cloudflare Pages (Settings → Environment variables + bindings D1).

## Structure du code

- `src/services/` — clients IA (`anthropicClient`, `mistralClient`,
  `geminiClient`, `openaiClient`), routage (`aiRouter`), stockage chiffré
  (`crypto`, `scopedStorage`, `storage`), auth Google (`googleAuth`)
- `src/services/tools/` + `src/services/toolDefinitions.ts` — outils exposés
  au LLM (Drive, Calendar, WordPress, utilitaires). ⚠️ Tout nouveau
  tool doit être classé dans le test de parité HITL
  (`src/__tests__/services/toolConfirmation.test.ts`)
- `functions/api/` — endpoints serveur : proxys IA, auth OAuth/OTP, quotas,
  facturation (Creem/Lemon Squeezy), partage, mémoire D1. Toute modification
  passe l'audit RÈGLE 6 de `CLAUDE.md`
- `src/__tests__/` — suite vitest (exécutée en CI sur chaque PR)

## Publication mobile

Checklist obligatoire avant tout build Play Store : `BEFORE-PUBLISHING.md`
(+ RÈGLE 4 de `CLAUDE.md`). Distribution beta : `FIREBASE-BETA.md` et
`deploy-beta.sh` (workflow GitHub Actions `android-firebase.yml`).

## Documentation

- `CLAUDE.md` — règles de développement, sécurité, et journal des 60+ bugs
  résolus (à lire avant toute modification)
- `docs/audits/` — audits sécurité, concurrentiels et de code
- `PRIVACY.md` / `PRIVACY-EN.md` — politiques de confidentialité
- `ROADMAP.md`, `docs/arty_v2_roadmap.md` — feuille de route
