# Arty Growth Orchestrator

Worker Cloudflare qui orchestre l'équipe d'agents Arty (Growth FR v6, Content FR, Analytics) chaque dimanche à 18h UTC. Consolide leurs livrables en un digest hebdo et l'envoie par email à Florent.

## Architecture en 1 schéma

```
Dimanche 18h UTC
       │
       ▼
[Cloudflare Worker scheduled]
       │
       ├──► API Anthropic Agents : session Arty Analytics
       ├──► API Anthropic Agents : session Arty Growth FR (parallèle)
       └──► API Anthropic Agents : session Arty Content FR (parallèle)
                  │
                  ▼
       [Attente complétion, max 10 min par session]
                  │
                  ▼
       [Consolidation Markdown unique]
                  │
                  ▼
       [Conversion HTML]
                  │
                  ▼
       [POST API Resend → email à flotellop@gmail.com]
                  │
                  ▼
       Florent lit lundi matin (~5 min)
```

## Setup (à faire une fois par Florent)

### 1. Installer les dépendances

```bash
cd services/growth-orchestrator
npm install
```

### 2. Créer un compte Resend (gratuit, < 5 min)

1. Aller sur https://resend.com et créer un compte avec ton email perso
2. Dashboard → API Keys → Create API Key avec accès "Send"
3. Garder la clé sous la main pour l'étape 3

**Domaine d'envoi** : par défaut Resend impose un domaine sandbox `onresend.dev` (gratuit, sans config DNS). Pour envoyer depuis `digest@tryarty.com`, il faut valider le domaine `tryarty.com` dans Resend (ajouter 3 enregistrements DNS chez Cloudflare). Au début, change `DIGEST_FROM_EMAIL` dans `wrangler.toml` vers `onboarding@resend.dev` pour le 1er test.

### 3. Configurer les secrets Cloudflare

```bash
cd services/growth-orchestrator
npx wrangler secret put ANTHROPIC_API_KEY
# (paste ta clé API Anthropic Console)

npx wrangler secret put RESEND_API_KEY
# (paste la clé Resend de l'étape 2)
```

### 4. Déployer le Worker

```bash
npx wrangler deploy
```

Le Worker se déploie sur le compte Cloudflare de Florent. Le cron trigger `0 18 * * 0` est créé automatiquement.

### 5. Tester manuellement avant le premier dimanche

```bash
npx wrangler dev --test-scheduled
```

Puis dans un autre terminal :

```bash
curl "http://localhost:8787/__scheduled?cron=0+18+*+*+0"
```

Ça déclenche le scheduled handler en local. Tu devrais recevoir un email digest dans ta boîte (avec des contenus de test).

## Coûts

- **Cloudflare Workers** : gratuit jusqu'à 100k requêtes/jour. Notre Worker s'exécute 1×/semaine donc négligeable.
- **API Anthropic** : ~0,30 $ × 3 sessions = 0,90 $/semaine = ~4 $/mois.
- **Resend** : gratuit jusqu'à 100 emails/jour, 3 000/mois. Largement suffisant.

**Total : ~4 $/mois.**

## Logs et debug

Voir les logs en temps réel pendant l'exécution :

```bash
npx wrangler tail
```

Voir l'historique des invocations dans le dashboard Cloudflare : Workers → arty-growth-orchestrator → Logs.

## Sécurité (cf RÈGLE 6 du CLAUDE.md racine du repo)

Audit sécu de ce Worker :

- **Authentification** : pas d'endpoint fetch exposé aux users. Uniquement `scheduled` triggered par Cloudflare lui-même. Aucune surface d'attaque user-facing.
- **Autorisation** : non applicable (pas de user concept).
- **Abus infra** : non applicable (pas de relais possible).
- **Leak d'info** : les API keys sont des secrets Cloudflare (pas en clair). Les logs ne contiennent ni les clés ni le contenu sensible des emails reçus en clair (seulement statuts ok/erreur).
- **Origin / CSRF** : non applicable (pas de requête entrante non-cron).

Conclusion : ce Worker est **safe by design** car il n'expose aucune surface aux users. La seule surface d'attaque serait la compromission des secrets Cloudflare ou de l'API key Anthropic.

## Limites connues (v1)

- L'API Anthropic Agents évolue. Si les conventions de session (endpoint, statut, format de message) changent, il faudra adapter `runAgentSession` dans `src/index.ts`.
- Pas de retry automatique si une session échoue. Le digest signale juste "Échec session" et continue. v2 : retry exponentiel.
- Pas de stockage persistant du journal cumulatif. Chaque agent repart "à zéro" chaque dimanche, sauf si l'orchestrateur lui passe l'historique en context. v2 : Cloudflare D1 pour stocker les journaux.
- Pas d'accès direct au Google Sheet waitlist. L'agent Analytics doit donc faire avec ce que Florent reporte dans le feedback. v2 : intégration Google Sheets API ou export CSV via webhook.

## Évolution prévue (v2, après validation traction FR au 31 mai)

- Ajouter Cloudflare D1 pour persister le journal cumulatif entre cycles
- Ajouter un agent Arty Growth EN (Reddit, HN, Product Hunt, X EN)
- Ajouter un trigger quotidien (lundi-vendredi 7h) pour un mini-briefing du matin
- Ajouter un endpoint webhook pour que Tally pousse les nouvelles inscriptions waitlist en temps réel et déclenche un email de notif "Bravo, X inscriptions ce matin"
- Connecter Google Sheets API pour lire en direct le compteur waitlist
