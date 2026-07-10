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
- `ANTHROPIC_GMAIL_VAULT_ID` : l'ID `vlt_...` créé à l'étape 7. Laisser vide
  désactive l'accès Gmail dans les sessions DG.
- `GMAIL_DRAFTS_ENABLED` : conserver `"false"` tant qu'un écran d'approbation
  humaine n'est pas disponible.

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

Le DG peut lire les mails de Florent via le serveur MCP Gmail. Démarrer le flux
OAuth (one-shot) :

```bash
curl -X POST -H "X-Trigger-Secret: <TRIGGER_SECRET>" \
  https://<worker>/oauth/google/start
```

La réponse contient `authorize_url` : l'ouvrir dans un navigateur **sous 10 min**,
se connecter avec le compte Google de Florent, accepter. Le `refresh_token` est
stocké en KV.

Le consentement par défaut demande uniquement la lecture Gmail. Si un ancien
jeton avait reçu le droit `gmail.compose`, le révoquer dans le compte Google puis
relancer cette étape pour réduire réellement ses droits.

### 7. Déclarer le serveur MCP Gmail et son coffre

Dans la config de l'agent DG (`mcp_servers`), ajouter un serveur MCP HTTP dont
l'URL est exactement `https://<worker>/mcp/gmail`.

Créer ensuite un vault Anthropic avec un credential `static_bearer` :

- `mcp_server_url` : la même URL, caractère pour caractère ;
- token : la valeur de `MCP_AUTH_TOKEN` ;
- reporter l'ID `vlt_...` dans `ANTHROPIC_GMAIL_VAULT_ID` puis redéployer.

Le Worker attache ce vault aux nouvelles sessions DG. Le jeton ne doit pas être
placé directement dans la définition de l'agent.

Dans les permissions MCP de l'agent, mettre `gmail_search` et
`gmail_get_message` en `always_allow`. Laisser `gmail_draft` désactivé : le
serveur ne l'annonce pas tant que `GMAIL_DRAFTS_ENABLED` vaut `false`. Toute
demande `always_ask` inattendue est refusée automatiquement afin que la session
ne reste pas bloquée indéfiniment.

### 8. (Optionnel) Activer l'équipe de veille

Quatre crons (`WED`, `THU`, `FRI`, `SAT` à 12h UTC) sont déjà déclarés dans
`wrangler.toml`. L'équipe veille = **10 watchers** au total (configurés dans
`WATCHERS_CONFIG` de `src/index.ts`). Chacun est un Managed Agent Anthropic à
créer une fois sur la console.

**Cycle mercredi — outils & infra (7 watchers)** :
| Watcher | Var wrangler | System prompt | Repo monté |
|---|---|---|---|
| MCP Tunnels | `AGENT_WATCHER_MCP_TUNNELS_ID` | [watcher-mcp-tunnels.md](agents/watcher-mcp-tunnels.md) | oui |
| Self-Hosted Sandboxes | `AGENT_WATCHER_SHS_ID` | [watcher-self-hosted-sandbox.md](agents/watcher-self-hosted-sandbox.md) | oui |
| IA (Claude/Gemini/Mistral/GPT) | `AGENT_WATCHER_AI_MODELS_ID` | [watcher-ai-models.md](agents/watcher-ai-models.md) | non |
| Cloudflare | `AGENT_WATCHER_CLOUDFLARE_ID` | [watcher-cloudflare.md](agents/watcher-cloudflare.md) | non |
| Google APIs | `AGENT_WATCHER_GOOGLE_APIS_ID` | [watcher-google-apis.md](agents/watcher-google-apis.md) | non |
| Mobile (Capacitor + OS) | `AGENT_WATCHER_MOBILE_ID` | [watcher-mobile-native.md](agents/watcher-mobile-native.md) | non |
| Comms/Growth/Payments | `AGENT_WATCHER_COMMS_ID` | [watcher-comms-growth.md](agents/watcher-comms-growth.md) | non |

**Cycle jeudi — marché & voix users (2 watchers)** :
| Watcher | Var wrangler | System prompt | Repo monté |
|---|---|---|---|
| Marché concurrents | `AGENT_WATCHER_MARKET_ID` | [watcher-market-competitors.md](agents/watcher-market-competitors.md) | non |
| Voix users | `AGENT_WATCHER_USERS_VOICE_ID` | [watcher-users-voice.md](agents/watcher-users-voice.md) | non |

