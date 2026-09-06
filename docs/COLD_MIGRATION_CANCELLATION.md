# Abandon avant barrière — contrat et preuves

6 septembre 2026. **Implémenté et validé localement ; publication en cours.**
Deux challenges indépendants readonly produit et sécurité ont approuvé ce
périmètre avant code. Aucun GO d'activation W06 ; le flag reste OFF.

## Besoin et promesse exacte

Une copie localStorage dépassant durablement la capacité disponible laisse un
header v3 `reserved`, un journal et éventuellement des cibles partielles, avant
les barrières physiques (migration.ts:486–529). Le test de quota actuel retire
le défaut avant retry ; il ne ferme pas la situation durable.

Promesse : **arrêter cette tentative sans modifier les sources legacy
actuelles**. Ce n'est ni une restauration d'une ancienne sauvegarde, ni la
certification d'un inventaire historique perdu, ni une garantie de capacité
pour toute écriture ultérieure. Ce n'est pas une panne active de production :
le migrateur isolé est toujours désactivé.

## Contrat de l'acteur froid

Acteur distinct, choix exclusif dans un nouveau document en maintenance.
L'UI propose inspection, confirmation d'abandon, puis rechargement volontaire.
Pas d'import privé, clé, KDF, réseau, appel natif ni effacement de compte.
Le caller ne fournit ni plan, adresse de copie, owner ni booléen d'autorité.

L'inspection doit figer un aperçu privé et vérifier :

- header **v3 reserved uniquement**, identité/révision/génération exactes ;
- versions physiques des deux sources exactement égales aux versions 0/1
  inscrites dans le plan ; jamais se fier au seul checkpoint ;
- identité/plan du journal exacts, cinq stores raw vides, destinations IDB
  absentes ; sources re-hashées égales au plan ;
- targets canoniques dérivés de ce plan/génération, absents ou exactement
  égaux aux octets attendus ; aucune exclusion/suppression par préfixe ;
- si plan absent : seulement journal absent ou identité seule et stores vides,
  aucune destination/cible ; nouvel aperçu des données **courantes** et
  confirmation fraîche, sans prétendre retrouver l'empreinte historique ;
- pas de condition « owner effaçable par le natif » : un abandon sans
  effacement ne doit pas dépendre de cette capacité.

Après confirmation, ne retirer que les cibles de copie exactes, jamais une
source LS/IDB, session, credential, brouillon ou donnée native. Réattester les
sources et l'absence des cibles avant de supprimer le seul payload `plan`
dans une transaction de journal contrôlée. Le plan contient lui-même des
copies privées (`localSource`, owners) : il ne peut pas devenir orphelin.

Puis CAS strict du header vers le descripteur existant `v1 legacy-v1 ready`,
révision +1. Ne supprimer ni la base de contrôle ni son record. Un journal
identité-seule peut rester (pas de GC général dans ce lot). Aucun passage à
App dans le document courant : la réservation maintenance est terminale.

## Coupures et refus

Une coupure pendant le retrait laisse reserved + plan + copie partielle ;
une coupure après retrait du plan laisse reserved + identité seule/raw vides.
Le second cas ne permet **aucune adoption silencieuse par l'ancien acteur** :
nouveau document, nouvel aperçu et nouvelle confirmation sur l'état courant.
Un premier incrément à exécution confirmée unique, puis reload en cas d'échec,
est préférable à un retry qui réévalue secrètement le baseline.

Refuser sans réparation : inventoried/barrier/copied/verified, toute source
physiquement v2, source/cible divergente, plan étranger/modifié, fragments sans
plan, destination existante, fence/effacement incohérent, perte du document,
header changé, contrôle vide/étranger. Un résultat de CAS perdu n'autorise pas
à interpréter un simple legacy ready comme preuve d'appartenance à ce job.

Alternative discutée puis écartée pour ce périmètre : nouvel état durable avec
preuves hashées de l'ancien inventaire. Il serait nécessaire pour une promesse
de baseline historique après crash ; cette promesse est explicitement exclue.
La sortie identité-seule déjà représentable suffit sous confirmation fraîche.

## Critères de validation avant livraison

