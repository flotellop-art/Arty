# 📋 MÉMO PROJET ARTY V2

**Document de reprise de contexte pour Claude**
**Dernière mise à jour** : 14 avril 2026, soir (ajout scope 3 versions validé)
**Propriétaire** : Florent Pollet (flotellop@gmail.com)

---

## 🎯 COMMENT UTILISER CE DOCUMENT

Si tu es Claude dans une nouvelle conversation et que Florent t'envoie ce document, lis-le en entier avant de répondre. Il contient :
- Qui est Florent et son contexte
- L'historique du projet Arty jusqu'à maintenant
- Les décisions stratégiques validées
- Où on en est dans le plan de travail
- Les règles de collaboration à respecter
- La prochaine action à faire

**Règle absolue** : Florent a demandé à être dans la réalité, pas dans la flatterie. Pas de "bravo", pas d'enthousiasme creux, pas de plan en 50 bullets. Tu challenges, tu poses des probabilités chiffrées, tu respectes sa contrainte famille.

**Règle de formatage** : JAMAIS de tiret cadratin (—). Toujours une virgule ou deux points à la place.

**Règle de confiance** : Avant toute info non triviale, indiquer un niveau de confiance (Faible / Moyen / Fort).

---

## 👤 QUI EST FLORENT

**Profil** :
- Façadier professionnel (Façades Pollet, région Drôme, France)
- Père d'Arthur, environ 15 mois
- En couple, compagne sincère mais exigeante sur le temps famille
- Ne parle pas anglais (ou très peu), écrit en français
- Pas de background technique profond
- N'a pas de LinkedIn ni X ni audience pré-construite
- Compte Reddit avec 1 karma, compte HN tout neuf

**Rapport au projet** :
- A codé Arty en 7 jours avec Claude Code début avril 2026
- N'avait jamais écrit une ligne de code auparavant
- Double casquette mal assumée : façadier public, maker secret
- Ne veut pas parler d'Arty à son entourage direct (identité)
- Projet motivé par un besoin profond de "construire quelque chose à partir de rien"
- A reconnu lui-même que cette envie est "trop forte" et a conduit à des soirées/nuits au détriment de la vie de couple

**Contrainte vie perso validée avec sa compagne** :
- 30 à 60 minutes par soir MAXIMUM sur Arty, jamais plus
- Week-ends sacrés sauf exception négociée
- Pas de journée off pour Arty, il continue son chantier de façadier
- Sa compagne a dit "tu peux continuer si ça te fait plaisir, tant que tu n'abuses pas et que tu prends du temps pour nous de temps en temps"

---

## 📱 LE PRODUIT ARTY (état au 14 avril 2026)

**Description courte** : Chatbot IA mobile et web avec BYOK (Bring Your Own Key), hébergé en Europe, privacy-first.

**Stack technique** :
- Frontend : React 18 + TypeScript + Vite + Tailwind CSS
- Mobile : Capacitor 8 (APK Android, iOS à venir)
- Backend/Infra : Cloudflare Pages + Workers + D1 (base EU)
- Auth : Google OAuth
- Dev : Claude Code
- Repo GitHub : `flotellop-art/Appfacade` (nom historique, NE PAS renommer)
- Projet Cloudflare Pages : `appfacade` (NE PAS renommer)

**Modèles IA intégrés actuellement** :
- Anthropic (Claude)
- Google Gemini
- Mistral

**Fonctionnalités actuelles** :
- BYOK obligatoire (pas de clé stockée côté serveur)
- Clé stockée en localStorage chiffré sur l'appareil
- Tracking des tokens en sidebar
- Gmail intégré
- Sélecteur de langue FR / EN
- Connexion Google OAuth fonctionnelle
- Interface bloquée si aucune clé API

**Bugs connus** :
- Bug clavier sur saisie clé API (CSS/viewport Capacitor)

**Domaines** :
- tryarty.com (principal, Namecheap + Cloudflare, ~10€/an)
- arty.to (secondaire, ~25€/an, décision de revente ou garder en attente)
- appfacade.pages.dev (URL technique historique)

