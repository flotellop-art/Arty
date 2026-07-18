# Veille modèles IA & rapport qualité/coût — 18 juillet 2026

**Demande** (Florent) : « faire le point sur les derniers modèles sortis et ceux
présents sur Arty, et un rapport qualité/coût ».

**Méthode** (RÈGLE 7) : 2 agents Sonnet en parallèle — (1) inventaire exhaustif de
la codebase (routing, clients, proxys, tables de prix, gates de plan, usages
internes) ; (2) veille web sourcée sur les pages officielles des fournisseurs
(5 sous-recherches : Anthropic, Mistral, Google, OpenAI, marché général). Prix
recoupés avec le référentiel Anthropic officiel (skill claude-api, cache 24 juin
2026) et les pages pricing officielles au 18 juillet 2026. Recommandations
alignées sur la boussole stratégique (`competitive-audit-2026-06-actions.md` :
confiance + exclusivité Google, PAS la largeur de catalogue).

---

## TL;DR

1. **🔴 P0 — `gemini-2.5-flash`, le modèle de chat par défaut de la cascade Auto
   (choisi le 13 juin pour son prix, P1.4), est officiellement déprécié par
   Google : arrêt le 16 octobre 2026.** `gemini-2.5-pro` aussi. Il faut re-choisir
   le défaut Gemini avant octobre — et le grounding Search/Maps est 2,5× moins
   cher sur la famille 3.x ($14 vs $35/1000 prompts), donc migrer tôt rapporte.
2. **Anthropic : rien à faire.** Arty est déjà sur la génération courante
   (Sonnet 5 GA du 30 juin, Haiku 4.5, Opus 4.8). Aucun nouveau modèle ni
   changement de prix depuis. Bonus : Sonnet 5 est facturé $2/$10 (intro)
   jusqu'au 31 août — nos tables enregistrent le tarif pérenne $3/$15, donc le
   dashboard surestime légèrement (conservateur, OK).
3. **Mistral : aligné.** Medium 3.5 (v26.04) et Small 4 (v26.03) sont bien les
   modèles courants. Magistral et Devstral sont retirés le 31 juillet — Arty ne
   les utilise pas. Nouveauté intéressante : **Voxtral TTS** ($0.016/1k chars),
   première alternative EU crédible au `tts-1` d'OpenAI (~même prix).
4. **OpenAI : GPT-5.6 est sorti le 9 juillet** (Sol $5/$30 = même prix que le
   5.5 actuel, Terra $2.5/$15, Luna $1/$6). Le défaut `gpt-5.5` d'Arty a une
   génération de retard — swap candidat à iso-prix (Sol) ou à −50 % (Terra).
5. **Transcription : bon choix de modèles, mauvais traçage.** Le proxy enregistre
   TOUT sous le tarif `whisper-1` alors que le modèle réellement servi en
   premier est `gpt-4o-transcribe` (absent de `pricing.ts`) — le dashboard coûts
   et `quota_model` D1 sont faux sur ce poste (esprit BUG 60).
6. **7 incohérences codebase** relevées par l'audit (détail §5), dont l'escalade
   Opus 4.8 structurellement inatteignable pour les abonnés (gate `isPro`
   licence BYOK, pas le plan subscription) et le trial multi-provider câblé
   serveur mais mort côté UI.

---

## 1. Ce qui tourne dans Arty aujourd'hui (inventaire au 18 juillet)

### Par rôle de routing

| Rôle | Modèle servi | Prix in/out ($/MTok) | Notes |
|---|---|---|---|
| Défaut Claude (+ synthèse hybride, résumé compression) | `claude-sonnet-5` | 3 / 15 (intro 2/10 → 31/08) | `aiRouter.ts:408` |
| Small talk / verrou free-trial / fact-check rapide / extraction mémoire | `claude-haiku-4-5-20251001` | 1 / 5 | `aiRouter.ts:392-400` |
| Escalade « rapport stratégique » | `claude-opus-4-8` | 5 / 25 | Gate triple : Pro BYOK + thinking≥10k + regex — quasi inatteignable (§5.3) |
| Défaut Mistral (non trivial) | `mistral-medium-latest` (= Medium 3.5 v26.04) | 1.5 / 7.5 | `mistralClient.ts:32` |
| Small talk Mistral (payants uniquement) | `mistral-small-2603` (= Small 4) | 0.15 / 0.6 | Trial swappé serveur → Medium |
| Défaut chat cascade Auto | `gemini-2.5-flash` | 0.3 / 2.5 | **⚠️ arrêt Google 16/10/2026** |
| Recherche mode hybride | `gemini-3.5-flash` | 1.5 / 9 | GA depuis le 19 mai |
| Défaut ChatGPT | `gpt-5.5` (fallback `gpt-5`) | 5 / 30 | GPT-5.6 sorti depuis |
| Transcription (EU **et** défaut global) | `voxtral-mini-latest` | $0.003/min | Meilleur WER FR, 2× moins cher que Whisper |
| Transcription OpenAI (1er essayé), repli | `gpt-4o-transcribe` → `whisper-1` | ≈$0.006/min | **Non pricé / mal tracé** (§5.1) |
| TTS brief vocal | `tts-1` | ~$15/1M chars | Fixé serveur |
| Image | `gpt-image-1` ($0.04/img) / `flux-2-klein-9b` ($0.015/img) | — | Routage par style |

