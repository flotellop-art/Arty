# Arty Growth Orchestrator (v2)

Worker Cloudflare qui orchestre une "équipe IA" pour Arty, via des **Anthropic
Managed Agents** et une interface **Discord**. Deux équipes :

- **Growth** : 4 agents (DG, Growth FR, Content FR, Analytics).
- **Veille infra** : 2 watchers (MCP Tunnels, Self-Hosted Sandboxes).
  System prompts dans `agents/watcher-*.md`.

Trois modes de fonctionnement :

- **Cycle hebdo growth** (cron, dimanche 18h UTC) : lance les 3 sous-agents, le
  DG consolide, le digest est posté sur le canal Discord `#dg`.
- **Cycle hebdo veille infra** (cron, mercredi 12h UTC) : lance les 2 watchers
  en parallèle. Chacun lit la doc Anthropic/Cloudflare, met à jour son journal
  dans le memory store, et renvoie un résumé entre des marqueurs
  `=== DISCORD_SUMMARY === ... === END ===`. Quand les 2 ont livré, un mini
  digest "Watch infra" est posté sur Discord.
- **Ad-hoc** : la slash command Discord `/dg <message>` interroge le DG à la
  demande.

Le flux est **webhook-driven** : le Worker crée les sessions Anthropic puis rend
la main. Anthropic notifie `/anthropic/webhook` quand une session devient `idle`
ou `terminated`, ce qui déclenche la suite (consolidation, post Discord).

```
Cron dim. 18h ─┐
/trigger ──────┴─► runWeeklyCycle ─► 3 sessions sous-agents (KV: cycle:{id}:*)
                                          │  (le Worker rend la main)
              Anthropic ─webhook─► /anthropic/webhook ─► handleSubAgentDone
                                          │  quand les 3 sont là ─► session DG
              Anthropic ─webhook─► /anthropic/webhook ─► handleWeeklyDgDone
                                          └─► digest posté sur Discord #dg

Discord /dg ─► /discord/interactions ─► handleDGAdhoc ─► session DG
              Anthropic ─webhook─► /anthropic/webhook ─► réponse PATCH sur Discord
```

## Routes HTTP

| Route | Méthode | Auth |
|---|---|---|
| `/` | GET | aucune (healthcheck public) |
| `/trigger` | POST | header `X-Trigger-Secret` (run growth) |
| `/admin/trigger-watch` | POST | header `X-Trigger-Secret` (run veille infra) |
| `/admin/register-commands` | POST | header `X-Trigger-Secret` |
| `/admin/post-test` | POST | header `X-Trigger-Secret` |
| `/anthropic/webhook` | POST | signature HMAC SHA256 (Standard Webhooks) |
| `/oauth/google/start` | POST | header `X-Trigger-Secret` |
| `/oauth/google/callback` | GET | nonce `state` anti-CSRF |
| `/mcp/gmail` | POST | header `Authorization: Bearer <MCP_AUTH_TOKEN>` |
| `/discord/interactions` | POST | signature Ed25519 (Discord) |

Aucun secret ne transite en query string (CLAUDE.md, BUG 7).

## Setup (à faire une fois)

### 1. Dépendances

```bash
cd services/growth-orchestrator
npm install
```

### 2. Configurer les 9 secrets Cloudflare

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY   # whsec_... (étape 4)
npx wrangler secret put TRIGGER_SECRET                  # chaîne aléatoire ≥ 32 chars
npx wrangler secret put MCP_AUTH_TOKEN                  # chaîne aléatoire ≥ 32 chars, distincte
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put TALLY_API_KEY
npx wrangler secret put GITHUB_TOKEN                    # PAT fine-grained, repo Arty, Contents:Read
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Générer un secret aléatoire : `openssl rand -hex 32`.

`TRIGGER_SECRET` et `MCP_AUTH_TOKEN` doivent être **distincts** : `MCP_AUTH_TOKEN`
est nécessairement partagé avec la config de l'agent Anthropic, on l'isole donc
des routes d'admin.

### 3. Variables non secrètes

Éditer `wrangler.toml` → `[vars]` :

- `DISCORD_ALLOWED_USER_IDS` : l'ID Discord de Florent (CSV si plusieurs).
  Récupérer l'ID via Discord → Paramètres → Avancé → Mode développeur, puis
  clic droit sur l'utilisateur → Copier l'ID.

