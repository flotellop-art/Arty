# ADR : comparaison contextuelle en branches documentaires

**Statut :** accepté pour implémentation, livraison non validée
**Date :** 6 septembre 2026
**Décideur :** root, mandat autonome W07 ; deux contre-revues readonly

## Contexte et contraintes

W07 exige un préfixe et des documents autorisés communs à plusieurs modèles,
des résultats conservés et une continuation sans écraser l'original. W03 est
un comparateur autonome texte, en RAM ; il ne devient pas implicitement W07.
EU, historique privé, auth, quotas, effacement et chiffrement local restent
contraignants. W06 restauration/synchronisation et activation isolée restent
ouverts : ce lot n'ajoute ni store ni protocole de synchronisation.

## Décision

Entrée depuis une **question utilisateur existante**, première question incluse.
Capture du compte/document/epoch/crypto/fence avant tout await, clone profond du
préfixe jusqu'à cette question ; l'original et ses réponses suivantes restent
inchangés. Les flags restrictifs de la conversation entière sont conservés.

Un noyau de préparation commun au chat projet réalise une seule extraction
Office, hydratation stricte des pièces, sélection locale et confirmation de la
bibliothèque actuelle. Deux modèles distincts du fournisseur autorisé reçoivent
des clones du même payload et les mêmes règles documentaires. Hors EU, le
premier mode contextuel utilise Claude ; EU utilise Mistral. Le comparateur
autonome conserve ses quatre fournisseurs. Il ne faut pas prétendre reproduire
les anciens extraits exacts de la réponse originale : le projet peut avoir
changé. L'aperçu annonce explicitement la révision actuelle et les deux appels
potentiellement facturés ; le serveur reste autorité, sans atomicité de facture.

Réserver les deux slots dans **l'instance useStreaming déjà détenue par le chat**
(cap commun trois), puis les deux branches en un seul commit de la liste locale.
Un quota avant ce commit empêche tout HTTP. Les clients revalident la portée,
la révision et l'accès après leurs awaits d'auth. Chaque résultat et chaque
échec sont indépendants, aucune promesse que les deux fournisseurs réussissent.
Des copies de messages sont des données ; elles ne réactivent pas les outils.

Le registre expose un lifecycle externe étroit (flush/cancel et lease liée au
StreamState), pas un deuxième ordonnanceur. Le moteur comparatif est seul
propriétaire du `responseId` fixe et du reçu de sauvegarde. Stop est terminal
avant abort ; release/flush ne peuvent retirer une invocation de remplacement.
Le plan n'est chargé qu'à l'ouverture du comparateur, puis relu depuis le
serveur après chaque panneau engagé : aucun décrément local supposé.

La branche est `hasProjectContext=true`, avec provenance de tour documentaire,
même sans bibliothèque. Ce flag existant est monotone, préservé par les branches,
imports et sauvegardes, et désactive actions HTML, rappels, fact-check et mémoire
automatiques. **Continuer reste un parcours documentaire en lecture seule.**
Il ouvre une branche locale, ne relance pas l'IA et ne route jamais depuis son
attribution historique. Les modèles demandés/servis restent distingués.

## Options considérées

| Option | Complexité | Coût/risque | Réutilisation |
|---|---|---|---|
| Ajouter l'historique au comparateur RAM | faible au départ | pertes au reload, permissions documentaires absentes | UI W03 seule |
| Deux envois projet indépendants | moyenne | extraits/consentements différents, effets de bord | chat existant, mauvaise unité de snapshot |
| Préparation commune, deux branches locales | moyenne | deux requêtes assumées, refus avant commit | builders W01/W04, historique et registre de streams |
| Nouveau magasin/dispatcher de comparaison | élevée | nouveaux cycles effacement/sync et plafond concurrent séparé | peu ; écarté |

## Conséquences et limites

- Aucun fallback transformant une pièce manquante en simple nom. Les données
  Office dérivées restent éphémères. Les références structurelles des fichiers
  survivent à la suppression d'une autre branche via le GC existant.
- Le catalogue texte ne prouve pas deux modèles Mistral vision compatibles :
  les comparaisons EU avec images sont refusées pour l'instant, de même que
  les PDF EU déjà non supportés par le préparateur strict. Ne pas retirer les
  pixels silencieusement ni relâcher EU pour débloquer.
- Les sources legacy JSON contenant des octets inline sont refusées avant
  préparation, pour ne pas multiplier du base64 dans localStorage. Les images
  de galerie générées sont également refusées : leurs références d'affichage
  ne deviennent pas automatiquement des entrées documentaires fournisseur.
  Ces limites doivent être visibles dans l'interface, pas un succès dégradé.
- Les IDs groupe/source/peer et états de lancement restent privés et locaux.
  JSON import/export les retire ; partage public et backup restent en projection
  fermée. Les exports sont **une branche seule**, pas une fiche comparative
  avec coûts/états de l'autre panneau. Ne pas étendre le format backup v2 strict
  sans migration séparée ; l'UI d'export doit annoncer cette limite.
- Le coût estime le payload complet ; binaires et modèle effectif inconnu
  restent non chiffrés, jamais « zéro euro ». Un commit de résultat raté doit
  s'afficher comme non conservé, même après un succès fournisseur.
- Stop, suppression, scope changé et callbacks tardifs ne recréent ni branche
  ni requête. Un reload expose les réservations interrompues sans auto-retry.

## Actions et preuve attendue

1. [x] Préparation commune et réservation atomique avec tests ciblés.
2. [x] UI de sélection/confirmation sur question et route de reprise locale.
3. [x] Intégration des deux invocations au registre de streams existant.
4. [x] Persistance des réponses/erreurs/attributions/coûts et statut de commit.
5. [x] Parcours validés par intégration et navigateur : projet + Office, deux appels, erreur quota partielle,
   reload, continuation, original intact, suppression d'une branche sans perte
   de pièces. Variantes EU, fichier absent, scope/crypto/effacement, quota local,
   cap partagé et inertie export/import/branch/détachement.
6. [x] Deux GO finaux, verify complète, PR/CI/preview, main/Pages/distribution APK vérifiés (#462).

Preuves et périmètres exacts dans `CONTEXTUAL_COMPARISON_RELEASE.md`. Les tests
locaux utilisent des comptes/données fictifs et des réponses HTTP simulées ;
ils n'attestent ni OAuth ni facturation fournisseur en production. W07 est
livré sur le web ; l'APK est distribuée, sans preuve d'installation physique.
