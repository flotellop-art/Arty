# Audit concurrentiel Arty — juin 2026

**Date** : 12 juin 2026
**Méthode** : 8 agents de recherche parallèles (inventaire codebase + recherche web multi-sources : sites officiels, Trustpilot, Pappers, Reddit/HN, blogs spécialisés FR/EN, données économiques API). Claims clés croisés sur 2+ sources indépendantes.
**Question** : qu'est-ce qu'Arty doit améliorer ou changer pour devenir la référence du segment « discount » des assistants IA multi-modèles — similaire ou mieux pour moins cher, marge faible assumée, volume avant marge ?

---

## 0. Résumé exécutif — le « secret »

Le marché des agrégateurs IA pas chers est encombré (Mammouth, Poe, Abacus ChatLLM, Monica, Merlin, T3 Chat, NinjaChat, Krater…) mais **toutes les plaintes virales des utilisateurs convergent vers le même mot : la confiance**. Quotas opaques, downgrade silencieux vers des modèles inférieurs, crédits qui brûlent sans explication, soupçon de modèles dégradés, facturation après annulation, support fantôme, pas d'essai gratuit. Aucun acteur du segment n'a résolu ça — c'est structurel chez eux, car leur marge dépend de l'opacité.

**Le secret du discounter qui gagne n'est pas le catalogue le plus large, c'est la confiance dans le prix bas** — exactement le modèle Lidl/Aldi : assortiment plus réduit que Carrefour, mais prix lisibles, qualité constante, zéro mauvaise surprise. Arty peut être le premier agrégateur **honnête** :

1. **Limites affichées en clair, en messages, pas en « crédits »** — « 150 msg Claude Sonnet + 100 GPT + 80 Gemini Pro + illimité standard » est déjà plus généreux ET plus lisible que le « 50 messages premium / 3 h » opaque de Mammouth. Il faut l'afficher frontalement, avec compteur en temps réel dans l'app.
2. **Jamais de downgrade silencieux** — quand le cap est atteint, le dire et proposer le choix. C'est la plainte n°1 du marché et ça ne coûte rien.
3. **Essai gratuit visible** — la critique n°1 de Mammouth sur Trustpilot est « pas d'essai gratuit ». Arty a déjà 30 messages de trial : c'est une arme marketing sous-exploitée.
4. **L'exclusivité que personne n'a sous 20 $/mois : tes mails, ton Drive, ton agenda dans Claude/Mistral**. Gemini est le seul à le faire bien — avec ses propres modèles uniquement. Aucun agrégateur discount n'a d'intégrations Google sérieuses. C'est le différenciateur d'Arty et son switching cost (rétention).

La stratégie « volume avant marge » est économiquement validée : un utilisateur moyen coûte ~1–3 $/mois en API avec un bon routage. À 9,99 €/mois la marge brute est ~60–67 % même en étant 2× plus généreux que Mammouth. Le risque n'est pas le prix : ce sont les whales et les appels à contexte massif (analyse de 200 mails, gros PDFs) — il faut des caps par appel, pas seulement par mois.

**Mais avant toute stratégie : les fondamentaux**. Arty a aujourd'hui des manques de table stakes qui tuent la crédibilité au premier contact (pas de coloration syntaxique, pas de bouton copier, partage cassé, listes numérotées cassées, pas de custom instructions, pas de génération d'images). Un discounter peut être en dessous du marché sur le prix, jamais sur les fondamentaux.

---

## 1. État des lieux Arty (inventaire codebase, v1.0.79)

### Forces réelles (vérifiées dans le code)

