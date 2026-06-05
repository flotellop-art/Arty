# Veille recherche docs/tutos — 2026-06-05

Cycle de veille « Recherche docs & tutos » (voir
`services/growth-orchestrator/agents/watch-topics.md`). 10 sujets surveillés,
2 trouvailles `news`, 0 `breaking`. Cette note documente les 2 trouvailles
actionnables et les décisions d'ingénierie prises en conséquence.

---

## Trouvaille 1 — Prompt caching Anthropic (action : implémentée)

### Ce que la doc Anthropic décrit (vérifié le 2026-06-05)

Source : https://platform.claude.com/docs/en/build-with-claude/prompt-caching

Trois fonctionnalités jusque-là non tracées :

1. **Cache automatique top-level** : `cache_control: {type:'ephemeral'}` posé
   directement sur la requête `messages.create()` — l'API le place sur le
   dernier bloc cacheable. Pratique quand on ne veut pas gérer le placement
   fin.
2. **Pré-chauffage via `max_tokens: 0`** : remplace le hack `max_tokens: 1`.
   Lance le prefill (écrit le cache) et retourne immédiatement, sans token de
   sortie facturé.
3. **TTL 1h** : `cache_control: {type:'ephemeral', ttl:'1h'}`. Écriture
   facturée 2× (vs 1,25× pour le TTL 5 min par défaut).

Rappels mécaniques utiles :
- Le cache est un **match de préfixe** : tout changement d'octet dans le
  préfixe invalide la suite. Ordre de rendu : `tools → system → messages`.
- **Max 4 breakpoints** par requête.
- Préfixe minimum cacheable = **4096 tokens sur Opus** (sinon pas de cache,
  silencieusement, sans erreur).
- Lecture cache ≈ **0,1×** du tarif input ; écriture ≈ **1,25×** (TTL 5 min).
- Le lookback de cache remonte **au plus 20 blocs** pour retrouver une entrée
  écrite précédemment.

### Le trou trouvé dans Arty

Dans `src/services/anthropicClient.ts`, Arty posait `cache_control` sur :
- le **bloc système** (`systemBlocks`),
- la **dernière définition d'outil** (`cachedTools`).

Soit 2 des 4 breakpoints. **Aucun marqueur sur les messages.** Conséquence :
en chat multi-tours, ET surtout dans la **boucle d'outils interne** (jusqu'à 30
itérations qui re-renvoient le préfixe accumulé : système + outils + historique
+ tool_results), tout repartait en **input plein tarif** à chaque appel. Le
volume le plus lourd et le plus répété (la boucle d'outils Gmail/Drive/web)
ne profitait d'aucun cache.

### Ce qui a été implémenté

Ajout d'un helper `markLastBlockForCaching()` qui pose **un** breakpoint mobile
sur le **dernier bloc du dernier message**, **re-posé à chaque itération de la
boucle d'outils** (pas une fois par tour utilisateur). Total : 3 breakpoints
(système + dernier outil + dernier message).

Deux invariants non négociables (issus de l'audit multi-agents) :
1. **Re-pose par itération** : sinon une chaîne d'outils longue dépasse les 20
   blocs de lookback → cache miss silencieux **+** réécriture 1,25× = optim
   *négative*. C'est précisément le cas le plus coûteux d'Arty.
2. **Helper idempotent** : retire tout `cache_control` de message déjà posé
   avant d'en poser un nouveau. Sinon les breakpoints s'empilent au fil de la
   boucle → dépassement de la limite de 4 → **400 invalid_request_error**.

Garde **BUG 52** : le helper ne touche jamais un message `role:'assistant'`
(blocs `thinking` à signature intègre). En pratique le dernier message est
toujours un `user` (question d'origine ou `tool_results`), donc le marqueur va
sur un bloc `text` ou `tool_result` — jamais sur un bloc thinking.

**Tracking de coût ajusté** (`recordUsage`) : les `cache_read_input_tokens`
sont désormais comptés à **0,1×** au lieu du tarif plein. Sans cet ajustement,
activer le cache aurait fait *monter* le coût affiché (écran Coûts /
CostIndicator, cf. BUG 54) alors que le coût réel baisse — un faux signal pour
l'utilisateur. Le `cache_creation` reste compté à 1× (légère sous-estimation
bornée du 1,25× réel).

**Log dev** : en `import.meta.env.DEV`, dump de `cacheReadTokens` /
`cacheCreationTokens` par requête pour vérifier que le cache mord réellement
(si `read` reste à 0 sur des tours répétés → lookup raté ou invalidateur
silencieux).

### Ce qui a été délibérément DIFFÉRÉ (et pourquoi)

- **Pré-chauffage `max_tokens: 0`** : inutile pour une app interactive. Chaque
  conversation démarre par un vrai message utilisateur qui chauffe le cache
  naturellement. Un appel de pré-chauffage serait un write 1,25× pur en plus.
- **TTL 1h** : écriture 2×, rentable seulement si l'utilisateur revient souvent
  dans la fenêtre 5 min–1 h avec un historique identique. Usage Arty
  (mobile, sporadique) → rarement rentable. On reste sur le TTL 5 min par
  défaut, suffisant pour des tours de chat qui s'enchaînent.
- **Cache automatique top-level** : on garde le placement **manuel/explicite**
  (plus prévisible que l'auto-placement, et nécessaire pour cohabiter avec nos
  breakpoints système + outils).

### Note connexe — Gemini / Mistral

- **Gemini** (`geminiClient.ts`) : pas de Context Caching (ressource
  `cachedContents`). Différent du cache Anthropic (ressource nommée, min 1 h,
  coût de stockage) — pertinent seulement pour des contextes > 32k réutilisés.
  Non rentable pour l'usage Gemini Flash court d'Arty. À garder en tête, pas à
  implémenter.
- **Mistral** : prefix caching automatique côté serveur sur certains modèles,
  rien à annoter côté client.

---

## Trouvaille 2 — Capacitor 8 → 9 (action : aucune, informatif)

Source : https://github.com/ionic-team/capacitor/releases

- Capacitor **9 en alpha** (alpha.0 le 2026-05-07, alpha.3 le 2026-06-02).
  Breaking changes Android en cours (SystemBars natif, Cordova conditionnelle).
- **Pas encore de guide de migration officiel v8 → v9.**
- Stable **8.4.0** sorti le 2026-06-02.

Arty est en Capacitor `^8.3.0` (`package.json`). **Rien à faire maintenant** :
trouvaille purement informative, pas de breaking pour nous. À ré-évaluer quand
le guide v8→v9 sortira et que le `@codetrix-studio/capacitor-google-auth`
(actuellement RC, voir `.npmrc` / BUG 37) aura une compat v9.

---

## Conformité RÈGLE 6 (audit sécu endpoints)

Le changement de cache est **purement côté construction du `requestBody`
client** dans `anthropicClient.ts`. Aucun endpoint serveur (`functions/`) créé
ou modifié, aucune auth, aucune donnée tierce, `proxy.ts` inchangé. Le header
beta `prompt-caching-2024-07-31` était déjà envoyé et forwardé par le proxy.
→ Audit 5-points RÈGLE 6 non requis (pas de surface serveur touchée).

## Vérification

- `npx tsc --noEmit` : OK (exit 0).
- À valider en navigateur réel : ouvrir une conversation multi-tours avec
  outils, vérifier dans la console DEV que `[anthropic cache] read=...` devient
  non nul dès le 2ᵉ tour / la 2ᵉ itération d'outils.
