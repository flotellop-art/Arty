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
  **Actions Florent (hors code)** : (1) [ ] vérifier dans le dashboard Lemon Squeezy
  que les prix sont configurés TTC (sinon la promesse « TTC » est fausse au checkout) ;
  (2) [x] `DAILY_QUOTA_PER_USER = 500` confirmé en prod (Florent, 12 juin) — limite
  anti-abus généreuse, la formulation « sans plafond mensuel » est juste. Chiffre
  volontairement absent du copy (variable d'env → éviter la divergence). Note vigie
  whales : 500/j est le plafond théorique d'un abonné (≈ 15 000 msg standards/mois
  dans l'absolu) — surveiller via la vigie économique trimestrielle.

## P1 — Combler les attentes standard 2026

- [ ] **P1.1 Mémoire automatique** : extraction post-conversation (Haiku, asynchrone,
  ~0,001 $/conv) au lieu d'attendre que l'IA appelle `update_memory`. Visible/éditable
  (le `MemoryViewer` existe). **Facteur de rétention n°1 du marché.**
- [ ] **P1.2 Custom instructions** (champ global utilisateur injecté au system prompt —
  aujourd'hui fixe dans `systemPrompt.ts`) **+ dossiers/projets légers** avec instructions
  par dossier. Standard partout (ChatGPT, Claude, Gemini, Mammouth « Mammouths », Poe).
- [ ] **P1.3 Génération d'images** : GPT-Image mini (~0,005 $) ou Flux (~0,01 $) via proxy
  Cloudflare — suivre ROADMAP v2 §3 + RÈGLE 3 (8 étapes) + RÈGLE 6. Cap 50–100 img/mois
  (~0,50 $/user max). Markup image +300 % déjà prévu (`creditPricing.ts`, PR #238).
  Devenue « attendue par défaut » en 2026.
- [ ] **P1.4 Modèle open-weights quasi gratuit** (DeepSeek V4-Flash ~0,28 $/M output, ou
  Llama) pour un « illimité sur les modèles standards » **honnête** — l'argument
  commercial du segment, sans le mensonge de Merlin.
- [ ] **P1.5 Partage de conversation par lien public** (`tryarty.com/share/:id`) : répare la
  feature cassée (data: URI incollable) ET crée le canal d'acquisition virale —
  indispensable à la stratégie volume. RÈGLE 6 sur l'endpoint (lecture publique = surface).
- [ ] **P1.6 i18n EN complète** : ~15 composants en FR hardcodé (liste exhaustive dans
  `docs/audits/frontend-audit-2026-06-10.md:135`). Préalable au volume hors France.
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
- [ ] **P2.3 Afficher « annulation en 1 clic, pause possible »** sur la page pricing
  (82 % plus enclins à s'abonner si l'annulation est facile).
- [ ] **P2.4 Page « pourquoi c'est moins cher »** : assumer publiquement le modèle
  (routage intelligent, markup +50 %, marge faible) — désarme le « trop beau pour être
  vrai » et fait de la transparence économique la marque.
- [ ] **P2.5 Recadrer Arty Pro 39 € lifetime** : « licence app à vie + BYOK », pas accès
  serveur illimité à vie (passif perpétuel — le doute qui plombe ChatPlayground).

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
