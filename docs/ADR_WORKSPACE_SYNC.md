# W06-B — synchronisation chiffrée optionnelle

Date : 6 septembre 2026. **Décision de conception / implémentation partielle**.
La sauvegarde/restauration [W06-A](ADR_WORKSPACE_BACKUP.md) existe ; un upload
d'archive ou un noyau causal isolé **ne valide pas W06-B**. Aucun bucket,
binding, migration serveur, endpoint public ou activation UI ajouté par ce lot.
Le [CDC](arty-workspace-cdc.md) complet, dont abonnements/crédits, reste ouvert.

## Résultat utilisateur à livrer

Opt-in explicite sur un compte vérifié, périmètre choisi, secret utilisateur
confirmé ; connexion d'un second appareil avec ce secret et premier aperçu.
Ensuite : envoi/réception automatiques, continuité des identités et références,
reprise après panne/hors ligne, conflits conservés. Conversations, comparaison
contextuelle, projets, originaux, texte documentaire exact et galerie restent
fidèles. Un historique reçu n'autorise jamais outils, reprise de stream,
fact-check, récupération de liens ni changement de confinement EU/documentaire.

Pour le premier applicateur sûr, réception automatique puis **« Appliquer les
changements reçus » sous maintenance et rechargement par lot**. Compromis
initial visible, pas « synchronisation temps réel transparente ». L'applicateur
chaud nécessite une barrière nouvelle couvrant tous les writers/lecteurs ;
le `persist()` synchrone et son chiffrement différé ne la fournissent pas.
W06-B reste partiel tant que l'ergonomie et les recettes ne sont pas acceptées.

États attendus : local, verrouillé, en attente d'envoi, révision acquittée,
changements reçus, conflit, stockage indisponible, appareil expiré à réconcilier.
Ne pas confondre suspendre, déconnecter cet appareil et effacer le coffre distant.

## Deux autorités, pas une reconnexion magique

- Identité serveur vérifiée, séparée du `userId` local. Premier parcours Google :
  `sub` obligatoire (le vérificateur actuel peut retourner `null`). Email vérifié
  a un espace d'identité distinct. BYOK/demo et invité n'obtiennent pas un coffre
  implicitement par simple association Google : leur effacement est actuellement
  local-only. Toute adoption de données invité exige une confirmation distincte.
- Secret de coffre aléatoire de 256 bits, détenu par l'utilisateur, dérivation
  HKDF et AES-GCM avec domaine distinct de l'archive et de la clé locale. Clé
  en RAM V1, déverrouillage explicite après fermeture/logout ; aucune promesse
  de récupération par Google seul. Pas de secret dans LS, journal ou logs.
- Enveloppes à authentifier : coffre, incarnation serveur, rôle de l'objet,
  identité/révision/parents et version de format. Le serveur ne voit que des
  identifiants opaques de transport, tailles, dates et engagements de ciphertext.
  **IDs logiques, contenu, graphe causal et hashes de plaintext restent chiffrés.**
  TLS/clé locale actuelle ne constituent pas ce chiffrement de bout en bout.
- `vaultId/epoch` dans une structure cliente ne prouve pas une autorisation.
  L'incarnation distante révoquée ne se recrée jamais sur un ancien upload.

## B1 : modèle causal conservatif

Format candidat interne `arty-sync-causal`, version 1. Un manifeste contient
des objets logiques stables (`conversation`, `project`, `file`, sources/textes
documentaires), chacun avec un DAG de révisions UUID v4. Chaque révision lie
identité, intention, parents exacts et valeur immuable : référence opaque de
payload + engagement privé + taille, ou tombstone explicite.

Intentions : création sans parent ; édition/suppression d'une tête vivante ;
restauration explicite d'une tête supprimée ; résolution citant toutes les
têtes présentées. Une résolution ne domine pas une troisième tête arrivée
après cet aperçu. L'UI future reste responsable du consentement, le noyau ne
le fabrique pas. Un retry conserve UUID, parents et valeur ; modifier l'un
sous le même UUID est une équivoque refusée.

Base ACK exacte conservée des deux côtés avant réconciliation. L'union des
révisions garde toutes les variantes concurrentes, y compris les contenus
égaux et suppression/édition ; aucun arbitrage par date, UUID ou LWW.
Les suppressions sont des versions causales, **jamais un getter vide/404**.

