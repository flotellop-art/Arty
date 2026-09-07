# Mise à jour des objets synchronisés existants — réception du lot

7 septembre 2026. État : runtime local `2cef4dc`, deux contre-revues favorables
sur le delta, vérification complète réussie puis renforcement ciblé du test
multi-compte. Aucune livraison de ce lot attestée.
Base publique : cac505a30f7358c51dcb35c21062dd8bc82ed246 (#495).
Branche : codex/sync-existing-update-20260907.

## Effet et périmètre

- Mise à jour ciblée des conversations et métadonnées/consignes de projets
  déjà matérialisés, mêmes identifiants physiques, filiation distante exacte,
  version locale et dépendances encore égales à la version reçue auparavant.
- Aperçu explicite avant confirmation, refus expliqués, aucune résolution
  automatique d'un conflit ou suppression ; les voisins restent présents.
- Journal v11 distinct du premier import v10 : reprise hors connexion avec
  ciphertexts déjà préparés, sans clé privée, réseau ou nouvelle identité.
- Historique puis projets/état synchronisés atomiquement dans leur base.
  Abandon avant écriture métier ; après, reprise en avant ou effacement local
  explicitement choisi. Ce n'est pas une transaction ACID entre plusieurs bases.
- Lecture privée précédée de l'admission durable ; inventaire des identités
  borné et terminal sur dépassement. Réception de l'état public créateur v1,
  sans permettre un nouvel état AFTER v1.

Les formats fermés v10 ne sont pas élargis. Son raccord conserve la garde
après import dynamique. Le pont commun d'effacement compare aussi le stockage
local après le dernier succès d'écriture du ticket d'effacement.

## Preuves ciblées exécutées

- Retour second profil → créateur : le test échouait sur BEFORE public v1
  (session 62717, exit 1). Après correction, session 62572 exit 0 : quatre tests
  réels du harness, aller-retour conversations/projets et effacements v10/v11
  préservant le compte B chiffré.
- Session 46293 exit 0 : sept tests ciblés, dont les deux allers-retours,
  paire/fence/clé retirée juste avant préparation (zéro capture/déchiffrement),
  zéro cible applicable sans allocation/chiffrement/journal, et grammaire v11
  avec checksum recalculé. BEFORE1/2 admis ; AFTER1 et bindings altérés refusés.
- Session 81725 exit 0 : deux tests. Fermeture réelle de l'acteur pendant un
  import différé v10, aucun appel au préparateur/à la capture/au déchiffrement.
  Puis comparaison + galerie + documents, premier import et mise à jour v11 :
  réponse réservée promue au même ID, fichiers/documents/usage inchangés,
  faux aperçu modifié sans effet sur la cible réelle, recapture non vide inchangée.
- Trois suites rapides : 39 tests PASS (aperçu/consentement/rélecture,
  inventaire cumulatif, admission/protocole). La compatibilité TypeScript de
  hasOwn a ensuite été corrigée sans changer les limites ; typechecks PASS.
- Plan pur : 18 tests PASS, dont six cas de dépendance forte (inchangée,
  révision différente à contenu égal, modifiée, conflit, absente, divergence
  locale). La révision matérialisée d'une dépendance n'avance pas implicitement.
- Contre-revue de la matrice de recette : ajout d'une publication v11 réussie
  jusqu'à ready avec un vrai compte B chiffré voisin. Lectures histoire/fichier/
  projet B, paire et paquet pending exacts, puis édition B et rechargement.
  Session 73731 exit 0 : trois scénarios (effacements v10/v11 et publication v11),
  14,66 s. L'essai initial 17486 échouait car l'assertion globale héritée de
  l'effacement attendait aussi l'absence de A après publication ; corrigée pour
  exiger exactement l'état A v2 et l'intégralité des lignes B inchangées.
  Aucun runtime ni critère d'effacement affaibli ; typechecks repassés.

Ne pas additionner ces sous-ensembles : ils se recouvrent. Le harness utilise
deux profils JSDOM/fake-IDB, les vrais stores/chiffrement/acteurs et HTTP workerd
avec D1/R2 de test ; Google tokeninfo est simulé. Ce n'est ni deux navigateurs
réels, ni le téléphone, ni un test sur des données utilisateurs de production.

## Contre-revues

Produit : aperçu de cibles, homonymes/identifiants invisibles, consentement
distinct et rélecture sans publication. GO local limité après corrections.
Sécurité : BEFORE1, ordre admission/lecture, borne cumulative puis garde
post-import v10. Toutes les objections relevées ont une correction et un canari.
GO local limité ; les agents n'ont exécuté aucun test ni modifié de fichier.

Contre-revue de réception : la matrice attestée porte sur six frontières
durables simulées et 24 combinaisons phase/histoire/projet/état. Les quotas
sont injectés sur histoire/projet ; l'effacement v11 avec B est exercé au
checkpoint publishing. Pas de couverture exhaustive des instructions, de
coupure physique, de mélange entre deux projets ou d'effacement après toutes
les mutations métier. Aucune nouvelle objection bloquante pour livraison OFF.

## Vérification et livraison

- [x] `npm run verify` du code gelé : première session 98808 terminée exit 1,
  214 échecs, 5310 réussites et un SKIP (372 suites, 223,47 s). Erreurs observées
  : connexions Miniflare locales `EADDRINUSE` (127.0.0.1), puis serveur de test
  indisponible et délais de hooks/tests. Aucun de ces échecs n'est effacé du reçu.
  Contre-épreuve sans changement : accountDelete + d1.productMeasurement,
  un worker, session 58178 exit 0, 21/21 tests en 12,67 s. Seconde campagne
  complète avec `VITEST_MAX_WORKERS=2`, option supportée par Vitest installé :
  session 39860 terminée exit 0, 372 suites réussies, 5 524 tests réussis et un
  ignoré (5 525 au total), durée Vitest 842,01 s. Couverture globale : statements
  77,35 %, branches 71,96 %, fonctions 82,23 %, lignes 79,67 %. Le build réussit
  en 7,47 s et le vrai worker Office export est validé dans une VM isolée ;
  cela ne constitue ni une ouverture visuelle dans Office ni un test natif.
  La commande complète est réussie ; l'avertissement de taille des chunks
  reste présent. Ce résultat ne prouve pas rétrospectivement la cause de chacun
  des échecs de la première campagne.
  Aucun test retiré, aucun délai/seuil/assertion affaibli. La limitation de
  charge est une mesure de vérification locale, pas une correction prouvée
  d'un défaut métier ou une mesure du pic de ports lors du premier échec.
- [ ] PR et CI application, orchestrateur et Android vertes sur le même candidat,
  incluant le scénario B ajouté après la vérification complète locale.
- [ ] Prévisualisation Pages identifiée, contrôles anonymes bornés.
- [ ] Livraison main, réception publique observée et identité de l'APK distribuée.
- [ ] Essai utilisateur sur la plateforme et version réellement annoncées.

### Première CI et correction du test HTTP

PR496, candidat `b23685d`, CI34161058024 : terminale en échec, 371 suites
réussies et une en échec ; 5 524 tests réussis, un échec et un ignoré,
518,69 s. Échec unique dans `anthropicPreflight.workerd.test.ts:48` :
`fetch failed`, causé par `write ECONNRESET` dans Undici `AsyncWriter.end`.
Le build du job application n'a pas été atteint. Android et orchestrateur
réussissent ; la preview d1050da7 est déployée et ses contrôles anonymes passent.

Le même test inchangé passe isolément en local (3 tests, 3,11 s) ; cela
n'efface pas l'échec CI. La source Miniflare retransmet un body stream à
Undici, qui écrit un terminateur chunked sans longueur connue. Une course
avec l'annulation anticipée est cohérente avec cette trace, sans causalité
définitivement reproduite par le test local.

Port sélectif de la correction test-only déjà préparée dans le candidat
opérationnel : longueur HTTP finie exacte pour les deux corps négatifs,
assertions 413/JSON/no-store/zéro fournisseur ; deux canaris supplémentaires
exécutent le vrai parseur dans workerd sur un flux jamais fermé et exigent
son annulation effective avant EOF. Les positifs 32 MB et deux fois 11 MB avec
Unicode restent identiques. Aucun ECONNRESET accepté comme succès ni retry.
Les deux contre-revues indépendantes valident ce périmètre. Six tests ciblés
PASS (4,07 s), typechecks repassés. Ce contrôle du flux interne ne prouve pas
la fiabilité d'un upload HTTP chunked externe. Runtime, limites, timeout et
configuration inchangés. La nouvelle CI complète reste à recevoir.

La chaîne existante peut distribuer un APK Firebase à la fusion main. Aucun
changement de workflow, migration D1 distante, paiement, webhook, secret,
binding ou provisionnement n'appartient à ce lot. Ne pas tester des comptes
sur une preview en supposant son D1 isolé : cette isolation n'est pas attestée.

## Activation, repli et reste de W06

`WORKSPACE_SYNC_APPLY_START_ENABLED=false` et
`WORKSPACE_UPGRADE_START_ENABLED=false` restent inchangés. Le lecteur/repreneur
isolé reste ON pour les données déjà présentes. Aucun nouveau départ v11 ne
doit être activé par cette livraison ; les canaris activent ces constantes
seulement dans les tests. Les achats Android ne sont pas ouverts par ce lot.

Avant repli, identifier la source servie et les éventuelles livraisons concurrentes.
Régression de lecture, confusion de compte ou blocage des parcours essentiels :
fermer les nouveaux départs et appliquer un correctif conservant les lecteurs
de tous les tickets déjà adoptés. Une version antérieure sans lecteur v11
refuse un tel ticket ; ne pas effacer, réécrire ou rétrograder ce ticket pour
faire réussir un retour arrière. Un repli Pages ne rappelle pas un APK distribué.

W06 reste ouvert : créations après premier import, fichiers/COW, remplacements
documentaires, suppressions, résolution explicite des conflits, configuration
distante autorisée, deux navigateurs réels et téléphone. Les obligations
commerciales, anti-abus, autres W01–W10 et validations externes sont inchangées.
