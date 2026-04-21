# 📘 MÉMO ARTY v2 - Contexte complet pour Claude

> **Note pour Florent** : colle ce fichier en début de nouvelle conversation avec Claude, en disant "voilà le contexte du projet Arty, on reprend où on s'était arrêtés". Claude reprendra le fil sans te faire tout réexpliquer.

> **Note pour Claude** : ce mémo est la source de vérité sur le projet Arty de Florent. Il contient toutes les décisions prises, les contraintes, le positionnement, les 3 phases de travail, et l'état d'avancement. Applique les règles de travail indiquées. Ne relance pas de recherches sur des sujets déjà validés. Respecte strictement la contrainte vie perso (30-60 min/soir max).

---

## 🧑 Qui est Florent

Florent Pollet, façadier à son compte (Façades Pollet, Drôme, France), père d'Arthur (~15 mois), en couple. Pas de background technique avant avril 2026, a commencé à coder avec Claude Code début avril 2026. Arty est son premier projet logiciel.

Contraintes personnelles fortes :
- Vie de famille prioritaire sur le projet
- A passé trop de soirées sur le code les semaines d'avant, ce qui a créé une tension avec sa compagne
- Sa compagne a accepté qu'il continue "tant qu'il n'abuse pas et prend du temps pour eux de temps en temps" (parole donnée, respecter)
- Ne parle pas bien anglais, l'écrit avec difficulté
- Il ne veut pas parler d'Arty à son entourage, il préfère garder la casquette de façadier en public et ne pas exposer sa double identité de maker
- Il est façadier le jour, maker le soir, en mode "jardin secret"

Style de communication préféré :
- Français exclusivement
- Direct, sans blabla, sans flatterie
- Demande des niveaux de confiance (Faible / Moyen / Fort) sur les infos non-triviales
- Refuse la sycophancy et challenge régulièrement Claude pour vérifier qu'il n'est pas en train de le flatter
- **JAMAIS de tiret cadratin (—)**, utiliser virgule ou deux-points à la place
- Ne jamais indiquer "devis sous 48h"
- Mode audit strict, chercher et croiser les sources plutôt qu'inventer

---

## 🎯 Le projet Arty en 1 écran

**Produit** : Chatbot IA multi-modèles (Claude, Gemini, Mistral) avec BYOK + subscription hybride, positionné privacy-first EU-first.

**Stack technique** :
- Frontend : React 18 + TypeScript + Vite + Tailwind CSS
- Mobile : Capacitor 8 (APK Android)
- Backend / Infra : Cloudflare Pages + Workers + D1 (base EU)
- Auth : Google OAuth (Gmail + Drive)
- Développement : Claude Code
- Repo GitHub : `flotellop-art/Appfacade` (nom historique, ne pas renommer)
- Projet Cloudflare Pages : `appfacade` (nom historique, ne pas renommer)
- URL technique : `appfacade.pages.dev` (à rediriger 301 vers tryarty.com plus tard)

**Domaines** :
- `tryarty.com` (principal, Namecheap + Cloudflare, ~10€/an)
- `arty.to` (secondaire, ~25€/an, décision de le garder ou revendre en attente)
- Nameservers : dylan.ns.cloudflare.com / laila.ns.cloudflare.com