**Cycle vendredi — recherche docs/tutos (1 watcher)** :
| Watcher | Var wrangler | System prompt | Repo monté |
|---|---|---|---|
| Recherche | `AGENT_WATCHER_RESEARCH_ID` | [watcher-research.md](agents/watcher-research.md) | oui (lit `agents/watch-topics.md`) |

**Cycle samedi — manager (1 watcher)** :
| Watcher | Var wrangler | System prompt | Repo monté | Web access |
|---|---|---|---|---|
| Manager veille | `AGENT_WATCHER_MANAGER_ID` | [watcher-manager.md](agents/watcher-manager.md) | oui | **NON** (lit seulement le memory store) |

Procédure pour activer (10-30 min) :

1. Sur `platform.claude.com`, workspace Appfacade, créer 10 nouveaux agents
   selon les tableaux ci-dessus (tier **Sonnet**, memory store `arty` monté
   sur `/mnt/memory/arty/`, web access **on sauf pour le manager**).
2. Coller les 10 `agent_id` dans les vars correspondantes de `wrangler.toml`.
3. (Optionnel) Seed manuel d'un `etat.md` minimal pour chaque watcher dans le
   memory store, chemin `/watch/<key>/etat.md`. Sans seed, le 1er cycle
   produira un résumé "je découvre tout" — non bloquant.
4. Le watcher **research** lit `agents/watch-topics.md` (la liste des sujets
   à surveiller). Éditer cette liste par PR Git, jamais directement dans le
   memory store.
5. Redéployer : `npx wrangler deploy`.
6. Tester chaque slot :
   ```bash
   curl -X POST -H "X-Trigger-Secret: ..." 'https://<worker>/admin/trigger-watch?slot=wed'
   curl -X POST -H "X-Trigger-Secret: ..." 'https://<worker>/admin/trigger-watch?slot=thu'
   curl -X POST -H "X-Trigger-Secret: ..." 'https://<worker>/admin/trigger-watch?slot=fri'
   curl -X POST -H "X-Trigger-Secret: ..." 'https://<worker>/admin/trigger-watch?slot=sat'
   ```
   Un digest distinct doit arriver sur Discord pour chaque slot sous ~5-10 min.

Tant que les `AGENT_WATCHER_*_ID` sont vides, les crons tournent mais skipent
les watchers concernés (log d'erreur, pas de crash). Tu peux donc déployer
maintenant et activer les watchers progressivement.

### 9. Test de bout en bout

- `/dg ping` dans le canal Discord `#dg` → le DG répond.
- `curl -X POST -H "X-Trigger-Secret: ..." https://<worker>/trigger` → lance un
  cycle growth manuel.
- `curl -X POST -H "X-Trigger-Secret: ..." 'https://<worker>/admin/trigger-watch?slot=wed'`
  → lance un cycle de veille manuel (slot mercredi).

## Sécurité (CLAUDE.md, RÈGLE 6)

Audit des 9 routes HTTP exposées.

| Endpoint | Authentification | Autorisation | Abus infra | Leak | Origin/CSRF |
|---|---|---|---|---|---|
| `GET /` | aucune | n/a | n/a | version/ts seulement | n/a |
| `POST /trigger` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a (secret header) |
| `POST /admin/*` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a |
| `POST /anthropic/webhook` | HMAC SHA256 + anti-replay 5 min | sessions trackées, livraison seulement sur `end_turn`, dédup par `event.id` | corps borné, timeouts, erreur critique = 503 | 401 nu | signature = origine |
| `POST /oauth/google/start` | `X-Trigger-Secret`, constant-time | n/a | secret requis | 404 nu | n/a |
| `GET /oauth/google/callback` | nonce `state` (KV, single-use, TTL 10 min) | n/a | timeout sortant | erreur Google masquée | state anti-CSRF |
| `POST /mcp/gmail` | `Authorization: Bearer`, constant-time | lecture seule par défaut ; brouillons masqués | corps/réponses/MIME bornés, timeouts | erreurs externes masquées | n/a (Bearer non automatique) |
| `POST /discord/interactions` | signature Ed25519 | allowlist `DISCORD_ALLOWED_USER_IDS` + canal vérifié | corps borné + timeout | 401 nu | signature = origine |

Autres mesures : aucun secret en query string (BUG 7), comparaisons de secrets
constant-time, IDs Gmail validés par regex avant toute URL d'API (BUG 32),
`path` des screenshots restreint au dossier `/livraisons/` (anti path-traversal).

### Risques acceptés (décision écrite)

- **Scope OAuth d'écriture** : par défaut, seul `gmail.readonly` est demandé.
  Activer explicitement les brouillons ajoute `gmail.compose`, qui autorise aussi
  techniquement l'envoi ; cette option reste donc désactivée sans approbation
  humaine.
- **`refresh_token` Google en KV** : stocké sans chiffrement applicatif (KV est
  chiffré at-rest par Cloudflare). Le chiffrer placerait la clé dans le même
  coffre de secrets CF → gain marginal. Accepté.
- **Race double-DG / double-post** : KV n'a pas de compare-and-set. Le Worker
  déduplique désormais par `event.id`, pose un claim temporaire et écrit les
  marqueurs seulement après confirmation Discord. Cela bloque les replays
  ordinaires, pas toutes les courses multi-régions ; une garantie forte exige
  encore une Queue + un état atomique (Durable Object).
- **Pas de rate limiting** sur `/trigger` (secret) et `/dg` (allowlist) :
  surfaces déjà protégées.

## Récap email (Resend + Haiku)

Chaque digest posté sur Discord déclenche aussi un email récap vers
`EMAIL_TO`. Le contenu est **vulgarisé par Haiku** (appel synchrone direct,
pas une session managed) en HTML simple sans jargon, lisible par un novice.

Activation : configurer le secret `RESEND_API_KEY` et la var `EMAIL_TO`
(défaut `flotellop@gmail.com`). Si `RESEND_API_KEY` est vide, l'envoi est
skippé sans erreur (Discord reste fonctionnel).

```bash
npx wrangler secret put RESEND_API_KEY
```

Compte Resend : https://resend.com (free tier 100 emails/jour, 3 000/mois —
largement suffisant pour 5 emails/semaine).

