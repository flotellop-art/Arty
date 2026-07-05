# CDC — Migration `claude-sonnet-4-6` → `claude-sonnet-5`

> **Statut : IMPLÉMENTÉ le 5 juillet 2026** (même session, sur décision de
> Florent — initialement délégué à Opus). Restent ouverts : le TODO ops §4
> (`DAILY_QUOTA_PER_MODEL` Cloudflare), la veille post-déploiement §6, et le
> bug préexistant §7 (PR séparée).
> Préparé le 5 juillet 2026 (session Fable, branche `claude/arty-sonnet-5-upgrade-rmnxw3`).
> Diagnostic challengé par 2 agents Sonnet 5 en parallèle (RÈGLE 7) : audit API
> (`anthropicClient.ts` + proxys) et challenge du plan (régressions, quotas,
> coûts historiques). Leurs corrections sont intégrées ci-dessous.

## Faits API vérifiés (référence Anthropic à jour, 05/07/2026)

- ID exact : **`claude-sonnet-5`** (pas de suffixe de date — ne JAMAIS en inventer un).
- Tarif : **$3 input / $15 output par MTok** (tarif intro $2/$10 jusqu'au
  31/08/2026 — voir « Décisions » ci-dessous), cache read $0.30, cache write $3.75.
- Contexte **1M tokens**, sortie max **128K** → le `maxTokens = 65536` actuel
  d'`anthropicClient.ts:673` est sous le plafond : **aucun risque de 400**.
- **Nouveau tokenizer : ~30 % de tokens en plus** pour le même texte. Le prix
  par token ne change pas, mais le coût **par message** augmente d'autant.
- Breaking changes API (vs 4.6) : `thinking:{type:'enabled', budget_tokens}` → 400 ;
  sampling params non-défaut (`temperature`/`top_p`/`top_k`) → 400 ; thinking
  adaptatif devient le défaut quand `thinking` est omis ; `thinking.display`
  défaut = `omitted`. **Arty est déjà conforme** : `anthropicClient.ts` envoie
  `thinking:{type:'adaptive'}` + `output_config:{effort}` (jamais `budget_tokens`),
  `temperature` uniquement sur Haiku, pas de prefill assistant.
  `web_search_20250305` (toolDefinitions.ts:23, factChecker) reste supporté.
