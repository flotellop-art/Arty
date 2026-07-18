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
   génération de retard — **reco : Terra** (−50 %, qualité quasi-Sol — annexe A).
   Luna : à NE PAS intégrer (long-contexte effondré — annexe A).
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

**⚠️ RECTIFICATIF (18 juillet, contre-audit Opus du CDC)** : la première
version de ce rapport affirmait ici que « en mode Auto, un compte sans BYOK
est servi à 100 % par Claude » et que P1.9 restait à implémenter. **C'est
faux depuis le 12 juillet** : la PR #334 « Refonte du routage des modèles
IA » (commit `8703258`) a livré P1.9 — `PAID_FAMILIES = [...ALL_FAMILIES]`
(`subscription/status.ts:27`) → `serverAllows` (`availability.ts:57-63`) →
cascade Auto multi-provider **sur clé serveur** (`resolveRoute.ts:138-142`).
Un abonné sans BYOK est donc DÉJÀ routé Gemini (factuel/web), Mistral
(trivial), hybride (rapports), Claude (privé/URLs/fichiers — garde BUG 12
inchangée). Conséquences : (1) le « levier marge n°1 » est déjà actif —
reste à le MESURER (vigie, jamais faite) ; (2) le blast-radius de la
migration Gemini P0 inclut les abonnés, pas seulement les BYOK ; (3)
rollback une ligne documenté dans `availability.ts:25`.

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
| Chat Auto — tous comptes, hors données privées (post-PR #334) | Gemini 2.5 Flash | ~0,21 ¢ | Très bon MAIS **meurt le 16/10** — et sert désormais AUSSI les abonnés | `gemini-3.1-flash-lite` (~0,14 ¢, GA, −33 %) ou `2.5-flash-lite` (~0,044 ¢) à qualifier FR |
| Données privées / URLs / fichiers (BUG 12) | Sonnet 5 | ~1,5 ¢ (1,0 ¢ jusqu'au 31/08) | Excellent — le bon modèle pour ce rôle | Intouchable (contrainte données, pas coût) |
| Small talk | Haiku 4.5 / Small 4 | ~0,5 ¢ / ~0,07 ¢ | Bien calibré | — |
| Rapports lourds | Opus 4.8 | ~3,25 ¢ | Meilleur rapport qualité/prix du tier frontier ($5/$25 vs GPT-5.6 Sol $5/$30) | Problème d'accès, pas de modèle (§5.3) |
| Mistral payants | Medium 3.5 | ~0,75 ¢ | Bon, EU | Large 3 ($0.5/$1.5) coûte 3× moins en output — à benchmarker FR, curiosité tarifaire |
| Hybride recherche | Gemini 3.5 Flash | ~0,84 ¢ + grounding | Justifié (agentique long) | Grounding 3.x à $14/1000 dès migration |
| ChatGPT | GPT-5.5 | ~2,8 ¢ | Une génération de retard | 5.6 Sol iso-prix (drop-in) ou Terra −50 % |
| Transcription | Voxtral ($0.18/h) | — | Optimal (qualité FR + prix + EU) | `gpt-4o-mini-transcribe` pour aligner le repli non-EU à $0.003/min |
| TTS | tts-1 (~$0.015/1k chars) | — | OK | **Voxtral TTS** $0.016/1k = iso-prix mais EU (cohérence euOnly) |
| Image | gpt-image-1 / Flux Klein | 4 ¢ / 1,5 ¢ | Routage par style déjà optimisé (P1.3) | — |

Points d'économie structurels confirmés par la veille :
1. **P1.9 est déjà livré (PR #334, rectificatif ci-dessus)** — le levier
   marge n°1 (Sonnet ~7× le prix de Gemini sur le factuel) est actif en
   prod ; ce qui manque est la **vigie** (part des requêtes par provider,
   marge €/abonné, taux de régénération, contrôle BUG 12) — jamais faite.
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
  pattern de bascule P1.4 sont réutilisables tels quels. ⚠️ Le comparateur
  expose **les deux** modèles condamnés : `gemini-2.5-pro` (`providerCatalog.ts:50`)
  ET `gemini-2.5-flash` (`:51`) → retirer/remplacer les deux, sinon 404 en
  prod après le 16/10. La vigie C1 se couple à la télémétrie P1.9 (déjà
  livré, PR #334 — rectificatif §1) qui sert de baseline.

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
- [ ] **GPT-5.6 : swap `gpt-5.5` → `gpt-5.6-terra`** ($2.5/$15, −50 % sur le
  poste ChatGPT). Les benchs (annexe A) placent Terra quasi au niveau de Sol
  (long-contexte 89,6 % vs 91,5 %) et la presse spécialisée converge sur
  « défaut = Terra, escalade = Sol ». Vérifier l'éligibilité du compte (le
  pattern fallback 5.5→5 de `openaiClient.ts` est réutilisable) ; Sol en
  option comparateur/BYOK seulement. ⚠️ Le bucket premium « 100 GPT-5 »
  facture aujourd'hui sur `gpt-5` ($1.25/$10) — décider explicitement quel
  modèle le bucket sert (Terra = 2× le coût du bucket).

### P2 — hygiène & options
- [ ] **Fact-check passe 2 : passer de `web_search_20250305` à
  `web_search_20260209`** (filtrage dynamique des résultats, dispo Sonnet 5)
  — précision meilleure + tokens économisés à iso-architecture
  (`fact-check.ts:255`). À valider en vigie (latence passe 2 : 25-30 s en
  prod, le filtrage peut jouer dans les deux sens). Le routing fact-check
  lui-même ne bouge PAS (annexe D : la contrainte dominante est que le
  vérificateur doit déjà voir la conversation → Anthropic verrouillé).
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
- ❌ Intégrer GPT-5.6 Luna : rappel long-contexte effondré (41,3 % — annexe A),
  rédhibitoire pour un assistant qui injecte mails/Drive (~150K tokens de
  boucle d'outils). Iso-prix Haiku, 4× le prix de gpt-5-mini : aucun rôle.
- ❌ Router vers Gemini 3.5 Pro (pas GA, ID/prix non confirmés) ou tout ID
  preview comme défaut.
- ❌ Fable 5 ($10/$50) : hors cas d'usage et hors économie du plan.
- ❌ Déplacer le fact-check vers Gemini/OpenAI malgré le grounding Google
  « meilleur sur le papier » : le fact-check reçoit question + réponse (donc
  potentiellement du contenu Gmail/Drive) — un nouveau destinataire des
  données privées violerait BUG 12 et la promesse de confiance (annexe D).

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

## 6. Annexes comparatives (18 juillet — questions de Florent)

⚠️ Précaution de lecture commune : chiffres à J+9 du lancement GPT-5.6,
configurations de reasoning pas toujours comparables (ex. Sonnet mesuré à
« max effort » vs Terra à « medium »), et aucun de ces benchs ne mesure le
français ni l'usage assistant-personnel. Ordres de grandeur, pas classement
au point près. Tout déroutage réel passe par une vigie FR maison (pattern
P1.4).

### A. GPT-5.6 : Sol / Terra / Luna face à l'écurie Arty

| Palier | Prix in/out | Concurrent direct Arty | Signal qualité |
|---|---|---|---|
| Sol | $5/$30 | Opus 4.8 ($5/$25) | Nouveau SOTA agentique (Agents' Last Exam 53,6) et coding index (80) ; Opus 17 % moins cher en sortie |
| Terra | $2.5/$15 | Sonnet 5 ($3/$15 ; intro $2/$10) | Quasi-Sol sur le long-contexte (89,6 % vs 91,5 %) pour moitié prix — « défaut = Terra, escalade = Sol » |
| Luna | $1/$6 | Haiku 4.5 ($1/$5), gpt-5-mini ($0.25/$2) | **Long-contexte effondré : 41,3 %** — disqualifiant pour Arty ; ne remplace ni Haiku (iso-prix) ni mini (4× moins cher) |

Sources : artificialanalysis.ai, vellum.ai, openai.com, the-agent-report.com.

### B. Terra vs Sonnet 5 (qualité)

Même classe, coude-à-coude : Intelligence Index AA 53 (Sonnet, max) vs 46
(Terra, medium) ; coding général nettement Sonnet (76,7 vs 63,4) ;
SWE-Bench Pro ex æquo (63,2 / 63,4) ; Terminal-Bench Terra devant (87,4 vs
80,4) ; connaissances factuelles avantage Terra ; leaderboard BenchLM 85/84.
**Conclusion Arty** : aucune raison de toucher au backbone Sonnet (boucle
d'outils, agentique, rédaction, architecture données privées, prix intro
jusqu'au 31/08) ; Terra = meilleur défaut du provider ChatGPT ; son point
fort factuel est déjà couvert — en mieux — par le grounding Gemini.
Sources : artificialanalysis.ai, benchlm.ai, merge.dev, datacamp.com.

### C. Gemini : niveau réel et validation du candidat de migration

Le sommet GA de Google est `gemini-3.5-flash` — une demi-classe sous
Sonnet 5/Terra en raisonnement brut (Terminal-Bench 76,2 vs 80,4/87,4 ;
Intelligence Index ~55) mais imbattable sur son terrain : grounding
Search/Maps natif, multimodal, vitesse, prix ($1.5/$9). Google n'a AUCUN
frontier GA (3.5 Pro bloqué en preview) → le découpage Arty « Gemini
cherche, Claude rédige » reste objectivement optimal.
**Candidat migration P0 validé** : `gemini-3.1-flash-lite` bat
`gemini-2.5-flash` sur 3 benchs sur 4 (GPQA Diamond 86,9 %, HLE, SimpleQA)
avec 2,5× moins de latence, +45 % de débit, ~1,5× moins cher. Trois
vérifications restantes : FACTS Grounding (le seul bench où 2.5 garde
l'avantage — cœur du rôle Arty), fenêtre de contexte exacte (< 1M), vigie
FR + support tools (`google_search`/`google_maps`/`url_context`).
Sources : blog.google, llm-stats.com, cometapi.com, datacamp.com,
buildfastwithai.com.

### D. Fact-checking : pourquoi le routing actuel est le bon

Setup (PR #327) : passe 1 Haiku sans web (60/j, tri rapide) → passe 2
Sonnet 5 + web_search (15/j, claims risqués). La contrainte dominante n'est
pas la qualité factuelle brute : **le vérificateur reçoit question +
réponse, donc potentiellement du contenu Gmail/Drive — il doit être un
fournisseur qui voit DÉJÀ la conversation**. Ça verrouille Anthropic.
Gemini+grounding serait « meilleur » et moins cher sur le papier ($14/1000
prompts groundés) mais ajouterait un destinataire des données privées
(contre BUG 12) ; Terra/Luna : même objection, gain nul (la faiblesse
long-contexte de Luna serait ici sans objet — payloads ~4K tokens — mais
iso-prix Haiku). Le web search de la passe 2 bat de toute façon les
connaissances paramétriques de n'importe quel modèle sur le factuel frais.
Seule amélioration retenue : variante `web_search_20260209` (action P2).

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
