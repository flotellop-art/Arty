# Cahier des charges — essai commun Google et e-mail

## Mission et livraison

Rendre commun le plafond de 30 admissions d’essai entre Google et le code
e-mail. Exemple de réception : 10 admissions Google puis connexion e-mail
correspondante donnent 20 restantes, et réciproquement.

Branche de livraison : `codex/anthropic-funding-release-20260908`.
Dossier : `D:\CodexData\worktrees\37fe\Arty-anthropic-funding-release-20260908`.
Base exacte : `b832dfcf` (offre Haiku, recherche native et mémoire locale).
Réutilisation examinée : `c6416305`, ancien lot Gmail non intégré ; appliquer
ses changements utiles sans remplacer les protections plus récentes.

Le livrable est le code intégré à cette branche, les tests et la réception
de ce CDC. Pas de déploiement, migration distante, dépense fournisseur ou
activation du budget de 100 USD. Pas de nouvelle mission automatique.

## Règles d’acceptation

| ID | Exigence vérifiable |
| --- | --- |
| R1 | Additionner les usages Google et e-mail ; le plafond commun est 30. À total 29, une seule demande concurrente obtient la dernière admission. |
| R2 | Conserver toutes les consommations existantes. 17 + 13 donne 0 restant ; 30 + 30 reste épuisé, sans effacement ni remise à zéro. |
| R3 | Utiliser un groupe de **restriction d’essai uniquement**, reprenant la normalisation historique e-mail : espaces extérieurs/casse, retrait du suffixe `+`, et pour Gmail personnel seulement retrait des points et `googlemail.com` → `gmail.com`. |
| R4 | Ne modifier aucun identifiant de session, compte, chiffrement, souvenir, conversation, abonnement, VIP ou portefeuille. OTP n’hérite jamais des droits ni des crédits Google. |
| R5 | Contrôle du cumul, incrément du canal courant et lecture du résultat dans la même transaction. Une panne ou un accusé ambigu n’autorise aucun fournisseur ni remboursement supposé. |
| R6 | Conserver le délai d’admission et de lecture borné. Une compensation tardive agit seulement sur le compteur réellement incrémenté, une fois, sans effacer un débit concurrent. |
| R7 | Google init et vérification OTP rendent le restant commun réel. En cas de lecture impossible : inconnu, jamais un nouveau 30. Une authentification OTP réussie reste réussie même si le quota est inconnu. |
| R8 | L’accueil « 30 offerts » ne s’affiche que pour un restant vérifié égal à 30. Métadonnées de connexion attribuées au propriétaire exact, réponses tardives écartées ; aucun transfert via cache global entre comptes. |
| R9 | Distinguer quota inconnu et hors essai pour l’accès aux crédits dans l’interface. Un échec de vérification ne déverrouille pas le premium ; un véritable Free à crédits conserve son accès. |
| R10 | Conserver le financement Haiku existant et le budget subventionné indépendant. Une continuation liée au trial refuse une bascule vers le wallet. Les nouveaux appels Google après épuisement attesté peuvent suivre le parcours de crédits existant ; pas de nouvel achat ni de paiement ajouté par ce lot. |
| R11 | Les anciennes applications utilisant le nouveau serveur restent soumises au plafond. Aucun compteur supprimé par changement d’IP, déconnexion, réinscription ou nouvelle vérification e-mail. |

### Limite explicite sur les anciennes adresses

L’ancien système e-mail a supprimé `+tag` de l’identité conservée, y compris
hors Gmail. Le destinataire exact de certaines anciennes vérifications n’est
plus reconstructible. Pour ne pas rouvrir 30 admissions, R3 applique une
restriction conservatrice : **deux boîtes distinctes avec `+` hors Gmail peuvent
partager cette limite et épuiser mutuellement leur essai**. Ce n’est ni une preuve
de même boîte ni une fusion de comptes. Leur distinction exacte nécessitera
une transition de preuve OTP versionnée, hors du présent lot.

Les points restent distincts hors Gmail. Des adresses entièrement différentes
ne sont pas reconnues comme appartenant à la même personne. Ce CDC ne promet
ni « 30 réponses visibles », ni « 30 par personne » : l’unité reste une admission
HTTP, conformément au financement déjà réalisé.

## Recette et critère de fin

1. D1 local : deux sens Google/e-mail, Gmail/alias, domaines ordinaires et
   restriction `+` historique ; cumul absent, 29 concurrent, 30, supérieur à 30,
   invalide ; premier INSERT, rollback, ACK perdu et compensation concurrente.
2. Vrais handlers avec fournisseurs simulés : initialisation Google, OTP,
   Haiku gratuit, refus des autres modèles, abonnements/VIP/BYOK, wallet Google
   après épuisement et impossibilité pour OTP de le dépenser.
3. Client : restant réel, inconnu, ancien serveur, Google → OTP → Google,
   réponse tardive, panne de stockage, accueil attribué et crédits protégés.
4. TypeScript application/Functions et build. Tests ciblés sur le candidat
   intégré, un seul worker pour les campagnes D1 ; reçus conservés et aucun
   contrôle relancé sans changement susceptible de l’affecter.
5. Deux contre-revues indépendantes en lecture seule, objections examinées.
   Fin quand les critères du lot sont prouvés localement et le résultat
   enregistré dans Git. Tout défaut extérieur reste consigné pour une suite.

La réception locale ne vaut pas mise en production : celle-ci nécessitera une
vérification des index et volumes D1, une bascule serveur coordonnée (un ancien
handler peut ignorer le cumul), la CI de livraison et le parcours réel téléphone.

## Point de reprise unique

État : CDC fixé avant implémentation ; deux contre-revues initiales réalisées.
Décisions : restriction historique R3 assumée, aucune migration d’identité ;
conserver les délais du candidat actuel et distinguer inconnu/hors essai.
Prochaine action : intégrer sélectivement le lot existant, étendre son groupe
de restriction, puis exécuter la recette ci-dessus. Les preuves et le candidat
final seront inscrits ici sans recréer un plan général.