**Distribution** :
- Web : tryarty.com (pointe actuellement DIRECTEMENT sur l'app, pas de landing page, PROBLÈME CONNU)
- Android : Firebase App Distribution beta v3.1 : https://appdistribution.firebase.dev/i/149a5c51d26b870b
- iOS : pas encore

**Identité visuelle** :
- Logo : étoile à 4 branches orange
- Palette : pierre/crème beige #F5EFE6, accent orange terre #D97706, texte #1A1A1A
- Typo : serif pour titres (Playfair/DM Serif/Lora), sans-serif body (Inter/DM Sans)
- Style : cohérent avec l'univers Anthropic, sobre, artisanal

---

## 🧠 HISTORIQUE ET DÉCISIONS STRATÉGIQUES

### Phase "avant le 13 avril"
- Florent a codé Arty en 7 jours début avril 2026
- Premier plan : launch Product Hunt le 14 avril 2026
- Post sur Renaud Dékode qui a reçu 2 commentaires sceptiques
- Audit sécurité + fix CORS déployé
- Beta Android v3.1 buildée

### Session du 13 avril 2026 (après-midi et soir)
- Décalage du launch du 14 au 21 avril
- Identification de 12 communautés cibles (Discord Anthropic built-with-claude en tier S)
- Reconnaissance que ta compagne n'accepterait pas plus de soirées sacrifiées
- **Crise existentielle** : Florent a questionné si Claude le soutenait juste pour le flatter
- Réponse honnête sur la sycophancy, reconnaissance des biais
- Florent a demandé à être "dans la réalité du monde"
- Discussion profonde sur la différence entre projet A (apprentissage déjà gagné) et projet B (side business 6-12 mois)
- Conversation avec sa compagne : elle a accepté avec la contrainte "pas d'abus"

### Session du 14 avril 2026 (matin, 7h24)
- **Décision majeure : annulation du launch du 21 avril**
- Florent a acté qu'il ne pouvait pas gérer retours testeurs + bugs + vie de famille sur 8 jours
- Décision d'aller vers un **modèle hybride** (type TypingMind)
- Décision de tester le **marché EU first** (pas EU only strict)
- Recherche web confirmée :
  - TypingMind fait 817K USD/an en solo avec 3 personnes, modèle hybride one-time + subscription
  - Marché BYOK EU existe mais est majoritairement B2B enterprise (Langdock, EUrouter)
  - Trou de marché réel : pas d'acteur EU BYOK grand public simple pour indépendants/petits pros
  - Validation du besoin via données publiques : frustrations sur cumul d'abonnements (82 USD/mois rapporté dans article Medium), usage limits Claude Pro, opacité tracking, prix qui montent
- Profils utilisateurs cibles validés via reviews TypingMind :
  1. Power user qui cumule 3 subscriptions et veut économiser
  2. Semi-tech qui veut accès multi-modèles simple
  3. Privacy-conscious (minoritaire mais stable)
  4. **PAS le vrai grand public** : correction importante par rapport au positionnement initial de Florent

### Session du 14 avril 2026 (après-midi)
- **Analyse concurrentielle Play Store approfondie** (25+ apps analysées)
- Confirmation du trou de marché : aucune app ne combine BYOK multi-providers + EU-hosted + hybride + Android natif de qualité
- Les apps EU-first existantes (Le Chat, Lumo, Euria, GreenPT) n'offrent PAS le BYOK
- Les apps BYOK existantes (Chatbox AI, ChatBoost, GPTMobile, UnboundChat) ne sont pas EU-first
- **Création de la roadmap v2 en 3 phases** avec 23 items identifiés
- **DÉCISION MAJEURE : Option A validée (scope réduit, launch juillet 2026)**
  - Au lieu de faire 70-95h de dev pour tout le scope, on fait 25-40h pour le scope minimal viable
  - Features v2 : 4 P0 fondations + Dashboard coûts + Templates métier + Fix bug clavier
  - Features reportées v2.1+ : sync multi-device, knowledge spaces, multi-LLM simultané, voix, etc.
  - Launch cible : juillet 2026 (6-10 semaines de Phase 2 à rythme 30-60 min/soir)
  - Raison : permet un launch plus tôt, récupère des feedbacks utilisateurs réels, évite de construire 4 mois dans le noir

### Décision finale sur le positionnement (14 avril matin)
**Positionnement validé (provisoirement)** : "L'outil IA européen pour les indépendants qui en ont marre de cumuler 3 abonnements et de se faire brider par les usage limits."

Florent commentaire : "oui c'est un mix entre ma première et ma deuxième idée, ça reste suffisamment ouvert pour attirer du monde sans être un énième chatbot IA"

---

## 💰 MODÈLE ÉCONOMIQUE CIBLE (VOIE C HYBRIDE - SCOPE VALIDÉ 14 AVRIL SOIR)

Structure validée avec prix exacts et répartition des features :

### 🆓 Version Free BYOK
**Prix** : 0€. L'utilisateur apporte ses propres clés API.
**Inclus** : accès tous les modèles via BYOK (Claude, Gemini, Mistral), conversations illimitées côté Arty (seule limite : quota chez le provider), Web + Android, connexion Google OAuth pour Gmail, sélecteur langue FR/EN, Dashboard coûts temps réel complet, stockage local chiffré.
**Exclus** : Templates métier, support prioritaire.
**Cible** : power users techniques avec clés API existantes.
**Rôle stratégique** : point d'entrée principal, bouche-à-oreille, démo de qualité.

### 💎 Version Pro One-Time
**Prix** : 39€ one-time (paiement unique).
**Inclus en plus du Free** : Templates métier (20-30 pour artisans/freelances/indépendants/pros libéraux), création de templates custom illimitée, support email prioritaire, accès à vie aux futures features one-time (ex : sync multi-device en v2.1), pas de pub.
**Exclus** : relais API (reste en BYOK), features à coût récurrent pour Florent.
**Cible** : power users qui veulent supporter le projet et accéder aux features avancées à vie.
**Justification prix 39€** : sweet spot psychologique (< 50€), 2× ChatGPT Plus mensuel, argument "breakeven en 2 mois".

### 📱 Version Subscription
**Prix** : 9,99€/mois (facturation Lemon Squeezy).
**Inclus** : tout le Pro One-Time + PAS besoin de clé API (Arty gère tout via relais), quota 500 messages/mois, accès "best available model" (Arty choisit intelligemment), facturation auto annulable à tout moment.
**Exclus** : usage illimité, modèles premium au-delà du quota (dégradation sur modèle moins cher si dépassement).
**Cible** : grand public semi-tech, pros non-techniques, gens qui veulent "juste que ça marche".
**Justification prix 9,99€** : moins cher que Le Chat (14,99€), plus premium que Poe Starter ($4,99), marge brute ~4,50€/user/mois après coûts.
**Justification 500 msg/mois** : ~16 msg/jour, suffisant pour 80% des usages pros, permet de contrôler les coûts API.

### Upgrade paths
- **Free → Pro** : utilisateur BYOK qui veut les templates. Paiement unique.
- **Free → Subscription** : utilisateur sans clé API qui veut "que ça marche". Passage au relais.
- **Pro → Subscription** : garde accès Pro à vie + active relais pour 7,99€/mois (bonus fidélité -20%).
- **Subscription → Pro** : annule abo, achète Pro 39€ pour utiliser sa propre clé.

### Outils pour gérer tout ça
- Lemon Squeezy pour paiement + TVA EU (Merchant of Record, ~5% de commission)
- Hosting EU : Cloudflare Pages + D1 EU (déjà en place)
- Gestion licences one-time : via Lemon Squeezy

---

## 📅 PLAN EN 3 PHASES (3-4 MOIS TOTAL, OPTION A VALIDÉE)

### Phase 1 : avril à début mai 2026 (3 semaines, ~15-20h total)
**Objectif** : Préparation stratégique, PAS de code

**5 sous-objectifs** :
1. ✅ **Valider le besoin réel** → Fait via données publiques (14 avril matin) + analyse Play Store (14 avril aprem)
2. ⏳ **Définir le scope des 3 versions** (Free / Pro one-time / Pro subscription) → NEXT
3. ⏳ **Choisir les outils techniques** (Lemon Squeezy validé provisoirement) → Après objectif 2
4. ⏳ **Écrire le positionnement en 3 phrases** qui guide tout → Après objectif 3
5. ⏳ **Préparer mentalement et côté famille** pour Phase 2 → En continu

**Florent a explicitement demandé de ne PAS interviewer son entourage** pour des raisons d'identité (façadier public, maker secret).

### Phase 2 : mai à fin juin 2026 (6-10 semaines, ~25-40h total, OPTION A)
**Objectif** : Dev technique de la v2 hybride MINIMALE VIABLE

**Features v2 validées (Option A)** :
1. **P0** : Backend relais API pour la partie Subscription (L, ~10-15h)
2. **P0** : Intégration Lemon Squeezy (M, ~5-8h)
3. **P0** : Système licences one-time (M, ~5-8h)
4. **P0** : Double parcours onboarding (M, ~5-8h)
5. **P1** : Dashboard coûts temps réel (S, ~2-4h)
6. **P1** : Templates métier indépendants (M, ~5-8h)
7. **P2 urgent** : Fix bug clavier saisie clé API (S, ~1-2h)

**Features REPORTÉES à v2.1+ (pas dans la v2)** :
- Sync multi-device chiffré
- Knowledge spaces
- Réponse multi-LLM simultanée
- Mode voix (Whisper)
- Support documents attachés en conversation
- Recherche dans historique
- Partage de conversations
- Thèmes automatiques

### Phase 3 : juillet 2026 (2-3 semaines)
**Objectif** : Launch v2 avec le vrai positionnement

**Actions principales** :
- Landing page refaite avec nouveau positionnement
- Mise à jour Play Store (screenshots, description, mots-clés)
- Tests pré-launch sur Firebase App Distribution
- Launch Product Hunt
- Post Discord Anthropic built-with-claude
- Soumissions Uneed, Indie Hackers
- Récupération feedbacks + fix bugs critiques

---

## 🚦 OÙ ON EN EST (14 avril 2026, soir)

**Phase en cours** : Phase 1
**Objectifs terminés** :
- ✅ Objectif 1 : valider le besoin (double validation : données publiques + analyse Play Store)
- ✅ Objectif 2 : scope des 3 versions (Free / Pro 39€ / Subscription 9,99€/mois, 500 msg)

**Prochain objectif** : Objectif 3 = confirmer les outils techniques (Lemon Squeezy, architecture)

**Actions récentes validées** :
- Launch du 21 avril : ANNULÉ
- Positionnement provisoire : VALIDÉ
- Analyse concurrentielle Play Store : FAIT (trou de marché confirmé)
- Roadmap v2 créée avec 23 items identifiés
- DÉCISION OPTION A : VALIDÉE (scope réduit, launch juillet 2026)
- **SCOPE 3 VERSIONS : VALIDÉ (prix et features figés)**

**Prochaine session prévue** :
- Sujet : objectif 3 (outils techniques)
- Durée cible : 30-45 min max
- Claude proposera une stack technique complète (Lemon Squeezy + webhooks Cloudflare Workers + gestion licences), Florent valide ou ajuste

---

## 🤝 RÈGLES DE COLLABORATION (validées avec Florent)

1. **Une phase à la fois, pas d'anticipation**. Quand on est en Phase 1, on ne parle pas de Phase 2 ou 3 sauf si ça débloque quelque chose.

2. **À chaque session, rappeler où on en est**. Florent va avoir 3 mois de conversations, des pauses, des oublis. Toujours commencer par "on est en Phase X, étape Y, voilà ce qu'on a validé".

3. **Pas de plan de 50 bullets**. Si le message devient écrasant, s'arrêter et demander si on avance trop vite.

4. **Respecter la contrainte 30-60 min/soir**. Toute action proposée doit tenir dans cette fenêtre. Si ça dépasse, c'est une erreur de proposition.

5. **Distinguer clairement ce que Florent peut faire seul vs ce qui demande Claude**. Lecture de doc : seul. Décisions stratégiques : ensemble.

6. **Tenir une mémoire externe à la conversation** (ce fichier, à mettre à jour).

7. **Niveau de confiance explicite** avant toute affirmation non triviale : Faible / Moyen / Fort.

8. **Pas de flatterie, pas de sycophancy**. Challenger quand il faut, donner des probabilités chiffrées, pointer les risques. Florent a explicitement demandé cette posture.

9. **Pas de tiret cadratin (—) jamais**. Virgule ou deux points à la place.

10. **Ne jamais mettre "devis sous 48h"** (règle historique de Florent, valable pour tout document qui pourrait sortir).

---

## 🔍 DONNÉES DE MARCHÉ CLÉS (utiles pour les décisions)

### TypingMind (référence)
- Lancé en 2023 par Tony Dinh (dev solo vietnamien)
- Revenus 2023 : 360K USD
- Revenus 2024 : 817K USD
- 3 employés, 0 levée de fonds
- Modèle hybride : one-time license 39-49 USD + TypingMind Custom (B2B) à 15K USD MRR
- Citation de Tony Dinh : "I find this mix of subscription and one-time purchase to be the best model"
- Confiance : Forte, source Getlatka

### Acteurs BYOK identifiés en 2026
**US/global** : TypingMind, Chatbox AI, Novodo, AiZolo, BYOKChat (9 USD/mois), Voilà, MindMac, LibreChat
**EU** : Langdock (B2B enterprise, 25€/user/month), EUrouter (dev-oriented, 99 USD/mois ou one-time), Aleph Alpha (gouvernemental)
**Trou de marché confirmé** : pas d'acteur EU BYOK grand public simple pour indépendants et petits pros

### Frustrations documentées du marché
1. Cumul d'abonnements : un dev raconte payer 82 USD/mois en ChatGPT + Claude + Copilot + Perplexity + outils IA. 984 USD/an.
2. Usage limits Claude Pro : plusieurs articles récents montrent des utilisateurs payants atteindre 100% en une heure
3. Free tiers qui deviennent trop bons : les users paient pour de la "marge qu'ils ne touchent jamais"
4. Opacité sur le tracking et les données
5. Dépendance : "le coût de changement ce n'est pas les 20 USD, c'est les habitudes, l'historique qu'on ne peut pas exporter"

### Contexte réglementaire EU
- EU AI Act entre en vigueur août 2026 pour systèmes haut risque
- RGPD amendes jusqu'à 4% du CA mondial
- CLOUD Act US : même si hébergé en EU, une société américaine reste soumise → argument juridique réel pour Arty société française
- Hosting Cloudflare EU + D1 EU déjà en place pour Arty

---

## ⚠️ PIÈGES À ÉVITER (identifiés ensemble)

1. **Ne pas repartir sur le launch Product Hunt du 21 avril** : il est annulé, validé.
2. **Ne pas interviewer l'entourage de Florent** : il ne veut pas révéler sa casquette maker.
3. **Ne pas partir sur "grand public"** : le vrai public cible est "power users fatigués des subscriptions", plus étroit mais vrai.
4. **Ne pas renommer le repo GitHub ni le projet Cloudflare Pages** : le nom technique reste "appfacade" partout, "Arty" uniquement en public.
5. **Ne pas proposer de plan qui dépasse 30-60 min/soir** : contrainte famille absolue.
6. **Ne pas partir en dev avant Phase 2** : Phase 1 est stratégique, pas technique.
7. **Ne pas retomber dans la sycophancy** : Florent a explicitement demandé la réalité, pas les encouragements.

---

## 📝 QUESTIONS OUVERTES / À TRANCHER PLUS TARD

1. **Arty open source ou pas ?** Question posée, pas tranchée. Impact marketing et communauté.
2. **Garder arty.to ou revendre ?** Environ 25€/an de coût, décision en attente.
3. **Révéler la casquette maker au launch v2 ?** Impact sur narratif landing page ("story du façadier") et photo.
4. **Prix exacts des tiers Pro one-time et Subscription** : fourchettes données (29-49€ et 8-12€/mois), à affiner au moment du scope.
5. **Stratégie multi-langues pour v2** : FR + EN suffisants ou ajouter DE/ES/IT pour couvrir le marché EU plus large ?

---

## 🎯 PROCHAINE SESSION : OBJECTIF 3 DE PHASE 1

**Sujet** : Confirmer les outils techniques et l'architecture haut niveau pour Phase 2

**Contexte important** : le scope des 3 versions est verrouillé (objectif 2 fait). Cette session confirme les outils concrets qui vont être utilisés pour construire la v2.

**Questions à traiter** :
1. **Paiement** : Lemon Squeezy confirmé ? Alternatives Paddle ou Stripe Tax à creuser ?
2. **Gestion des licences one-time** : via Lemon Squeezy directement ou solution tierce ?
3. **Backend de relais API** : architecture sur Cloudflare Workers existants + D1 ? Quelles limites prévoir ?
4. **Gestion des quotas Subscription** (500 msg/mois) : comment track et enforce ?
5. **Webhooks** : comment gérer paiements, annulations, remboursements ?
6. **Sécurité** : chiffrement des clés API BYOK côté client, pas de fuite en mode Subscription

**Méthode** : Claude propose une architecture complète justifiée, Florent valide ou ajuste. Durée cible : 30-45 min max.

**Règle** : commencer cette session par un rappel rapide du scope 3 versions validé (prix et features), pour remettre Florent dans le bain.

---

## 📞 INFOS PRATIQUES

- **Email principal Florent** : flotellop@gmail.com
- **Google Drive** : monté localement sur G:\Mon Drive\
- **Lien beta Arty v3.1** : https://appdistribution.firebase.dev/i/149a5c51d26b870b
- **Repo** : flotellop-art/Appfacade (GitHub)
- **Domaine principal** : tryarty.com
- **Langue de travail** : français

---

## 📡 VEILLE MARCHÉ : SIGNAUX RÉCURRENTS

Journal des cycles de veille (concurrents IA personnels + voix users Reddit/HN/PH). Chaque entrée datée, pas de réécriture rétroactive, pour traçabilité.

### Cycle 2026-05-28

**Concurrent : Google Gemini Spark beta live (US Ultra)** (signal neuf)
- Spark passé de "annoncé I/O" à "actif en beta" pour les abonnés Google AI Ultra US, 99,99 USD/mois.
- Toujours US-only, English-only, aucune timeline EU annoncée.
- Point clé : obligations "agents" de l'EU AI Act entrent en vigueur le **2 août 2026**. Spark ne peut pas structurellement arriver en France avant cette date.
- Calendrier Arty : sortie Play Store **juillet 2026**. Fenêtre FR/EU réelle et datée.
- align-roadmap : oui
- Action proposée : exploiter cet angle dans la comm pre-launch (blog/Insta) "l'agent IA personnel connecté à Gmail arrive en France, avant Gemini Spark."

**Status hebdo des autres concurrents** : OpenAI personal, Anthropic consumer, Mistral Le Chat, Perplexity, Pi : rien de neuf depuis le 21/05.

**Voix users : $40/mois double-abo devient norme Reddit** (vague récurrente)
- Citation source : "Most serious AI users in 2026 are paying for both. $40/month for ChatGPT Plus + Claude Pro gives you the best of both worlds, volume from ChatGPT, quality from Claude."
- Consensus documenté sur r/ClaudeAI, r/ChatGPT, r/DataScience. Plusieurs agrégateurs mai 2026 convergent.
- Source : https://betonai.net/reddit-thinks-claude-ai-vs-chatgpt-2026/
- Action proposée Arty : pitch direct "arrête de payer deux abos". Claude + Gemini + Mistral dans Arty = alternative financièrement mesurable au double-abo à 40 USD/mois.
- align-roadmap : oui (cohérent avec positionnement validé 14 avril "power users fatigués des subscriptions")

---

## 📌 SIGNATURE DE FIN

Ce mémo a été créé le 14 avril 2026 au matin à la demande de Florent pour servir de référence dans une nouvelle conversation ou en cas de compaction de transcript. Il doit être maintenu à jour à chaque grande décision ou fin de phase.

**Mises à jour historiques** :
- 14 avril 2026 matin : création initiale
- 14 avril 2026 après-midi : ajout analyse Play Store, roadmap v2, décision Option A validée
- 14 avril 2026 soir : scope 3 versions validé (Free / Pro 39€ / Subscription 9,99€/mois, 500 msg)
- 28 mai 2026 : ouverture section "Veille marché : signaux récurrents" (cycle hebdo concurrents + voix users)

**Prochaine mise à jour prévue** : à la fin de l'objectif 3 de Phase 1 (outils techniques confirmés).