Sélection UI : providers Claude/Mistral/Gemini/ChatGPT + sous-modèles via le
comparateur. **Opus 4.8 n'est sélectionnable nulle part** (ni sélecteur, ni
comparateur).

Rappel périmètre (P1.9, décision D1 du 5 juillet, encore ouverte) : en mode
Auto, un compte **sans BYOK** est aujourd'hui servi à 100 % par Claude — la
cascade multi-provider ci-dessus ne joue à plein que pour les BYOK. C'est le
levier de coût n°1 côté abonnés (voir §3).

### Legacy / entrées mortes (pricing seulement, jamais appelées)

`claude-opus-4-6/4-7`, `claude-sonnet-4-6` (coûts historiques — légitimes) ;
`codestral-latest`, `flux-2-pro`, `gpt-5.5-mini`, `gpt-5-nano`, `gpt-4o`,
`gemini-3-flash(-preview)`, `gemini-pro-latest`, `gemini-3.1-pro-preview`
(mortes — hygiène possible, §5.4).

---

## 2. Dernières sorties par fournisseur (état au 18 juillet 2026)

### Anthropic — RAS, Arty est à jour

Gamme active : Fable 5 (`claude-fable-5`, $10/$50, 1M ctx), Opus 4.8 ($5/$25),
Opus 4.7/4.6 ($5/$25), **Sonnet 5 ($3/$15 — intro $2/$10 jusqu'au 31/08/2026,
GA 30 juin)**, Sonnet 4.6 ($3/$15), Haiku 4.5 ($1/$5). Aucun nouveau modèle ni
changement de prix depuis fin juin (vérifié docs officielles). Dépréciations :
Opus 4.1 retiré le 5 août (non utilisé) ; `claude-mythos-preview` retiré le
21 juillet (hors périmètre — Project Glasswing). Fable 5 n'est **pas** pertinent
pour Arty : prix 2× Opus, rétention 30 j obligatoire, cible reasoning extrême.

### Mistral — consolidation sur les généralistes, Arty aligné

Source : `mistral.ai/pricing/api/` + `docs.mistral.ai` (HTML officiel parsé).

| Modèle | ID | Prix in/out | Statut |
|---|---|---|---|
| Medium 3.5 (flagship, v26.04) | `mistral-medium-latest` | 1.5 / 7.5 | GA — **défaut Arty ✓** |
| Small 4 (hybride reasoning, v26.03) | `mistral-small-latest` | 0.15 / 0.6 | GA — Arty utilise le snapshot `-2603` ✓ |
| Large 3 (v25.12) | `mistral-large-latest` | 0.5 / 1.5 | GA — quasi orphelin dans Arty (comparateur only) |
| Magistral Medium/Small | `magistral-*` | 2/5, 0.5/1.5 | **Retirés le 31/07/2026** → Medium 3.5 / Small 4. Arty non concerné |
| Devstral 2 | `devstral-medium-latest` | 0.4 / 2 | **Retiré le 31/07/2026**. Non concerné |
| Voxtral Mini Transcribe 2 (v26.02) | `voxtral-mini-latest` | $0.003/min | GA — **défaut transcription Arty ✓** |
| **Voxtral TTS (nouveau, v26.03)** | `voxtral-mini-tts-latest` | $0.016/1k chars | GA — alternative EU au `tts-1` |
| Codestral (v25.08) | `codestral-latest` | 0.3 / 0.9 | GA — entrée Arty morte ET stale (0.2/0.6) |

Signal de fond : Mistral replie ses lignes spécialisées (Magistral, Devstral)
dans les généralistes. Endpoint régional EU confirmé (`api.eu.mistral.ai`,
inférence garantie EU/EFTA) — atout pour la promesse euOnly.