| Atout | Détail | Position marché |
| --- | --- | --- |
| Intégrations Google profondes | Gmail 11 tools, Drive 10, Calendar 4, Contacts 2, Sheets 2 — actions réelles via API, pas du scraping | **Unique sous 20 $/mois**. Personne d'autre ne le fait (Gemini seul, avec ses modèles) |
| Routage intelligent | aiRouter : privé→Claude, YouTube→Gemini, trivial→Haiku/Mistral, hybride recherche+rédaction | Niveau « AI orchestrator », au-dessus du simple model switcher des concurrents |
| BYOK 4 providers | Anthropic/Gemini/Mistral/OpenAI, chiffré AES-256 local | Capte le segment power users (~10-15 % du marché) |
| Mode EU verrouillé | Conversations euOnly → Mistral uniquement | Argument B2B/pro réglementé, tie-breaker B2C |
| Fact-checker intégré | Post-pass auto avec contexte de recherche | Aucun concurrent mainstream ne l'a |
| Comparateur side-by-side | 2 modèles en parallèle | Parité avec Poe/ChatPlayground |
| Voix | Dictée Web Speech + Whisper, TTS | Parité marché |
| Mémoire double | D1 serveur (profil/clients/projets/notes) + mémoire locale chiffrée | Au-dessus de la plupart des agrégateurs (Poe/You.com : rien) |
| Caps déjà lisibles | 150 Sonnet + 100 GPT + 80 Gemini Pro/mois, codés dans checkPremiumCap | **Déjà plus transparent que tout le marché — mais pas exploité en marketing** |
| Page coûts | Dashboard usage par modèle, source serveur D1 | Transparence rare |

### Faiblesses bloquantes (table stakes manquants ou cassés)

| Manque | Gravité | Référence |
| --- | --- | --- |
| Pas de coloration syntaxique des blocs de code | **Bloquant** — n'importe quel chat IA l'a | frontend-audit-2026-06-10.md:77 |
| Pas de bouton « Copier » (message + bloc de code) | **Bloquant** — action la plus fréquente d'un chat IA | frontend-audit:73 |
| Partage de conversation cassé (data: URI incollable) | **Bloquant** — et c'est un canal d'acquisition gratuit perdu | frontend-audit:28 |
| Listes numérotées cassées (`ol` sans compteur) | Bloquant | frontend-audit:79 |
| Pas de génération d'images | Élevé — devenu « attendu par défaut » en 2026 | ROADMAP.md:34 |
| Pas de custom instructions / system prompt utilisateur | Élevé — standard chez ChatGPT/Claude/Gemini ET chez Mammouth (« Mammouths »), Poe (bots), Abacus | systemPrompt.ts (fixe) |
| Pas de projets/dossiers | Élevé — Mammouth a « Projects », Claude/ChatGPT aussi | — |
| Pas de régénération de réponse (« Retry ») | Élevé | — |
| Titres de conversation auto cassés (1re conv + EU) | Moyen | frontend-audit:84 |
| Boutons invisibles au tactile (suppression, branche : `group-hover`) | Moyen — Arty est mobile-first ! | MessageList.tsx:55 |
| Pas d'app iOS publiée | Élevé — plafond de verre d'acquisition (55-60 % des dépenses mobiles EU/US) | ios/ existe, pas de soumission |
| ~15 composants non traduits EN | Moyen — bloque l'expansion hors FR | frontend-audit:135 |
| Onboarding sommaire (4 slides emojis) | Moyen | WelcomeSlides.tsx |
| Mémoire non automatique (l'IA doit décider d'appeler update_memory) | Moyen — la mémoire qui « marche silencieusement » est le facteur de rétention n°1 | — |

---

## 2. Le concurrent direct : Mammouth AI

Données croisées (2 dossiers indépendants, sources : mammouth.ai/pricing + quota-policy fetchés en direct, Pappers, Trustpilot, LinkedIn).

