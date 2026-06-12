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

- [ ] **P0.1 Coloration syntaxique des blocs de code** — table stakes absent.
  `src/components/shared/MarkdownRenderer.tsx`. ⚠️ Garder `rehype-sanitize` (BUG 20) :
  étendre le schema aux classes de highlight, ne JAMAIS désactiver la sanitisation.
- [ ] **P0.2 Bouton « Copier »** sur chaque message ET chaque bloc de code — l'action la
  plus fréquente d'un chat IA. `MessageList.tsx` / `AssistantBubble.tsx`.
- [ ] **P0.3 Listes numérotées cassées** (`ol` sans compteur) — fix CSS/renderer.
- [ ] **P0.4 Bouton « Régénérer »** (retry) sur les réponses IA.
- [ ] **P0.5 Titres de conversation auto cassés** (1re conversation + conversations EU
  restent « Nouvelle conversation »). `useConversation.ts`.
- [ ] **P0.6 Compteur de quota visible** : « 132/150 Sonnet restants ce mois » dans l'UI.
  Données déjà en D1 (`checkPremiumCap.ts`, `quota.ts`) — exposer via endpoint (RÈGLE 6 !)
  + badge type `CostIndicator`/`WalletBadge`. **Différenciateur n°1 du marché entier**
  (même Claude Pro/ChatGPT Plus n'en ont pas — plainte massive depuis oct. 2025).
- [ ] **P0.7 Jamais de bascule silencieuse** : cap atteint → toast explicite + choix
  (« continuer en Haiku / +100 messages 1,99 € / crédits / attendre »). La plainte n°1
  contre Mammouth, Poe, Abacus.
- [ ] **P0.8 Actions tactiles invisibles** : supprimer les `opacity-0 group-hover` sur
  mobile (suppression conv, branche — `MessageList.tsx:55`, Sidebar). Arty est mobile-first.
- [ ] **P0.9 Caps par appel sur les tools à gros contexte** (Gmail/Drive) : nombre de mails
  injectés, taille de PDF, contexte total par appel. Protection économique vitale
  (leçon T3 Chat : un seul tool à contexte massif a failli les couler ; « analyse mes
  200 mails » = 0,50–2 $ l'appel). `gmailTools.ts`, `driveTools.ts`, proxys.
- [ ] **P0.10 Landing/pricing transparentes** : trial 30 msg **sans CB** en bouton principal
  (la plainte n°1 anti-Mammouth devient l'argument n°1) ; caps affichés en messages
  (« 150 Sonnet + 100 GPT + 80 Gemini Pro + standards illimités ») ; prix TTC
  (Mammouth affiche HT → surprise TVA, plainte récurrente).

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
