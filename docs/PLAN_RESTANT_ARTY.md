# Arty — plan du travail restant

7 septembre 2026. Objectif complet conservé : W01–W10, abonnements, crédits
et protection des 30 messages gratuits. Ce plan n'annonce aucune clôture.

## Point de départ

Plusieurs fonctions sont déjà livrées sur le web : lecture Office, projets,
exports modifiables, comparaison et parcours métier. Le travail restant est
un mélange de fonctionnalités à finir, d'intégrations à qualifier et de
tests réels à faire. Il ne consiste pas à reconstruire tout cet existant.

La réception du lot #495 est consignée dans FUNDING_UI_STANDALONE_RELEASE.md.
La distribution Firebase ne prouve pas l'installation de cet APK sur téléphone.
La synchronisation reste désactivée. Son premier import existe ; la mise à
jour d'objets existants passe ses tests ciblés, y compris le retour vers le profil
créateur corrigé. La vérification complète est en cours. Ce lot reste local et
non livré ; aucun essai entre deux appareils réels ne le valide.
Abonnements/crédits et anti-abus complet ne sont pas opérationnellement validés.

Source : cahier des charges et reçus du dépôt, pas nouvel audit de production
ou nouvelle consultation des comptes marchands à l'occasion de ce plan.

## Ordre concret de reprise

1. Fermer le petit lot de synchronisation déjà commencé, sans engager toute
   la suite : corriger le retour vers le profil créateur, valider les droits
   avant toute lecture privée, borner l'inventaire des identités et montrer
   précisément les éléments qui seront modifiés avant confirmation. Puis
   contre-revues et tests complets. Aucun déploiement de ce lot tant qu'ils échouent.
2. Priorité de mise en service : qualifier le prestataire de paiement et finir
   abonnements/crédits, puis recevoir les protections anti-abus avant ouverture
   large. Une attente externe sur le prestataire ne bloque pas les travaux locaux.
3. Tester les fonctions utiles déjà présentes sur web/PWA/téléphone et corriger
   les défauts observés. Ces recettes accompagnent chaque livraison utile.
4. Poursuivre la synchronisation complète en piste indépendante, sans retarder
   artificiellement les trois étapes précédentes.
5. Préparer les mesures produit dès maintenant ; observer ensuite les vrais
   utilisateurs, leur retour et leur préférence face à Mammouth.

Cet ordre exprime les priorités, pas une promesse de délai. Le détail ci-dessous
donne pour chaque piste une condition de fin observable.

## Organisation

Responsable technique : agent principal. Deux agents indépendants challengent
en lecture seule chaque changement non trivial ; ils ne modifient pas le code.
Les six pistes ci-dessous peuvent avancer sans dépendance artificielle entre
elles. Pas de promesse de date globale sans estimation des travaux restants et
qualification des dépendances externes. Les horizons sont des étapes, pas des délais.

### 1. Rendre abonnements et crédits réellement utilisables — priorité commerciale

État : partiellement préparé, validation opérationnelle manquante.

- Qualifier tôt le prestataire : état marchand, produits autorisés, environnement
  réel. Ne pas confondre page de connexion, mode test, clés ou lien avec acceptation.
- Rattacher côté serveur tout achat au bon compte Arty ; conserver et rapprocher
  les ventes, abonnements et crédits historiques.
- Réutiliser le candidat crédits déjà préparé après audit de son écart avec
  la production. Inventorier aussi les anciens checkouts encore payables avant
  de remplacer un webhook : un bouton d'achat fermé ne rend pas ce handler inerte.
- Terminer achat, activation, renouvellement, impayé, expiration, reprise,
  remboursement et annulation via le portail client.
- Vérifier attribution des crédits une seule fois, réservations, débits, solde
  et remboursements partiels/complets, même si les notifications sont perdues,
  répétées ou arrivent dans le désordre.
- Terminer la résolution des litiges : preuve de clôture du prestataire,
  opérateur autorisé, rapprochement des remboursements déjà récupérés et
  transition atomique vérifiable. Un rapport de consultation ne débloque pas un solde.
- Tester d'abord sans argent réel ; contrôle live seulement avec autorisation
  spécifique de dépense. Vérifier ensuite les droits Web et Android. Cela
  n'autorise pas à ouvrir les achats natifs actuellement fermés.