- **Société** : SAS parisienne créée sept. 2024, bootstrappée (capital 2 000 €), 2 fondateurs (HEC), équipe passée à ~4 personnes. Trafic ~2,1 M visites/mois (mai 2026), ×9,6 en 18 mois. **C'est une petite équipe : battable sur l'exécution.**
- **Pricing** : Starter 12 $/mois (~10 € HT), Standard 24 $, Expert 72 $. Prix affichés HT → surprise TVA pour les particuliers FR (plainte récurrente).
- **Quota** : ~50 messages premium **par fenêtre glissante de 3 h** (Starter). Power users à sec en 1 h 30. Au dépassement : **bascule automatique silencieuse** vers un modèle inférieur (Opus→Sonnet→Haiku, GPT→mini).
- **Catalogue** : très large — 20+ LLM (OpenAI, Anthropic, Google, Mistral, Grok, DeepSeek, Qwen, Kimi, GLM, Llama, Perplexity Sonar), images (GPT Image, SD 3.5, Recraft, Flux…), **vidéo depuis avril 2026** (Sora 2, Veo 3.1 Lite, Kling 2.5), voix. Midjourney retiré.
- **Features** : reprompting 1-clic (signature), « Mammouths » (assistants personnalisés cross-modèles), Projets, recherche web Perplexity, OCR 50 pages, API compatible OpenAI, SSO entreprise. **App Android native sur le Play Store depuis mai 2026** ; iOS = PWA seulement.
- **Limites non divulguées avant achat** : contexte plafonné à **100 000 caractères même sur Gemini Pro** (qui en supporte 1 M en natif) ; les modèles frontière (Claude Opus, GPT-5 plein) **absents du catalogue réel** malgré le marketing « tous les modèles ».
- **Réputation** : **Trustpilot 2,6–2,9/5**. Plaintes dans l'ordre : (1) pas d'essai gratuit, (2) quotas trop restrictifs, (3) soupçon de modèles dégradés (« j'ai l'impression de revenir en 2019 »), (4) downgrade silencieux, (5) crédits non reportés, (6) support lent, (7) remboursement difficile. Points aimés : prix vs 3 abonnements séparés, interface FR, RGPD (serveurs Allemagne, rétention 30 j), mises à jour fréquentes.
- **Verdict des testeurs** : « outil de découverte et de comparaison, pas un remplacement pour le travail intensif ».

**Lecture stratégique** : Mammouth gagne sur la largeur du catalogue et la notoriété FR naissante ; il perd sur la confiance (Trustpilot 2,6), la profondeur (pas de mémoire, pas d'intégrations, contexte peu fiable en conversation longue) et la transparence. Arty ne doit PAS courir après son catalogue — il doit attaquer ses 7 plaintes une par une.

---

## 3. Panorama du marché (juin 2026)

| Service | Prix d'entrée payant | Modèles | Image gen | Mémoire | Intégrations Google | App mobile | Plainte signature |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Mammouth** | 12 $/mois | 20+ | Oui (+vidéo) | Non | Non | Android natif, iOS PWA | Quotas 3 h opaques, pas de trial |
| **Poe** | 4,99–19,99 $/mois | 200+ | Oui (+vidéo) | Non | Non | iOS+Android | Compute points opaques (1 requête = 30-40 K pts), free tier −90 % en mars 2026 |
| **Abacus ChatLLM** | 10 $/mois | 20+ | Non | Oui | Non | iOS+Android | Crédits qui brûlent inexplicablement, support absent |
| **You.com** | 20 $/mois | majeurs | Oui | Non | Non | iOS+Android | Crédits non-rollover, support 2,3/5 |
| **Monica** | ~8,30 $/mois (annuel) | majeurs | Oui | Oui | Non | iOS+Android | Facturation après annulation |
| **Merlin** | 19 $/mois | 20+ | Oui | Non | Non | Extension | « Unlimited » mensonger |
| **T3 Chat** | 8 $/mois | 5-6 | Non | Non | Non | Non | Claude capé à 100 msg/mois |
| **TypingMind** | 39 $ one-time (BYOK) | tous | Oui | Non | Non | **Non** | Pas de mobile, BYOK complexe |
| **OpenRouter** | pay-as-you-go | 300+ | API | Non | Non | Non | Pas grand public |
| **Perplexity Pro** | 20 $/mois | 6-8 | Oui | Non | Non | iOS+Android | Cher hors usage recherche |
| **Arty aujourd'hui** | 9,99 €/mois (+ Pro 39 € lifetime) | 4 providers | **Non** | **Oui** | **Oui (unique)** | Android (Play en cours), iOS ✗ | — (pas encore de notoriété) |

**Les 3 trous du marché identifiés** (aucun acteur ne combine) :
1. **Discounter mobile-first avec app native de qualité** — TypingMind/T3/OpenRouter n'ont pas de mobile, Mammouth vient seulement de sortir Android.
2. **Transparence totale des limites** — plainte la plus virale du segment, chez tous.
3. **Intégrations Gmail/Drive/Calendar sous 20 $/mois** — personne. C'est LA case d'Arty.

**Prix psychologique validé : 8–10 $/mois.** En dessous de 8 $ : « trop beau pour être vrai ». Au-dessus de 15 $ : concurrence frontale avec ChatGPT Plus/Claude Pro à 20 $. T3 Chat (8 $) et Abacus (10 $) ont prouvé la traction de cette fourchette. **Le 9,99 €/mois d'Arty est déjà au bon endroit.**

---

## 4. Ce que les utilisateurs demandent (signaux forts, multi-sources)

### Demandes (par force du signal)
1. **Multi-modèles en un seul abonnement** — la demande n°1. Les Américains abonnés paient en moyenne 66 $/mois pour 4 outils IA ; 24 % dépassent 100 $/mois ; **75 % veulent tous leurs abonnements IA regroupés en une seule facture** (Bango, n=2 000). La consolidation est LE moteur du segment.
2. **Mémoire cross-sessions** — facteur de rétention n°1 (« ne plus se réexpliquer »). Valorisée quand elle marche **silencieusement**, sans configuration.
3. **Contexte long fiable** (200K, gros PDFs) — et surtout PAS de troncature silencieuse en conversation longue (plainte forte vs Poe/Mammouth).
4. **Recherche web avec citations** — Perplexity a normalisé l'attente.
5. **Image gen incluse dans le plan de base** — passée de « premium » à « attendue par défaut ».
6. **Tarification simple** — 50 %+ trouvent les pricing IA « trop complexes ». Les crédits/points opaques sont massivement rejetés. 82 % plus enclins à s'abonner si l'annulation est facile ; 78 % veulent pause/swap ; 53 % annulent et relancent à la carte.
7. Voice (devient standard, pas décisif), privacy/« pas d'entraînement » (critère de confiance, pas déclencheur d'achat), agents spécialisés (marketing > usage réel).