Exemple : b→l, b→r, puis z enfant de l et r. Rejouer b/l/r est sans effet.
Une nouvelle r2 enfant de r et créée hors ligne reste concurrente de z,
même si z est une suppression. La chaîne X→Y→X conserve ses trois révisions.
Une base tronquée provoque un refus/rebase ; elle ne devient pas une base vide.

Le graphe est fermé, sans cycle, parent étranger, auto-parent, doublon ni
parents redondants. Une identité de révision ne peut être réutilisée sur un
autre objet ; un payload immutable ne peut changer de commitment/propriétaire.
Sérialisation canonique des ensembles uniquement ; aucun tri des messages
ou documents applicatifs pour calculer leur contenu.

Bornes candidates : 2 000 objets, 10 000 révisions au total, 256 par objet,
16 têtes concurrentes, 4 Mio de manifeste, 10 Mio par payload. Dépassement =
refus sans écriture ni troncature. Ce n'est ni une capacité commerciale ni
un quota cloud activé. Aucune GC des « derniers N » : un futur checkpoint avec
expiration/réconciliation des appareils doit conserver la preuve de domination
et leurs intentions locales. La rétention exacte des payloads des ancêtres
reste à traiter ; aucune purge n'est implémentée ici.

La borne de têtes n'est pas monotone : 16+1 têtes peuvent être refusées, puis
la résolution explicite des 16 permet de rejoindre la 17e comme seconde tête.
L'union mathématique converge ; les propriétés d'associativité/ordre de livraison
du noyau borné valent pour les résultats intermédiaires admis. Sur limite,
conserver l'intention figée et permettre la reprise, sans rebaser ses parents
sur les dernières têtes et sans qualifier tout refus de blocage permanent.

Implémentation B1 : `src/services/workspaceSync/{types,schema,causal}.ts`.
Parse strict par descripteurs sans getters, formes fermées, UUID/hash bornés,
copie détachée, décodage canonique refusant les clés JSON dupliquées ; staging
à parents exacts, retry identique, merge conservatif et variantes maximales.
Ce noyau est pur et non importé par l'application : **pas encore d'E2EE,
d'outbox, d'ACK réseau, de capture fidèle ou de stockage/publisher**. Le payload
est un engagement opaque, pas la validation de son contenu ou de ses dépendances.

## B2–B5 : verticale restante, pas des exclusions

### Capture, secret, journal et application locale

Extraire la capture stricte sans le nouveau code aléatoire de chaque archive.
Mapping logique/physique persistant et sémantique stable avant scellement :
l'archive actuelle recrée IDs, sel et date ; son fingerprint n'est pas un
signal de modification. Ne pas perdre `Conversation.comparison` (la projection
d'archive ne la conserve pas aujourd'hui). Références exactes par variante,
graphes de dépendances complets, originaux inchangés et flags monotones.

Outbox séparée, owner/génération-scopée et chiffrée ; capture du scope, fence,
secret et activité. Les hooks de suppression doivent produire une intention
explicite. Scan de reprise des vrais stores contre la base ACK pour fermer
la coupure sauvegarde locale/outbox ; une lecture en erreur ne supprime rien.
ACK A après édition B n'acquitte que A ; aucune régression de checkpoint et
aucune suppression globale de l'outbox. Après issue réseau inconnue : consulter
ou rejouer la même opération et les mêmes octets.

Applicateur dédié `sync-apply` versionné, **dans la génération locale active** :
préparer ciphertexts et nouvelles pièces immuables → adopter journal exact et
retirer le document → reprise à froid → CAS ciblés de l'historique et index →
réattestation de toutes les écritures → ready/suppression du journal.
Ne pas assouplir le contrat v8 de restauration additive (IDs tous nouveaux),
ni placer l'outbox dans `control.meta` dont la forme est strictement inventoriée.
Éviter une copie complète de tous les comptes à chaque pull ; B doit rester
intact pendant une application, panne ou suppression de A.

### Publication distante et effacement