Terminé quand : achat et attribution des droits/du solde, renouvellement,
impayé, expiration, reprise, annulation, remboursements et résolution des
litiges passent chacun leur recette, y compris notifications perdues,
répétées ou désordonnées et achats historiques. Un seul achat réussi ne suffit pas.
Dépendances : compte marchand utilisable, configuration autorisée, éventuels
KYC/conditions propriétaire et paiement de recette explicitement autorisé.

### 2. Empêcher que les essais gratuits coûtent sans limite — P0 avant ouverture large

État : premiers garde-fous livrés ; protection multi-compte et budget complet à finir.

- Couvrir Google et email, alias, inscriptions répétées, requêtes directes,
  changement d'appareil et anciens clients, sans fusionner contenus ou droits.
- Combiner les signaux : une IP, un VPN ou un identifiant client ne suffit pas
  à reconnaître une personne. Préserver les usages famille/bureau/VPN légitimes.
- Raccorder le budget global avant chaque appel financé : texte, voix, recherche,
  outils, comparaison et nouvelles tentatives, y compris les hôtes accessibles.
- Tester concurrence, panne, annulation, résultat tardif et compensations.
  Séparer essai, crédits payés et coût financier réellement engagé par Arty.
- Prévoir explication, reprise/recours, rétention limitée et purge des signaux.

Terminé quand : les scénarios d'abus n'obtiennent pas un budget illimité, le
coût maximal est démontré et les cas légitimes passent les tests. Pas de
promesse de suppression absolue du multi-compte.
Dépendances : décision explicite sur le budget autorisé et information préalable
si une nouvelle collecte est nécessaire. L'offre reste 30 messages ; ni carte,
SMS payant ni pièce d'identité ne sont imposés implicitement.

### 3. Vérifier les fonctions qui donnent de la valeur à Arty — dès maintenant

État : fonctions web largement présentes ; plusieurs recettes réelles manquent.

- W01 : DOCX/XLSX réellement compris dans un nouvel envoi, historique et retry,
  en français/anglais et mode Europe ; erreurs claires pour formats/limites.
- W02/W03 : offre, Free/VIP/abonné/crédits/BYOK, catalogue et modèles cohérents
  sur tous les écrans ; distinguer modèle demandé, transmis et attesté.
- W04 : projet, consignes, conversations et documents réutilisables ; sources
  identifiables, recherche limitée annoncée, données séparées entre comptes.
- W05 : télécharger et ouvrir les DOCX/XLSX réels, vérifier qu'ils sont
  modifiables et fidèles, sans formule dangereuse ni contenu actif.
- W07 : comparer avec le même contexte autorisé, voir chaque erreur/coût/quota,
  conserver les résultats et poursuivre sans perdre la conversation d'origine.
- W08 : terminer les recettes synthèse documentaire, réponse client préparée
  et Agenda avec confirmation avant écriture ; connexions affichées honnêtement
  selon la plateforme. Aucun élargissement implicite de scopes Google.

Terminé quand : les parcours réussissent de bout en bout avec de vrais fichiers
et les intégrations disponibles ; les défauts observés sont corrigés et retestés.
Corriger les lacunes, ne pas refaire les fonctions déjà validées sans raison.
Dépendances : comptes/intégrations accessibles ; consentements réservés au propriétaire.

### 4. Terminer la continuité entre appareils — développement en cours

État : sauvegarde/restauration et socle de sync présents ; sync complète non activée.

- Finir le parcours en cours : mise à jour des conversations/projets aux mêmes
  identifiants, aperçu, confirmation, reprise après interruption et vrais lecteurs.
- Prendre en charge les autres créations/modifications, fichiers partagés et
  documents remplacés ; ne pas déclarer appliqué ce qui reste uniquement distant.
- Donner un choix explicite pour conflits et suppressions, sans gagnant arbitraire.
- Vérifier hors-ligne/reconnexion, modifications des deux côtés, perte réseau,
  fermeture, compte invité, changement de compte, déconnexion et effacement.
- Expliquer le secret de synchronisation et les limites de récupération ;
  conserver le chiffrement avant envoi et le fonctionnement local sans sync.
- Recette dans deux vrais profils navigateurs puis sur le téléphone avec APK
  identifié ; configuration, activation contrôlée et repli compatible après validation.