### Frustrations (par force du signal)
1. **Quotas opaques + downgrade silencieux** (universel sur le segment)
2. **Contexte tronqué en conversation longue**
3. **Absence des features natives** (Canvas/Artifacts/Projects non répliqués)
4. **Coûts cachés, hausses sans préavis, crédits perdus**
5. **Support défaillant, remboursement impossible**
6. Doute « est-ce le vrai modèle ? » (modéré mais corrosif)

### BYOK
Segment réel mais minoritaire (~10-15 %, économies 60-90 % pour les gros consommateurs). La majorité ne franchit pas le pas : complexité perçue, peur du bill shock (78 % des responsables IT ont eu des frais imprévus en usage-based), interface inférieure. **Le prix fixe est une feature.** La stratégie double d'Arty (abonnement + BYOK) couvre les deux segments — c'est rare et correct.

---

## 5. Économie du modèle discount (validation chiffrée)

Prix API juin 2026 (vérifiés) : Haiku 4.5 $1/$5 par Mtok ; Sonnet 4.6 $3/$15 ; Opus $5/$25 ; Gemini Flash $0.30/$2.50 ; Mistral Medium $1/$3 ; DeepSeek V4-Flash $0.14/$0.28 (≈ 50× moins cher qu'Opus en output) ; images : $0.005 (GPT-Image mini) à $0.06/image.

- Utilisateur moyen (100 échanges/mois, tout-Sonnet) ≈ **1,10 $/mois**. Actif (300 échanges) ≈ 3,30 $. Whale (1 000) ≈ 11 $.
- **À 9,99 €/mois avec routage intelligent + caching + caps actuels : marge brute ~65-70 %** sur la base d'utilisateurs typique. Largement de quoi être « en dessous du marché » en générosité tout en restant rentable.
- Un plan d'entrée à ~5 € serait viable (~60 % de marge) avec caps ~30 msg premium/jour — mais fragile face aux whales.
- **Leçon T3 Chat** : leur top 1 % coûtait >200 $/mois/user ; un seul outil à gros contexte a failli les couler. **Pour Arty, le danger n°1 est identique : les tools Gmail/Drive à contexte massif** (« analyse mes 200 mails » = 0,50–2 $ l'appel). Il faut des caps par appel et une limite de contexte injecté, pas seulement des caps mensuels.
- **Risque de coût exogène** : le changement de tokenizer Anthropic d'avril 2026 a gonflé les factures API de ~+27 % à tarif inchangé (même contenu → plus de tokens). Les marges calculées ci-dessus doivent être re-vérifiées sur les factures réelles chaque trimestre — pas seulement sur les prix affichés.
- **Risque ToS (à surveiller)** : Anthropic durcit ses conditions sur les wrappers « revente d'accès ». Arty est dans la zone sûre tant qu'il se positionne comme **assistant personnel dont l'IA est une feature** (intégrations, mémoire, routage) — jamais comme « Claude moins cher ». Le BYOK est la couverture juridique la plus solide. Ne jamais utiliser les noms de marque des modèles comme argument de vente principal.
- Churn : les apps IA ont un pic de curiosité puis −40 %. Les contre-mesures : mémoire + intégrations (switching cost), annuel/lifetime, annulation facile (paradoxalement, la facilité d'annulation augmente la conversion).

---

## 6. Diagnostic : les écarts entre Arty et la demande

| Demande utilisateur (force) | Arty aujourd'hui | Écart |
| --- | --- | --- |
| Multi-modèles 1 abonnement (forte) | 4 providers, routage auto | OK sur le cœur ; catalogue étroit vs Mammouth (pas de DeepSeek/Grok/Llama) — manque surtout un **modèle quasi-gratuit pour l'« illimité »** |
| Mémoire silencieuse (forte) | Mémoire D1 + locale, mais à l'initiative de l'IA | **Écart** : pas d'extraction automatique post-conversation |
| Rendu/UX de base (forte) | Code sans coloration, pas de copier, ol cassées | **Écart bloquant** |
| Image gen incluse (moyenne-forte) | Absente | **Écart** (coût de comblement trivial : $0.005-0.01/image) |
| Transparence des limites (forte) | Caps lisibles dans le code, page coûts — mais invisibles avant l'achat et pas de compteur en cours d'usage | **Écart marketing** plus que technique : l'atout existe, il n'est pas montré |
| Custom instructions / projets (forte) | Absents | **Écart** vs tout le marché |
| App mobile native (forte) | Android oui, iOS non publié | **Écart distribution** (iOS = 55-60 % des dépenses mobiles EU/US) |
| Essai sans payer (forte) | Trial 30 msg existant | Écart de **visibilité** uniquement |
| Annulation facile / pause (forte) | Lemon Squeezy standard | À vérifier et à afficher |
| Recherche web citée (forte) | Oui (3 mécanismes) + fact-checker | **Avance** |
| Intégrations Google (différenciateur) | 29 tools réels | **Avance unique** — sous-exploitée en marketing |
| Contexte long fiable (forte) | OK (PDF natifs Claude) ; résumés/branches existent | Avance relative ; attention à la croissance quadratique des coûts |

---

## 7. Recommandations priorisées

### P0 — Fondamentaux & confiance (2-4 semaines, quasi gratuit, fait avant tout le reste)

1. **Réparer le rendu** : coloration syntaxique (shiki/prism), bouton copier (message + bloc code), listes numérotées, titres auto, bouton retry. C'est la crédibilité au premier message.
2. **Compteur de quota visible** : « 132/150 Sonnet restants ce mois » dans l'UI (les données existent déjà côté D1/quota). Jamais de bascule silencieuse : si cap atteint → toast explicite + choix (« continuer en Haiku / acheter +100 / attendre »). **C'est l'anti-Mammouth, l'anti-Poe et l'anti-Abacus en une feature — et même Claude Pro et ChatGPT Plus n'ont pas de compteur visible** (c'est une plainte massive contre les apps officielles depuis oct. 2025 : quota brûlé sans avertissement, notification seulement après blocage).
3. **Landing & pricing page frontalement transparentes** : tableau « ce que tu as exactement pour 9,99 € » en messages (pas en crédits), comparaison directe avec Mammouth (50 msg/3h opaque) et Poe (points). Mettre le **trial 30 messages sans CB** en bouton principal — la plainte n°1 du concurrent direct devient l'argument n°1 d'Arty.
4. **Boutons tactiles** : supprimer les `group-hover` sur mobile (suppression, branche). Arty est mobile-first, ses actions doivent l'être.
5. **Caps par appel sur les tools à gros contexte** (Gmail/Drive : nombre de mails injectés, taille PDF) — protection économique vitale du modèle discount (leçon T3 Chat).

### P1 — Combler les attentes standard (1-2 mois)

6. **Mémoire automatique** : extraction post-conversation (Haiku, asynchrone, ~0,001 $/conversation) avec visibilité/édition (le MemoryViewer existe). Rétention n°1 du marché.
7. **Custom instructions + dossiers/projets légers** : un champ d'instructions global + instructions par dossier de conversations. Réplique « Mammouths »/Projects à faible coût.
8. **Génération d'images** : GPT-Image mini ($0.005) ou Flux ($0.01) via proxy Cloudflare (RÈGLE 3 + RÈGLE 6), cap 50-100 images/mois. Comble le manque le plus visible vs Mammouth pour un coût plafonné à ~0,50 $/user/mois.
9. **Un modèle « illimité » quasi gratuit** (DeepSeek V4-Flash ou Llama via provider) pour pouvoir dire honnêtement « messages illimités sur les modèles standards » — l'argument commercial du segment, sans mentir comme Merlin.
10. **Partage de conversations par lien public** (`tryarty.com/share/:id`) : répare une feature cassée ET crée le canal d'acquisition virale — indispensable à la stratégie « le nombre ».
11. **Finir l'i18n EN** (~15 composants) : condition préalable à tout volume hors France.

### P2 — Distribution & expansion (2-6 mois)

12. **iOS App Store** (port Capacitor, le code existe) : le plafond de verre d'acquisition. À planifier sérieusement (compte développeur, privacy descriptions — BUG 34 — process de review).
13. **Onboarding commercial** : montrer les 3 démos différenciantes (mail→réponse rédigée, agenda→brief du matin, PDF→analyse) au lieu des 4 slides emojis.
14. **Affichage « annulation en 1 clic, pause possible »** sur la page pricing (82 % plus enclins à s'abonner).
15. **Page « Pourquoi c'est moins cher »** : expliquer le modèle (routage intelligent, marge faible assumée) — la transparence économique désarme le « trop beau pour être vrai » et construit la marque de confiance.

### À NE PAS faire (pièges documentés)

- **Ne pas courir après le catalogue de Mammouth** (20+ modèles, vidéo) : coût de maintenance énorme, différenciation nulle, et la vidéo (Sora/Veo/Kling) ruinerait l'économie du plan.
- **Ne pas vendre « Claude moins cher »** : risque ToS Anthropic + course perdue. Vendre « l'assistant qui connaît ton Google ».
- **Ne pas passer aux crédits/points** : c'est LE repoussoir du marché. Rester en messages.
- **Ne pas promettre « unlimited »** sur les modèles premium : c'est le mensonge de Merlin, il se voit toujours.
- **Ne pas mettre le comparateur en avant-vitrine** : feature de power user, pas d'onboarding.
- **Ne pas faire de la privacy l'argument n°1 B2C** : c'est un tie-breaker. L'argument qui convertit : « gagne du temps sur tes mails / ton agenda ».
- **Ne pas brader sous 8 €** : en dessous, le marché doute de la qualité ; la bataille du volume se gagne sur la confiance et la distribution, pas sur 2 € de moins.

---

## 8. Pricing recommandé

Le pricing actuel est presque bon — c'est sa **présentation** qui est en retard sur sa générosité :

| Plan | Aujourd'hui | Recommandation |
| --- | --- | --- |
| Trial | 30 msg, peu visible | Inchangé mais **en bouton principal de la landing, sans CB** |
| Free | Haiku 10 msg/j | + modèle open-weights illimité lent (option) ; sert d'aimant |
| Subscription 9,99 €/mois | « 500 msg/mois » + caps premium internes | Reformuler en clair : « **150 Claude Sonnet + 100 GPT + 80 Gemini Pro + illimité standard** » + compteurs visibles. TTC affiché (Mammouth affiche HT — différenciation facile) |
| Pack +100 premium à 1,99 € | OK | Inchangé — c'est le « débordement » transparent que Poe fait payer 30 $/M points |
| Pro 39 € lifetime | Accès à vie, 3 appareils | **À recadrer** : le lifetime sur clés serveur = passif perpétuel (problème ChatPlayground). Le repositionner « licence app à vie + BYOK » ou le réserver aux early adopters en série limitée |
| (Optionnel) Entrée 4,99 €/mois | n'existe pas | À tester plus tard : ~50 premium/mois. Casse le prix d'appel sous T3 Chat, marge ~60 % mais fragile — seulement après les caps par appel (P0.5) |

---

## 9. Positionnement final

> **« Tous les grands modèles + ton Gmail, ton Drive et ton agenda. Des limites écrites en clair, un prix honnête. Essaie sans carte. »**

- **Contre Mammouth** : la confiance (trial, quotas lisibles, pas de downgrade caché, TTC) + la profondeur (mémoire, intégrations Google) contre la largeur (catalogue).
- **Contre Poe/Abacus** : des messages, pas des points.
- **Contre T3 Chat/TypingMind** : le mobile + le grand public.
- **Contre Gemini** (le vrai concurrent structurel sur les intégrations) : Claude et Mistral sur tes données Google — ce que Google ne proposera jamais.
- **La richesse par le nombre** exige 3 multiplicateurs de distribution, dans l'ordre : partage public de conversations (P1), Play Store finalisé + iOS (P2), i18n EN complète (P1).

---

## 10. Sources principales

Pricing/quotas vérifiés en direct : mammouth.ai/pricing, info.mammouth.ai/docs/quota-policy + release-notes, poe.com, abacus.ai, typingmind.com, openrouter.ai.
Société : Pappers (SIREN 932 983 968), LinkedIn fondateurs, Product Hunt, Similarweb.
Avis : Trustpilot (Mammouth 2,6-2,9/5 ; You.com 2,3/5 ; TypingMind ; Monica), kearai.com, docs.bswen.com, blog-ia.com, comparateur-ia.com, radinmalinblog.com, digitiz.fr, agentland.fr.
Économie : finout.io (Anthropic), aipricing.guru (OpenAI), aicostcheck.com (Gemini, caching), devtk.ai (Mistral), spheron.network (open-weights), buildmvpfast.com (images), T3 Chat economics (biggo.com), openrouter.ai/state-of-ai, revenuecat.com, venturebeat.com (ToS Anthropic).
Comportement utilisateurs : Bango nov. 2025 (n=2 000), readless.app (subscription fatigue 2026), NPR, XDA, globalrule.substack.com, news.ycombinator.com, greyneuronsconsulting.com, rkanade.medium.com, folding-sky.com, moclaw.ai, Zylo 2026 SaaS Index.
Features standard 2026 : mindstudio.ai, mem0.ai, techpluto.com, graygrids.com, metallm.medium.com, instinctools.com, TechCrunch (App Store Q1 2026), aitoolradar.io, xprivo.com, coincentral.com, demandsage.com, assemblyai.com, pymnts.com, usecarly.com.
Inventaire interne : codebase Arty v1.0.79 (`src/services/aiRouter.ts`, `functions/api/_lib/checkPremiumCap.ts`, `migrations/0002_monetisation.sql`, `docs/audits/frontend-audit-2026-06-10.md`, `ROADMAP.md`).

*Caveat : les numéros de version de modèles tiers cités par des sources web (GPT-5.x, Gemini 3.x…) sont parfois instables ou projetés ; les prix fluctuent (±10 %). Les ordres de grandeur et les conclusions stratégiques sont croisés sur 2+ sources.*