R2 privé pour ciphertexts immuables, D1 pour coffre/incarnation/head CAS,
réservations/opérations/budgets et nettoyage durable. Pas de bucket public ou
URL durable ; lecture authentifiée via binding, réponses `no-store`.
R2 est [fortement cohérent](https://developers.cloudflare.com/r2/reference/consistency/),
ses [écritures conditionnelles](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations)
ne constituent pas une transaction commune avec D1.

Réserver l'opération/budget D1 AVANT upload ; écrire/relire les objets exacts ;
publier head+ACK en [batch D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
conditionné par owner/incarnation/base. Un UPDATE à zéro ligne n'est pas une
erreur SQL : toutes les instructions dépendantes doivent partager le gate.
Ne pas supposer qu'un batch D1 annule un PUT R2. Réponse CAS perdue : retrouver
l'opération durable ; réserver les orphelins au nettoyage, pas au head actif.

Effacement : révoquer d'abord l'incarnation, refuser uploads/publications
tardifs, puis purger via inventaire durable. **Un PUT déjà parti peut terminer
après la purge** : injecter ce retard et conserver l'intention jusqu'à preuve
de nettoyage. `waitUntil` seul n'est pas un journal durable. Les deux endpoints
`account/delete.ts` et `account/erasure-v1.ts` doivent intégrer ce protocole ;
ne pas annoncer « effacé » si seul l'accès est révoqué. Nettoyage exact des
journaux/clefs RAM de A, sans B ; un appareil hors ligne n'est pas physiquement
effacé à distance. Recréation volontaire = nouvelle incarnation.

### Activation et preuve de bout en bout

Avant activation : disponibilité/capacité/juridiction R2 confirmées, protocole
d'effacement réel, contrat E2EE et politique publique cohérents. Les pages
confidentialité promettent encore la non-persistance des échanges courants et
un préavis de 30 jours pour modification substantielle. Préparer ce changement
et obtenir l'action propriétaire nécessaire ; **aucun email, accord juridique,
activation facturable ou contournement de permissions déduit de ce lot**.
Le test local Miniflare/R2 ne requiert pas d'activer le bucket en production.

Recette indispensable : deux profils indépendants, vrais stores/crypto,
API locale D1/R2 et identité synthétique vérifiée ; conversation + DOCX/TXT
projet + galerie de A vers B, réponse de B vers A sans doublon, reload,
modifications disjointes/concurrentes hors ligne, suppression et résolution,
ACK perdu/retardé, quota, corruption, owner A→B→A et logout en vol. Injecter
une coupure à chaque frontière upload/CAS/application locale, un PUT après
effacement et un ancien appareil après recréation. Ensuite seulement recette
déployée et APK exact sur appareil réel. Tests purs/fake-IDB ne valent pas
cette validation de bout en bout.

## Challenge et état de preuve

Deux contre-revues indépendantes readonly avant code : produit/continuité et
sécurité/publication. Objections intégrées : DAG fermé conservé après résolution,
replay ancien versus nouvelle branche ancienne, intentions de restauration,
ACK distinct, préavis public et upload tardif pendant effacement. Refus d'un
simple merge de valeurs, de l'import additif répété ou d'un clone global à
chaque pull. Deux GO code bornés après relecture ; aucune écriture déléguée.
La borne non monotone des têtes a été précisée et testée après objection.

Preuves locales sous Node 22.23.2 : **60 tests ciblés réussis**, dont ordre de
livraison, replay après résolution, nouvelle branche hors ligne, suppression/
restauration, ABA, intentions détachées, équivoques, cycles/parents étrangers,
getters/formes hostiles, format JSON canonique et dépassement réel de 4 Mio.
Dernière passe complète `npm run verify` : **331 suites, 4 283 tests réussis,
1 ignoré préexistant**, typechecks front/back, no-CASA, couverture, build et
vrai worker Office isolé réussis. Les quatre derniers cas négatifs de caractères
de fin de ligne ont ensuite été ajoutés et passent dans la suite ciblée à 60 ;
aucun code de production changé après la passe complète. CI de la PR à vérifier
sur le candidat exact avant fusion.

Reçus locaux ignorés : `workspace-sync-b1-verify-final.log` et
`workspace-sync-b1-unit.log`. Les marqueurs du protocole sont absents du bundle
applicatif compilé, en accord avec l'absence d'import. Pas de recette navigateur,
multi-appareil, crypto, D1/R2 ou APK revendiquée pour B1. Retour arrière : revert
du commit par la chaîne Git habituelle, aucune donnée ni migration à inverser.
