# ADR — lecture fidèle des cibles déjà matérialisées

Statut : diagnostic en lecture seule livré par #488 (`b4cfa5d`, 7 septembre
2026 à 09:10 UTC). Aucun writer de mise à jour ni démarrage activé par ce lot.
Date : 7 septembre 2026.
Décision : implémentation principale et deux contre-revues indépendantes,
produit/données et sécurité. Aucun GO d'activation ou d'écriture.

## Contexte

M décrit les objets que ce profil a matérialisés ; T décrit le transport
acquitté et R la chaîne reçue. Aucun des trois ne prouve le contenu actuel B
des stores locaux. La sélection peut légitimement être vide après un import.
Une capture ordinaire peut normaliser les identités et ne collecte que les
références de la sélection : son `changed=false` ne protège pas un remplacement.

## Décision

Le raccord `localOutbox.inspectMaterialized()` ne reçoit aucun argument. Il
dérive M, ses associations et toutes ses cibles de l'état privé v3 ouvert par
l'acteur. Il exige une réception possédée, sa revue, une paire durable exacte,
aucune opération pending, le même compte/grant/clé/document et un stockage
isolé version 2 déjà préparé. L'inspection ne prépare ni ne publie un journal.
Elle retourne seulement des compteurs locaux/distants séparés, puis détruit
le témoin privé dans un `finally`. Aucun DTO retourné n'est une capacité.

`attestMaterializedTargets` est le helper interne ciblé. Il n'accepte pas la
sélection comme preuve. Le mapping strict ne crée ni ne promeut une identité.
Pour chaque cible, le frame canonique réellement reconstruit doit avoir le
même SHA-256 et la même longueur que l'unique tête vivante de M. Le décodeur
métier contrôle aussi ce frame, notamment les marqueurs d'image canonique.

Les résultats sont distincts : égal, différent, absent, illisible et non
inspecté. Un nouveau message/document local avec un nouvel identifiant est
une différence, pas la disparition de son contenant. Un fichier de M devenu
orphelin est lu directement à son adresse privée, sans conversation fictive.
Une ligne document existante hors catalogue n'est jamais déclarée absente.

La fermeture porte uniquement sur les dépendances fortes du contenu B dont
l'égalité à M vient d'être établie : pièces jointes, galerie, source et texte
du catalogue. Les références faibles de comparaison, attribution, contexte
projet, recadrage ou prose ne déclenchent aucune lecture supplémentaire.
Une dépendance forte absente de M reste explicitement bloquante ; la présence
d'un fichier local ne la remplace pas. Cibler seulement le texte d'un document
ne prouve ni son autre corps ni tout le projet identique.

## Témoins et durée de vie

`materializedRows` épingle présence et valeur de chaque ligne exacte. Les
décodeurs projet/document partagés décodent cette copie et n'effectuent aucune
nouvelle recherche d'adresse. Une lecture générique différente entre deux
observations raw n'est donc pas utilisée comme preuve. La validation finale
relit les mêmes adresses et compare les lignes complètes, ciphertext inclus,
même si leur numéro de révision ou leur contenu sémantique est identique.

La racine READY est la seule entrée de contrôle et doit correspondre exactement
à la génération, aux propriétaires requis et à la version physique. L'existence
de `erasing` bloque, y compris pour une valeur null/undefined. La présence ET
la valeur de la fence sont figées : absent et présent `initial` ne sont pas
interchangeables. Les gardes de paire/reçu passent par l'inventaire réel de
l'acteur ; le helper ne transforme pas un simple objet de garde en preuve.

L'historique complet reste dans le témoin, même les voisins non synchronisés,
car un futur remplacement publierait un ciphertext de compte entier. Les
descripteurs sont vérifiés avant toute sérialisation/clonage. Le clone structuré
conserve les membres undefined pour que la validation puisse les refuser ; le
JSON canonique sert seulement à la cohérence avec la persistance. Le témoin
raw conserve également la provenance locale et les restrictions déjà commises.
Les quatre slots et l'ensemble borné de localStorage sont comparés exactement.
Les slots de récupération non courants interdisent l'inspection, sans réparation.

