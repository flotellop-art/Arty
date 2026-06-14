# Plan d'action concurrentiel — suivi opérationnel

**Source** : `docs/audits/competitive-audit-2026-06.md` (audit du 12 juin 2026, PR #262).
**Rôle de ce fichier** : liste de travail actionnable et **maintenue à jour**. Les agents
doivent le consulter avant toute tâche produit/UX/pricing/monétisation, et **cocher +
dater + référencer la PR** quand un item est traité (même partiellement — le noter).
Ne pas supprimer d'items : un item abandonné est barré avec la raison.

**Boussole stratégique** (résumé de l'audit) : Arty gagne le segment discount par la
**confiance** (limites lisibles en messages, jamais de bascule silencieuse, essai sans CB,
crédits sans expiration) + son **exclusivité** (Gmail/Drive/Calendar dans Claude/Mistral,
unique sous 20 $/mois). Pas par la largeur de catalogue. Volume = distribution
(partage public, stores, i18n EN).

---

## P0 — Fondamentaux & confiance (avant tout le reste)

- [x] **P0.1 Coloration syntaxique des blocs de code** — FAIT (12 juin 2026, PR P0
  fondamentaux). `rehype-highlight` ordre `raw → highlight → sanitize` (sanitize
  TOUJOURS actif en dernier, BUG 20), palettes hljs par thème dans `index.css`
  (Ember = bloc sombre/tokens clairs, Nocturne = bloc clair/tokens foncés),
  header de langage sur les blocs, fix blocs sans langage rendus en inline.
- [x] **P0.2 Bouton « Copier »** — FAIT. Assistant + blocs de code existaient déjà
  (PR #239 du 10 juin) ; ajouté le manquant : copier sur les messages USER
  (`UserBubble.tsx`) + extraction texte récursive pour la copie des blocs colorés.
- [x] **P0.3 Listes numérotées** — DÉJÀ FAIT (PR #239 du 10 juin, `index.css:227`
  compteurs CSS `md-marker`). Constaté lors de l'implémentation : le plan datait
  de l'audit du 10 juin, antérieur au fix.
- [x] **P0.4 Bouton « Régénérer »** — FAIT (12 juin 2026). `retryMessage()` existait
  (`useConversation.ts:696`) mais n'était exposé que sur `interrupted` ; ajouté le
  bouton proactif sur la DERNIÈRE réponse assistant (props `isLast`/`isStreaming`),
  actions masquées pendant le stream (copier/TTS apparaissaient dès le 1er token).
- [x] **P0.5 Titres de conversation auto** — VÉRIFIÉ DÉJÀ CORRIGÉ (12 juin, diagnostic
  agent) : `useConversation.ts` pose le titre sur `userMessageCount === 1` (couvre la
  1re conv avec welcome ET les conversations EU). L'audit du 10 juin était antérieur
  au fix. Suivi ouvert (qualité, non-P0) : titre = troncature 50 chars, pas une
  génération LLM — si on l'ajoute un jour, guard `conv.euOnly` OBLIGATOIRE (titre EU
  via Mistral, jamais Claude US).
- [x] **P0.6 Compteur de quota visible** — FAIT (12 juin 2026). `/api/subscription/status`
  expose `monthly_cap` (lecture seule de `premium_cap`, par bucket) ; `usePlanStatus`
  le porte ; `PlanBadge` affiche « Sonnet 132/150 » (bucket le plus entamé) ; section
  « Quota du mois » avec barres de progression dans `ChatOptionsSheet`.
- [x] **P0.7 Jamais de blocage muet** — FAIT (12 juin 2026). Constat d'audit : pas de
  bascule silencieuse (le proxy bloquait déjà en 429) mais UX cassée — retry inutile
  de 24 s (anthropicClient), message générique « trop de requêtes » sur OpenAI/Gemini,
  redirect muet vers /upgrade qui éjectait du fil, scroll pack cassé. Corrigé : le 429
  `premium_cap_reached` court-circuite les retries (anthropic/gemini/openai), payload
  429 enrichi (bucket/cap), `CapReachedModal` de choix explicite dans le fil (+100 à
  1,99 € / continuer en standard / plus tard), plan résolu via `usePlanStatus` sur
  l'écran upgrade (le `?scroll=premium` fonctionne enfin).
- [x] **P0.8 Actions tactiles invisibles** — FAIT (12 juin 2026). L'essentiel était déjà
  migré au pattern `opacity-50 md:opacity-0` (PR #239) ; corrigé le dernier `opacity-0`
  pur restant (`TaskPanel.tsx` bouton supprimer une tâche). Reste OUVERT en suivi :
  cibles ~30px < 44px WCAG (`p-2` partout) — amélioration séparée, non bloquante.
- [x] **P0.9 Caps par appel sur les tools à gros contexte** — FAIT (12 juin 2026).
  Constat d'audit (2 agents) : maxResults Gmail déjà cappé à 10 ; le vrai danger était
  les BINAIRES (PJ Gmail 20 MB / download Drive 25 MB ≈ 6-8 M tokens ≈ 20-25 $/itération
  de boucle) et le system prompt qui ordonnait « lis CHAQUE mail, NON NÉGOCIABLE ».
  Corrigé : (1) budgets explicites dans le system prompt (5 read_email + 3
  read_drive_file par réponse, recherches/listings illimités) ; (2) caps binaires
  serveur 8 MB (Gmail PJ + Drive download) + pageSize Drive 200→50 ; (3) garde client
  base64 + budget de contexte cumulé ~150 K tokens/message dans la boucle d'outils
  (au-delà : le modèle synthétise, message explicite — cohérent P0.7).
  Conservé délibérément : 8000 chars/mail (fix BUG 49) — le budget de lectures fait le
  travail sans dégrader le différenciateur. Suivis ouverts : fichiers Office
  silencieusement droppés dans executeToolCalls (feature cassée, pas un coût) ;
  caps différenciés par plan (BYOK assoupli) si la vigie whales le justifie.
- [x] **P0.10 Landing/pricing transparentes** — FAIT (12 juin 2026). Trial « 30 messages
  gratuits · sans carte bancaire » DANS le bouton Google (OnboardingChoice) + callout
  sur /upgrade pour les visiteurs directs ; carte Subscription détaillée en messages
  (« 150 Sonnet/Opus + 100 GPT-5 + 80 Gemini Pro + Haiku/Flash/Mistral sans plafond
  mensuel ») ; « · TTC » sur les 3 prix + ligne transparence (« limites en clair, pas
  de crédits/points ; limite journalière anti-abus ») ; lien « Gérer mon abonnement »
  (portail Lemon Squeezy) ; TrialBanner i18n (était hardcodée FR) ; clés
  onboardingChoice.* ajoutées aux JSONs ; « GPT-4o mini » obsolète corrigé.
  ⚠️ GARDE-FOU (agent challenge) : « standards ILLIMITÉS » serait un mensonge — le
  quota JOURNALIER (`consumeDailyQuota`, défaut 50/j) s'applique au plan subscription
  sur tous les modèles. Formulation honnête retenue : « sans plafond mensuel » +
  mention de la limite journalière. Clés quota.* du P0.6 corrigées en conséquence.
  **Actions Florent (hors code)** : (1) [x] « Tax-inclusive pricing » ACTIVÉ dans
  Lemon Squeezy (Settings → General, Florent, 12 juin) — le défaut LS est HT, le
  toggle était nécessaire pour que « TTC » soit vrai au checkout. Note marge : la TVA
  est absorbée (net FR ≈ 8,32 € sur 9,99 €) — cohérent stratégie confiance. Reste à
  faire un checkout test depuis une adresse FR pour confirmer le total à 9,99 € ;
  (2) [x] `DAILY_QUOTA_PER_USER = 500` confirmé en prod (Florent, 12 juin) — limite
  anti-abus généreuse, la formulation « sans plafond mensuel » est juste. Chiffre
  volontairement absent du copy (variable d'env → éviter la divergence). Note vigie
  whales : 500/j est le plafond théorique d'un abonné (≈ 15 000 msg standards/mois
  dans l'absolu) — surveiller via la vigie économique trimestrielle.

## P1 — Combler les attentes standard 2026

- [x] **P1.1 Mémoire automatique** — FAIT (12 juin 2026). Extraction asynchrone des
  faits durables depuis les messages USER (debounce 3 messages + filtre de substance),
  via endpoint dédié `/api/ai/memory-extract` **hors quota utilisateur** (le piège
  « brief proactif mange le trial » est documenté et évité), Haiku forcé + rate-limit
  propre 20/j. Prompt serveur anti-hallucination (faits explicites uniquement +
  citation source) + exclusion des données sensibles (santé, politique, intime,
  finances, tiers). Stockage : mémoire LOCALE chiffrée uniquement (jamais D1),
  dédup/remplacement par Haiku avec la liste existante fournie, éviction FIFO au cap
  (bug addFact→null silencieux corrigé côté auto), `MAX_FACTS` 50→80. ON par défaut
  + 3 obligations de confiance : toggle Settings, toast « mémoire mise à jour »,
  phrase d'onboarding. euOnly → jamais d'extraction (promesse EU).
  Suivis ouverts : sync multi-device des faits locaux (v2, chiffrement bout-en-bout
  avant upload — noté ROADMAP), tiering d'injection si MAX_FACTS doit monter,
  le brief proactif consomme toujours le quota (même piège, fix séparé).
- [x] **P1.2 Custom instructions** — FAIT (12 juin 2026). Champ global (cap 500 chars
  ~130 tokens), stocké LOCAL chiffré (`customInstructions.ts`), injecté EN TÊTE du
  system prompt via `buildContextualPrompt` avec label « PRIORITÉ ABSOLUE » (l'explicite
  prime sur la mémoire auto P1.1 et les défauts — résout le conflit « je vouvoie » déclaré
  vs « tutoie » extrait). Vaut pour TOUS les providers (`systemPromptRef` unifié), euOnly
  inclus (l'user écrit ses propres instructions, comme `responseStyle`/`locale`). Pas de
  toggle (rempli=actif), sauvegarde au blur, compteur de chars. Textarea dans Settings.
  **Dossiers/projets DIFFÉRÉS** (verdict agent challenge RÈGLE 7) : la Sidebar est déjà à
  sa limite (288 px), l'arborescence est un piège desktop, et les instructions par
  dossier = 4-6 blocs de contexte en compétition (sur-engineering v1). Reclassés → P1.8
  ci-dessous sous forme de **tags** (filtrables via la search existante), pas
  d'arborescence, sans instructions par dossier.
- [x] **P1.8 Tags de conversation** — FAIT 14 juin 2026 (PR à venir), version SÛRE
  (audit RÈGLE 7 : 2 agents). `tags?: string[]` sur `Conversation` (transparent au
  déchiffrement, AUCUNE migration). Le challenge a écarté le texte libre pur (doublons
  casse, FR/EN, couleur hash) → **jeu prédéfini fermé** (6 tags : Travail/Perso/Clients/
  Finance/Admin/Idées, id stable + libellé i18n + couleur fixe en pastille ●) **+ 1 tag
  perso normalisé** (trim, dédup insensible casse, plafond 4 tags/conv, 24 char). Chips
  affichés dans la Sidebar (ligne 2, après 🇪🇺), filtrables via la recherche existante
  (matche le LIBELLÉ résolu, pas l'id), édition via une modale ouverte depuis l'item
  Sidebar (PAS de prop-drilling vers ChatTopBar, PAS d'arborescence, PAS d'instructions
  par tag). **Tags exclus du partage public** (privés — test de non-régression ajouté).
  branchConversation hérite des tags. Tests : conversationTags + shareClient.
- [x] **P1.3 Génération d'images** — FAIT (12 juin 2026). gpt-image-1 via proxy dédié
  `/api/ai/image-gen` (RÈGLE 3) — réutilise l'`OPENAI_API_KEY` serveur existante, ZÉRO
  nouvelle clé. Déclenchement par tool `generate_image` injecté CONDITIONNELLEMENT
  (`wantsImageGeneration` : verbe de création + nom visuel, exclusions « décris/
  imagine/ressemblerait ») — jamais dans TOOLS par défaut : seule garantie
  anti-faux-déclenchement (un faux positif brûle le cap = frustration n°1 du marché).
  Cap recalibré par l'agent challenge : **10 img/mois qualité medium** (~0,40 $
  worst-case), bucket `gpt-image` dans `PREMIUM_BUCKET_CAPS` → compteur auto-visible
  (PlanBadge « Images 8/10 », section Quota du sheet). free/trial=0 (upsell explicite),
  pro/vip illimités, BYOK OpenAI sans cap. Anti-BUG 11 : l'image va en IndexedDB
  chiffré (putFile), référencée `arty-img://fileId` dans le markdown, résolue en
  blob: URL au rendu — jamais de base64 dans la conversation. euOnly : jamais atteint
  (conversation forcée Mistral → le tool n'est pas injecté). Coût tracké via
  `imagePerUnit` dans pricing.ts. Suivis : monter le cap après vigie 1 mois ;
  **FLUX (Black Forest Labs)** = chemin d'évolution documenté — Flux Flex ~0,01 $/img
  (cap ×3-4 à budget égal, argument face aux 40-60 img/mois de Mammouth) ou FLUX.1
  schnell via Cloudflare Workers AI (compte existant, quasi gratuit, qualité moindre).
  **FLUX/BFL IMPLÉMENTÉ (12 juin, PR P1.3-FLUX)** — routage par style livré pour
  les conversations standard : `selectImageProvider` (logos/texte → gpt-image-1
  [priment], photoréalisme → flux-2-klein-9b ~0,015 $/img), proxy multi-provider
  (`provider` validé serveur), endpoint RÉGIONAL `api.eu.bfl.ai` par défaut, flow
  asynchrone BFL (submit→poll borné 40×1 s [limite sous-requêtes Workers]→download,
  base64 chunké BUG 50, garde SSRF domaine *.bfl.ai), cap PARTAGÉ bucket gpt-image
  (« 10 images/mois » toutes images), pricing flux + fallback préfixe, fallback
  flux→openai UNIQUEMENT hors EU (le handler n'est jamais injecté en euOnly).
  **Chemin euOnly : GATED** — verdict recherche BFL = INCERTAIN : endpoint EU
  documenté « GDPR compliant » + société allemande + SCC + SOC2/ISO27001, MAIS
  les API Terms autorisent l'ENTRAÎNEMENT sur les prompts, DPA sur demande
  uniquement, GPU non confirmés. Activer euOnly avec ça = mensonge « confidentiel ».
  Activation = injecter le tool dans le chemin Mistral (la boucle d'outils Mistral
  EXISTE, mistralClient.ts:376-487 — vérifié) + MAJ du texte d'accueil EU
  (useConversation.ts:101, promesse « rien n'est envoyé à... » à amender).
  **Actions Florent** : (1) [ ] créer la clé sur dashboard.bfl.ai (crédits
  prépayés ~10-20 $) et l'ajouter en `BFL_API_KEY` sur Cloudflare — sans elle,
  fallback gpt-image transparent ; (2) [ ] demander à dpo@blackforestlabs.ai /
  bfl.ai/enterprise : DPA + clause NO-TRAINING + confirmation inférence EU sur
  api.eu.bfl.ai → condition d'activation du chemin euOnly.
  Suivi : pas d'édition/variations en v1 ; trial perd 1 message sur tentative
  d'image (checkAllowedUser décrémente avant le 403 — préexistant, mineur).
- [~] **P1.4 Modèle open-weights quasi gratuit** — ÉCARTÉ (13 juin 2026, 2 agents
  RÈGLE 7, décision Florent). Verdict : pas maintenant. (1) Gain économique négligeable
  à l'échelle actuelle : ~7 ¢/user/mois (le « standard » Mistral Medium/Gemini Flash/
  Haiku coûte déjà 0,12–0,36 $/user/mois à usage réel, marge ~97 %) ; le claim « sans
  plafond mensuel » tient déjà. (2) Risque qualité FR = BUG 58 bis (Llama 8B/distill
  < Mistral Medium en français). (3) DeepSeek direct = serveurs Chine, rédhibitoire
  (positionnement EU/privacy). Si repris à l'échelle (~5-10k abonnés) : **Cloudflare
  Workers AI** (Qwen3-30B, binding `env.AI` sur le compte existant, 10k neurons/j
  gratuits, zéro nouveau vendor) — PAS DeepSeek. Format non-OpenAI (`env.AI.run()`),
  euOnly déjà bloqué en amont (useConversation.ts:442).
  ➡️ **REMPLACÉ par une optimisation à vrai gain — FAIT (13 juin 2026, PR à venir).**
  Le défaut CHAT bascule de `gemini-3.5-flash` ($1,50/$9 par M) vers `gemini-2.5-flash`
  (tarif GA réel **$0,30/$2,50** — ~5× moins en input, ~3,6× en output ; + grounding
  facturé PAR PROMPT vs par requête sur 3.x). Vérifié par agent recherche (RÈGLE 7) :
  `google_search`, `url_context`, `google_maps` et function calling sont TOUS supportés
  sur 2.5-flash (function calling même amélioré), aucune perte de qualité recherche web,
  et qualité FR équivalente pour le chat grand public (Global-MMLU multilingue 88,4 %).
  La moitié RECHERCHE du mode hybride (`geminiResearch`) GARDE `gemini-3.5-flash` (là où
  le saut agentique/long-horizon sert vraiment). Killswitch `arty-gemini-cheap-disabled='1'`
  (localStorage) repasse le chat sur 3.5 sans redéploiement. **Bug de tracking corrigé au
  passage** : prix `gemini-2.5-flash` stale ($0,075/$0,30 = ancien tarif preview) →
  $0,30/$2,50 dans `pricing.ts` + `costTracker.ts` (sinon le dashboard sous-estimait ~4-8×).
  Vigie : le gain ne concerne que les abonnés sur clé serveur (sans BYOK).
- [x] **P1.5 Partage de conversation par lien public** — FAIT (13 juin 2026).
  (Constat : le data: URI cassé était DÉJÀ réparé le 10 juin ; P1.5 = création du
  lien public permanent, inexistant.) Endpoint `POST /api/share` (auth Google,
  euOnly REFUSÉ, taille ≤50 K chars, rate-limit 5/j via bg_quota, max 20 actifs/user,
  TTL 30 j) ; `GET /api/share/:id` PUBLIC (sans auth, 404 indistinguable si
  introuvable/expiré/révoqué, cache CDN 5 min) ; `DELETE` owner (soft delete, id
  jamais réutilisé). Route React `/share/:id` montée HORS auth (bloc non-connecté
  + bloc authentifié), vue légère `SharedConversationView` (réutilise
  MarkdownRenderer) avec bandeau d'acquisition « Essayer Arty — gratuit ».
  Sérialisation : texte uniquement — EXCLUT fichiers/base64, factCheck, pinned,
  interrupted ; NEUTRALISE les réf. d'images locales `arty-img://`. **Privacy =
  acte explicite** : modale bloquante (case à cocher non pré-cochée) + avertissement
  RENFORCÉ si `hasGoogleData` (nouveau flag Conversation, posé au moment de l'appel
  d'un tool Gmail/Drive/Calendar/Contacts — car le contenu Google est dans le TEXTE
  des réponses, indétectable a posteriori). euOnly bloqué UI + serveur.
  ⚠️ PAS de `public/_redirects` (réintroduirait BUG 40 — SPA fallback Cloudflare
  automatique, comme /chat/:id). Suivis : OG/meta tags serveur pour de jolis
  aperçus de lien (booste le viral) = follow-up ; lien « signaler » + renouvellement
  d'expiration = v2.
- [x] **P1.6 i18n EN complète** — FAIT (13 juin 2026). Inventaire par 2 agents
  (périmètres non chevauchants) : ~90 chaînes user-visibles encore en FR dur dans
  17 composants (l'UI principale était déjà bilingue depuis le 16 mai ; restaient les
  écrans/modales secondaires + ceux ajoutés récemment dont SharedConversationView que
  j'avais écrit en FR). Tout extrait vers fr.json/en.json (parité 100 % vérifiée, 0 clé
  orpheline). Composants i18nisés : SharedConversationView, PlanBadge, templates,
  ApiKeySetup, ApiKeysModal, MemoryViewer, MemoryHistoryPanel, OrchestratorSync,
  CalendarView, EmailCard, DriveFileCard, GoogleStatus, OAuthCallback, LoginScreen
  (erreurs OAuth + fix mismatch clé `login.apikey`), TopBar, Sidebar, InputBar, App.tsx
  (bannière budget + erreur partage + LazyFallback), OnboardingChoice (cartes).
  Hors scope (décision déjà actée) : les ~80 chaînes `result:` des services tools
  (renvoyées au LLM, jamais affichées). Bug annexe corrigé : variable locale `t`
  (withTimeout) masquait le `t` i18n dans LoginScreen → renommée `timeout`.
  Suivi : les labels de catégories de templates vivent dans `data/templates.ts`
  (couche données, encore FR) — à i18niser si on vise sérieusement l'anglophone.
- [ ] **P1.7 Crédits — visibilité du coût par message** (suite PR #238) : « ce message :
  3 crédits » sous chaque réponse (données du settle existantes), estimation avant envoi
  sur modèles premium, maîtrise du contexte en conversation longue (croissance
  quadratique = le « mes crédits ont fondu » d'Abacus). Conditions pour rester côté
  OpenRouter (transparent) et pas côté Poe (opaque).

## P2 — Distribution & expansion

- [ ] **P2.1 iOS App Store** : port Capacitor (code `ios/` existant). Le plafond de verre
  d'acquisition (55-60 % des dépenses mobiles EU/US). Prérequis : privacy descriptions
  Info.plist (BUG 34), compte développeur, process de review.
- [ ] **P2.2 Onboarding commercial** : remplacer les 4 slides emojis par 3 démos
  différenciantes (mail → réponse rédigée ; agenda → brief du matin ; PDF → analyse).
- [x] **P2.3 Afficher « annulation en 1 clic, pause possible »** sur la page pricing
  (82 % plus enclins à s'abonner si l'annulation est facile). FAIT 14 juin 2026 (PR #280) :
  ligne de rassurance sur la carte Subscription, visible aussi aux non-abonnés. ⚠️ « pause »
  suppose l'option activée côté portail Lemon Squeezy (à confirmer ops).
- [x] **P2.4 Page « pourquoi c'est moins cher »** : assumer publiquement le modèle
  (routage intelligent, markup +50 %, marge faible) — désarme le « trop beau pour être
  vrai » et fait de la transparence économique la marque. FAIT 14 juin 2026 (PR #280) :
  section dépliable `WhyCheaperSection` sur /upgrade (pas une page séparée — placée là où
  naît le doute, au moment de l'achat).
- [x] **P2.5 Recadrer Arty Pro 39 € lifetime** : « licence app à vie + BYOK », pas accès
  serveur illimité à vie (passif perpétuel — le doute qui plombe ChatPlayground). FAIT
  14 juin 2026 (PR #280) : `proTagline`/`proDescription` recadrées (« Licence à vie · ta
  propre clé » + « Paiement unique, app à vie · Tu utilises ta clé API (BYOK) »).

## Anti-objectifs — à NE PAS faire (pièges documentés)

- ❌ Courir après le catalogue Mammouth (20+ modèles, vidéo Sora/Veo) — coût de
  maintenance énorme, différenciation nulle, la vidéo ruine l'économie du plan.
- ❌ Se positionner « Claude moins cher » — risque ToS Anthropic (durcissement wrappers).
  Arty = assistant personnel dont l'IA est une feature. BYOK = couverture juridique.
- ❌ Crédits/points **opaques** (unité abstraite, expiration, pas de compteur). Le wallet
  PR #238 est du bon côté (1 crédit = 1 centime, sans expiration) — y rester (cf. P1.7).
- ❌ Promettre « unlimited » sur les modèles premium (le mensonge de Merlin, toujours vu).
- ❌ Mettre le comparateur side-by-side en vitrine (feature power user, pas d'onboarding).
- ❌ Faire de la privacy l'argument n°1 B2C (tie-breaker, pas déclencheur — ce qui
  convertit : « gagne du temps sur tes mails/ton agenda »).
- ❌ Brader sous 8 € (le marché doute de la qualité ; la bataille = confiance +
  distribution, pas 2 € de moins).

## Vigies économiques (à re-vérifier chaque trimestre)

- [ ] Marges réelles vs prix affichés (le changement de tokenizer Anthropic d'avril 2026
  a gonflé les factures de ~+27 % à tarif inchangé). Comparer factures réelles / `pricing.ts`.
- [ ] ToS Anthropic/OpenAI sur les wrappers — surveiller (veille existante `docs/veille/`).
- [ ] Distribution whales : part des 5 % d'utilisateurs les plus actifs dans le coût total
  (données `quota_model` D1). Si > 60 %, durcir les caps par appel (P0.9).

---

*Mise à jour : 12 juin 2026 — création (audit PR #262). Toute PR qui traite un item doit
cocher la case ici, avec date + numéro de PR.*