Terminé quand : le travail créé/modifié d'un côté est retrouvé correctement de
l'autre, sans perte, doublon ni mélange de comptes, y compris après les incidents
du jeu de recette. Un export manuel ou un premier import ne suffit pas.
Dépendances : préparation technique complète, accès de configuration autorisé,
stockage distant provisionné dans le périmètre approuvé, appareils accessibles.
Cette piste ne bloque pas les paiements ou les fonctions locales indépendantes.

### 5. Faire la recette web, PWA et téléphone — à chaque livraison utile

État : chaîne de distribution prouvée ; recette complète du dernier APK manquante.

- Identifier et installer/vérifier le bon APK signé, puis tester connexion,
  statut/solde, navigation, clavier, scroll, retour et arrière-plan/premier plan.
- Tester import/partage Office, téléchargements, comparateur, projets et sync
  selon leur disponibilité réelle ; mise à jour conservant les données.
- Vérifier installation PWA, cache/mise à jour, liens tryarty et compatibilité
  des anciens APK/API. Ne pas rediriger un POST historique comme une page web.
- Qualifier les validations OAuth/domaine ou store réellement nécessaires.
  Un APK Firebase n'est pas une publication Play Store.

Terminé quand : les mêmes parcours essentiels passent sur les plateformes
promises et les limites restantes sont explicitement visibles.
Dépendances : téléphone accessible, éventuels gestes/consentements propriétaire
et décisions externes Google. Aucune nouvelle soumission implicite.

### 6. Mesurer l'utilité et la préférence face à Mammouth — préparer maintenant

État : rapport de coût technique et pilote fermé présents ; mesure complète absente.

- Définir événements d'activation, succès/échecs, retour à 7/30 jours et conversion,
  sans contenu de conversation ; consentement, rétention et effacement vérifiables.
- Traiter l'information préalable requise avant toute nouvelle collecte, puis
  activer le périmètre autorisé. Ne pas attendre la fin du code pour ce cadrage.
- Relier coûts serveur, recettes/retours de paiement et période d'observation ;
  rapport avec taille d'échantillon et limites, pas une marge depuis un compteur local.
- Préparer les mêmes tâches Arty/Mammouth pour un panel réel de 20 personnes.
  Recrutement, contact externe et dépenses ne sont pas implicites.

Terminé quand : protocole exécuté et résultats observés, y compris les résultats
négatifs. Hypothèses du CDC : premier résultat utile <2 minutes, ≥95 % de réussite
sur le jeu déterministe, préférence majoritaire du panel. Ce ne sont pas des
performances déjà acquises ni une garantie de supplanter Mammouth.
Dépendances : information/participation autorisée, utilisateurs réels et temps
calendaire pour D7/D30. Distinguer fonction livrée et résultat encore non observable.

## Règle de livraison et points de contrôle

Chaque lot : deux contre-revues → corrections et tests ciblés → vérification
complète (`npm run verify`, front/back, no-CASA, build, worker Office) → PR/CI →
version Pages/Android identifiée → contrôle réel de portée explicite → repli.
Ne pas garder toute la recette ou tout le déploiement pour une fin unique.

Premier jalon : fonctions locales utilisables, achats/droits/crédits réellement
qualifiés et anti-abus reçu avant ouverture large. Ce jalon ne clôt PAS l'objectif.
Clôture complète : tous les critères W01–W10 et extensions, livraisons et recettes
obligatoires vérifiés ; validations externes manquantes restent ouvertes.

À chaque bilan, indiquer quatre choses : livré, local non livré, prochaine
preuve à obtenir et intervention externe nécessaire. Aucune date artificielle
ni pourcentage d'avancement déduit du nombre de fichiers/tests.

Les extensions vidéo, SSO et API publique restent hors mandat sans besoin démontré.

## Contre-revues du plan

Revue produit : suppression de la dépendance artificielle « tout attendre
derrière la sync », anti-abus avant ouverture large, cadrage de la mesure tôt,
recettes mobiles et livraison à chaque lot. Retours intégrés.
Revue facturation : ne pas refaire #495, réutiliser le candidat crédits,
inclure checkouts historiques, notifications perdues et résolution réelle des
litiges. Retours intégrés. Aucun compte tiers consulté ou modifié pour ce plan.
