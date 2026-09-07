# ADR — appliquer les mises à jour des objets existants

Statut : décision acceptée, implémentation et recette automatisée reçues,
livraison et recette utilisateur encore ouvertes.
Date : 7 septembre 2026. Deux challenges indépendants produit et sécurité.

## Contexte et décision

Le diagnostic B==M est déjà public depuis #488. Le journal v10 n'applique
que des copies nouvelles ; son abandon peut les supprimer. Le transformer
en remplacement ferait courir un risque de perte de données existantes.

Un journal distinct v11 applique les conversations et métadonnées de projets
existants aux mêmes adresses. La cible distante doit avoir une tête vivante
unique, descendante exacte de M. La revue valide toujours l'identité de tout
le reçu, puis le plan choisit les seules cibles et dépendances admissibles
AVANT toute allocation ou projection. B==M porte sur ces cibles et leurs
dépendances fortes. Un voisin modifié avant la préparation est conservé ;
une mutation pendant la préparation invalide le nouvel historique complet.

M_after remplace seulement les records effectivement appliqués. Le reste de
M et des bindings est conservé. Les messages ajoutés peuvent recevoir des
bindings embedded ; aucun nouveau record physique n'est créé dans ce lot.
Fichiers, sources et textes doivent être déjà matérialisés et inchangés.
Les dates métier et caractères reçus restent exacts. Révision locale projet
+1, EU inchangé, restrictions de sortie non abaissées. Les éléments non
appliqués restent distants et sont signalés, pas déclarés synchronisés.

L'état public BEFORE accepte v1 (créateur ayant seulement publié) ou v2 ;
AFTER exige v2. La paire et les droits sont validés avant la capture/déchiffrement
de l'historique, puis revalidés après chaque attente. L'inventaire de collisions
est cumulativement borné : 100 000 lignes, 100 000 chaînes distinctes, un million
de visites et 32 Mio de caractères. Les répétitions sont comptées ; un dépassement
est terminal, jamais une troncature considérée comme un inventaire complet.

L'aperçu distingue cibles proposées et éléments conservés. Type, titre avant/après
et identifiant local exact échappé permettent de distinguer les homonymes. Ces
valeurs sont détachées et ne pilotent aucune écriture. Relire détruit l'ancien
aperçu et désarme le consentement ; cette action ne publie jamais un envoi.

## Publication et reprise

`prepared → publishing → historique AFTER → projets+état sync AFTER → ready`

Le journal possède BEFORE/AFTER chiffrés et les preuves exactes des autres
données ; sa limite compte les deux côtés. L'intermédiaire nouveau ciphertext
et ancien plaintext est reconnu. Projets et état sync changent ensemble dans
une RW CAS, jamais ligne par ligne avec acceptation d'un mélange. Les fences
sont comparées en présence ET valeur, et le reçu d'effacement doit être
physiquement absent, y compris si sa valeur serait undefined ou null.

Avant la première mutation, abandon sans restaurer ni supprimer les données
métier. Après, reprise en avant uniquement ou effacement propriétaire explicite.
Commit incertain : document retiré, aucune restauration aveugle. Admission
froide avant App, inventaire root+job exact, reprise disponible START OFF.
Pont vers effacement v6 atomique et preuves actuelles des autres propriétaires.
Le verrou inter-bases coopératif n'est pas une transaction ACID inter-bases.

## Options écartées et conséquences

- Réutiliser v10 : plus court, mais abandon destructeur et mauvaise matrice.
- Projeter tout R puis filtrer : conserve des promotions de bindings indues.
- Remplacer l'historique par les seules cibles : perd les voisins locaux.

Le protocole distinct augmente le coût de maintenance et les scénarios de
reprise à tester. Il préserve en échange les lecteurs et garanties v10.

## Recette obligatoire avant livraison

- [x] Deux profils du harness : premier import puis modifications
  distantes, préparation/confirmation v11, rechargement et lecteurs réels.
- [x] Mêmes IDs, nouveaux messages texte, dates exactes, voisin modifié avant
  préparation et autre compte préservés ; fichiers/documents inchangés.
- [x] Recapture non vide avec objets lus et changed=false ; édition locale
  suivante avec parent causal exact, sans renvoi artificiel de l'import.
- [x] Mutations cible/voisin, retrait clé/grant, fence absent/présent initial,
  reçu présent undefined/null et révocation au dernier succès IDB refusés.
- [x] Interruptions et ACK locaux perdus aux six frontières déclarées,
  quotas histoire/projet et matrice phase/histoire/projet/état BEFORE/AFTER ;
  abandon/reprise et effacement A au checkpoint publishing préservant B.
- [ ] Deux contre-revues finales, vérification complète, Git/CI/Pages et
  recette utilisateur de portée explicite.

Ce lot ne retire pas de W06 les créations ultérieures, fichiers/COW,
remplacements documentaires, suppressions et résolution des conflits. Il
n'active pas START, ne provisionne rien et ne clôt pas la recette multi-appareils.

Preuves ciblées, état de vérification complète et limites de livraison :
SYNC_EXISTING_UPDATE_RELEASE.md.

Les trois premiers critères sont exercés dans
`src/__tests__/functions/workspaceSyncClientRoundTrip.test.ts` : parcours
`existing update uses the real journal and readers without ping-pong`, corpus
comparaison/galerie/documents et scénario `v11 publication preserves real
encrypted B history, project, file and pending pair`. Ce dernier lit puis
modifie et recharge réellement B après que A est revenu à ready ; les scénarios
d'effacement v10/v11 restent distincts. JSDOM/fake-IDB ne sont pas des
navigateurs réels. Le test B ajouté après la campagne complète passe dans la
session 73731 (3 scénarios, exit 0), sans changement du runtime.

Portée sécurité : six frontières simulées dans le harness, 24 combinaisons de
matrice, quotas histoire et projet. Les deux directions de présence du fence
sont couvertes dans `workspaceSyncMaterializedCoverage.test.ts` ; le canari
intégré couvre une direction. Pas de preuve de coupure physique navigateur/
disque, de quota à chaque instruction, de mélange entre deux projets distincts
ou d'effacement v11 après mutation métier. Ces limites ne sont pas effacées par
la vérification complète réussie ni par la livraison OFF.
