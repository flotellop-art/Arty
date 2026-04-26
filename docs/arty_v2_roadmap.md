# 🗺️ ROADMAP ARTY V2

**Document de planification produit**
**Date** : 14 avril 2026 (mise à jour après-midi : décision Option A validée)
**Auteur** : Florent Pollet
**Version** : 1.1 (Option A validée)

---

## 🎯 OBJECTIF DE CE DOCUMENT

Ce document liste **toutes les améliorations d'Arty** organisées en phases temporelles, avec priorités et durées estimées.

**Il répond à la question** : "Dans quel ordre je construis quoi, et pourquoi ?"

**Il ne remplace pas** : le mémo Arty v2 (contexte stratégique global), les spécifications techniques détaillées (qui seront faites en Phase 2 par Claude Code), le plan marketing (Phase 3).

---

## 📐 CADRE DE PRIORISATION

Chaque feature est classée selon 3 critères :

**Priorité** :
- **P0** : Critique. Sans ça, Arty ne peut pas être lancé en v2. À faire obligatoirement.
- **P1** : Important. Ça différencie Arty de la concurrence. À faire en priorité après les P0.
- **P2** : Nice-to-have. Ça améliore l'expérience mais peut attendre v3 ou plus tard.

**Effort** :
- **S** (Small) : 1-3 sessions de 30-60 min
- **M** (Medium) : 4-8 sessions
- **L** (Large) : 10-20 sessions
- **XL** (Extra Large) : 20+ sessions

**Impact différenciant** :
- 🟢 **Fort** : feature qui différencie clairement Arty de la concurrence
- 🟡 **Moyen** : feature attendue mais qui peut être mieux exécutée qu'ailleurs
- 🔵 **Faible** : table stakes, doit exister mais ne différencie pas

---

## 🏗️ VUE D'ENSEMBLE DES 3 PHASES

```
PHASE 1 (avril-mai 2026)    │ PHASE 2 (mai-juin 2026)    │ PHASE 3 (juin-juillet 2026)
3 semaines                   │ 4-6 semaines                │ 2-3 semaines
───────────────────────────  │ ───────────────────────────  │ ───────────────────────────
Préparation stratégique      │ Dev technique               │ Launch v2
Pas de code                  │ Code intensif               │ Marketing + polish

Livrables :                  │ Livrables :                 │ Livrables :
- Scope 3 versions           │ - Backend relais API        │ - Landing page refaite
- Outils choisis             │ - Stripe/Lemon Squeezy      │ - Product Hunt launch
- Positionnement 3 phrases   │ - Licences one-time         │ - Post Discord Anthropic
                             │ - Double onboarding         │ - Uneed + autres
                             │ - 2-3 features Pro          │ - Post-launch ajustements
```

---

## 📋 PHASE 1 : PRÉPARATION STRATÉGIQUE (avril-mai 2026)

**Durée cible** : 3 semaines, ~15-20h total
**Règle** : zéro ligne de code Arty pendant cette phase

### Objectif 1 : Valider le besoin ✅ FAIT

Validé via recherche web et analyse concurrentielle du Play Store.
**Conclusion** : trou de marché confirmé pour "BYOK multi-modèles + EU-first + hybride" en Android.

### Objectif 2 : Définir le scope des 3 versions ⏳ À FAIRE (NEXT)

**Durée estimée** : 1-2 sessions de 45 min
**Livrable** : tableau final des features par version

**Questions à trancher avec Claude** :
- Quelles features dans Free BYOK (pour attirer les power users tech) ?
- Quelles features dans Pro one-time 29-49€ (pour justifier le paiement) ?
- Quelles features dans Subscription 8-12€/mois (pour attirer le grand public) ?
- Upgrade path entre les 3 versions

### Objectif 3 : Choisir les outils techniques

**Durée estimée** : 1 session de 30-45 min
**Livrable** : liste courte des outils à utiliser

