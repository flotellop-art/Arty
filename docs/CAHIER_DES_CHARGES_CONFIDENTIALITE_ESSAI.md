# Cahier des charges — confidentialité et parcours d'essai

**Statut :** spécification à implémenter

**Date :** 15 juillet 2026

**Périmètre :** Arty Web/PWA et Android public

**Déclencheur :** prérequis n°2 avant toute acquisition payante

**PR :** documentaire uniquement ; aucun comportement de production n'est modifié

## 1. Résumé de la décision

Avant d'envoyer du trafic publicitaire vers Arty, le produit doit présenter un contrat unique et vérifiable sur deux sujets :

1. les données réellement traitées, stockées et transmises ;
2. ce que donnent exactement les 30 messages d'essai, avant et après leur épuisement.

La cible recommandée est la suivante :

- l'application publique accède à l'identité Google et à Calendar, mais pas à la boîte Gmail, à Drive ou à Contacts ;
- la politique française et sa traduction anglaise décrivent les mêmes traitements et les mêmes durées ;
- l'essai donne 30 générations financées par Arty sur quatre variantes standard : Claude Haiku, GPT-5 mini, Gemini Flash et Mistral Medium ;
- les modèles premium sont visibles mais verrouillés pendant l'essai ; ils ne sont jamais substitués silencieusement ;
- le compteur affiché, le plan retourné par l'API et l'enforcement des quatre proxys restent cohérents ;
- à zéro message, Arty affiche une fin d'essai explicite et les options réellement disponibles selon la plateforme ; aucun accès gratuit post-essai n'est promis ;
- l'attribution publicitaire Google Ads et le stockage du `gclid` restent dans un chantier séparé. Toute activation future exigera une mise à jour préalable du registre de données et des textes de consentement.

Cette spécification devient le gate `PRIVACY-TRIAL-READY`. La landing d'acquisition et les campagnes payantes ne doivent pas être activées tant que tous les critères P0 ne sont pas satisfaits.

## 2. Contexte et constats vérifiés

### 2.1 Confidentialité

La branche principale contient déjà une politique corrigée après le retrait de Gmail public :