Chaque échec de fraîcheur est terminal. Les grandes références privées et les
listeners sont retirés ; un retour ultérieur au même compte ne réarme rien.
Les gardes synchrones passent après le dernier await, pas seulement à l'entrée.

## Options et compromis

- Réutiliser la capture : moins de code, mais elle écrit parfois et son domaine
  dépend de la sélection ; rejeté pour une preuve de non-écrasement.
- Relire via la bibliothèque métier : simple, mais deux lectures peuvent
  décoder une ligne différente de celle attestée ; rejeté.
- Épingler les lignes, partager seulement les décodeurs purs et reconstruire
  les mêmes frames : choisi. Plus de contrôles et de tests, mais une provenance
  précise des données comparées. Les lecteurs ordinaires conservent leurs
  contrôles de révision/fence après déchiffrement.

Les limites sont des refus, jamais des troncatures : 256 objets / 16 Mio de
frames, 768 adresses, 24 Mio de témoin raw cumulé, 16 Mio de caractères de
localStorage ; historique 1 million de nœuds / 32 Mio de caractères. Elles
n'attestent pas la mémoire maximale d'un téléphone. Les clones/encodages ont
un surcoût et un espace plus gros doit recevoir un autre parcours explicite.

## Plan de tests et frontières de preuve

- Intégration locale : vrais services de stockage/crypto avec fake-IDB et
  compte de synthèse. Égalité exacte, titres/pins/nouvelles identités, UTF-16,
  provenance historique, source/texte distincts, fichier zéro octet et texte
  vide présents, orphelins, références faibles réellement matérialisées,
  dépendance forte manquante et absence d'écritures/allocation UUID/réseau.
- Pannes : ligne remplacée pendant déchiffrement, ciphertext renouvelé à
  contenu identique, mutations de voisin/provenance/quatre slots/paire/racine,
  présence fence et erasing, compte/clé/grant/document invalidés, canari après
  la dernière validation asynchrone, champs undefined/getters/toJSON et bornes
  avant déchiffrement. Aucun échec ne doit retourner une preuve réutilisable.
- Intégration acteur : deux profils réellement préparés par migration/upgrade,
  vrai import froid v10, vrai transport HTTP workerd/D1/R2, coffre privé v3,
  grant Google local réel mais serveur Google simulé. Sélection vide, compteurs
  dérivés de M, aucun write ; changement de paire/grant/clé en cours et galerie
  remappée. Ce ne sont pas deux navigateurs physiques ni OAuth réel.
- Non-régression : lecteurs projet existants, courses d'historique et campagne
  `npm run verify`, incluant types, OAuth, build et worker Office isolé.

## Conséquences et suite obligatoire

Le diagnostic ne constitue ni un verrou interbases ni une autorisation
d'écriture. R reste évalué séparément : B égal à M ne sélectionne aucune
variante distante et ne ferme pas les dépendances de R par substitution de B.
Le futur applicateur doit déterminer ses cibles et dépendances conservées,
réattester son BEFORE puis effectuer ses propres CAS dans le vrai journal.

- [x] Mapping strict, témoins readonly et décodeurs de lignes épinglées.
- [x] Raccord privé sans entrée DTO et compteurs détachés.
- [x] Deux objections des contre-revues intégrées : undefined conservé et
  présence de fence exacte ; pas de clonage de tout l'historique par cible.
- [ ] Journal distinct v11 de mise à jour existante, reprise/effacement inclus.
- [ ] Fichiers partagés/COW, couple documentaire remplacé, suppressions et
  résolution explicite de concurrence ; ces exigences restent dans W06.
- [ ] Recettes vraies fenêtres/téléphone et gates opérationnelles avant START.

Les résultats finaux de test sont consignés dans le CDC ; aucun commit local
postérieur à main `41ab207` n'est inclus dans la livraison #487 par implication.