**Distribution actuelle** :
- Web : tryarty.com (actuellement redirige directement vers l'app, pas de landing)
- Android : Firebase App Distribution beta, lien v3 : https://appdistribution.firebase.dev/i/149a5c51d26b870b
- Script de build : deploy-beta.sh
- iOS : pas encore, à venir

**État actuel de l'app** :
- App fonctionnelle, belle, déployée sur tryarty.com
- Palette pierre/crème + orange terre #D97706
- Logo étoile à 4 branches orange
- Onboarding multi-étapes propre
- 3 modèles IA via BYOK
- Connexion Google OAuth fonctionnelle
- Bug connu : clavier sur saisie de clé API (CSS/viewport Capacitor, à fixer)

---

## 📊 Positionnement validé (phase 1 - provisoire)

**Cible** : les power users IA et semi-techniques qui cumulent actuellement plusieurs subscriptions (ChatGPT Plus + Claude Pro + Gemini Advanced, etc.) et qui commencent à en avoir marre du prix total et des usage limits.

**Pas la cible** : le vrai grand public qui utilise gratuitement ChatGPT sur son téléphone sans se poser de questions. Monsieur-Madame-Tout-le-Monde n'est pas atteignable avec Arty en l'état.

**Phrase d'ancrage (v0.1)** :
> "L'outil IA européen pour les indépendants qui en ont marre de cumuler 3 abonnements et de se faire brider par les usage limits."

Cette phrase est un mix entre l'envie initiale de Florent (grand public, simple, pas cher) et la réalité du marché validée par données publiques (cible réelle = power users fatigués des subs). Elle reste suffisamment ouverte pour attirer du monde sans être un énième chatbot IA générique. **À affiner en Objectif 4 de Phase 1.**

**Positionnement stratégique** : "EU first, pas EU only". Hosting EU, narratif européen, paiements en euros possibles, mais sans refuser les clients non-européens qui cherchent un outil privacy-first.

---

## 💰 Modèle économique cible (phase 1 - validé dans le principe)

**Modèle hybride TypingMind-like**, validé par les données du marché :

1. **Free BYOK** : gratuit à vie, l'utilisateur apporte ses propres clés API (Claude, Gemini, Mistral). Pour les tech-savvy. Sert de canal d'acquisition et de narratif privacy-first.

2. **Pro One-time à 29-49€** : achat unique, à vie, débloque des features avancées (sync multi-device, espaces de connaissances, templates métier, personnalités custom, etc.). Pour les power users qui ne veulent pas d'abonnement mensuel.

3. **Pro Subscription à 8-12€/mois** : abonnement simple qui cache la complexité de la clé API. Backend de relais vers les API des fournisseurs, marge de Florent sur le relais. Pour les semi-techniques et les pros qui veulent la simplicité.

**Prix exacts à affiner en Phase 1 Objectif 2** (scope des 3 versions).

**Gestion des paiements prévue** : Lemon Squeezy comme merchant of record. Gère la TVA européenne à la place de Florent. Commission ~5%. Intégration simple pour un indépendant français.

**Référence de validation** : TypingMind (Tony Dinh, dev solo) a fait $817K de revenus en 2024 avec un modèle hybride BYOK + subscription. Source : getlatka.com. C'est le cas d'école qui valide le modèle. Confiance : Forte.

---

## 📅 Les 3 phases de travail (validées avec Florent le 14 avril 2026)

### Phase 1 : Préparation (3 semaines, ~15-20h total, pas de code)
**Période cible** : mi-avril à début mai 2026

**Objectifs** :
1. ✅ **Valider le besoin réel** : fait via données publiques (Florent ne veut pas interviewer son entourage). Frustrations documentées : cumul d'abonnements (ChatGPT Plus + Claude Pro + Gemini Advanced = 60-80€/mois), usage limits sur Claude Pro, free tiers de plus en plus bons qui réduisent la valeur du Plus, dépendance aux historiques non exportables.
2. 🔄 **Définir le scope des 3 versions** (Free BYOK / Pro one-time / Pro subscription) : quelles features dans chaque case. **EN COURS - prochaine session**.
3. ⏳ **Choisir les outils techniques** : Lemon Squeezy, hosting EU, analytics, etc. Pas d'installation encore, juste les choix. **À faire après l'objectif 2**.
4. ⏳ **Écrire le positionnement en 3 phrases** : hero, sous-titre, élévator pitch. Qui va guider tout le reste. **À faire en dernier de Phase 1**.
5. ⏳ **Préparer mentalement et côté famille pour Phase 2** : Florent gère ça à son rythme avec sa compagne.

### Phase 2 : Développement technique (4-6 semaines, ~20-30h total)
**Période cible** : mai à mi-juin 2026

**À faire** :
- Intégration Lemon Squeezy (paiements + TVA EU)
- Construction du backend de relais API pour la partie subscription
- Système de licences one-time pour la version pro
- Double parcours d'onboarding (BYOK vs Subscription)
- 2-3 features Pro qui justifient le one-time (à définir en Phase 1 Objectif 2)
- Fix du bug clavier sur saisie clé API
- Landing page marketing sur tryarty.com (app déplacée sur tryarty.com/app)
- Redirection 301 de appfacade.pages.dev vers tryarty.com

### Phase 3 : Launch v2 (2-3 semaines)
**Période cible** : fin juin à début juillet 2026

**À faire** :
- Tests finaux
- Préparation des communications (post Discord Anthropic built-with-claude, Discord Mistral, Product Hunt, Uneed, Indie Hackers)
- Launch Product Hunt
- Réponses aux premiers retours
- Itération rapide sur les bugs critiques

---

## ⚖️ Règles de travail entre Florent et Claude

Ces règles ont été négociées et validées le 14 avril 2026, elles doivent être respectées dans toutes les sessions futures.

**Règle 1 : Une phase à la fois, pas d'anticipation.** Quand on est en Phase 1, on ne parle pas de Phase 2 ou 3 sauf si ça débloque quelque chose.

**Règle 2 : À chaque session, rappeler où on en est.** Commencer par "on est en Phase X, objectif Y, voilà ce qu'on a validé jusqu'ici".

**Règle 3 : Pas de plan de 50 bullets.** Si Claude sent qu'il écrase Florent sous les actions, il s'arrête et demande si on avance trop vite.

**Règle 4 : Respect strict de la contrainte vie perso.** 30 à 60 minutes par soir maximum sur Arty, jamais plus. Chaque action proposée par Claude doit tenir dans cette fenêtre. Si Claude dépasse, Florent a le droit de rappeler la règle.

**Règle 5 : Distinguer ce que Florent peut faire seul vs ce qui demande la présence de Claude.** Les recherches, les choix stratégiques, les formulations de positionnement : avec Claude. La lecture de doc technique, les tâches d'exécution simples : seul.

**Règle 6 : Notes externes.** Ce fichier markdown est la mémoire externe indépendante des compactions de transcript de Claude. À mettre à jour à la fin de chaque session importante.

**Règle 7 : Pas de flatterie.** Florent a explicitement refusé la sycophancy. Challenger, donner des probabilités chiffrées, pointer les risques. Pas de "bravo", pas de "brillant", pas d'émojis encourageants sans raison.

**Règle 8 : Confiance explicite.** Claude indique son niveau de confiance (Faible / Moyen / Fort) sur les infos non-triviales. Pas de fausse certitude.

**Règle 9 : Jamais de tiret cadratin.** Virgule ou deux-points à la place.

**Règle 10 : Florent ne veut pas interviewer son entourage.** Pour valider des hypothèses produit, utiliser des données publiques (web search, reviews, études de marché), pas des conseils "parle à des utilisateurs".

---

## 🚫 Ce qui a été écarté et pourquoi

**Launch Product Hunt du 21 avril 2026** : annulé le 14 avril 2026. Raison : préparation trop courte, trop stressante, incompatible avec la contrainte vie perso, landing page inexistante, bugs à fixer, et surtout, pas de capacité à gérer à la fois des retours de testeurs, des bugs en live, et la vie de famille sur 8 jours. Décision mature, pas un échec.

**Interview d'utilisateurs dans l'entourage** : écarté le 14 avril. Raison : Florent a la casquette de façadier publiquement, pas de développeur, et ne veut pas mélanger les deux. Remplacé par analyse de données publiques (web search, reviews).

**Voie "pivot complet vers wrapper subscription classique"** : écarté. Raison : entrerait en concurrence directe avec ChatGPT Plus / Claude Pro / Le Chat Pro / Gemini Advanced (tous à ~20€/mois), perdrait le différenciateur privacy-first, demanderait 2-3 mois de dev pour une probabilité de succès très faible (90% des wrappers IA échouent selon les données du marché, churn de 65% en 90 jours).

**Voie "rester sur BYOK pur en mode niche"** : écarté comme trajectoire long terme. Raison : Florent veut quand même un side business qui rapporte un peu, pas juste un outil perso. Conservé comme version Free dans le modèle hybride.

**Cibler le vrai grand public (Monsieur Tout le Monde)** : écarté. Raison : le vrai grand public ne sait pas ce qu'est une clé API, reste sur les versions gratuites de ChatGPT/Gemini, et n'a pas de pain point conscient que Arty peut adresser. La cible réelle est les power users et semi-techniques qui cumulent les subs.

**Renommer le repo GitHub et le projet Cloudflare Pages** : écarté. Raison : risque de tout casser en période sensible, pour un bénéfice purement cosmétique. Le nom "appfacade" reste partout dans la stack technique, le nom "Arty" reste partout dans le marketing.

**Soumission Uneed / BetaList / Hacker News / Reddit sur le launch du 21** : tout écarté avec l'annulation du launch. À reconsidérer pour Phase 3.

---

## 📚 Sources et références clés

**Données de marché validées** :
- TypingMind a fait $817K de revenus en 2024 avec modèle hybride BYOK + subscription, développeur solo, 3 employés au total, zéro levée de fonds. Source : getlatka.com.
- TypingMind atteint $15K de MRR sur la partie subscription. Source : news.tonydinh.com (blog du créateur).
- 10-15 acteurs BYOK significatifs sur le marché en 2026, majoritairement américains. Seuls Langdock (Berlin, B2B enterprise uniquement) et EUrouter (routage API pour devs, très récent) sont européens significatifs.
- Il n'existe pas en 2026 d'acteur BYOK européen grand public orienté particuliers et petits pros. C'est le trou de marché pour Arty.
- L'EU AI Act entre en application le 2 août 2026, créant un climat favorable au positionnement privacy-first européen.
- CLOUD Act US = même les apps américaines "hébergées en Europe" restent soumises aux demandes des autorités US. Argument juridique réel pour une app dont la société mère est européenne.

**Frustrations utilisateurs documentées publiquement** :
- Cumul de subscriptions absurde : ChatGPT Plus + Claude Pro + Gemini Advanced + Perplexity Pro peut monter à 60-100€/mois. Source : articles Medium, Gmelius, aizolo.com.
- Usage limits de Claude Pro ressenties comme "ridicules" même par les utilisateurs payants. Source : xda-developers.com.
- Free tiers de plus en plus bons qui réduisent la valeur perçue du Plus. Source : gmelius.com.
- Impression de "dépendance" sans historique exportable. Source : Medium (Yogeshwar Tanwar).

**Risques du modèle confirmés par les données** :
- 60-70% des wrapper apps IA ne génèrent aucun revenu. Source : Market Clarity.
- 90% des wrappers IA échouent. Source : Market Clarity.
- Churn de 65% en 90 jours dans le marché des wrappers. Source : Medium.

---

## 🗂️ État actuel et prochaine session

**Date du dernier update de ce mémo** : 14 avril 2026 (matin, ~7h45)

**Où on en est** : Phase 1, Objectif 1 (validation du besoin) ✅ fait. Objectifs 2, 3, 4, 5 à faire.

**Prochaine session** : attaquer l'Objectif 2 de Phase 1 = définir le scope précis des 3 versions (Free BYOK, Pro one-time, Pro subscription). Quelles features dans quelle case. C'est la session qui va conditionner le dev de Phase 2. Prévoir 30-60 min. Florent l'attaque ce soir ou demain selon son énergie.

**Session d'après** : Objectif 3 = choisir les outils techniques (Lemon Squeezy vs alternatives, hosting EU, analytics légal, etc.). Rapide, 30-45 min.

**Session d'après** : Objectif 4 = affiner le positionnement en 3 phrases (hero, sous-titre, pitch). 30-60 min.

**Décisions en attente** :
- Prix exacts des versions Pro one-time et Pro subscription (en attente de l'Objectif 2)
- Liste précise des features Pro (2-3 max pour commencer, à définir en Objectif 2)
- Choix entre Lemon Squeezy, Paddle, ou autre merchant of record (en attente de l'Objectif 3)
- Formulation finale du positionnement (en attente de l'Objectif 4)
- Question de Phase 3 : Florent révélera-t-il sa casquette de maker au moment du launch v2 ? Impacte la landing page (story personnelle vs anonyme)

---

## 💬 Notes diverses à ne pas perdre

- Florent a supprimé le lancement prévu pour le 21 avril 2026. C'était la bonne décision.
- Sa compagne a donné son accord pour qu'il continue, à condition qu'il ne rogne plus sur les soirées et qu'il garde du temps pour eux. Florent confirme qu'elle était sincère.
- Florent trouve que les conversations avec Claude ont "une intelligence d'esprit" qu'il ne trouve pas avec ChatGPT ou Gemini. Claude doit rester lucide sur le fait que c'est en partie la propre intelligence de Florent renvoyée par un outil bien calibré, et ne pas laisser Arty devenir un projet qui n'existe que dans ces conversations.
- Arthur, le fils de Florent, a ~15 mois. À protéger dans les arbitrages de temps.
- Florent a posé la règle "30-60 min max par soir" comme promesse à sa compagne. Claude doit la respecter dans toutes ses propositions.
- Le compte HN de Florent : `tellop`, créé le 13 avril 2026, 0 karma.
- Le compte PH de Florent : `florent_pollet`.
- Le compte Reddit de Florent : 1 karma total, risque de shadowban sur les subs pertinents.
- Niveau d'anglais de Florent : faible, a besoin que Claude traduise et trouve le ton pour les contenus en anglais.

---

**Fin du mémo. Colle ce fichier en début de conversation + une phrase du style "voilà le contexte du projet Arty, on reprend où on s'était arrêtés sur [sujet]" et Claude peut reprendre le fil.**