Quota de duplication maintenu pendant toute la recette, jamais retiré pour
faire passer le test : échec reserved → nouveau document → inspection et
confirmation → abandon → nouveau document legacy → B déchiffre son historique
et fichier, effectue une petite modification puis recharge. A peut rester
sans clé. Le budget doit permettre cette petite écriture, pas la duplication.

Coupures au premier/dernier target et après chaque retrait, après suppression
du plan, avant/après CAS ; contrôle remplacé ou acquittement perdu ; nouvelle
cible/source inconnue ; témoin v2 caché sous reserved ; perte de document ;
ancienne capacité encore en vol ; propriétaire anonyme/non natif ; OFF réel.
Vérifier intégralement les sources et voisins, auth/settings, clés crypto,
brouillons et URL OAuth/verifier. Aucun appel réseau/KDF/natif avant admission.

Quota après barrière, restauration publiée et synchronisation demeurent hors
de ce petit incrément.

## Implémentation et validation locale

`createColdMigrationCancellation()` expose uniquement `inspect()` et
`confirm()`. Dès le début d'une confirmation, les deux deviennent terminaux,
même après erreur ou acquittement perdu. Le lecteur commun reste readonly ;
le prédicat d'owner natif demeure dans le wrapper de préparation d'effacement,
sans booléen public permissif. L'abandon ne dépend pas de ce prédicat.

Retraits LS limités aux targets exacts, avec comparaison de tout le snapshot
LS avant et après chaque retrait. Une même transaction readwrite sur
`journal` et les cinq stores raw revérifie identité, clés, plan et compteurs
vides avant de supprimer uniquement `plan`. Le baseline privé reste celui de
l'aperçu jusqu'au CAS ; garde LS synchrone dans `beforePut`. Il n'existe pas
d'atomicité globale LS/IDB ni de garantie face à un ancien client non coopératif.
Aucune source n'est écrite ou supprimée par cet acteur.

`npm run verify` exit 0 : **314 suites, 3 994 tests réussis + 1 sauté**.
Typechecks front/back, no-CASA, couverture, build et vrai worker Office isolé
réussis. Couverture 71,82 / 66,72 / 77,45 / 73,66 %. Log ignoré
`.playwright-mcp/migration-cancellation-verify.log`.
31 tests service dédiés : anonymous/non natif, journal absent/identité-seule,
phases refusées, témoin physique v2, snapshots modifiés, coupures de retraits,
plan retiré, transaction journal attaquée, CAS incertain et acteur périmé.
11 nouveaux cas d'intégration UI : quota fixe insuffisant pour première ou
dernière copie, A sans clé, B réel lecture/écriture/relecture, double clic,
rechargement après échec, absence de reprise automatique et choix exclusifs.
Ces recettes initialisent directement la session synthétique : elles ne
valident pas le formulaire de connexion ni un fournisseur réel.

Chrome isolé à **13:06:54 UTC**, 390/1280 px : vrais IDB/crypto et composants
froids ; quota conservé entre les documents ; abandon explicitement confirmé,
sources comparées intégralement, zéro KDF/déchiffrement et zéro import App
pendant l'abandon, URL/verifier préservés, puis B lit son historique/fichier,
modifie et relit après reload. Politique OFF réelle ensuite vérifiée sans
boutons d'action. Aucun débordement horizontal ni requête externe/erreur.
Capture 390 px inspectée. Fixture et runner ignorés
`.playwright-mcp/migration-cancellation-{fixture.tsx,browser.mjs}`.
Activation remplacée uniquement dans l'interception de ce profil localhost ;
aucune modification de la constante de production. Ce n'est pas une recette
authentifiée en production, un APK installé ou un test physique mobile.

## Livraison et repli

Deux contre-revues readonly indépendantes après code ont donné leur GO borné
(produit/lifetime et sécurité/transactions), sans objection P1/P2 restante.
Leur GO ne remplace ni les tests exécutés par root ni les preuves distantes.

Git/PR puis CI web, orchestrateur, Android et preview avant fusion normale.
Contrôler Pages/main/Firebase et les bytes canonical/immuables après fusion.
Flag OFF conservé et aucune migration D1, scope OAuth ou fonction serveur.
Repli par PR vers le code précédent si régression froide, sans purge ni
rétrogradation de journal/base. Les sondes publiques ne prouvent pas des taux
d'erreur ou latences globaux ; aucune télémétrie de production inventée.