### Google Gemini — ⚠️ le point chaud

Source : `ai.google.dev/gemini-api/docs/pricing` + `/deprecations`.

| Modèle | ID | Prix in/out | Statut |
|---|---|---|---|
| Gemini 3.5 Flash | `gemini-3.5-flash` | 1.5 / 9 | **GA** (19 mai) — hybride Arty ✓ |
| Gemini 3.5 Pro | — | non publié | Preview entreprise, repoussé — **ne pas router dessus** |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | 2/12 (≤200K), 4/18 (>200K) | Preview |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | 0.25 / 1.5 | **GA** |
| Gemini 3 Flash | `gemini-3-flash-preview` | 0.5 / 3 | Preview |
| Gemini 2.5 Pro | `gemini-2.5-pro` | 1.25 / 10 | **Déprécié — arrêt 16/10/2026** |
| Gemini 2.5 Flash | `gemini-2.5-flash` | 0.3 / 2.5 | **Déprécié — arrêt 16/10/2026** — défaut chat Arty ! |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | 0.10 / 0.40 | GA, pas d'arrêt annoncé |

**Grounding** (Search/Maps, cœur du rôle Gemini dans Arty) : famille 3.x =
5 000 prompts gratuits/mois puis **$14/1000** (Search) et **$25/1000** (Maps) ;
famille 2.5 = quotas/jour puis **$35/1000** (Search). → Migrer vers 3.x divise
le coût de grounding par 2,5 en plus d'être obligatoire.

### OpenAI — GPT-5.6 (9 juillet), transcription stable

Source : `developers.openai.com/api/docs/pricing`.

| Modèle | ID | Prix in/out | Statut |
|---|---|---|---|
| GPT-5.6 Sol (flagship) | `gpt-5.6-sol` | 5 / 30 | GA 9 juillet — même prix que 5.5 |
| GPT-5.6 Terra | `gpt-5.6-terra` | 2.5 / 15 | GA |
| GPT-5.6 Luna | `gpt-5.6-luna` | 1 / 6 | GA |
| GPT-5.5 | `gpt-5.5` | 5 / 30 | Toujours listé — défaut Arty actuel |

Transcription : `whisper-1` inchangé ($0.006/min, non déprécié) ;
`gpt-4o-transcribe` recommandé (≈$0.006/min, meilleure qualité) — déjà le 1er
choix d'Arty ✓ ; **`gpt-4o-mini-transcribe` ≈$0.003/min** (palier éco, aligné
sur le prix Voxtral) ; `gpt-4o-transcribe-diarize` (diarisation sans surcoût)
si le besoin réunions émerge. Pas de « GPT-5-transcribe ».

### Marché général (pour situer — anti-objectif catalogue, on n'intègre pas)

- **xAI Grok 4.5** (8 juillet) : $2-4 / $6-12 dynamique, 500K ctx.
- **Meta Llama 4** : rien de neuf en 2026, hébergement tiers only.
- **DeepSeek V4** (mars) : V4-Flash $0.14/$0.28, V4-Pro $0.435/$0.87 — 10-100×
  sous les prix occidentaux, mais serveurs Chine = rédhibitoire pour le
  positionnement EU/privacy (déjà acté en P1.4 : écarté).

---

## 3. Rapport qualité/coût par rôle

Lecture : coût d'un échange type ~2K tokens in / 600 out (hors cache, hors
grounding), qualité relative dans le rôle.