Les IDs d'agents, du memory store, du workspace et de Discord sont déjà remplis.

### 4. Déployer + configurer le webhook Anthropic

```bash
npx wrangler deploy
```

Note l'URL du Worker (`https://arty-growth-orchestrator.<compte>.workers.dev`).

Sur la console Anthropic, créer un **webhook** pointant vers
`https://<worker>/anthropic/webhook`, abonné aux événements
`session.status_idled` et `session.status_terminated`. Récupérer la **signing
key** (`whsec_...`) et la configurer en secret `ANTHROPIC_WEBHOOK_SIGNING_KEY`
(étape 2), puis re-déployer. **Sans ce webhook, rien ne se déclenche après le
lancement des sessions.**

### 5. Enregistrer la slash command Discord

Dans le portail développeur Discord, renseigner l'**Interactions Endpoint URL** :
`https://<worker>/discord/interactions`. Discord valide l'endpoint par un PING
(le Worker répond automatiquement). Puis enregistrer la commande `/dg` :

```bash
curl -X POST -H "X-Trigger-Secret: <TRIGGER_SECRET>" \
  https://<worker>/admin/register-commands
```

Tester le bot :

```bash
curl -X POST -H "X-Trigger-Secret: <TRIGGER_SECRET>" \
  https://<worker>/admin/post-test
```

### 6. Connecter Gmail (OAuth Google)

Le DG peut lire les mails de Florent et créer des brouillons via le serveur MCP
Gmail. Démarrer le flux OAuth (one-shot) :

```bash
curl -X POST -H "X-Trigger-Secret: <TRIGGER_SECRET>" \
  https://<worker>/oauth/google/start
```

La réponse contient `authorize_url` : l'ouvrir dans un navigateur **sous 10 min**,
se connecter avec le compte Google de Florent, accepter. Le `refresh_token` est
stocké en KV.

### 7. Déclarer le serveur MCP Gmail dans l'agent DG

Dans la config de l'agent DG (`mcp_servers`), ajouter un serveur MCP HTTP :

- URL : `https://<worker>/mcp/gmail`
- Authorization token : la valeur de `MCP_AUTH_TOKEN` (envoyée en header
  `Authorization: Bearer`).

L'agent dispose alors des outils `gmail_search`, `gmail_get_message`,
`gmail_draft`.

### 8. (Optionnel) Activer la veille infra

Le cron `0 12 * * WED` est déjà déclaré dans `wrangler.toml`. Pour l'activer
vraiment, créer les 2 watchers sur la console Anthropic :

1. Sur `platform.claude.com`, workspace Appfacade, créer 2 nouveaux agents :
   - **Arty Watcher — MCP Tunnels** : coller le system prompt de
     [`agents/watcher-mcp-tunnels.md`](agents/watcher-mcp-tunnels.md).
   - **Arty Watcher — Self-Hosted Sandboxes** : coller le system prompt de
     [`agents/watcher-self-hosted-sandbox.md`](agents/watcher-self-hosted-sandbox.md).

   Tier Sonnet pour les deux, web access activé, memory store `arty` monté,
   repo `flotellop-art/Arty` monté en read-only.
2. Récupérer les 2 `agent_id` et les coller dans `wrangler.toml` (vars
   `AGENT_WATCHER_MCP_TUNNELS_ID` et `AGENT_WATCHER_SHS_ID`). Redéployer.
3. (Optionnel mais recommandé) Seed manuel d'un `etat.md` minimal dans le
   memory store pour chaque watcher, via la console memory Anthropic :
   - chemin `/watch/mcp-tunnels/etat.md` → contenu : `Statut initial inconnu.
     Source d'amorçage : InfoQ 19/05/2026. À compléter au prochain cycle.`
   - chemin `/watch/self-hosted-sandbox/etat.md` → idem.

   Sans ce seed, le 1er cycle produira un résumé "je découvre tout". Pas
   bloquant.
4. Lancer un cycle manuel pour vérifier :
   `curl -X POST -H "X-Trigger-Secret: ..." https://<worker>/admin/trigger-watch`.
   Un mini-digest "Watch infra" doit apparaître sur Discord sous ~5 min.