**Décisions à prendre** :
- Paiement : Lemon Squeezy vs Paddle vs Stripe Tax (recommandation initiale : Lemon Squeezy pour sa simplicité et sa gestion TVA européenne)
- Backend de relais API : architecture simple sur Cloudflare Workers existants
- Gestion des licences one-time : intégré à Lemon Squeezy ou solution tierce

### Objectif 4 : Écrire le positionnement en 3 phrases

**Durée estimée** : 1 session de 30-45 min
**Livrable** : 3 phrases qui guident tout le marketing

**Base actuelle** : "L'outil IA européen pour les indépendants qui en ont marre de cumuler 3 abonnements et de se faire brider par les usage limits."

**À décliner en** :
- Phrase 1 : le pain point (1 phrase)
- Phrase 2 : la solution Arty (1 phrase)
- Phrase 3 : la différenciation (1 phrase)

### Objectif 5 : Préparer Phase 2 côté famille

**Durée estimée** : discussion avec compagne, 1 fois
**Livrable** : accord explicite sur le rythme 30-60 min/soir pendant 4-6 semaines

---

## 🔨 PHASE 2 : DÉVELOPPEMENT TECHNIQUE (mai-juin 2026)

**Durée cible** : 4-6 semaines, ~20-30h total
**Règle** : 30-60 min par soir, pas plus. Week-ends sacrés.

### 🔴 P0 : Fondations techniques (CRITIQUE)