| Rôle Arty | Aujourd'hui | Coût/échange | Verdict qualité/coût | Alternative crédible |
|---|---|---|---|---|
| Chat standard (Auto, clé serveur) | Sonnet 5 | ~1,5 ¢ (1,0 ¢ jusqu'au 31/08) | Excellent en qualité, cher en volume | **P1.9** : dérouter le factuel/web vers Gemini (~0,2 ¢) = levier n°1 de marge |
| Chat cascade Auto (BYOK) | Gemini 2.5 Flash | ~0,21 ¢ | Très bon MAIS **meurt le 16/10** | `gemini-3.1-flash-lite` (~0,14 ¢, GA, −33 %) ou `2.5-flash-lite` (~0,044 ¢) à qualifier FR |
| Small talk | Haiku 4.5 / Small 4 | ~0,5 ¢ / ~0,07 ¢ | Bien calibré | — |
| Rapports lourds | Opus 4.8 | ~3,25 ¢ | Meilleur rapport qualité/prix du tier frontier ($5/$25 vs GPT-5.6 Sol $5/$30) | Problème d'accès, pas de modèle (§5.3) |
| Mistral payants | Medium 3.5 | ~0,75 ¢ | Bon, EU | Large 3 ($0.5/$1.5) coûte 3× moins en output — à benchmarker FR, curiosité tarifaire |
| Hybride recherche | Gemini 3.5 Flash | ~0,84 ¢ + grounding | Justifié (agentique long) | Grounding 3.x à $14/1000 dès migration |
| ChatGPT | GPT-5.5 | ~2,8 ¢ | Une génération de retard | 5.6 Sol iso-prix (drop-in) ou Terra −50 % |
| Transcription | Voxtral ($0.18/h) | — | Optimal (qualité FR + prix + EU) | `gpt-4o-mini-transcribe` pour aligner le repli non-EU à $0.003/min |
| TTS | tts-1 (~$0.015/1k chars) | — | OK | **Voxtral TTS** $0.016/1k = iso-prix mais EU (cohérence euOnly) |
| Image | gpt-image-1 / Flux Klein | 4 ¢ / 1,5 ¢ | Routage par style déjà optimisé (P1.3) | — |

Points d'économie structurels confirmés par la veille :
1. **P1.9** (routage Auto multi-provider sur clé serveur) reste le plus gros
   levier de marge : Sonnet ~7× plus cher que Gemini Flash sur le chat factuel.
2. **Migration Gemini 3.x** : grounding 2,5× moins cher + un candidat
   (`3.1-flash-lite`) moins cher que l'actuel en tokens.
3. **Sonnet 5 intro** : jusqu'au 31/08, le coût réel Anthropic est ~33 % sous
   nos tables — la marge réelle est meilleure que le dashboard ne l'affiche.

---

## 4. Actions recommandées

### P0 — avant le 16 octobre 2026
- [ ] **Migrer le chat Auto hors de `gemini-2.5-flash`** (arrêt Google 16/10).
  Candidats par ordre : `gemini-3.1-flash-lite` (GA, $0.25/$1.5, −33 % vs
  actuel), `gemini-2.5-flash-lite` (GA, $0.10/$0.40, non déprécié mais même
  famille condamnée à terme), `gemini-3.5-flash` (qualité max, 5×). Exige la
  vigie qualité FR rapide comme en P1.4 (grounding/function calling supportés à
  vérifier sur le candidat). Le killswitch `arty-gemini-cheap-disabled` et le
  pattern de bascule P1.4 sont réutilisables tels quels. ⚠️ `gemini-2.5-pro`
  (comparateur) meurt aussi le 16/10 → le retirer/remplacer dans
  `providerCatalog.ts`. À COUPLER avec P1.9 pour ne faire qu'une seule vigie.

### P1 — dette d'exactitude coûts (esprit BUG 60) & produit
- [ ] **Fix traçage transcription** : `whisper-proxy.ts:117` enregistre
  `whisper-1` quel que soit le modèle servi ; `gpt-4o-transcribe` n'a pas
  d'entrée `pricing.ts`. Ajouter l'entrée + tracer le modèle réel.
- [ ] **Trancher l'escalade Opus 4.8** (décision produit, pas un fix mécanique) :
  gate actuel = licence Pro BYOK (39 €) + thinking≥10k + regex FR étroite →
  aucun abonné subscription ne peut l'atteindre, et Opus n'est dans aucune UI.
  Options : (a) assumer (Opus = jamais sur clé serveur, documenter) ;
  (b) l'ouvrir au plan subscription dans le bucket Sonnet+Opus existant
  (cf. vigie éco : sous-quota Opus à arbitrer) ; (c) l'exposer au comparateur
  pour les BYOK. Lié au trou « trial multi-provider mort » (§5.2).
- [ ] **GPT-5.6** : swap `gpt-5.5` → `gpt-5.6-sol` (iso-prix) après vérif
  d'éligibilité du compte (le pattern fallback 5.5→5 existe déjà dans
  `openaiClient.ts`) ; évaluer Terra ($2.5/$15) comme défaut si la qualité
  suffit — −50 % sur le poste ChatGPT.

### P2 — hygiène & options
- [ ] Purger/annoter les entrées de pricing mortes (`codestral` — au passage
  stale 0.2/0.6 vs 0.3/0.9 officiel —, `flux-2-pro`, `gpt-5.5-mini`,
  `gpt-5-nano`, `gpt-4o`, `gemini-3-flash*`) + fixer la normalisation
  `gpt-5.5-mini` → `gpt-5-mini` (dashboard local −2× si un jour câblé).
