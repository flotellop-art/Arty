# Vigie économique — 14 juin 2026

**Cadre** : vigie trimestrielle du plan d'action concurrentiel (RÈGLE 7 :
3 agents en parallèle — 2× Opus marges, 1× Sonnet méthodo/ToS/tokenizer —
+ requêtes D1 prod faites par Claude). Les agents n'ont pas modifié de code.

**Donnée structurante : Arty est encore en pré-lancement.** La table D1
`quota_model` ne contient que **2 utilisateurs** sur 7 semaines (23 avr → 14 juin) :
Florent (123 appels, 18,42 $) + une bêta-testeuse (13 appels, 2,40 $). Total
**20,82 $**. Tout chiffre « par utilisateur » ci-dessous est donc une projection,
pas une mesure de base installée.

---

## 1. Marges réelles vs prix affichés — VÉRIFIÉ

### Verdict (convergence des 3 agents)

- **Sur le profil MÉDIAN d'une vraie base d'abonnés : largement rentable**,
  ~**76–78 % de marge brute API** (coût API moyen pondéré ≈ 1,85–2,05 € contre
  8,32 € net encaissé sur 9,99 € TTC). Économie classique du forfait : les
  dormants (~35 %) subventionnent les intensifs.
- **Sur un abonné qui MAXE ses quotas : à perte dans tous les cas** — de
  −0,7 € (médian, 150 Sonnet seul) à **−36 €** (worst-case avec Opus). Les
  quotas (150 Claude / 100 GPT / 80 Gemini) bornent ce trou mais ne le
  suppriment pas.
- **Condition de viabilité** : la part de power-users/maxeurs doit rester
  **< ~10 % de la base**. Au-delà, la marge moyenne s'effondre vers 0. À
  surveiller via D1 : `coût_Claude_mensuel / (abonnés_actifs × 8,32 €)`.

### Le seul vrai trou de marge : le bucket Claude partagé (Sonnet + Opus)

`checkPremiumCap.ts` met **Sonnet et Opus dans le même bucket de 150**
(`claude-sonnet` cap 150, et `claude-opus-*` partage ce bucket). Rien
n'empêche un abonné de forcer Opus sur ses 150 messages. Opus coûte ~5× Sonnet :
30 messages Opus médians effacent à eux seuls le revenu net du mois.
C'est le réflexe naturel de l'early-adopter tech (« je prends le meilleur
modèle ») — donc pas un épouvantail purement théorique.

➡️ **Recommandation prioritaire (décision Florent — levier business)** :
sous-quota Opus dédié (~20–30 msg/mois isolés), le reste forcé sur Sonnet.
Cohérent avec la stratégie confiance (limite lisible, pas de bascule muette).
**Non implémenté** : c'est un changement d'offre, pas un fix — à arbitrer.

### Donnée prod : le coût réel par message est plus élevé que l'estimé optimiste

Les agents (raisonnant sur le code) estimaient Sonnet ~0,02–0,07 $/message en
supposant un bon taux de cache. **La prod montre 0,36 $/message Claude Sonnet**,
dont **~70 % (0,25 $) en *création* de cache** (`cache_creation` ≈ 67 k tokens/appel
à 3,75 $/M, soit 1,25× le tarif input).

Analyse (Claude, après lecture de `anthropicClient.ts:560`) : **le code de
caching est correct** (breakpoints système + dernier outil + dernier bloc user,
gestion idempotente du lookback < 20 blocs dans la boucle d'outils). Le coût
élevé vient de deux causes, PAS d'un bug :
1. **Cache froid (TTL 5 min)** : en test, les messages sont espacés de plusieurs
   minutes → le préfixe caché expire → réécriture pleine (1,25×) à chaque appel.
   Pour un vrai utilisateur en échange rapide, le cache serait relu (0,1×).
2. **Contexte lourd** : 17 k tokens d'input « frais » + gros préfixe Gmail/Drive.

Conséquence honnête : le 0,36 $/msg est **gonflé par le pattern de test
cold-cache** et n'est pas représentatif d'un utilisateur engagé. MAIS le point
structurel tient : quand les sessions sont espacées, le caching ne rapporte rien
et coûte même +25 % (écriture 1,25×). Levier d'économie réel = **alléger le
contexte injecté** (nettoyage HTML/CSS/signatures Gmail/Drive avant l'API — brique
déjà amorcée BUG 49), invisible pour l'utilisateur, −20–40 % sur les cas lourds.

### Risque actionnable repéré : fallbacks de `getPricing()`

`pricing.ts:89-94` : un modèle inconnu de préfixe `gpt-*` retombe sur
`gpt-5.5-mini` (0,5/3 $), `gemini-*` sur `gemini-2.5-flash`, etc. — des tarifs
**bas**. Si un futur modèle premium était routé via un alias non recensé, le coût
serait **sous-estimé** (tracking faux + wallet sous-débité). Impact actuel = **nul**
(tous les modèles live sont dans la table). Défensif : rendre les fallbacks de
préfixe pessimistes (tarif flagship) plutôt que « mini ». **Non corrigé** :
arbitrage sous-comptage (tracking) vs sur-débit wallet d'un alias mini — à
trancher si on ajoute des modèles.

---

## 2. ToS providers / wrappers — ANGLE MORT COMBLÉ

La veille `docs/veille/` ne couvrait QUE le prompt caching + Capacitor. Le risque
ToS « revente d'accès API / wrapper multi-utilisateurs » n'était pas suivi.
➡️ Doc de veille créée : `docs/veille/2026-06-tos-wrappers.md` (revue trimestrielle
des 3 providers). Résumé : la couverture BYOK est **sans risque** (relation
directe user↔provider) ; la zone grise est l'usage de la **clé serveur du owner**
pour des users whitelistés (usage commercial indirect). Signal d'alerte le plus
concret = email « commercial/enterprise agreement required » du provider sur un
compte à fort volume multi-fingerprints — pas la lettre des ToS.

---

## 3. Tokenizer Anthropic « +27 % » — REQUALIFIÉ NON-PERTINENT POUR LE SETTLE

Les 3 agents convergent : **le +27 % ne doit PAS être ré-appliqué à `pricing.ts`.**
Raison décisive : `computeCostMicroUsd()` consomme les `input_tokens`/`output_tokens`
que **l'API Anthropic renvoie elle-même** dans le SSE (`message_start`/`message_delta`,
lus par `trackUsage.ts`). Si Anthropic re-tokenise +27 %, il renvoie ce nouveau
compte au tarif $/token inchangé → le coût calculé reflète **déjà** la réalité du
settle. Aucun sous-comptage structurel côté parsing (vérifié : pas d'estimation
maison au settle, seulement aux estimations de réserve pré-appel, rattrapées au
settle exact). Cross-check interne fait : recompute manuel des composantes =
`cost_usd_micro` stocké au centime → tracking cohérent avec `pricing.ts`.