Tant que `AGENT_WATCHER_*_ID` sont vides, le cron du mercredi tourne mais skip
les watchers concernés (log d'erreur, pas de crash).

### 9. Test de bout en bout

- `/dg ping` dans le canal Discord `#dg` → le DG répond.
- `curl -X POST -H "X-Trigger-Secret: ..." https://<worker>/trigger` → lance un
  cycle growth manuel.
- `curl -X POST -H "X-Trigger-Secret: ..." https://<worker>/admin/trigger-watch`
  → lance un cycle de veille infra manuel.

## Sécurité (CLAUDE.md, RÈGLE 6)

Audit des 9 routes HTTP exposées.

| Endpoint | Authentification | Autorisation | Abus infra | Leak | Origin/CSRF |
|---|---|---|---|---|---|
| `GET /` | aucune | n/a | n/a | version/ts seulement | n/a |
| `POST /trigger` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a (secret header) |
| `POST /admin/*` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a |
| `POST /anthropic/webhook` | HMAC SHA256 + anti-replay 5 min | sessions trackées en KV | dedup KV | 401 nu | signature = origine |
| `POST /oauth/google/start` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a |
| `GET /oauth/google/callback` | nonce `state` (KV, single-use, TTL 10 min) | n/a | n/a | erreur Google brute (flux Florent) | state anti-CSRF |
| `POST /mcp/gmail` | `Authorization: Bearer`, constant-time | refresh_token unique (1 user) | token requis | 401 nu | n/a |
| `POST /discord/interactions` | signature Ed25519 | allowlist `DISCORD_ALLOWED_USER_IDS` + canal vérifié | n/a | 401 nu | signature = origine |

Autres mesures : aucun secret en query string (BUG 7), comparaisons de secrets
constant-time, IDs Gmail validés par regex avant toute URL d'API (BUG 32),
`path` des screenshots restreint au dossier `/livraisons/` (anti path-traversal).

### Risques acceptés (décision écrite)

- **Scope OAuth `gmail.compose`** : Google ne fournit pas de scope « brouillon
  uniquement » ; ce scope autorise techniquement l'envoi. Mitigation : le serveur
  MCP n'expose **aucun** outil d'envoi (search / get / draft seulement) et le
  token est isolé en KV. Le risque résiduel est une fuite du `refresh_token`.
- **`refresh_token` Google en KV** : stocké sans chiffrement applicatif (KV est
  chiffré at-rest par Cloudflare). Le chiffrer placerait la clé dans le même
  coffre de secrets CF → gain marginal. Accepté.
- **Race double-DG** : KV n'a pas de compare-and-set ; deux webhooks
  quasi-simultanés peuvent en théorie lancer 2 sessions DG. Le garde
  d'idempotence `cycle:{id}:digest-posted` borne l'impact à une session
  Anthropic en trop (~0,30 $, rare), jamais deux digests postés.
- **Pas de rate limiting** sur `/trigger` (secret) et `/dg` (allowlist) :
  surfaces déjà protégées.

## Coûts

- **Cloudflare Workers** : plan Workers Paid (5 $/mois) requis pour `cpu_ms`
  étendu. Quelques exécutions/semaine, négligeable.
- **API Anthropic** : ~0,30 $/session × ~4 sessions/cycle ≈ 1,2 $/semaine.
- **Tally / Discord / Gmail** : gratuit aux volumes utilisés.

Total : ~10 $/mois.

## Logs et debug

```bash
npx wrangler tail        # logs en temps réel
npx tsc --noEmit         # typecheck (obligatoire avant deploy — CLAUDE.md BUG 13)
npx wrangler deploy --dry-run   # valide le build sans déployer
```

Historique des invocations : dashboard Cloudflare → Workers →
`arty-growth-orchestrator` → Logs (observability activée).

## Limites connues (v2)

- **Pas de watchdog** : si une session Anthropic n'émet jamais `idle` ni
  `terminated`, le cycle reste incomplet ; les clés KV expirent après 24h.
- **Tally paginé à 50** : `fetchTallyStats` ne lit que la 1ʳᵉ page. À paginer
  quand le total dépasse ~50 inscriptions sur une fenêtre courte.
- **Pas de retry** automatique sur échec de création de session.
- Le journal long terme vit dans le **memory store Anthropic**
  (`/mnt/memory/arty/`), pas en D1.
