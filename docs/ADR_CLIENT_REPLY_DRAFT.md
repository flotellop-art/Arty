# W08 — statut durable de la réponse client

6 septembre 2026, base main `2c114cf` (#466). Décision de réalisation, pas
attestation de livraison. Deux diagnostics indépendants readonly examinés :
continuité sécurité/fidélité et parcours produit/export.

## Décision

Une réponse client est un fil neuf, documentaire détaché, sans projet implicite,
outils, données Google ni capacité d'envoi. `Conversation.outputRestriction`
admet une seule valeur : `client-reply-draft-v1`. Elle impose
`hasProjectContext:true`, suit les branches, entre dans les clés de revue et
ne peut pas disparaître lors d'une réécriture du même fil. Aucune valeur `sent`,
aucun destinataire, jeton ou identifiant mail. Les imports refusent les valeurs
inconnues ; le texte du modèle n'active et ne retire jamais la restriction.

Le marqueur est publié avec la demande, avant tout token. Les writers existants
gardent le texte modèle brut, y compris pour Stop/crash et comparaison. Une
projection applicative commune ajoute une notice distincte à l'affichage,
copie, lecture, partage explicite et exports de lecture. Pas de faux token ni
de préfixe stocké/répété dans les messages. La paire contenu brut + restriction
est la vérité persistée, pas une seconde autorité dupliquée sur chaque message.

Notice finale : « Réponse préparée — non envoyée par Arty ». Un partiel est
annoncé comme incomplet ; un stream en cours n'est pas présenté comme finalisé.
Zéro texte ne devient pas une réponse grâce à la notice. Le statut décrit ce
parcours Arty, pas un éventuel envoi ultérieur par l'utilisateur ailleurs.

Office transporte la notice dans son DTO et sa clé de fraîcheur, avec texte
visible dans l'aperçu et le DOCX. XLSX la conserve dans la feuille Informations
pour chaque message sélectionné ; un paragraphe Markdown seul serait perdu
car Excel n'exporte que les tableaux. Aucune modification des cellules sources.

## Fidélité des formats

Les archives contenant le marqueur utilisent manifeste v3/minReader3 avec
l'enveloppe chiffrée inchangée et les règles de fichiers v2 conservées. Les
archives sans ce marqueur restent v2 ; les lecteurs v1/v2 restent acceptés.
Le mapper le conserve explicitement ; v1/v2 refusent le nouveau champ au lieu
de le supprimer. Le planner de restauration le garde sans changer son inertie
`restoredArchive:true`. Le publisher W06 et la synchronisation restent OFF.

Le JSON privé v2 transporte le mode restrictif et le texte brut pour éviter les
préfixes cumulés après aller-retour. Les galeries sont exclues et comptées au
niveau de l'export, sans fabriquer du texte modèle ; les projections de lecture
ajoutent leur note d'omission après calcul du statut sur le brut. Son import
valide le mode et le conserve en fil détaché. Tout ancien placeholder streaming
est déclaré interrompu avant remappage de son ID. Les anciennes APK, lecteurs
JSON permissifs et fichiers modifiés
hors d'Arty ne fournissent pas de garantie rétroactive de conservation.

Le bouton Copier un bloc de code est absent dans ce mode ; la copie complète
reste disponible. Les boutons générés sont du texte, sans faux contrôle
focusable. Le résumé automatique secondaire et le raccourci Agenda sont
indisponibles pour ce fil : ils ne transportent pas ce contrat de sortie.

## Parcours prévu et critères P0

Demande client et faits autorisés : 8 192 caractères chacun, objectif : 1 600,
ton prédéfini. Collage intégral conservé, dépassement refusé sans troncature.
Intention de l'utilisateur séparée des données collées non fiables ; revue
exacte des quatre champs et fournisseur, budget final revérifié. Aucune URL
collée téléchargée. Admission du fil neuf par une variante interne explicite,
pas un faux projet ; mêmes guards owner/crypto/fence et adoption que la synthèse.

Revue annulée : aucun fil ni HTTP, brouillon RAM conservé. Double confirmation :
un seul HTTP. Après commit, le stream ne dépend plus du montage du formulaire.
Rechargement sans appel ; retry/édition/branche/comparaison restent documentaires
et marqués. Aucun appel mail/Agenda/recherche/mémoire. Copie/export ciblés,
aucun partage public automatique.

Tests requis : final/partiel/Stop/crash/reload, valeur inconnue, retrait du mode,
branche, retry, deux résultats de comparaison, JSON et archive aller-retour,
copie/HTML-PDF/Markdown/DOCX/XLSX ciblés avec relecture des artefacts. Recette
du vrai App FR/EN 390/1440, limites, accès, annulation, double clic et changement
de compte. Une tranche de fondation peut précéder le formulaire, mais ne doit
jamais être présentée comme le parcours client livré.

## Alternatives écartées

- Demander au modèle de se déclarer non envoyé : non garanti face aux données
  hostiles et aux relances génériques.
- Ajouter un badge seulement : perdu à la copie et dans les exports.
- Préfixer chaque writer : plusieurs vérités, cumul au reload et métriques IA
  faussées ; nouveaux writers faciles à oublier.
- Détourner tags/quickAction/restoredArchive : ces champs ne sont pas l'autorité
  canonique de ce mode et leurs règles d'import sont différentes.

Pas de résultat commercial ni de mesure de rétention prétendus. La validation
P0 est une condition de lancement ; les mesures terrain restent W10.