#### 1. Backend de relais API pour la partie Subscription
**Priorité** : P0 · **Effort** : L · **Impact** : 🔵
**Description** : construire le système qui permet aux utilisateurs Subscription d'utiliser Arty sans fournir leur propre clé API. Arty utilise ses clés maîtresses et facture l'utilisateur.
**Détail technique** :
- Endpoint Cloudflare Workers qui reçoit les requêtes des users Subscription
- Middleware qui vérifie l'abonnement actif via Lemon Squeezy
- Système de quotas par user (ex: 500 messages/mois en subscription 9,99€)
- Tracking des tokens consommés par user pour éviter les abus
- Fallback propre si quota atteint (message clair, proposition d'upgrade)
**Justification** : sans ça, pas de tier Subscription possible, donc pas d'ouverture au grand public

#### 2. Intégration Lemon Squeezy
**Priorité** : P0 · **Effort** : M · **Impact** : 🔵
**Description** : intégrer Lemon Squeezy pour gérer les paiements one-time et subscription avec gestion automatique de la TVA européenne
**Détail technique** :
- Widget de paiement intégré dans Arty
- Webhook Cloudflare Workers pour recevoir les événements (paiement, renouvellement, annulation, remboursement)
- Base de données D1 pour stocker les licences et abonnements actifs
- Portail client pour gérer son abonnement (annuler, mettre à jour le moyen de paiement)
- Gestion des factures automatiques
**Justification** : impossible de vendre légalement en Europe sans gérer la TVA OSS correctement

#### 3. Système de licences one-time
**Priorité** : P0 · **Effort** : M · **Impact** : 🔵
**Description** : générer et vérifier des clés de licence pour la version Pro one-time
**Détail technique** :
- Génération de clés de licence au moment de l'achat (via webhook Lemon Squeezy)
- Activation offline (la clé peut être vérifiée sans connexion après première activation)
- Limitation raisonnable : activation sur 3 appareils max par licence
- Portail de gestion des licences pour l'utilisateur (voir ses appareils, en révoquer)
**Justification** : sans ça, pas de tier Pro one-time possible

#### 4. Double parcours d'onboarding
**Priorité** : P0 · **Effort** : M · **Impact** : 🟡
**Description** : au premier lancement, l'utilisateur choisit entre "Je colle ma propre clé API" (BYOK) ou "Je veux un abonnement simple" (Subscription)
**Détail technique** :
- Écran de choix initial clair, non-intrusif
- Tutoriel guidé pour créer une clé API (lien vers Anthropic/OpenAI/Google/Mistral consoles)
- Parcours de paiement Subscription intégré et fluide
- Possibilité de switcher plus tard (BYOK → Subscription ou l'inverse)
**Justification** : la complexité du BYOK est le #1 frein à l'adoption grand public. Ce parcours résout le problème.

---

### 🟠 P1 : Features Pro différenciantes (PRIORITAIRE)

#### 5. Sync multi-device chiffré
**Priorité** : P1 · **Effort** : L · **Impact** : 🟢
**Description** : synchronisation des conversations entre mobile et web avec chiffrement end-to-end
**Détail technique** :
- Chiffrement côté client avant upload sur Cloudflare D1
- Clé de déchiffrement dérivée d'un mot de passe master que Arty ne stocke jamais
- Sync automatique en background quand connecté à internet
- Mode offline robuste (les conversations récentes sont accessibles sans connexion)
**Positionnement concurrentiel** : Lumo (Proton) le fait déjà mais sans BYOK. TypingMind le fait mais web-only. Feature rare sur Android.
**Justification** : argument fort pour justifier le prix Pro one-time 29-49€

#### 6. Espaces de connaissances (Knowledge spaces)
**Priorité** : P1 · **Effort** : XL · **Impact** : 🟢
**Description** : l'utilisateur peut uploader des documents (PDF, DOCX, TXT, MD) qui deviennent consultables par l'IA dans ses conversations
**Détail technique** :
- Upload de fichiers depuis mobile ou web
- Extraction du texte et chunking
- Stockage chiffré local (pas d'envoi de documents sur serveur par défaut en mode BYOK)
- Injection intelligente dans le contexte des conversations
- Gestion de plusieurs "spaces" (un pour le travail, un pour les recettes, etc.)
**Positionnement concurrentiel** : ChatGPT le fait avec ses "Projects", Claude avec ses "Projects". Personne ne le fait en privacy-first local sur Android.
**Justification** : feature killer qui justifie vraiment l'achat Pro pour les pros

#### 7. Templates métier (pour artisans, freelances, indépendants)
**Priorité** : P1 · **Effort** : M · **Impact** : 🟢
**Description** : bibliothèque de prompts et de workflows pré-remplis pour des cas d'usage pros
**Détail technique** :
- 20-30 templates au launch (ex : "Rédige un devis façade à partir de ces infos", "Résume-moi mes emails de la semaine", "Analyse ce contrat et trouve les clauses douteuses", "Traduis-moi cette facture allemande")
- Chaque template a des champs à remplir + un prompt structuré en coulisse
- Possibilité d'éditer/dupliquer/partager des templates
- Catégories : Artisanat, Freelance, Admin, Juridique, Marketing, Finances
**Positionnement concurrentiel** : Poe a des "bots" mais génériques. Arty aurait des templates ciblés sur les indépendants européens.
**Justification** : touche directement ta cible (indépendants) avec un angle unique et concret

#### 8. Réponse multi-LLM simultanée
**Priorité** : P1 · **Effort** : M · **Impact** : 🟢
**Description** : l'utilisateur pose une question et reçoit les réponses de 2-3 modèles en parallèle pour comparer
**Détail technique** :
- Écran split view sur mobile (ou tabs)
- Appels API parallèles aux modèles sélectionnés
- Affichage des coûts par modèle
- Possibilité de "fork" une conversation avec un seul modèle
**Positionnement concurrentiel** : GPTMobile le fait (10K+ DL, 4.1★) mais mal. Arty peut le faire mieux avec une meilleure UX.
**Justification** : différenciateur visuellement fort pour le marketing (screenshots PH), et vrai cas d'usage pour les power users

#### 9. Dashboard de coûts en temps réel
**Priorité** : P1 · **Effort** : S · **Impact** : 🟢
**Description** : affichage clair et transparent de ce que chaque conversation coûte à l'utilisateur
**Détail technique** :
- Compteur de tokens par message (déjà partiellement fait)
- Conversion en coût réel (€ ou $) par conversation et cumulé mois
- Graphiques d'usage mensuel
- Alertes configurables ("prévenir si je dépasse 10€/mois")
- Export CSV des coûts
**Positionnement concurrentiel** : aucune app grand public ne le fait bien. Poe cache ses crédits. ChatGPT Plus ne montre rien.
**Justification** : argument marketing puissant ("zéro surprise de facturation") et feature unique facile à implémenter

---

### 🟡 P2 : Polish et features secondaires (NICE-TO-HAVE)

#### 10. Fix du bug clavier sur saisie clé API
**Priorité** : P2 mais urgent · **Effort** : S · **Impact** : 🔵
**Description** : corriger le bug CSS/viewport Capacitor qui masque l'écran quand on saisit la clé API
**Justification** : bug connu qui nuit à l'onboarding. À faire tôt dans Phase 2.

#### 11. Mode voix (dictée vocale)
**Priorité** : P2 · **Effort** : M · **Impact** : 🟡
**Description** : permettre de parler à Arty au lieu de taper, via Whisper API
**Positionnement concurrentiel** : table stakes en 2026, mais Arty ne l'a pas encore
**Justification** : feature attendue mais pas différenciante. Peut attendre v2.1.

#### 12. Support de documents attachés en conversation
**Priorité** : P2 · **Effort** : M · **Impact** : 🟡
**Description** : permettre de glisser un PDF/image dans une conversation pour l'analyser (hors du système Knowledge Spaces)
**Justification** : pratique mais peut attendre si Knowledge Spaces est fait

#### 13. Recherche dans l'historique des conversations
**Priorité** : P2 · **Effort** : S · **Impact** : 🔵
**Description** : barre de recherche pour retrouver une conversation passée
**Justification** : basique mais utile. Facile à implémenter.

#### 14. Partage de conversations
**Priorité** : P2 · **Effort** : S · **Impact** : 🔵
**Description** : générer un lien public (optionnel) pour partager une conversation
**Justification** : feature de croissance virale potentielle, mais pas prioritaire pour la v2

#### 15. Thèmes (dark/light/system)
**Priorité** : P2 · **Effort** : S · **Impact** : 🔵
**Description** : le mode sombre est déjà là, mais ajouter le switch automatique basé sur le système
**Justification** : détail UX qui compte. Facile.

---

## 🚀 PHASE 3 : LAUNCH V2 (juin-juillet 2026)

**Durée cible** : 2-3 semaines
**Règle** : 30-60 min/soir, focus marketing et polish, pas de nouvelle feature

### 🔴 P0 : Pré-launch (CRITIQUE)

#### 16. Landing page refaite avec nouveau positionnement
**Priorité** : P0 · **Effort** : M · **Impact** : 🟢
**Description** : refaire tryarty.com avec le positionnement validé en Phase 1
**Contenu clé** :
- Hero : positionnement en 3 phrases
- Section problème : "combien coûtent tes abonnements IA ?"
- Section solution : les 3 versions d'Arty
- Section différenciation : EU, privacy, BYOK, transparence des coûts
- Screenshots des features clés
- FAQ (question BYOK, privacy, prix, comparaison ChatGPT)
- Pricing clair avec les 3 versions
- Story du façadier (si décision de garder le narratif)

#### 17. Mise à jour de la page Play Store
**Priorité** : P0 · **Effort** : S · **Impact** : 🟡
**Description** : screenshots, description, mots-clés alignés avec le nouveau positionnement
**Justification** : le Play Store est ton canal d'acquisition principal

#### 18. Tests pré-launch sur Android
**Priorité** : P0 · **Effort** : M · **Impact** : 🔵
**Description** : beta testeurs sur Firebase App Distribution pendant 1-2 semaines avant launch public
**Checklist** :
- 5-10 testeurs minimum (amis proches, communauté, ou payants via Beta-tester services)
- Focus sur parcours paiement Subscription et Pro one-time
- Tests de charge légère sur le backend de relais
- Tests de sync multi-device
- Corrections rapides des bugs critiques

### 🟠 P1 : Launch (PRIORITAIRE)

#### 19. Launch Product Hunt
**Priorité** : P1 · **Effort** : S · **Impact** : 🟢
**Description** : launch sur Product Hunt un mardi ou mercredi de juin-juillet
**Préparation** :
- First comment préparé en bad English assumé
- Screenshots et GIF de qualité
- Réseau activable pour upvotes (quelques dizaines idéalement)
- Disponibilité pour répondre aux commentaires dans la journée

#### 20. Post Discord Anthropic built-with-claude
**Priorité** : P1 · **Effort** : S · **Impact** : 🟡
**Description** : annoncer Arty dans le channel built-with-claude après le launch PH
**Format** : post concis, bon anglais assumé, angle "built by a French facade craftsman in 7 days", lien beta

#### 21. Soumissions alternatives (Uneed, Indie Hackers, r/SideProject)
**Priorité** : P1 · **Effort** : S · **Impact** : 🟡
**Description** : amplifier la visibilité post-launch PH
**Plan** :
- Uneed (jour J+1 ou J+2)
- Indie Hackers post (J+3, avec résultats PH si positifs)
- r/SideProject (attention au karma, à évaluer)
- LinkedIn si tu te décides à créer un compte pour ça

### 🟡 P2 : Post-launch (DANS LES 2 SEMAINES APRÈS)

#### 22. Récupération des feedbacks utilisateurs
**Priorité** : P2 · **Effort** : M · **Impact** : 🟢
**Description** : processus pour collecter et trier les retours
**Détail** :
- Email de welcome qui invite au feedback
- Formulaire simple (Tally ou Google Forms)
- Suivi des reviews Play Store
- Veille sur les mentions réseaux sociaux

#### 23. Fix des bugs critiques découverts au launch
**Priorité** : P2 mais urgent · **Effort** : Variable · **Impact** : 🔵
**Description** : release 2.0.1, 2.0.2, etc. pour corriger les bugs critiques des premiers jours
**Règle** : pas de nouvelle feature, uniquement des fix

---

## 🔮 POST-V2 : ROADMAP V3+ (après juillet 2026)

**Ces features ne sont PAS dans la v2. Elles sont là pour la vision long terme.**

### V2.1 (août-septembre 2026)
- Mode voix avec Whisper
- Amélioration des templates métier selon feedback
- Optimisations performances

### V3 (automne 2026) - Si v2 a du succès
- Version iOS native (nécessite compte Apple Developer à 99$/an)
- Intégrations tierces (Google Drive, Notion, Slack)
- Export des conversations en PDF/Markdown/DOCX
- Mode "agent" simple (ex : "traite tous les emails de cette semaine")
- Multi-langues (DE, ES, IT) pour élargir le marché EU

### V3+ (2027 et au-delà)
- API publique pour développeurs
- Version Teams/Business (Arty Team à 15-20€/user/mois)
- Marketplace de templates communautaires
- Intégration avec MCP servers
- Plugins system
- Mode "façadier" : templates et workflows spécifiques pour le BTP (ton propre métier)

---

## 📊 ESTIMATION TOTALE PHASE 2

| Item | Priorité | Effort |
|---|---|---|
| 1. Backend relais API | P0 | L (10-15h) |
| 2. Lemon Squeezy integration | P0 | M (5-8h) |
| 3. Système licences one-time | P0 | M (5-8h) |
| 4. Double onboarding | P0 | M (5-8h) |
| 5. Sync multi-device | P1 | L (10-15h) |
| 6. Knowledge spaces | P1 | XL (20h+) |
| 7. Templates métier | P1 | M (5-8h) |
| 8. Réponse multi-LLM | P1 | M (5-8h) |
| 9. Dashboard coûts | P1 | S (2-4h) |
| 10. Fix bug clavier | P2u | S (1-2h) |
| **TOTAL P0 + P1 + fix critique** | | **~70-95h** |

**À 30-60 min/soir, 5 soirs par semaine, ça fait 2,5 à 5h par semaine, donc entre 14 et 38 semaines pour tout faire.**

### ⚠️ CONCLUSION RÉALISTE

**Faire TOUTE la liste en 4-6 semaines est impossible.** Il faut couper.

**Scénario réaliste pour une v2 lançable** :
- **Tous les P0** (items 1-4) : ~25-40h → 6-10 semaines
- **3-4 features P1 clés** : Sync + Templates + Dashboard coûts + Multi-LLM (items 5, 7, 8, 9) : ~22-35h → 5-9 semaines
- **Knowledge spaces (item 6) reporté à v2.1** : trop gros pour la v2
- **Fix bug clavier (item 10)** : obligatoire, 1-2h

**Total réaliste v2** : 50-75h, soit **12-18 semaines à ton rythme**.

---

## ✅ DÉCISION STRATÉGIQUE VALIDÉE : OPTION A

**Décision prise le 14 avril 2026 après-midi** : scope réduit, launch juillet 2026.

**Features v2 incluses (OPTION A)** :
- Items 1-4 (tous les P0) : Backend relais API, Lemon Squeezy, Licences one-time, Double onboarding
- Item 9 (Dashboard coûts) : justifie le positionnement "transparence"
- Item 7 (Templates métier) : touche directement la cible indépendants
- Item 10 (Fix bug clavier) : obligatoire pour une v2 propre

**Features REPORTÉES à v2.1 et au-delà** :
- Item 5 : Sync multi-device chiffré
- Item 6 : Knowledge spaces
- Item 8 : Réponse multi-LLM simultanée
- Item 11 : Mode voix (Whisper)
- Item 12 : Support documents attachés en conversation
- Items 13-15 : Recherche, partage, thèmes automatiques

**Total v2 Option A** : 7 items, ~25-40h de dev, 6-10 semaines à rythme 30-60 min/soir.

**Raison de ce choix** :
1. Compatible avec la contrainte famille (30-60 min/soir)
2. Permet un launch plus tôt (juillet 2026) pour récupérer des feedbacks utilisateurs réels
3. Évite le risque de construire pendant 4 mois dans le noir
4. Approche lean startup : ship tôt, apprends, itère en v2.1

**Ce qui est exclu explicitement** : l'Option B (scope complet, launch automne 2026) n'est pas retenue.

---

## 📝 PROCHAINES ÉTAPES IMMÉDIATES

1. ✅ **Validation de la roadmap v2 et décision Option A** → Fait (14 avril après-midi)
2. ✅ **Intégration dans le mémo Arty v2** → Fait
3. ⏳ **Passer à l'objectif 2 de Phase 1** : répartir les 7 features Option A dans les 3 tiers de pricing (Free / Pro one-time / Subscription)
4. ⏳ **Objectif 3 de Phase 1** : confirmer Lemon Squeezy comme outil principal + architecture technique haute niveau
5. ⏳ **Objectif 4 de Phase 1** : positionnement en 3 phrases basé sur la cible "power users fatigués des subscriptions"
6. ⏳ **Objectif 5 de Phase 1** : second check avec compagne pour valider le cadre de la Phase 2

---

## 🎯 SIGNATURE ET MAINTENANCE

Ce document est la roadmap v1.0 d'Arty v2, créée le 14 avril 2026.

**À mettre à jour** :
- À la fin de Phase 1 (scope des 3 versions défini → ajustement des priorités)
- À chaque début de mois pendant Phase 2 (ce qui est fait, ce qui reste)
- Avant le launch v2 (freeze du scope final)
- Après le launch v2 (planification v2.1 basée sur les feedbacks)