Domaine d'envoi (`EMAIL_FROM`) :
- Par défaut : `onboarding@resend.dev` (sandbox Resend, zéro config DNS).
- Pour passer à `digest@tryarty.com`, valider `tryarty.com` dans Resend
  (3 entrées DNS chez Cloudflare).

Sujets des emails :
- mer : `Recap outils & tech — semaine du <date>`
- jeu : `Recap concurrence & users — semaine du <date>`
- ven : `Recap recherche & nouveautes — semaine du <date>`
- sam : `Synthese hebdo de l'equipe IA — <date>`
- dim : `Recap growth — cycle #<N> (<date>)`

Si la traduction Haiku échoue ou si Resend rejette, l'erreur est loggée et
le pipeline continue. Le Discord est le canal de référence ; l'email est un
récap lisible « café du matin ».

## Coûts

- **Cloudflare Workers** : plan Workers Paid (5 $/mois) requis pour `cpu_ms`
  étendu. Quelques exécutions/semaine, négligeable.
- **API Anthropic** : ~3 $/semaine pour les 10 watchers + 4 sessions growth.
- **Haiku traductions** : 5 emails/semaine × ~5k tokens = ~0,03 $/semaine.
- **Resend** : gratuit (free tier).
- **Tally / Discord / Gmail** : gratuit aux volumes utilisés.

Total : ~17 $/mois.

## Logs et debug

```bash
npx wrangler tail        # logs en temps réel
npx tsc --noEmit         # typecheck (obligatoire avant deploy — CLAUDE.md BUG 13)
npm test                 # tests contrats Anthropic, Discord et Gmail
npm run verify           # typecheck + tests + build Cloudflare à blanc
npx wrangler deploy --dry-run   # valide le build sans déployer
```

Historique des invocations : dashboard Cloudflare → Workers →
`arty-growth-orchestrator` → Logs (observability activée).

## Limites connues (v2)

- **Pas de watchdog** : si une session Anthropic n'émet jamais `idle` ni
  `terminated`, le cycle reste incomplet ; les clés KV expirent après 24h.
- **Traitement webhook encore synchrone** : les erreurs critiques renvoient 503
  et conservent le suivi, mais la livraison durable par Queue et la coordination
  fortement cohérente par Durable Object restent le prochain chantier.
- **Tally paginé à 50** : `fetchTallyStats` ne lit que la 1ʳᵉ page. À paginer
  quand le total dépasse ~50 inscriptions sur une fenêtre courte.
- **Pas de retry** automatique sur échec de création de session.
- Le journal long terme vit dans le **memory store Anthropic**
  (`/mnt/memory/arty/`), pas en D1.