- [`public/privacy/index.html`](../public/privacy/index.html) ;
- [`public/privacy/en/index.html`](../public/privacy/en/index.html) ;
- retrait public de Gmail documenté par la [PR #343](https://github.com/flotellop-art/Arty/pull/343).

Cette correction reste fragile : des travaux marketing ou de paiement peuvent réintroduire une ancienne copie mentionnant Gmail, Drive, Contacts ou un chiffrement plus fort que le mécanisme réel. Il n'existe pas de test de cohérence global entre le runtime, les textes FR/EN, l'onboarding, la landing et les prestataires de paiement.

Autre divergence visible : l'introduction de l'essai affirme actuellement que « tout reste chiffré sur ton appareil », alors que certaines données explicitement choisies par l'utilisateur peuvent être persistées côté serveur, notamment la mémoire structurée, les conversations partagées et les signalements. La formulation doit distinguer le stockage local par défaut des exceptions serveur.

### 2.2 Essai

Le backend et l'interface exposent plusieurs sources de vérité :

- [`functions/api/_lib/checkAllowedUser.ts`](../functions/api/_lib/checkAllowedUser.ts) définit 30 messages et quatre variantes standard ;
- [`functions/api/trial/init.ts`](../functions/api/trial/init.ts) crée ou récupère le plan `trial` ;
- [`functions/api/subscription/status.ts`](../functions/api/subscription/status.ts) ne reconnaît pas `trial` dans son contrat public et le normalise en `free` ;
- [`src/services/trialClient.ts`](../src/services/trialClient.ts) conserve un compteur local alimenté par le header `x-trial-remaining` ;
- [`src/components/onboarding/OnboardingChoice.tsx`](../src/components/onboarding/OnboardingChoice.tsx) annonce les quatre variantes standard ;
- les proxys peuvent remplacer silencieusement un modèle premium demandé par sa variante standard.

Conséquences possibles : catalogue différent entre l'écran et le serveur, badge de plan incorrect, verrouillage excessif dans le frontend, message consommé sur une erreur évitable, ou réponse produite par un autre modèle que celui cru par l'utilisateur.

### 2.3 Économie et acquisition

Les 30 messages constituent une dépense d'acquisition. Leur fonction n'est pas seulement d'autoriser des appels API : ils doivent permettre d'atteindre une première valeur, d'expliquer honnêtement les limites et de produire un signal d'activation fiable.

Une inscription ou un `trial_started` ne suffit pas. La mesure doit distinguer : création de l'essai, première réponse réussie, activation, épuisement, affichage des offres, début de paiement et abonnement confirmé.

## 3. Problème à résoudre

Un nouvel utilisateur ne peut pas déterminer avec certitude quelles données quittent son appareil, quel modèle répond pendant l'essai, pourquoi un modèle est verrouillé et ce qui se passe après le trentième message. Ces incohérences diminuent la confiance, faussent la mesure marketing et peuvent exposer Arty à des promesses publiques différentes du comportement réel.

Sans correction, toute campagne payante amplifierait un parcours non déterministe : Arty paierait pour acquérir des utilisateurs dont l'expérience ne correspondrait pas nécessairement à l'annonce ni à la politique de confidentialité examinée par la régie.

## 4. Objectifs

### 4.1 Objectifs utilisateur

1. Permettre à tout nouvel utilisateur de connaître avant son premier message les modèles inclus, les limites de l'essai et le devenir de ses données.
2. Garantir que le nom du modèle affiché correspond au modèle effectivement appelé.
3. Afficher un compteur de messages identique après reconnexion, changement d'onglet et changement d'appareil.
4. Présenter une fin d'essai compréhensible et sans impasse trompeuse sur Web et Android.

### 4.2 Objectifs produit et conformité

1. Obtenir 100 % de parité entre le contrat frontend, le statut API et l'enforcement serveur.
2. Obtenir 100 % de parité sémantique entre les politiques FR et EN sur les catégories de données, prestataires, finalités et durées.
3. Empêcher par CI le retour d'une promesse Gmail/Drive/Contacts dans le client public sans décision et revue dédiées.
4. Mesurer l'activation réelle de l'essai sans contenu de conversation ni identifiant publicitaire.
5. Atteindre, sur les 50 premiers essais éligibles, au moins 30 % d'utilisateurs activés sous sept jours. Cette cible est une hypothèse à recalibrer après obtention de la première base réelle.

## 5. Non-objectifs

- **Implémenter Google Ads ou le `gclid` :** ce travail appartient au prérequis d'attribution et de conversion, traité séparément.
- **Réintroduire Gmail, Drive ou Contacts :** ces connecteurs exigent une décision produit, OAuth et conformité distincte.
- **Refondre toute la tarification :** les prix, l'offre annuelle et le contenu des packs ne sont pas décidés ici.
- **Créer une CMP générique :** le P0 couvre le consentement strictement nécessaire aux traitements réellement activés ; le futur tracking publicitaire aura son propre gate.
- **Garantir l'absence de conservation chez les fournisseurs d'IA :** Arty doit décrire leurs règles applicables sans promettre ce qu'il ne contrôle pas.
- **Migrer tout le stockage local :** seuls les écarts de description, de sécurité ou de suppression qui rendent la promesse actuelle fausse sont dans le périmètre.

## 6. Définitions et décisions de référence

### 6.1 États de plan

| État | Définition | Accès financé par Arty |
|---|---|---|
| `trial` | Nouvel utilisateur avec 1 à 30 messages restants | Quatre variantes standard uniquement |
| `trial_exhausted` | Ancien `trial` avec compteur à zéro | Aucun appel serveur gratuit ; wallet ou offre payante selon éligibilité |
| `free` | Compte legacy explicitement classé `free` | Haiku selon le quota quotidien existant |
| `subscription` | Abonnement récurrent valide | Catalogue du plan et quotas publiés |
| `pro` | Licence à vie BYOK | Application débloquée ; clé personnelle requise |
| `vip` | Bypass interne autorisé | Catalogue complet selon les règles VIP |

`trial_exhausted` peut rester un état dérivé de `plan = trial` et `remaining = 0` ; il n'est pas nécessaire d'ajouter une valeur en base si cela complexifie la migration. En revanche, ce concept doit être explicite dans le contrat client.

### 6.2 Catalogue de l'essai

Décision recommandée :

| Fournisseur | Variante incluse | Premium verrouillé, exemples |
|---|---|---|
| Anthropic | Claude Haiku | Sonnet, Opus |
| OpenAI | GPT-5 mini | GPT-5 complet et variantes premium |
| Google | Gemini Flash | Gemini Pro |
| Mistral | Mistral Medium | Mistral Large et variantes premium |

Une décision Haiku-only reste possible pour des raisons de coût, mais elle doit alors modifier en une même PR le backend, l'onboarding, la landing, les traductions et les tests. L'état hybride est interdit.

### 6.3 Décompte

Un « message d'essai consommé » est une demande authentifiée, valide, autorisée et effectivement acceptée pour génération par un fournisseur avec une clé financée par Arty.

Ne consomment pas de message :

- échec d'authentification ;
- JSON ou pièce jointe rejeté avant appel fournisseur ;
- modèle non autorisé ;
- endpoint auxiliaire en lecture seule ;
- appel BYOK ;
- affichage des quotas, de la facturation ou des paramètres.

Un timeout ou un `5xx` fournisseur avant tout début de réponse doit, au minimum, être identifiable. La restitution automatique du message est P1 si elle ne peut pas être rendue atomique dans le P0.

### 6.4 Activation

Un essai est « activé » lorsqu'un utilisateur obtient au moins cinq réponses réussies dans les sept jours suivant sa création. Ce seuil doit être stocké sous forme d'événement pseudonymisé ; le contenu, le prompt et la réponse ne doivent jamais être inclus.

## 7. Utilisateurs et histoires

### 7.1 Nouveau prospect Web

- En tant que prospect venant d'une publicité, je veux savoir ce que couvrent les 30 messages afin de décider si l'essai correspond à la promesse de l'annonce.
- En tant que nouvel utilisateur, je veux voir le vrai modèle utilisé afin de pouvoir comparer les réponses sans tromperie.
- En tant qu'utilisateur arrivé à zéro, je veux comprendre mes options afin de continuer sans perdre mon travail.

### 7.2 Utilisateur Android

- En tant qu'utilisateur Android, je veux connaître la limite de mon essai sans recevoir un lien d'achat interdit ou indisponible dans mon contexte.
- En tant qu'utilisateur connecté sur Web et Android, je veux retrouver le même compteur afin d'éviter un solde contradictoire.

### 7.3 Utilisateur attentif à ses données

- En tant qu'utilisateur, je veux distinguer ce qui reste local, ce qui transite par Arty et ce qui est persisté côté serveur.
- En tant qu'utilisateur, je veux que la politique FR et EN décrive le même service.
- En tant qu'utilisateur, je veux retirer un consentement optionnel aussi facilement que je l'ai donné.

### 7.4 Exploitant Arty

- En tant qu'exploitant, je veux un gate automatisé avant déploiement afin qu'une ancienne copie juridique ou marketing ne réintroduise pas une fonction retirée.
- En tant qu'exploitant, je veux connaître le passage première valeur → activation → paiement afin de ne pas optimiser une campagne sur de simples inscriptions.

## 8. Exigences P0 — confidentialité

### PRIV-P0-01 — Inventaire canonique des données

Créer un inventaire versionné qui indique pour chaque catégorie : source, finalité, base légale à valider, stockage local, stockage serveur, destinataires, durée, suppression et texte public correspondant.

Critères d'acceptation :

- [ ] L'inventaire couvre identité, contenu courant, mémoire structurée, conversations partagées, signalements, pièces jointes, OAuth, BYOK, quotas, anti-abus, paiements, wallet, localisation, Calendar, waitlist et future mesure de campagne.
- [ ] Chaque stockage D1/KV/R2/localStorage/sessionStorage/IndexedDB utilisé en production est rattaché à une ligne de l'inventaire.
- [ ] Toute catégorie inconnue bloque la validation de confidentialité.

### PRIV-P0-02 — Périmètre Google public

Le client public ne doit promettre que l'identité Google et Calendar. Gmail, Drive et Contacts peuvent subsister sous forme de code tombstoné ou de chantier séparé, mais ils ne doivent être ni exposés ni demandés par le client OAuth public.

Critères d'acceptation :

- [ ] Aucun scope public Gmail, Drive ou Contacts n'est demandé sur Web/PWA/Android.
- [ ] Aucun texte d'onboarding, landing, pricing, aide ou politique ne présente un accès direct à ces services.
- [ ] Un email peut être traité uniquement lorsqu'il est collé, joint ou partagé manuellement par l'utilisateur.
- [ ] Calendar est décrit comme une action à la demande, jamais comme une surveillance en arrière-plan.

### PRIV-P0-03 — Description exacte du stockage et du chiffrement

Les textes doivent distinguer : stockage local par défaut, transit nécessaire, persistances serveur volontaires et limites du chiffrement sans BYOK.

Critères d'acceptation :

- [ ] Aucune formulation ne dit que « tout » reste sur l'appareil.
- [ ] Le mode sans BYOK n'est pas décrit comme protégé par une clé secrète ou liée au matériel.
- [ ] Le stockage des clés BYOK est décrit conformément au runtime audité.
- [ ] Mémoire structurée, partage public et signalement sont identifiés comme exceptions possibles au stockage local.
- [ ] Les suppressions locales et serveur sont décrites séparément.

### PRIV-P0-04 — Paiements et prestataires

La politique doit refléter les prestataires réellement activés : Lemon Squeezy pour les offres concernées et Creem pour le wallet/crédits si ce parcours est en production.

Critères d'acceptation :

- [ ] Aucun prestataire désactivé n'est présenté comme destinataire actif.
- [ ] Email, identifiant de produit, identifiant de transaction et statut sont documentés sans prétendre qu'Arty reçoit les coordonnées bancaires.
- [ ] Les durées comptables et opérationnelles sont distinguées.
- [ ] Toute bascule de prestataire impose une mise à jour FR/EN avant activation.

### PRIV-P0-05 — Mesure de campagne

Le P0 autorise seulement une mesure first-party, pseudonymisée et explicitement décrite. Il n'autorise ni `gclid`, ni identifiant Meta, ni profilage, ni export vers une régie.

Critères d'acceptation :

- [ ] Sans consentement requis, aucun stockage optionnel de campagne n'est écrit.
- [ ] Refuser n'empêche ni l'essai ni le paiement.
- [ ] Retirer le consentement supprime les paramètres locaux optionnels.
- [ ] Les durées locales et serveur sont affichées séparément et correspondent au mécanisme de purge.
- [ ] Les événements ne contiennent ni email, IP applicative, user-agent, prompt, réponse ou nom de fichier.
- [ ] L'ajout futur du `gclid`, de Consent Mode ou d'un import Google Ads déclenche une revue dédiée avant déploiement.

### PRIV-P0-06 — Parité FR/EN

Les politiques française et anglaise doivent être générées ou vérifiées depuis le même inventaire.

Critères d'acceptation :

- [ ] Même date et même numéro de version.
- [ ] Mêmes catégories, prestataires, finalités, durées et exceptions.
- [ ] Les liens canoniques et `hreflang` sont réciproques.
- [ ] Une CI échoue si une ligne structurante existe dans une langue seulement.

### PRIV-P0-07 — Gate de déploiement

Un script ou test automatisé doit vérifier les affirmations publiques sensibles.

Le gate échoue notamment si :

- Gmail/Drive/Contacts sont annoncés dans le client public sans feature gate approuvé ;
- une politique manque ou diverge sur les prestataires ;
- « tout reste sur ton appareil », « clé liée à l'appareil » ou un équivalent non qualifié réapparaît ;
- une durée de conservation ne correspond pas à la purge implémentée ;
- une nouvelle télémétrie n'est pas inscrite dans l'inventaire.

## 9. Exigences P0 — essai

### TRIAL-P0-01 — Contrat API unique

`/api/subscription/status` doit reconnaître `trial` et retourner l'état nécessaire à l'interface.

Réponse minimale attendue :

```json
{
  "plan": "trial",
  "status": "active",
  "trial_messages_remaining": 24,
  "allowed_families": [
    "claude-haiku",
    "gpt-mini",
    "gemini-flash",
    "mistral-medium"
  ],
  "locked_families": [
    "claude-sonnet",
    "claude-opus",
    "gpt-full",
    "gemini-pro"
  ]
}
```

Critères d'acceptation :

- [ ] Le serveur D1 est la source de vérité du plan et du compteur.
- [ ] Le stockage local n'est qu'un cache d'affichage et ne peut ouvrir un modèle refusé par le serveur.
- [ ] Une reconnexion ou un nouvel appareil récupère le même solde.
- [ ] Une réponse sans D1 ne transforme jamais un `trial` en abonnement ou VIP.

### TRIAL-P0-02 — Catalogue partagé

Une seule définition testable doit alimenter le statut API, les proxys, le routeur frontend, le sélecteur et les textes d'onboarding.

Critères d'acceptation :

- [ ] Les quatre variantes standard annoncées sont réellement sélectionnables et appelables.
- [ ] Les variantes premium sont visibles comme verrouillées si elles sont affichées.
- [ ] Toute modification de catalogue casse un test tant que les surfaces ne sont pas alignées.

### TRIAL-P0-03 — Aucune substitution silencieuse

Une demande premium pendant l'essai doit être empêchée dans l'interface et refusée côté serveur si elle contourne le client.

Critères d'acceptation :

- [ ] Le serveur retourne une erreur typée `trial_model_restricted` sans consommer de message.
- [ ] Le message explique quelle variante standard est disponible.
- [ ] Si une substitution reste nécessaire pour compatibilité, le modèle effectif est renvoyé dans un champ/header signé par le serveur et affiché avant la réponse ; cette exception doit être approuvée explicitement.
- [ ] Le journal technique ne contient pas le prompt.

### TRIAL-P0-04 — Compteur équitable et atomique

Critères d'acceptation :

- [ ] Deux demandes concurrentes ne peuvent pas dépasser le plafond de 30.
- [ ] Le solde reste borné entre 0 et 30.
- [ ] Les erreurs d'authentification, validation et modèle verrouillé ne consomment rien.
- [ ] Toute réponse réussie financée par Arty consomme exactement une unité.
- [ ] Le header `x-trial-remaining` est présent sur les réponses réussies et sur `trial_expired`.
- [ ] Les quatre proxys appliquent le même contrat.

### TRIAL-P0-05 — Fin d'essai

À zéro message, aucune requête ne doit tomber silencieusement sur le tier `free` Haiku réservé aux comptes réellement `free`.

Critères d'acceptation :

- [ ] Le client affiche « Essai terminé » et ne laisse pas croire à une panne du modèle.
- [ ] Web/PWA présente les offres ou le wallet réellement activés.
- [ ] Android applique le parcours approuvé pour la distribution native et ne montre pas de CTA d'achat indisponible ou non conforme.
- [ ] Une souscription ou un wallet valide débloque le bon accès après rafraîchissement, sans nouvelle connexion obligatoire.
- [ ] Les conversations et pièces jointes locales restent accessibles à la fin de l'essai.

### TRIAL-P0-06 — Google et essai email

Les deux entrées doivent partager la même promesse tout en conservant leurs contraintes d'identité.

Critères d'acceptation :

- [ ] Google OAuth et OTP email affichent le même catalogue et le même plafond.
- [ ] Un essai email épuisé ne peut pas accéder au wallet d'un compte Google non lié.
- [ ] La fusion éventuelle de deux identités ne double pas le budget sans décision explicite.
- [ ] Les protections anti-alias et anti-concurrence restent atomiques.

### TRIAL-P0-07 — BYOK

Une requête utilisant une clé personnelle ne consomme pas de message financé par Arty.

Critères d'acceptation :

- [ ] Le compteur ne bouge pas sur un appel BYOK réussi ou échoué.
- [ ] Le modèle effectif reste affiché.
- [ ] La clé n'est ni persistée ni journalisée côté serveur.
- [ ] Le produit explique que la licence Pro à vie donne accès à l'application, pas aux clés serveur Arty.

### TRIAL-P0-08 — Instrumentation produit

Événements minimaux :

| Événement | Déclenchement | Propriétés autorisées |
|---|---|---|
| `trial_created` | Création serveur réussie | canal `google`/`email`, plateforme, version |
| `trial_first_success` | Première réponse réussie | fournisseur, famille standard, latence arrondie |
| `trial_activated` | Cinquième réponse réussie sous 7 jours | jour depuis création, plateforme |
| `trial_exhausted` | Passage atomique à zéro | plateforme, durée depuis création |
| `upgrade_viewed` | Offre affichée volontairement | origine UI, plateforme |
| `checkout_started` | Début de paiement valide | offre, plateforme |
| `subscription_started` | Webhook confirmé | offre, devise, valeur autorisée |

Critères d'acceptation :

- [ ] Chaque événement est idempotent lorsque nécessaire.
- [ ] Aucun contenu utilisateur ou identifiant publicitaire n'est envoyé.
- [ ] Les événements sont documentés dans l'inventaire de données.
- [ ] `subscription_started` vient d'un webhook vérifié, jamais du retour navigateur seul.

## 10. Exigences P1

- Restaurer automatiquement un message lorsqu'un fournisseur échoue avant le premier token, avec idempotence et journal d'audit minimal.
- Ajouter un écran « Comment tes données circulent » lisible depuis l'onboarding et les paramètres.
- Afficher l'historique local des consommations d'essai sans contenu de conversation.
- Ajouter un test visuel FR/EN du bandeau à 30, 5, 1 et 0 message.
- Conserver l'intention d'arrivée de la landing jusqu'au premier exemple proposé, sans identifiant publicitaire.
- Mesurer l'activation qualitative par type de tâche, uniquement via une catégorie choisie par l'utilisateur ou une action UI ; ne pas classifier le prompt en télémétrie.

## 11. Considérations futures P2

- Consent Mode et import de conversions Google Ads après spécification dédiée.
- Expérience de restauration d'achat native quand les achats intégrés seront activés.
- Essais différenciés par canal ou offre, seulement après une base de rétention suffisante.
- Mode de confidentialité renforcé désactivant mémoire serveur, partage et télémétrie optionnelle.
- Génération des politiques FR/EN depuis un registre structuré unique.

## 12. Scénarios d'acceptation de bout en bout

### Scénario A — nouvel utilisateur Google

**Étant donné** un email jamais vu par Arty

**Quand** l'utilisateur termine Google OAuth

**Alors** le serveur crée un seul plan `trial` à 30, l'interface annonce les quatre variantes standard et le statut API retourne `trial`.

### Scénario B — modèle premium

**Étant donné** un essai avec 12 messages restants

**Quand** un client modifié demande Claude Sonnet

**Alors** le serveur retourne `trial_model_restricted`, propose Haiku comme option et conserve 12 messages.

### Scénario C — concurrence au dernier message

**Étant donné** un essai avec un message restant

**Quand** deux requêtes valides partent simultanément

**Alors** une seule est autorisée et le solde final vaut zéro.

### Scénario D — reconnexion multi-appareil

**Étant donné** un essai à 17 côté D1 et un cache local obsolète à 24

**Quand** l'utilisateur ouvre Arty sur un second appareil

**Alors** l'interface affiche 17 et remplace le cache local.

### Scénario E — essai épuisé

**Étant donné** un `trial` à zéro sans wallet

**Quand** l'utilisateur envoie un nouveau message

**Alors** aucun appel fournisseur n'est effectué, aucune unité n'est consommée et l'interface affiche le parcours de fin d'essai adapté à la plateforme.

### Scénario F — appel BYOK

**Étant donné** un essai à 9 et une clé personnelle valide

**Quand** l'utilisateur obtient une réponse BYOK

**Alors** le modèle effectif est visible et le compteur reste à 9.

### Scénario G — politique de confidentialité

**Étant donné** un build candidat

**Quand** le gate de confidentialité s'exécute

**Alors** les versions FR/EN, l'inventaire, les prestataires et le runtime public sont cohérents ; toute réintroduction de Gmail/Drive/Contacts ou d'une promesse de chiffrement absolue fait échouer le build.

## 13. Tests requis

### 13.1 Unitaires

- résolution `trial` dans le statut d'abonnement ;
- parité catalogue déclaré/enforcement pour les quatre fournisseurs ;
- refus premium sans décrément ;
- bornes et concurrence du compteur ;
- BYOK sans décrément ;
- idempotence des événements ;
- comparaison structurée FR/EN et inventaire.

### 13.2 Intégration D1

- création, reconnexion, épuisement et conversion `trial` → `subscription` ;
- essai Google et essai email ;
- wallet après essai Google ;
- webhook vérifié et rafraîchissement du statut ;
- absence de fuite de prompt, réponse, token ou clé dans les événements et logs testés.

### 13.3 E2E

Matrice minimale :

| Surface | Auth | Solde | Cas |
|---|---|---:|---|
| Web Chrome | Google | 30 | onboarding + premier succès |
| Web Firefox | Email | 30 | onboarding + premier succès |
| Web Chrome | Google | 1 | concurrence + fin d'essai |
| Web Chrome | Google | 0 | wallet/upgrade |
| Android | Google | 30 | compteur + catalogue |
| Android | Google | 0 | fin d'essai sans CTA invalide |
| Web | Google + BYOK | 9 | réponse sans décrément |

Les tests de paiement utilisent d'abord le mode test, puis une transaction réelle contrôlée et remboursée avant ouverture des campagnes.

## 14. Indicateurs de réussite

### 14.1 Gates avant acquisition

- 100 % des scénarios P0 passent sur le commit déployé.
- 0 occurrence publique non justifiée de Gmail, Drive ou Contacts.
- 0 divergence FR/EN sur l'inventaire structurant.
- 0 substitution silencieuse observée.
- 0 événement contenant du contenu ou un secret dans la suite de tests.
- Une transaction réelle et son webhook sont confirmés de bout en bout.

### 14.2 Indicateurs après ouverture

| Indicateur | Cible initiale | Fenêtre |
|---|---:|---|
| Initialisation d'essai réussie après auth valide | ≥ 99 % | 7 jours glissants |
| Écart compteur client/serveur | < 0,5 % des sessions | 7 jours glissants |
| Première réponse réussie | ≥ 70 % des essais créés | 24 heures |
| Activation à 5 réponses | ≥ 30 % des essais créés | 7 jours |
| Essai → affichage volontaire des offres | ≥ 15 % | 14 jours |
| Essai → paiement confirmé | hypothèse ≥ 8 % | 30 jours |

Le taux de paiement à 8 % n'établit pas à lui seul la viabilité des publicités. Le CAC et la rétention restent des gates économiques séparés.

## 15. Découpage d'implémentation recommandé

1. **PR A — inventaire et textes :** registre canonique, corrections FR/EN, onboarding, tests de régression documentaire.
2. **PR B — contrat trial :** type `trial` dans le statut, solde serveur, cache client, migrations éventuelles.
3. **PR C — enforcement :** catalogue partagé, refus premium, suppression des substitutions silencieuses, parité des quatre proxys.
4. **PR D — expérience :** sélecteur, compteur, fin d'essai Web/Android, BYOK et wallet.
5. **PR E — mesure et QA :** événements d'activation, tests D1/E2E, transaction réelle contrôlée et runbook.

Chaque PR doit pouvoir être relue et annulée indépendamment. Aucune ne doit mélanger la future intégration Google Ads.

## 16. Dépendances et ordre

1. Valider la décision quatre variantes standard contre Haiku-only.
2. Valider l'inventaire de données et les durées avec la personne responsable du traitement.
3. Implémenter le contrat serveur avant de modifier le sélecteur frontend.
4. Corriger les textes et l'onboarding dans le même train de release que le comportement.
5. Exécuter la matrice E2E et la transaction réelle.
6. Déployer Web puis Android.
7. Autoriser seulement ensuite la landing et le budget d'acquisition.

## 17. Risques et mesures

| Risque | Impact | Mesure |
|---|---|---|
| Quatre fournisseurs rendent l'essai trop coûteux | Marge | Modèles standard uniquement, plafond atomique, suivi coût agrégé |
| Compteur consommé avant échec fournisseur | Confiance | Identifiant de requête, état réservé/réglé, restitution P1 |
| Cache local débloque un modèle | Abus | Serveur source de vérité et fail-closed |
| Ancienne copie juridique réapparaît | Conformité | Inventaire + CI + revue FR/EN |
| Android finit sur une impasse | Conversion/support | Parcours natif dédié et testé |
| Instrumentation devient du profilage | Conformité | Liste blanche de propriétés et aucun contenu |
| Le chantier Ads contamine ce P0 | Retard/scope | Gate et PR séparés |

## 18. Questions ouvertes

### Bloquantes avant implémentation

1. **Produit/Finance — catalogue :** confirme-t-on les quatre variantes standard recommandées ou un essai Haiku-only ?
2. **Produit — fin d'essai :** le wallet doit-il être présenté avant l'abonnement, après l'abonnement, ou seulement dans les paramètres ?
3. **Distribution/Legal — Android :** quel message et quelle action sont autorisés à zéro tant que les achats natifs ne sont pas actifs ?
4. **Privacy — durées :** quelle durée exacte appliquer aux compteurs d'essai, événements d'activation et logs anti-abus, avec purge effective correspondante ?

### Non bloquantes pour PR A-B

5. **Engineering — échecs fournisseur :** restitution atomique en P0 ou instrumentation en P0 puis restitution en P1 ?
6. **Data — activation :** cinq réponses est-il le meilleur proxy de valeur ou faut-il ajouter une action document/comparateur ?
7. **Produit — identités :** faut-il proposer une fusion explicite entre essai email et compte Google ?

## 19. Définition de fini `PRIVACY-TRIAL-READY`

Le point n°2 est terminé uniquement lorsque :

- [ ] toutes les exigences P0 ont un test ou une preuve de revue ;
- [ ] les décisions bloquantes sont consignées dans la PR d'implémentation ;
- [ ] la politique FR/EN déployée correspond au commit applicatif déployé ;
- [ ] un compte neuf a parcouru 30 → 0 sans contradiction de modèle ou de compteur ;
- [ ] Web et Android présentent une fin d'essai valide ;
- [ ] l'abonnement ou le wallet est reconnu après webhook sans reconnexion ;
- [ ] aucun secret ou contenu utilisateur n'apparaît dans les événements/logs contrôlés ;
- [ ] le responsable du lancement signe le gate ;
- [ ] la landing d'acquisition ne contient aucune affirmation plus large que ce contrat.

Tant que cette checklist n'est pas complète, la campagne reste en état **préparation**, avec un budget média de **0 €**.
