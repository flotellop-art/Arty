# Point complet — veille modèles juillet 2026 : état final après exécution (18 juillet 2026)

**Référence** : rapport de veille `veille-modeles-2026-07.md` (PR #356) et son
CDC d'exécution `veille-modeles-2026-07-cdc.md`. Ce document est le **point
complet final** demandé par Florent après l'exécution de la chaîne complète
des chantiers (18 juillet 2026, PRs #356 → #365).

---

## 1. Ce qui a été livré aujourd'hui (10 PRs mergées, toutes CI vertes)

| PR | Chantier | Contenu |
|---|---|---|
| #356 | Rapport + CDC | Veille modèles complète + 4 annexes comparatives + CDC 12 chantiers, décisions D-A/D-B/D-C/D-D tranchées |
| #357 | C6 + C8 + C9 | Tables de coût corrigées/annotées (entrées mortes conservées avec ⚠️, codestral $0.3/$0.9), doc free/trial clarifiée (CLAUDE.md BUG 58), **traçage TTS** (tts-1, $15/1M chars — n'était pas tracé du tout) |
| #358 | C5 | Fact-check : `web_search_20260209` (compatible Sonnet 5) + garde de version en CI |
| #360 | C1 | **Chat Gemini : 2.5-flash → 3.5-flash** (le remplaçant GA recommandé ; le candidat lite écarté sur −19 % FACTS Grounding) ; catalogue comparateur réduit (D-B) ; killswitch inerte assumé, rollback = redéploiement |
| #361 | C2 | **Vigie routage** sur D1 prod : routage multi-provider confirmé en vrai, D-A vérifiée (dominant = gpt-5.5), protocole à rejouer à >40 users/30 j |
| #362 | C3 | **ChatGPT : défaut → gpt-5.6-terra** ($2.5/$15, −50 % vs gpt-5.5 servi) + fix **double-consommation quota/cap** sur le retry d'éligibilité (voidPremiumCap/voidDailyQuota, 6 tests D1 réels) — invariant « consommé ⟺ servi » établi |
| #363 | C4 | **Transcription tracée sous le modèle réel** (gpt-4o-transcribe essayé en premier, whisper-1 en repli) : allowlist RÈGLE 6 depuis le body réellement forwardé (ferme un trou de relais de modèle arbitraire), remboursement sur échec upstream, fix dashboard (les modèles de transcription ne fusionnent plus dans gpt-5/gpt-5-mini) |
| #364 | C11 | **Traçage du grounding Gemini** : volume `grounded_prompts` en D1 (détection groundingMetadata avec preuve réelle, 1/prompt max), coût borne haute DÉRIVÉ (`SUM × $0.014`), jamais mélangé au coût facturable (revue : sinon biais du conseiller de facturation + dashboard gonflé) ; wallet jamais débité ; ALTER exécuté sur la prod |
| #365 | C12 | **Copy « 80 Gemini Pro » retiré** (5 clés fr/en + lp/prix) — promesse sans chemin de consommation depuis C1 ; bucket masqué de la réponse status TANT QUE non consommé (réapparaît si consommation réelle — jamais de cap qui fond sans ligne visible) ; cap serveur toujours enforcé |

Chaque chantier code a été relu par **2 agents en parallèle** (RÈGLE 7 —
Opus pour les angles sécu/facturation, Sonnet pour les régressions) et leurs
findings intégrés avant merge. Deux bugs pré-existants ont été trouvés et
corrigés au passage grâce à ces revues : la double-consommation de quota
(C3) et la fusion voxtral→« gpt-5-mini » à l'écran Coûts (C4).

## 2. État du routeur après les bascules

| Chemin | Modèle servi | Tarif | Traçage D1 |
|---|---|---|---|
| Auto / Claude | Sonnet 5 (défaut), Opus 4.8 (escalade), Haiku 4.5 (free) | $3/$15 · $5/$25 · $1/$5 | ✅ tokens + cache |
| ChatGPT | **gpt-5.6-terra** (retry gpt-5 si compte non éligible) | $2.5/$15 | ✅ + remboursement sur échec |
| Gemini (chat ET recherche) | **gemini-3.5-flash** | $1.5/$9 | ✅ + volume groundé (C11) |
| Mistral | Medium 3.5 (défaut payant), Small 4 (small talk) | $1.5/$7.5 · $0.15/$0.6 | ✅ |
| Transcription | **gpt-4o-transcribe** → whisper-1 (repli) | ~$0.006/min | ✅ sous le modèle réel (C4) |
| Dictée EU (euOnly) | voxtral-mini | $0.003/min | ✅ (ligne propre depuis C4) |
| TTS (brief vocal) | tts-1 | $15/1M chars | ✅ (C9 — nouveau) |
| Images | gpt-image-1 / FLUX klein | $0.04 · $0.015/img | ✅ |

**Économie des bascules** (ordres de grandeur établis en revue) : tour ChatGPT
−50 % ; tour Gemini groundé −40 % (le grounding 3.x à $14/1000 vs $35/1000
domine, malgré des tokens ~×4) ; le tour Gemini NON groundé coûte plus cher
qu'avant (~×4 tokens) — d'où l'option « downgrade éco » gardée en réserve
(killswitch `arty-gemini-cheap-disabled`, aujourd'hui inerte).

**Invariant nouveau, appliqué partout où un compteur précède un fetch** :
« quota/cap consommé ⟺ réponse servie » (remboursement testé sur openai-proxy
et whisper-proxy ; les autres proxys consomment après vérifs ou ne re-fetchent
pas). Résiduel documenté : le repli voxtral→whisper INTER-endpoints refait
consommer (pré-existant, INFO, à traiter si la vigie whales le montre).

## 3. Données vigie C2 (rappel) et angle mort résorbé

- **Échantillon pré-lancement : n=2 utilisateurs, 13 appels, ~$1.37** sur la
  fenêtre post-#334 — faits qualitatifs uniquement, aucune stat.
- **Le routage multi-provider fonctionne en prod** : Gemini ~23 % des appels
  Auto, Mistral servi, « plus jamais 100 % Claude » observé en réel.
- **D-A vérifiée** : gpt-5 = un seul jour de tests (24/04) ; le chemin vivant
  était gpt-5.5 → la bascule Terra divise bien par 2.
- **L'angle mort grounding chiffré par la vigie** (borne haute = 3× le coût
  tokens sur l'échantillon) **est résorbé par C11** : dès maintenant, chaque
  prompt groundé incrémente `grounded_prompts` en D1. La prochaine vigie fera
  `SUM(grounded_prompts) × $0.014` au lieu d'estimer à l'aveugle.
- **À rejouer à >40 utilisateurs actifs/30 j** (protocole écrit dans
  `vigie-routage-2026-07.md`) — avec, cette fois, le volume groundé réel.

## 4. Décisions ouvertes (rien de bloquant)

| Sujet | État | Déclencheur |
|---|---|---|
| **C10 — escalade Opus** | D-D tranchée (« ouvrir aux abonnés ») ; à SPÉCIFIER puis implémenter (critères d'escalade Sonnet→Opus dans selectClaudeSubModel, coût borné par le bucket 150) | Prochaine session de dev |
| **D-C — familles trial** | Statu quo assumé (le client voit trial=free→Haiku ; les 4 familles serveur `TRIAL_ALLOWED_MODELS` restent inatteignables via l'UI) | Re-vigie >40 users |
| **Downgrade éco Gemini** | Option en réserve : rebrancher le killswitch vers un modèle moins cher si le tour non-groundé pèse ; désormais MESURABLE grâce à C11 (part groundée vs non-groundée) | Re-vigie >40 users |
| **C7** | Sorti du lot courant (décision CDC) | — |
| **C14 — quota transcription en secondes** | Différé (cap body 10 MB borne le coût/appel) | Vigie whales |

## 5. Échéances calendaires à surveiller

- **31/08/2026 — fin du tarif intro Sonnet 5** ($2/$10 → $3/$15). **Aucun
  code à changer** : pricing.ts et costTracker.ts inscrivent déjà le tarif
  pérenne ; d'ici là le dashboard sur-estime légèrement (conservateur, voulu).
- **16/10/2026 — arrêt Google de la famille Gemini 2.5** (2.5-pro, 2.5-flash,
  2.5-flash-lite). **Aucun client Arty ne route dessus depuis C1** ; les
  entrées pricing restent (valorisation de l'historique D1). Rien à faire —
  garde : ne JAMAIS re-router vers un modèle 2.5.
- **Go-live Creem** (hors périmètre veille, rappel) : IDs produits TEST à
  remplacer par les LIVE au lancement commercial (TODO `⚠️ replace at
  go-live` dans le code).

## 6. Tests terrain restants (Florent, quand tu utilises l'app)

1. **C5** : lancer un fact-check en prod (bouton ✓ sur une réponse) — vérifier
   qu'il rend un verdict normal après la bascule de version web_search.
2. **C1/C3** : usage normal chat — vérifier que rien ne « sent » différent
   (qualité Terra vs 5.5, Gemini 3.5-flash en recherche).
3. **C4** : une dictée → l'écran Mes coûts doit montrer une ligne
   `gpt-4o-transcribe` (ou `whisper-1`) distincte, plus jamais fusionnée.
4. **C11** : après une question actu/recherche via Gemini, la colonne
   `grounded_prompts` doit s'incrémenter en D1 (visible aussi via
   `/api/ai/quota/status`).

---

*Rédigé en clôture de la session veille du 18 juillet 2026. Prochaine
échéance de veille : re-vigie C2 à >40 utilisateurs actifs, ou tout
changement tarifaire des providers (routine watcher-ai-models).*