- [ ] Évaluer **Voxtral TTS** comme TTS du chemin euOnly (iso-prix, EU) —
  aujourd'hui le brief vocal passe par OpenAI `tts-1` pour tout le monde.
- [ ] Évaluer `gpt-4o-mini-transcribe` comme repli non-EU (−50 %).
- [ ] MAJ CLAUDE.md BUG 58 : « Trial/free gardent Small par défaut » est
  obsolète (free = Mistral verrouillé ; trial = swap serveur vers Medium).

### À NE PAS faire (aligné anti-objectifs)
- ❌ Intégrer DeepSeek/Grok/Llama malgré leurs prix — largeur de catalogue =
  anti-objectif assumé, DeepSeek déjà écarté (serveurs Chine, P1.4).
- ❌ Router vers Gemini 3.5 Pro (pas GA, ID/prix non confirmés) ou tout ID
  preview comme défaut.
- ❌ Fable 5 ($10/$50) : hors cas d'usage et hors économie du plan.

---

## 5. Incohérences codebase relevées (audit RÈGLE 7)

1. **Transcription mal tracée (P1 ci-dessus)** — `gpt-4o-transcribe` (1er modèle
   essayé à chaque appel, `whisperClient.ts:101`) absent de `pricing.ts`, usage
   enregistré sous `whisper-1` (`whisper-proxy.ts:117`). Dashboard coûts et
   `quota_model` D1 faux sur ce poste.
2. **Trial multi-provider mort côté UI** — `TRIAL_ALLOWED_MODELS`
   (`checkAllowedUser.ts:285-291`) autorise gemini-flash/mistral-medium/
   gpt-5-mini et les proxys ont les branches trial, mais `normalizePlan`
   (`subscription/status.ts:93-96`) collapse trial→free → `allowed_families` =
   `['claude-haiku']` → `getProviderAvailability()` bloque avant envoi. Backend
   câblé pour rien, ou UI à ouvrir — à trancher.
3. **Escalade Opus gatée sur la mauvaise notion de « Pro »** —
   `aiRouter.ts:404` teste `isProActivated()` (licence BYOK one-shot), pas le
   plan subscription. Un abonné classique ne peut JAMAIS être routé Opus ; Opus
   absent de toute UI. Choix produit à confirmer ou bug de câblage.
4. **9 entrées de pricing mortes** (grep exhaustif) — dont `gemini-3-flash`
   jamais sorti en GA (le commentaire `pricing.ts:85` l'admet) et `codestral`
   au tarif stale. `pricingParity.test.ts` ne les couvre pas toutes.
5. **`gpt-5.5-mini` : bug de normalisation dormant** — pricé serveur ($0.5/$3),
   absent du client → `normaliseModel` le rabat sur `gpt-5-mini` ($0.25/$2) =
   coût local sous-estimé 2× s'il est un jour câblé.
6. **Opus absent du comparateur** — même un Pro BYOK ne peut pas le forcer
   manuellement (cohérent avec §3 mais à décider explicitement).
7. **Mistral Large 3 quasi orphelin** — jamais routé automatiquement,
   comparateur only ; ironie tarifaire : $0.5/$1.5, moins cher que Medium 3.5
   en sortie (5×) — vaut un benchmark FR par curiosité avant de statuer.

---

## Sources

- Anthropic : référentiel officiel skill claude-api (cache 24/06/2026) +
  `platform.claude.com/docs/en/about-claude/model-deprecations` (vérifié live).
- Mistral : `mistral.ai/pricing/api/` (HTML parsé),
  `docs.mistral.ai/getting-started/models/models_overview/`,
  `docs.mistral.ai/studio-api/regional-inference/`.
- Google : `ai.google.dev/gemini-api/docs/pricing`,
  `ai.google.dev/gemini-api/docs/deprecations`.
- OpenAI : `developers.openai.com/api/docs/pricing`,
  `developers.openai.com/api/docs/models/whisper-1`,
  `platform.openai.com/docs/models/gpt-4o-transcribe-diarize`.
- Marché : `docs.x.ai/developers/models`,
  `api-docs.deepseek.com/quick_start/pricing/`.
- Codebase : audit agent Sonnet (fichiers/lignes cités dans le corps du texte).

*Rapport généré le 18 juillet 2026. Prochaine veille suggérée : début octobre
(deadline Gemini du 16/10 + fin du tarif intro Sonnet 5 au 31/08).*