De plus, un −27 % d'efficacité de tokenizer sur un modèle stable n'a aucun
précédent public (les écarts inter-tokenizers sur texte normal sont ±5–15 % ;
le seul grand saut récent, o200k chez OpenAI, a *amélioré* l'efficacité).
**Hypothèse la plus crédible** : un cas mesuré sur du HTML/JSON brut extrapolé,
OU l'effet `cache_creation` (1,25×) confondu avec un effet tokenizer.

➡️ **Ne rien multiplier dans `pricing.ts`.** Vérif définitive = comparer un
échantillon Anthropic Console vs agrégats `quota_model` D1 sur mars-avril
(**action Florent** — nécessite l'accès Console). Si écart < 5 %, hypothèse close.

---

## 4. Distribution « whales » — SANS OBJET (n=2), MÉTHODO PRÊTE

Avec 2 utilisateurs, `NTILE(20)` (top 5 %) n'a aucun sens. À refaire quand la base
dépasse ~40 utilisateurs actifs/30 j. Requêtes SQL prêtes (fournies par l'agent
Sonnet, voir plus bas). **Pièges** documentés pour la prochaine fois :
- **BYOK absent de `quota_model`** : les requêtes BYOK ne sont pas insérées (le
  proxy court-circuite `recordUsage` si `isByok`). Les vrais heavy users
  technophiles (= souvent BYOK) seront invisibles → distribution tronquée.
- **`count` figé pour les VIPs** : `recordUsage` n'incrémente pas `count` sur
  `ON CONFLICT` pour les whitelistés → **ne JAMAIS classer les whales par
  `count`**. Classer par `cost_usd_micro` (fiable, s'incrémente correctement).

Requête de secours (top 10 par coût, 30 j) à garder sous la main :
```sql
WITH user_cost AS (
  SELECT email, SUM(cost_usd_micro) AS cost_micro, SUM(count) AS calls
  FROM quota_model WHERE day >= date('now','-30 days') GROUP BY email
), grand AS (
  SELECT SUM(cost_usd_micro) AS total FROM quota_model WHERE day >= date('now','-30 days')
)
SELECT email, ROUND(cost_micro/1e6,4) AS cost_usd, calls,
       ROUND(100.0*cost_micro/NULLIF(g.total,0),1) AS pct_of_total
FROM user_cost, grand g ORDER BY cost_micro DESC LIMIT 10;
```

---

## Actions retenues

| # | Action | Type | Qui |
|---|--------|------|-----|
| 1 | Sous-quota Opus dédié (isoler du bucket Sonnet) | Décision offre | **Florent** (puis Claude code) |
| 2 | Réconcilier Console Anthropic vs `quota_model` mars-avril (close le +27 %) | Ops | **Florent** |
| 3 | Alléger le contexte Gmail/Drive injecté (suite BUG 49) | Code (suivi) | Claude, PR dédiée |
| 4 | Fallbacks `getPricing()` pessimistes | Code (défensif, nul aujourd'hui) | Claude, si ajout de modèle |
| 5 | Re-lancer la vigie whales à >40 users actifs | Routine | trimestriel |

**Aucun changement de code dans cette vigie** : c'est une analyse. Les leviers
(quota Opus, markup) sont des décisions business à arbitrer, pas des fixes.

*Sources : agents RÈGLE 7 (Opus×2, Sonnet) + requêtes D1 prod `arty-db` (EU).
Tarifs vérifiés conformes à `functions/api/_lib/pricing.ts`.*