- Effort : Sonnet 5 supporte `low/medium/high/xhigh/max` (4.6 n'avait pas `xhigh`).
  Hors scope — garder le type `ClaudeEffort` actuel, corriger juste le commentaire.

## 1. Changements obligatoires (bloquants)

1. **`src/services/aiRouter.ts:319`** — type `ClaudeSubModel` :
   `'claude-sonnet-4-6'` → `'claude-sonnet-5'` ; **`:359`** — `return 'claude-sonnet-5'`.
2. **`src/services/costTracker.ts:19`** — **AJOUTER**
   `'claude-sonnet-5': { input: 3.00, output: 15.00 }` en **GARDANT** l'entrée
   `claude-sonnet-4-6` (valorisation des coûts historiques localStorage —
   pattern PR #231 Opus 4.6→4.8) ; **`:98`** — fallback préfixe
   `startsWith('claude-sonnet')` → `'claude-sonnet-5'`.
3. **`functions/api/_lib/pricing.ts:27`** — **AJOUTER**
   `'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }`
   en gardant 4-6 ; **`:89`** — fallback préfixe `claude` → `'claude-sonnet-5'`.
   ⚠️ **Point le plus critique** : cette table débite les **crédits wallet réels**
   (`walletBilling.ts`, `creditPricing.ts:123` via `estimateReserveMicro`).
   Sans entrée explicite, Sonnet 5 serait valorisé silencieusement par le
   fallback — indétectable sans test.
4. **`src/services/factChecker.ts:195-196`** — model → `'claude-sonnet-5'`,
   label → `'Sonnet 5'`.
5. **`src/services/conversationCompressor.ts:133`** — model → `'claude-sonnet-5'`.
   **Garder** `COMPRESSION_THRESHOLD = 80000` (conservateur, sans risque avec 1M).
6. **`src/services/comparator/providerCatalog.ts:36` et `:87`** —
   modelId/costKey → `'claude-sonnet-5'` (le costKey doit matcher EXACTEMENT la
   clé ajoutée au point 2), label `'Claude Sonnet 5'`.
7. **`src/services/modelLabels.ts:58`** — la regex actuelle
   `/-(haiku|sonnet|opus)-(\d+)-(\d+)/` exige deux groupes de chiffres →
   `claude-sonnet-5` afficherait « Claude Sonnet » sans version. Fix validé
   (robuste aussi aux futurs IDs datés type `claude-sonnet-5-20260815`) :

   ```js
   const verMatch = m.match(/-(haiku|sonnet|opus)-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?/)
   const ver = verMatch ? (verMatch[3] ? `${verMatch[2]}.${verMatch[3]}` : verMatch[2]) : null
   ```

   Cas vérifiés : `claude-haiku-4-5-20251001` → « 4.5 », `claude-sonnet-4-6` →
   « 4.6 », `claude-opus-4-8` → « 4.8 », `claude-sonnet-5` → « 5 »,
   `claude-sonnet-5-20260815` → « 5 » (le lookahead `(?!\d)` empêche la date
   YYYYMMDD d'être captée comme version mineure).
8. **i18n** — `src/i18n/locales/fr.json:708` + `en.json:708` : « Sonnet 4.6 » →
   « Sonnet 5 » (label fact-checker settings). Vérifier aussi
   `settings.factChecker.costSonnet` si un coût y est mentionné.
9. **Tests** :
   - `src/__tests__/services/aiRouter.test.ts:396` — attend `'claude-sonnet-4-6'`
     → mettre à jour (sinon CI rouge).
   - **AJOUTER** un test `modelLabels` : `formatModelName('claude-sonnet-5') ===
     'Claude Sonnet 5'` + non-régression sur haiku-4-5-20251001 / sonnet-4-6 /
     opus-4-8. Aucun test n'existe pour ce fichier, et le pattern maison
     (BUG 56) exige un test avec chaque fix de regex.
   - **NE PAS TOUCHER** : `d1.wallet.test.ts:14` et `billingAdvisor.test.ts`
     (fixtures opaques — `premiumBucket()` matche par `.includes('sonnet')`,
     le harnais D1 traite le modèle comme literal opaque ; vérifié sans impact).

## 2. Ne RIEN changer (vérifié par les 2 agents)

- `functions/api/_lib/checkPremiumCap.ts:78` (`startsWith('claude-sonnet')`) —
  claude-sonnet-5 tombe bien dans le bucket premium 150/mois.
- `functions/api/subscription/status.ts:14`, `functions/api/_lib/freeQuota.ts`,
  `functions/api/ai/proxy.ts:175` (verrou free = `includes('haiku')` → 403
  correct pour Sonnet 5).
- `src/hooks/usePlanStatus.ts`, `PlanBadge.tsx`, `CapReachedModal.tsx`,
  `ChatOptionsSheet.tsx` : familles génériques `'claude-sonnet'`, pas des IDs.
- `functions/api/ai/proxy.ts` : pas d'allowlist de modèles exacts.
- `schema.sql`, `walletClient.ts`, `modelSelector.ts`, `costs.tsx` : aucune
  référence versionnée.

## 3. Cosmétique (même PR, non bloquant)

Commentaires obsolètes : `aiRouter.ts:266` (effort — noter que Sonnet 5
supporte xhigh mais qu'on ne l'exploite pas), `anthropicClient.ts:199,681`,
`factChecker.ts:86,189,202`, `conversationCompressor.ts:82` (doublement faux
après migration : nom ET « contexte 200k » — Sonnet 5 = 1M). Exemples :
`functions/env.d.ts:13`, `.env.example:38`, `functions/api/_lib/quota.ts:81`,
`services/growth-orchestrator/agents/watcher-ai-models.md:29`.

## 4. ⚠️ TODO OPS (Florent — hors code, avant/au déploiement)

`functions/api/_lib/quota.ts:102` fait un **match EXACT de clé** sur
`DAILY_QUOTA_PER_MODEL` (env Cloudflare) — contrairement aux autres gates qui
matchent par préfixe. Si cette variable contient une clé
`"claude-sonnet-4-6": N` en prod, elle cessera de s'appliquer **silencieusement**
(retour au défaut global) après la migration. → **Vérifier le dashboard
Cloudflare et renommer la clé JSON si elle existe.**

## 5. Décisions (recommandations retenues)

- **Tarif intro $2/$10 (jusqu'au 31/08/2026)** : inscrire **$3/$15** (tarif
  durable) dans les deux tables — évite une PR de re-pricing au 1er septembre,
  conservateur pour le wallet. Le noter en commentaire dans le code.
- **`xhigh`** : hors scope. Le type `ClaudeEffort` reste `low/medium/high/max`.

## 6. Veille post-déploiement (rien à coder)

- **Tokenizer +30 %** → coût par message Sonnet ~+30 %. La vigie éco
  (`docs/audits/vigie-eco-2026-06.md`) avait déjà identifié le bucket partagé
  Sonnet+Opus (150 msg/mois, `checkPremiumCap.ts:37`) comme « le seul vrai trou
  de marge » à ~$0.36/message. **Re-mesurer le $/message après migration**
  avant de considérer le cap 150 comme bien dimensionné.
- Réserve wallet : `functions/api/_lib/walletBilling.ts:17`
  (`CHARS_PER_TOKEN = 4`, pré-réservation avant appel) sous-estimera davantage
  l'input réel sur Sonnet 5. Le settle utilise les vrais tokens et le code
  tolère un solde légèrement négatif borné (`creditPricing.ts:106-109`) —
  pas bloquant, mais **surveiller les soldes D1 wallet** ; resserrer la
  constante côté modèles Claude si dérive matérielle.
- Estimateur client `conversationCompressor.ts:37` (`CHARS_PER_TOKEN = 3.8`) :
  sous-compte ~23 % de plus avec le nouveau tokenizer — sans impact pratique
  (contexte 1M), mais l'estimateur est durablement imprécis.
- **Premier vrai message Sonnet 5 en prod : vérifier le débit wallet réel vs
  `computeCostMicroUsd`** (le risque n°1 de cette migration est un montant mal
  compté, pas un 400).

## 7. Bug préexistant découvert (HORS migration — PR séparée)

`src/services/conversationCompressor.ts:126` envoie `'x-api-key': apiKey` sans
le garde BUG 25 (`apiKey !== 'server-provided'`) appliqué partout ailleurs
(`aiHttp.ts:40`, `imageClient.ts:29`, `promptEnhancer.ts:64`). Pour un
utilisateur Google sans BYOK, la sentinelle `'server-provided'` part comme vrai
header → `proxy.ts:48-49` la lit comme clé BYOK (`isByok = true`) → le chemin
serveur (checkAllowedUser/quotas/wallet) est court-circuité → 401 upstream
Anthropic → catch silencieux (`:142-144/:169-172`). **Conséquence : la
compression de contexte ne fonctionne JAMAIS pour les utilisateurs sans BYOK**
(quasi tous les non-Pro). Fix : appliquer le même garde que `aiHttp.ts:40`
(idéalement migrer le fichier vers `buildAiHeaders` de `aiHttp.ts`, C9/PR #312).
À traiter séparément pour ne pas mélanger les diffs.

## 8. Vérifications finales avant push (implémenteur)

1. `npx tsc --noEmit` (BUG 13 — les erreurs TS bloquent le déploiement en silence).
2. `npm test` (suite complète, y compris le nouveau test modelLabels).
3. Relire le diff : aucune suppression d'entrée de prix historique.
