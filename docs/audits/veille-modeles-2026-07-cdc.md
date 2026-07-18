# Cahier des charges — chantiers de la veille modèles du 18 juillet 2026

Référence : `docs/audits/veille-modeles-2026-07.md` (rapport + rectificatif P1.9).
Branche : `claude/modeles-qualite-cout-gwiwps` (PR #356 — documentation uniquement).

**Méthode (RÈGLE 7)** : cartographie technique par agent Sonnet (93 vérifications
file:line dans le code) + challenge du plan par agent Opus (verdicts, risques,
critères de vigie). Le finding majeur du challenge — P1.9 déjà livré par la
PR #334 du 12 juillet — a été contre-vérifié en lecture directe puis rectifié
dans le rapport et dans `competitive-audit-2026-06-actions.md`.

**Principe de découpage** : cette PR ne code RIEN. Chaque chantier ci-dessous =
une PR dédiée future, avec sa vigie propre. Les chantiers marqués ⛔ exigent une
décision écrite de Florent AVANT tout code. Les gardes intouchables communes à
tous les chantiers : données privées → Claude (BUG 12), euOnly → Mistral,
Pro = BYOK (3 proxys, `proKeyRequiredResponse`).

---

## Vue d'ensemble

| # | Chantier | Verdict | Taille | Bloqué par |
|---|---|---|---|---|
| C1 | Migration Gemini chat 2.5 → 3.x (deadline 16/10) | ✅ **FAIT (18/07, PR C1)** — chat basculé sur `gemini-3.5-flash` (décision Florent : le candidat éco 3.1-flash-lite a une régression FACTS Grounding documentée −19 % [40.6 vs 50.4, model card DeepMind] → bascule sûre d'abord, downgrade éco à re-décider après la vigie C2). Recherche de validation : tools 4/4 confirmés sur le lite, contexte 1M identique, grounding $14/1000. Comparateur : les 3 entrées 2.5 retirées (D-B), 3.5-flash ajouté. Killswitch conservé (inerte, futur rollback). `geminiClient.test.ts` créé (1er test du client). Suivis : copy « 80 Gemini Pro » orphelin ; entrée Pro à réintroduire à la GA de 3.5 Pro ; downgrade lite conditionné à vigie C2 + test live google_search | S/M | — |
| C2 | P1.9 — re-scopé : vigie + reliquat trial | ✅ **Volet 1 FAIT (18/07, `vigie-routage-2026-07.md`)** — routage multi-provider confirmé actif en prod (Gemini/Mistral reçoivent du trafic Auto), vérif D-A tranchée (dominant = gpt-5.5 → C3 GO), échantillon pré-lancement (n=2) → re-vigie à >40 users actifs/30 j. Volet 2 (trial) : statu quo D-C maintenu jusqu'à la re-vigie | S | — |
| C3 | Défaut ChatGPT → gpt-5.6-terra | ✅ **FAIT (18/07, PR C3)** — swap DEFAULT_MODEL (fallback gpt-5 conservé) + les 4 sous-chantiers : pricing serveur $2.5/$15, MODEL_COSTS client, labels Sol/Terra/Luna distincts (formatModelName), listes de parité (ROUTABLE_IDS, pricingParity, premiumModelClassification). `openaiClient.test.ts` créé (1er test du client). D-A résolue par la vigie C2 (dominant = gpt-5.5 → Terra −50 %, cap 100 inchangé). **Bonus revue (agents profonds)** : bug pré-existant de DOUBLE-CONSOMMATION corrigé — quota journalier + cap premium étaient consommés avant le fetch upstream sans remboursement, donc le retry d'éligibilité (Terra rejeté → gpt-5) brûlait 2 unités/message ; ajout `voidPremiumCap` (monthly_cap + re-crédit pack) et `voidDailyQuota` (2 tables), câblés sur TOUS les chemins d'échec upstream du proxy OpenAI (invariant « consommé ⟺ servi ») + 6 tests D1 réels. Le wallet avait déjà son void (vérifié Opus). Docs watcher + commentaires stale corrigés | M | — |
| C4 | Traçage transcription (nom du modèle) | ✅ **FAIT (18/07, PR C4)** — le modèle est lu DU BODY forwardé (`request.clone().formData()`, borné 10 Mo), validé par allowlist {gpt-4o-transcribe, whisper-1} (hors allowlist → 400 sans forward, trou de relais fermé), quota ET coût tracés sous le modèle réel ; entrée pricing `gpt-4o-transcribe` (approximation $/min documentée) ; invariant C3 appliqué (voidDailyQuota sur échec upstream — le fallback client refaisait consommer) ; `whisperProxyModel.test.ts` créé | M | — |
| C5 | web_search 20250305 → 20260209 | ✅ **FAIT (18/07, PR C5)** — fact-check.ts + garde de version dans factCheckEndpoint.test.ts (interdit aussi le retour au 20250305 et la déclaration manuelle d'exécution de code, BUG 10). Reste : smoke test prod post-deploy (latence passe 2 vs 25-30 s baseline) ; chat principal (toolDefinitions.ts) volontairement en 2e étape | S | — |
| C6 | Hygiène pricing + normalisation | ✅ **FAIT (18/07, PR #357)** — entrées annotées (pas supprimées), codestral 0.3/0.9, fix gpt-5.5-mini + parité | S | — |
| C7 | Voxtral TTS euOnly | **Différé** (aucun consommateur) | M/L si repris | Un cas d'usage euOnly réel |
| C8 | MAJ doc BUG 58 | ✅ **FAIT (18/07, PR #357)** — formulation deux couches free/trial | S | — |
| C11 | (nouveau, revue produit C1) **Traçage du coût de grounding Gemini** | ✅ **FAIT (18/07, PR #364)** — `createGeminiParser` détecte `groundingMetadata` avec preuve réelle (webSearchQueries/groundingChunks non vides ou searchEntryPoint), plafonné 1/prompt ; colonne D1 `grounded_prompts` (VOLUME) + tarif `groundingPerPrompt` ($14/1000, 3.5-flash + 3.1-flash-lite). **Design corrigé en revue (2 relecteurs convergents)** : la borne haute est DÉRIVÉE (`groundingUpperBoundMicroUsd`), JAMAIS mélangée dans `cost_usd_micro` — sinon biais du conseiller de facturation vers l'abo + dashboard gonflé sans explication (BUG 60) + divergence ledger wallet. Le wallet ne débite jamais ce poste (testé runtime). **Vigie : borne haute = `SUM(grounded_prompts) × $0.014`** (nuance : les prompts groundés Maps, SKU distinct, sont comptés dans le même volume au tarif Search — borne indicative). Facturation réelle souvent 0 (palier gratuit ~5 000/mois partagé) | S/M | — |
| C12 | (nouveau, revue produit C1) **Copy « 80 Gemini Pro » structurellement mensonger** | ✅ **FAIT (18/07, PR à suivre)** — copy retiré des 5 clés fr/en (upsell 218-219 → « Gemini » tout court, subDesc/a1/subscriptionDescription → « 150 Sonnet/Opus + 100 GPT-5 ») + lp/prix ; le bucket est masqué DANS LA RÉPONSE `subscription/status` → disparaît aussi des vieux APK, `unknown-model` (filet technique affiché en brut dans le tooltip) masqué au passage. **Décision produit tracée (revue, 2 relecteurs Sonnet)** : masque CONDITIONNEL `hiddenIfUnused` — si une consommation RÉELLE existe (modèle forgé, ou dérive « client déployé avant l'entrée pricing »), la ligne RÉAPPARAÎT → un cap ne fond jamais sans ligne visible, avertissement anticipé du badge préservé, et les labels de secours CapReachedModal/ChatOptionsSheet ne sont plus du code mort ; **le cap serveur reste enforcé** (checkPremiumCap intact). Garde anti-dérive `c12GeminiProCopy.test.ts` : « Gemini Pro » dans locales OU dans TOUT dossier `public/lp/*` (itération dynamique) OU retrait du filtre → CI rouge. Réintroduction copy+affichage inconditionnel UNIQUEMENT avec un vrai chemin (GA 3.5 Pro) | S | — |
| C9 | (nouveau) Traçage coût TTS inexistant | ✅ **FAIT (18/07, PR #357)** — tts-1 pricé ($15/1M chars), recordUsage waitUntil clé serveur ; relecture 2 agents (Opus sécu GO 5/5 + Sonnet régressions GO, suite 1230/1230). Résiduel LOW documenté : `count` D1 reste 1/jour (structurel recordUsage, coût exact) | S | — |

**Ordre d'exécution recommandé** (challenge Opus) : C6+C8+C9 (quick wins) →
C5 (après validation live) → C1 (+ vigie couplée à la télémétrie C2) → C4 →
C3 (dès décision D-A). C7 sort du lot courant.

**Non-chantier assumé** : la fin du tarif intro Sonnet 5 (31/08, $2/$10 →
$3/$15) ne demande AUCUN code — `pricing.ts:28-31` et `costTracker.ts:20-23`
inscrivent déjà le tarif pérenne ; jusqu'au 31/08 le dashboard sur-estime
légèrement (conservateur, voulu).

---

## C1 — Migration Gemini chat : `gemini-2.5-flash` → ~~`gemini-3.1-flash-lite`~~ **`gemini-3.5-flash`** (réalisé)

> **⚠️ RÉALISÉ DIFFÉREMMENT DE LA SPEC CI-DESSOUS (18/07, PR C1).** La
> recherche de validation a chiffré une régression FACTS Grounding de −19 %
> sur le candidat lite (40.6 vs 50.4, model card DeepMind) → décision
> Florent : bascule sûre sur `gemini-3.5-flash` (GA, remplaçant recommandé
> par Google). Conséquences vs la spec historique conservée ci-dessous :
> (1) le killswitch est INERTE (chat == recherche) — **rollback de C1 =
> redéploiement uniquement, assumé** (revenir à un modèle éteint le 16/10
> serait une impasse ; 3.5-flash servait déjà la recherche hybride en prod) ;
> (2) coût réel (revue produit) : tokens ×4 mais **−40 % sur un tour groundé**
> (le grounding domine et passe de $35 à $14/1000) ; (3) le downgrade éco
> vers le lite reste possible après la vigie C2 + test live google_search —
> le killswitch retrouverait alors son rôle. La spec ci-dessous reste comme
> trace du plan initial.

**Deadline dure : 16 octobre 2026** (arrêt Google de 2.5 Flash ET 2.5 Pro).
Blast-radius : depuis la PR #334, ce défaut sert AUSSI les abonnés clé serveur,
pas seulement les BYOK.

**Fichiers** : `src/services/geminiClient.ts:25` (`GEMINI_CHAT_MODEL`),
`:14-24` (bloc de commentaire à réécrire — son argument « grounding 2.5 moins
cher » est désormais inversé), `src/services/comparator/providerCatalog.ts:50-51`
(retirer `gemini-2.5-pro` ET `gemini-2.5-flash`), `src/services/modelLabels.ts:123,160`
(commentaires). `GEMINI_RESEARCH_MODEL` (3.5-flash, `:32`) ne bouge PAS.

**Bonne nouvelle vérifiée** : `gemini-3.1-flash-lite` est DÉJÀ câblé partout —
`pricing.ts:81`, alias `costTracker.ts:80`, `providerCatalog.ts:49`, cases de
`pricingParity.test.ts:20`. La partie mécanique se réduit au swap de constante.

**Tests** : `modelLabels.test.ts:101` (`ROUTABLE_IDS` — LE verrou central :
label + région + capacité + coût en un test), `:103` (entrée 2.5-pro),
`pricingParity.test.ts:17-18` (garder si legacy conservé — recommandé, coûts
historiques), cosmétiques (`modelPerMessage`, `routeExplanation`,
`premiumModelClassification:24`). **Créer `geminiClient.test.ts`** : aucun test
du killswitch ni de `geminiChatModel()` n'existe.

**Pièges** :
1. Aucune logique conditionnelle par modèle pour les tools
   (`geminiClient.ts:232-236` choisit selon la requête) — si le candidat gère
   mal `google_maps`, aucun garde-fou logiciel : seule la vigie protège.
2. Killswitch `arty-gemini-cheap-disabled` → bascule vers 3.5-flash (connu
   bon) : cible à conserver telle quelle, c'est le bon secours post-16/10.
3. Effet de bord confiance : retirer 2.5-pro du comparateur vide encore plus
   le bucket « 80 Gemini Pro » vendu dans le copy P0.10 (déjà quasi-orphelin —
   rien ne route vers `gemini-pro` en Auto). À traiter via D-B.

**Vigie (avant bascule, critères de rollback)** : 50-100 requêtes FR
représentatives (factuel/web, itinéraires/maps, météo, rédaction) jouées sur
2.5-flash vs candidat. Rollback si : (a) le moindre drop d'invocation
`google_search`/`google_maps`/`url_context` (tolérance zéro — cœur du rôle) ;
(b) qualité FR nettement pire sur >15 % de l'échantillon ; (c) fenêtre de
contexte < ~200K (la boucle d'outils injecte jusqu'à ~150K, P0.9) ; (d) FACTS
Grounding dégradé (seul bench où 2.5 garde l'avantage).

**Décision D-B (Florent)** : `gemini-2.5-pro` n'a AUCUN remplaçant GA (3.5 Pro
en preview, 3.1-pro-preview = preview). Options : (a) retirer Gemini Pro du
comparateur sans remplaçant (= retrait de fonctionnalité) ; (b) exposer
`gemini-3.1-pro-preview` étiqueté préversion ; (c) attendre 3.5 Pro GA.
Recommandation : (a) maintenant + (c) quand GA — cohérent avec « ne pas router
vers un ID preview ».

**Critère d'acceptation** : plus aucune référence routable à `gemini-2.5-*`
hors entrées de coût historique ; vigie documentée dans la PR ; killswitch
testé.

---

## C2 — P1.9 : re-scopé en « vigie + reliquat trial »

**NE PAS RÉ-IMPLÉMENTER.** Livré pour le plan `subscription` par la PR #334
(12/07) : `PAID_FAMILIES` (`subscription/status.ts:27`) → `serverAllows`
(`availability.ts:57-63`) → cascade Auto (`resolveRoute.ts:138-142`).
`availability.test.ts:116-149` le fige (« plus jamais 100 % Claude »). Les
gardes BUG 12 (`resolveRoute.ts:107-111`) et euOnly (`:56-63`) sont déjà
correctes. Case P1.9 cochée a posteriori dans le plan d'action (18/07).

**Ce qui reste — volet 1 (vigie, jamais faite, prérequis de la décision D1)** :
télémétrie sur fenêtre glissante : (a) % des requêtes abonnés Auto par provider ;
(b) marge €/abonné (D1 `cost_usd_micro`) vs baseline Claude-only pré-#334 ;
(c) taux de régénération sur réponses Gemini-routées vs Claude-routées (proxy
qualité) ; (d) contrôle BUG 12 : zéro requête « mes mails/Drive/agenda » routée
hors Claude. **Rollback une ligne** : `serverAllows → false`
(`availability.ts:25`, documenté dans le fichier). Fenêtre commune avec la
vigie C1 (le modèle choisi en C1 devient celui que les abonnés reçoivent),
métriques distinctes.

**Ce qui reste — volet 2 (reliquat trial, incohérence §5.2 du rapport)** :
`normalizePlan` (`subscription/status.ts:93-96`) ne renvoie jamais `'trial'` →
la branche trial d'`availability.ts:56` est du code mort client → un essai
reste 100 % Haiku malgré `TRIAL_ALLOWED_MODELS` (`checkAllowedUser.ts:238-243`)
et les branches trial des 3 proxys, entièrement câblées serveur.

**Décision D-C (Florent)** : (a) ouvrir réellement le trial multi-provider
(faire remonter un statut `trial` + ses familles — `subscription/status.ts:93-96,125-138`,
`availability.ts:56`, tests `availability.test.ts` end-to-end +
`subscriptionStatusEntitlement.test.ts`) ; ou (b) assumer « essai = Haiku » et
purger les branches trial serveur mortes. Piège si (a) : ne pas relâcher la
garde Pro=BYOK des 3 proxys.

**Critère d'acceptation** : volet 1 = rapport de vigie chiffré ; volet 2 =
décision D-C actée puis le code et la doc alignés sur UNE seule réalité.

---

## C3 — Défaut ChatGPT : `gpt-5.5` → `gpt-5.6-terra` ⛔

**⛔ Décision D-A (Florent) — économie CORRIGÉE en review (l'analyse initiale
était inversée)** : le bucket premium « 100 GPT-5 » capte automatiquement
Terra (`checkPremiumCap.ts:88-90`, `startsWith('gpt-5.')`). Le modèle
réellement servi aujourd'hui dans ce bucket est **`gpt-5.5` à $5/$30**
(DEFAULT_MODEL, `openaiClient.ts:21`) — `gpt-5` ($1.25/$10) n'est que le
fallback des comptes non éligibles. **Terra ($2.5/$15) divise donc par 2 le
coût du chemin dominant.** L'analyse initiale (« Terra = 2× le coût ») était
fondée sur le nom technique du bucket, pas sur le modèle servi. Reste avant
de coder : (a) vérifier en D1 (`quota_model`) la part réelle du fallback
`gpt-5` — seule sous-population pour laquelle Terra serait un renchérissement
(2×) ; (b) confirmer que le cap 100 reste inchangé (probable : le coût
baisse). D-A devient une vérification + un feu vert, plus un arbitrage lourd.

**Sous-chantiers OBLIGATOIRES découverts par la cartographie** (sans eux, le
swap est un bug de facturation actif) :
1. **`pricing.ts`** : `gpt-5.6-terra` ABSENT → `computeCostMicroUsd` retombe
   sur `FALLBACK_PRICING` $15/$75 (`pricing.ts:93-98`) = **sur-facturation
   wallet/D1 ~6×** sur clé serveur. Ajouter l'entrée ($2.5/$15) + Sol/Luna si
   exposés.
2. **`costTracker.ts`** : sans alias, `normaliseModel` rabat par préfixe sur
   `gpt-5` ($1.25/$10) = sous-estimation client 2×. Serveur et client
   divergeraient dans des sens OPPOSÉS.
3. **`modelLabels.ts:174-180`** : la regex `formatModelName` extrait « 5.6 » →
   Sol/Terra/Luna tous affichés « GPT-5.6 », indistinguables (anti-drift PR
   #323 violé en esprit). Ajouter l'extraction du suffixe, comme pour Gemini
   (`:164-170`).
4. **Ajout MANUEL aux listes de parité** : `ROUTABLE_IDS`
   (`modelLabels.test.ts:104`), `pricingParity.test.ts:14`,
   `premiumModelClassification.test.ts:9`. ⚠️ Ces tests itèrent sur des listes
   codées en dur : ils resteraient VERTS si on oublie d'y ajouter terra — ce
   sont des rappels, pas des garde-fous automatiques.

**Fichiers** : `openaiClient.ts:21-22` (`DEFAULT_MODEL`, et décider
`FALLBACK_MODEL` : garder `gpt-5` recommandé — le pattern retry 400/404 de
`startChatRequest` `:106-126` est réutilisable tel quel), + les 4 sous-chantiers.
Option : rattraper le comparateur (`providerCatalog.ts:66-72` n'a même pas
gpt-5.5). **Créer `openaiClient.test.ts`** (le fallback n'a aucune couverture).

**Cadrage** : même provider → PAS un RÈGLE 3 complet, mais nettement plus
qu'un swap de constante.

**Critère d'acceptation** : coût D1 d'un message Terra = $2.5/$15 exactement
(pas le fallback) ; coût client identique ; labels Sol/Terra/Luna distincts ;
décision D-A documentée dans la PR.

---

## C4 — Traçage transcription : le modèle réel, pas `whisper-1`

**Urgence requalifiée à la baisse** (challenge) : le € est aujourd'hui correct
(gpt-4o-transcribe ≈ whisper-1 ≈ $0.006/min) — seul le NOM en D1 est faux.
C'est de l'exactitude de données (esprit BUG 60), pas une fuite d'argent.

**Constat structurel** : le proxy streame `request.body` tel quel (préserve le
boundary multipart, `whisper-proxy.ts:77-89`) → il ne PEUT pas lire le champ
`model` du FormData sans le consommer. Le client, lui, sait
(`whisperClient.ts:99-109` : gpt-4o-transcribe d'abord, whisper-1 en repli —
deux requêtes HTTP distinctes, aucun état partagé).

**Solution retenue (CORRIGÉE en review — le body est la source de vérité,
pas un header)** : la première version proposait un header `x-transcribe-model`
allowlisté ; objection review fondée : un header peut mentir par rapport au
champ `model` du multipart réellement transmis à OpenAI (client ancien ou
malveillant → quota/coût faussés — inoffensif aujourd'hui à prix quasi égaux,
faux dès qu'un palier moins cher comme `gpt-4o-mini-transcribe` existe).
Solution : le proxy lit le champ `model` DU BODY via
`await request.clone().formData()` — c'est exactement ce qu'OpenAI servira,
donc la vérité de facturation par construction. Coût mémoire du clone borné
par le cap existant `MAX_BODY_BYTES` 10 Mo (`whisper-proxy.ts:16`) —
acceptable ; si la mémoire Workers pose problème en pratique, repli :
reconstruire le FormData côté proxy (parse unique + re-émission). Le modèle
extrait est **validé contre l'allowlist** {`gpt-4o-transcribe`, `whisper-1`}
(RÈGLE 6) — hors allowlist : 400 (le proxy ne forwarde pas un modèle
arbitraire sur la clé serveur, durcissement bonus vs l'existant). La valeur
validée alimente les DEUX points hardcodés : `consumeDailyQuota`
(`whisper-proxy.ts:68`) ET `recordUsage` (`:117`) — en corriger un seul
rendrait quota et coûts incohérents entre eux. Aucun changement client requis
(anciens clients inclus : le champ `model` est déjà dans le FormData,
`whisperClient.ts:80-93`).

**Pricing** : ajouter `gpt-4o-transcribe` dans `pricing.ts` avec `audioPerSec`
approximé (~$0.006/min) — la vraie facturation OpenAI est par tokens audio,
mais `parseWhisperBody` (`trackUsage.ts:246-258`) n'extrait que `duration` ;
documenter l'approximation dans le fichier.

**Tests** : créer un test whisper-proxy (aucun n'existe) : FormData avec
`model=gpt-4o-transcribe` → quota + coût tracés sous ce nom ; avec
`model=whisper-1` → idem whisper-1 ; champ `model` absent → défaut
`whisper-1` (compat) ; modèle hors allowlist → 400 sans forward. + case
`pricingParity` si le client price aussi.

**Audit sécu (RÈGLE 6, endpoint touché)** : auth inchangée ; le modèle tracé
vient du body réellement forwardé, validé par allowlist (pas d'injection D1,
pas de désynchronisation header/body possible) ; le rejet hors allowlist
FERME un trou existant (aujourd'hui le proxy forwarde n'importe quel `model`
du FormData sur la clé serveur) ; pas de nouveau leak d'erreur ; Origin/CSRF
inchangés ; pas de relais infra nouveau.

**Critère d'acceptation** : une transcription gpt-4o-transcribe apparaît sous
son nom dans `quota_model` D1 et l'écran Coûts ; le repli whisper-1 reste
correct ; option `gpt-4o-mini-transcribe` (−50 %) notée pour plus tard.

---

## C5 — Fact-check passe 2 : `web_search_20250305` → `web_search_20260209`

**Fichier** : `fact-check.ts:255` (un littéral). **Découverte cartographie** :
`toolDefinitions.ts:16` (chat principal Claude) est AUSSI sur `20250305`,
alors que `web_fetch_20260209` est déjà à jour juste en dessous (`:21`) —
asymétrie qui ressemble à un oubli, PAS un choix.

**Séquencement recommandé** (pas de décision Florent requise) : qualifier
`20260209` d'abord sur le fact-check (volume faible, rollback trivial), PUIS
étendre au chat principal dans une seconde étape si la vigie est bonne — en
documentant explicitement l'état transitoire à deux versions.

**Préalable (allégé en review)** : la doc Anthropic confirme que
`web_search_20260209` supporte Sonnet 5 et auto-provisionne l'exécution
nécessaire — le préalable se réduit à un smoke test en prod avant merge
(pas un point bloquant).

**Pièges** : BUG 10 — ne JAMAIS ajouter `code_execution` dans TOOLS au passage
(auto-injecté par l'API) ; latence passe 2 (25-30 s prod) à re-mesurer, le
filtrage dynamique peut jouer dans les deux sens.

**Tests** : ajouter dans `factCheckEndpoint.test.ts` une assertion sur le
`type` du tool envoyé (aucun test ne fige la version aujourd'hui).

**Critère d'acceptation** : passe 2 verte en prod sur claims réels, latence
≤ baseline, verdicts non dégradés sur un échantillon.

---

## C6 — Hygiène pricing + fix normalisation

**Cartographie exacte des 9 entrées « mortes »** (le rapport les rangeait à
tort toutes dans les deux fichiers) :
- `pricing.ts` seulement : `codestral-latest` (:71, tarif stale 0.2/0.6 vs
  0.3/0.9 officiel), `flux-2-pro` (:62), `gpt-5.5-mini` (:50), `gpt-5-nano`
  (:54), `gpt-4o` (:55), `gemini-3-flash` (:88), `gemini-3-flash-preview` (:89).
- `costTracker.ts` seulement : alias `gemini-pro-latest` (:86),
  `gemini-3-flash*` (:81-82).
- `gemini-3.1-pro-preview` : AUCUNE entrée nulle part (commentaire + regex +
  test seulement) — rien à purger.

**⚠️ Piège sérieux** : supprimer `gpt-5.5-mini`/`gpt-5-nano` de `pricing.ts`
CHANGE le comportement du cap premium — `hasKnownPricing()` passe à false et
`checkPremiumCap.ts:99` les ferait tomber dans le bucket `unknown-model`
(cap 80) au lieu d'être exemptés (`:79`, `-mini`/`-nano`).
`premiumModelClassification.test.ts` le détecterait, mais facile à rater en
review. **Recommandation : ANNOTER (« mort, conservé comme ancre de coût
historique / exemption cap ») plutôt que supprimer**, sauf `codestral-latest`
dont le tarif stale doit être corrigé ou l'entrée retirée.

**Fix normalisation (indépendant de la purge)** : `costTracker.ts:99` —
`'gpt-5.5-mini'.includes('mini')` → rabat sur `gpt-5-mini` ($0.25/$2) au lieu
de $0.5/$3 serveur. Ajouter l'alias/entrée explicite OU tester l'ordre des
règles pour que `gpt-5.5*` ne matche jamais `gpt-5-mini`.

**Critère d'acceptation** : `premiumModelClassification.test.ts` et
`pricingParity.test.ts` verts SANS modification de leurs attentes de
comportement ; chaque entrée conservée porte un commentaire disant pourquoi.

---

## C7 — Voxtral TTS euOnly : DIFFÉRÉ (justification)

**NO-GO du challenge, confirmé par la cartographie** :
1. **Aucun consommateur** : le seul appelant de `/api/ai/tts` est
   `MorningBrief.tsx:117-124` — un écran global HORS conversation, donc sans
   flag `euOnly` à exploiter (euOnly est un flag PAR CONVERSATION,
   `types/index.ts` ; aucun réglage global n'existe). Construire un chemin EU
   pour un usage inexistant = sur-engineering, anti-objectif.
2. Nouvelle intégration Mistral TTS = RÈGLE 3 partielle + RÈGLE 6 + nouveau
   champ de pricing (facturation par caractère, inexistant dans
   `ModelPricing`) — taille réelle M/L, pas un « swap ».
3. ⚠️ Ne pas confondre `src/utils/tts.ts` (TTS navigateur natif du chat) avec
   le proxy `tts.ts` (brief vocal OpenAI) — deux systèmes distincts.

**Condition de reprise** : un vrai cas d'usage euOnly (ex. « lire ce message à
voix haute » dans une conversation EU). À ce moment-là : proxy dédié sur le
pattern `tts.ts`, champ pricing par caractère, audit RÈGLE 6 complet.

---

## C8 — MAJ doc BUG 58 (CLAUDE.md:822)

Remplacer la phrase « Trial/free utilisateurs gardent Small par défaut (cap
quota) » par une formulation à DEUX COUCHES (harmonisée en review avec C2 —
la version initiale de ce CDC se contredisait entre C2 « trial = 100 % Haiku »
et C8 « trial = Mistral Medium ») :

> « Small n'est plus jamais servi aux non-payants. **Free** :
> `allowed_families = ['claude-haiku']` — aucun accès Mistral, ni UI ni
> serveur. **Trial** : côté CLIENT, vu comme `free` (`normalizePlan` ne
> renvoie jamais `trial`) → chat Auto = Haiku uniquement en pratique ; côté
> SERVEUR, `TRIAL_ALLOWED_MODELS` autoriserait 4 familles dont
> `mistral-medium` (jamais Small, retiré en mai 2026) avec swap proxy vers
> Medium — branches aujourd'hui inatteignables via l'UI (cf. D-C).
> **Payants** : Small réservé aux messages triviaux, Medium 3.5 défaut. »

Vérifié contre `checkAllowedUser.ts:236-243,285-291`,
`subscription/status.ts:12,25,93-96`. Les deux couches (réalité client vs
câblage serveur) doivent TOUTES DEUX apparaître, sinon la doc redevient
fausse dans un sens ou l'autre.

---

## C9 (nouveau) — Traçage coût TTS inexistant

**Découverte cartographie, absent du rapport** : `functions/api/ai/tts.ts` n'a
AUCUN `recordUsage` et `tts-1` n'a AUCUNE entrée `pricing.ts` — le brief vocal
dépense la clé OpenAI du owner sans laisser une seule ligne en D1 (angle mort
total du dashboard coûts, esprit BUG 60). Indépendant de C7.

**Changements** : entrée `tts-1` dans `pricing.ts` (nouveau champ « par
caractère » ou approximation par unité, ~$15/1M chars — documenter le choix) +
`recordUsage` dans `tts.ts` (le texte est côté serveur : `text.length` connu).
Audit RÈGLE 6 au passage (endpoint touché). Taille S.

**Critère d'acceptation** : chaque brief vocal apparaît en D1 avec son coût.

---

## Décisions Florent — TRANCHÉES le 18 juillet 2026 (session quick wins)

- **D-A : GO après vérif D1.** Swap Terra validé sous réserve de vérifier
  d'abord en D1 la part réelle du fallback `gpt-5` ; cap 100 inchangé ;
  les 4 sous-chantiers pricing/labels/parité obligatoires.
- **D-B : retirer Gemini Pro du comparateur maintenant** (dans la PR C1),
  réintroduction à la GA de Gemini 3.5 Pro.
- **D-C : statu quo trial jusqu'à la vigie C2 volet 1** — la vigie chiffrera
  le coût d'un essai multi-provider avant d'ouvrir (ou de purger).
- **D-D : ouvrir l'escalade Opus 4.8 aux abonnés** dans le bucket
  Sonnet+Opus existant, sous-quota Opus à définir (cf. vigie éco 14/06) —
  nouveau chantier C10 à spécifier.

## Décisions Florent en attente (récapitulatif — historique pré-décision)

| ID | Question | Bloque | Recommandation |
|---|---|---|---|
| D-A | Bucket « 100 GPT-5 » : confirmer le swap Terra (−50 % vs gpt-5.5 servi aujourd'hui — économie corrigée en review) après vérif D1 de la part du fallback gpt-5 | C3 | Vérif D1 puis GO : Terra dans le bucket, cap 100 inchangé |
| D-B | Gemini Pro au comparateur : retirer sans remplaçant GA, exposer un preview, ou attendre 3.5 Pro ? | C1 (partie comparateur) | Retirer maintenant, réintroduire à la GA de 3.5 Pro |
| D-C | Trial multi-provider : ouvrir pour de vrai ou purger le code serveur mort ? | C2 volet 2 | Trancher après la vigie C2 volet 1 (chiffrer le coût réel d'un essai multi-provider) |
| D-D | Escalade Opus 4.8 (gate Pro BYOK, regex étroite, absent de toute UI) — rapport §5.3 | Hors chantiers (décision produit pure) | (b) du rapport : ouvrir au bucket Sonnet+Opus subscription, sous-quota à arbitrer (cf. vigie éco 14/06) |

*Rédigé le 18 juillet 2026 (PR #356). Toute PR qui traite un chantier DOIT
cocher la vue d'ensemble ci-dessus (date + n° de PR), comme pour le plan
d'action concurrentiel.*
