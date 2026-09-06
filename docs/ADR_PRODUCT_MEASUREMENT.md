# ADR — mesure produit facultative, W10

Statut : implémentation locale en cours, après deux contre-revues indépendantes.
6 septembre 2026. **Publication fermée, aucun collecteur livré en production.**
`PRODUCT_MEASUREMENT_RELEASED=false` ferme séparément interface et endpoint
avant lecture du corps, authentification ou accès D1. Les tests du pilote
prospectif ouvrent uniquement cette constante ; un test distinct vérifie le
vrai gate fermé. Une préférence localStorage ne permet jamais de l'ouvrir.

## Objectif complet et étape courante

W10 exige activation, issues de parcours, D7/D30, conversion et un rapport
avec période/échantillon/limites. Le rapport de coût technique #475 existe.
La présente étape raccorde un vrai parcours jusqu'à une collecte facultative
et son rapport ; elle ne remplace pas les exigences de cohortes ou paiement.

Première population explicitement annoncée : nouvelles soumissions du guide
Réponse client, Web, compte Google déjà connecté et jeton suffisamment frais.
Ni navigateur de démonstration, invité, BYOK sans Google, reprise d'historique,
retry de conversation, comparaison, import ou restauration. Pas de collecte
rétroactive à partir du marqueur importable d'une conversation.

## Décision

### Acquittement du parcours réel

`arty-message-sent` n'est pas un succès : il précède la sauvegarde finale et
peut accompagner une comparaison en erreur. L'adoption/navigation du guide
précède également la génération. Le finaliseur donne désormais un résultat
explicite au témoin RAM exact de la soumission : enregistré, vide, erreur,
arrêt, non enregistré, non démarré. Un texte blanc n'est pas une réponse utile.
L'enregistrement désigne le filet de sécurité local synchrone, pas la fin du
chiffrement différé ni la qualité subjective de la réponse.

Fixer une issue avant abort/notifications réentrantes ; un ancien callback ne
termine pas un nouveau stream. L'observateur ne modifie jamais le transport,
les quotas IA, le fact-check ou la réponse. Discard de compte/document et
démontage abandonnent le témoin sans beacon ou rattrapage. Son scope propre
survit à une clôture saine du stream et au démontage du formulaire après
adoption ; aucune observation n'est sérialisée dans les objets métier.
Le passage en arrière-plan abandonne également la mesure en cours, sans
annuler le travail métier. Revenir visible ne réarme pas un ancien témoin.

### Participation

Option locale owner-scoped, désactivée par défaut ; absence/mauvais format
refusés. Capturer au départ propriétaire, epoch, crypto, fences, consentement
exact et génération RAM. Le retrait invalide immédiatement les tickets même
si son enregistrement échoue ; OFF→ON ne réarme pas un ancien résultat.
La nouvelle clé est inventoriée par les lecteurs/migrateurs/effacements.
Un retrait non enregistré reste visible après fermeture/réouverture des
paramètres dans le même document. Son action de réessai écrit explicitement
OFF ; elle ne bascule jamais involontairement sur ON. Si le stockage est
inaccessible, aucune persistance au prochain rechargement n'est promise.

Aucune préparation OAuth pour mesurer : lecture synchrone d'un jeton Google
déjà admis et suffisamment frais sous son bail courant. Pas de refresh,
bootstrap, reconnexion, fallback email ou réutilisation de clé BYOK. Une panne
de mesure n'empêche pas la tâche. Avant dispatch, valider le fence IDB puis
relire scope/consentement/bail/jeton, sans attente entre dernier contrôle et
fetch. Une seule tentative client, jamais de retry après un acquittement perdu.

### Gate de publication et information

La politique publique actuelle annonce un préavis email de 30 jours pour
une modification substantielle (`public/privacy/index.html:206` et version
anglaise correspondante). L'opt-in technique n'atteste pas à lui seul que ce
préavis est respecté ou inapplicable. Aucun email, modification de politique
publique ou démarrage de collecte n'est autorisé par cette ADR.

Avant d'ouvrir le gate : faire valider la notice et l'application de cet
engagement par le responsable de traitement, avec revue professionnelle
recommandée ; synchroniser les quatre copies FR/EN Markdown/HTML ; fixer et
prouver la date d'effet et, si applicable, l'information préalable. Ne pas
affaiblir la politique existante pour gagner du temps. Le guide de conformité
a fait ajouter cette étape ; il ne constitue pas une validation juridique.

La [CNIL décrit les conditions du consentement](https://www.cnil.fr/fr/les-bases-legales/consentement),
notamment information, choix spécifique et retrait. Cette référence justifie
le contrôle explicite ; elle n'atteste ni nos contrats Cloudflare ni l'ensemble
des traitements déjà présents dans Arty.

### Collecteur borné, pas journal de personnes

POST fermé : version, parcours constant, résultat enum, plateforme Web.
Aucun horodatage client, ID d'événement/conversation/participant, email, modèle,
nom de fichier, texte ou erreur libre dans la projection stockée. Auth Google
stricte uniquement pour autoriser la requête, sans consommation de quota IA.
Lecture du corps réellement bornée avant JSON, y compris longueur mensongère.

Une ligne D1 par jour UTC, six compteurs et total plafonné à 10 000. Une seule
instruction UPSERT conditionnelle incrémente le bucket et son total : pas de
SELECT puis incréments indépendants, ni ticket de réservation nécessaire.
Ce plafond borne les admissions, pas tout coût HTTP/authentification. Le
limiteur IP existant reste par isolate ; aucune résistance Sybil revendiquée.
La date est celle de l'admission SQL serveur. Aucune dimension libre.

Les agrégats ne conservent aucun lien permettant de retrouver la contribution
d'un compte ; le retrait arrête les futurs envois, il ne retranche pas un ancien
compteur. La politique et l'option doivent l'expliquer avant activation.
Aucune échéance de purge personnelle fictive : il n'y a pas ici de journal
individuel, et aucun nouveau cron n'est nécessaire pour ces compteurs fixes.

Référence primaire consultée : [API D1](https://developers.cloudflare.com/d1/worker-api/d1-database/).
Les exemples de Sessions/limites de certains anciens guides locaux ne sont
pas utilisés. Le binding DB existant est conservé, aucun nouveau service.

### Rapport dans le même lot

SQL → agrégat strict → HTML/CSV/JSON local, comme le rapport wallet mais sans
mélanger leurs dénominateurs. Fenêtre UTC, snapshot et compteurs intègres ;
schéma absent, erreur ou réponse tronquée = indisponible, jamais faux zéro.
Libellé : déclarations facultatives reçues. Ni utilisateurs uniques, ni taux
global de réussite, ni absence d'usage déduite de l'absence de déclaration.
Consentement, scopes exclus, jetons expirés, fermeture/panne et plafond
biaisent l'échantillon. Les succès/erreurs sont déclarés par le client, pas
des résultats métier certifiés par le collecteur.

## Options écartées et exigences suivantes

- Réutiliser streak, acquisition, quota ou retour checkout : faux oracle.
- Journal personnel/cohorte silencieux : nouvelle collecte et effacement à
  définir, pas une conséquence implicite de « sans contenu ».
- D7/D30 : choisir compte vs installation, activation qualifiante, jours UTC
  exacts, maturité des cohortes, suppression et fermeture des écritures tardives.
  Une purge opportuniste ne garantit pas une suppression physique à J45.
- Conversion : preuve prospective de paiement réel/test et attribution exacte,
  remboursements distingués ; ni VIP/BYOK ni plan affiché ne prouvent un achat.

Ces exigences restent ouvertes dans le CDC. L'accès de configuration Cloudflare
expiré bloque la synchronisation distante, pas ce collecteur sur le binding DB
déjà déployé. Ne pas créer de secret/binding/cron en contournant cet accès.

## Plan de tests bloquants

1. Vrai guide/revue/transport synthétique/finaliseur/collecteur/rapport ; aucun
   réseau avant participation, résultat enregistré et corpus inchangé.
2. Stop, réponse blanche, erreur, quota LS, notifications/abort réentrants,
   double callback, R1/R2 et remplacement du même ID ; pas de seconde issue.
3. Annulation avant fournisseur, discard, fermeture et démontage ; jamais
   de fausse erreur ni de beacon lors d'une fermeture.
4. Consentement absent/malformé, activation tardive, OFF→ON, retrait échoué ;
   compte A→B→A, crypto/fence IDB/document perdus avant dispatch : zéro POST.
5. Jeton expiré ou refresh déjà en attente : pas de nouveau refresh ni attente.
   Rejet Google, corps chunké trop grand, champs libres : zéro incrément.
6. Vrai D1 isolé, concurrence au plafond et buckets différents ; panne et
   commit sans ack, aucun retry. Inspection des sorties sans donnée individuelle.
7. Rapport sans données/avec zéro/capacité atteinte, dates et entiers incohérents,
   rendu FR/EN et petits écrans ; local verify puis CI/Pages avant livraison.

## Preuves locales et reste à faire — 6 septembre

- Premier `npm run verify` : 323 suites, 4 176 tests réussis, 1 ignoré ; typecheck,
  build, contrôles no-CASA/add-on et worker Office réussis. Journal ignoré
  `.playwright-mcp/product-measurement-verify.log`. Ce passage précède les
  derniers correctifs UI de réessai et le gate de publication : ne pas le
  présenter comme une validation finale de la branche.
- Vrai guide + scope de préparation Claude **et** Mistral : `saved` reçu une
  seule fois après sauvegarde, pas de discard induit par notre propre commit.
- Recette interface → guide → transport HTTP synthétique → finaliseur →
  collecteur → SQL → rapport : `useClientReply.measurementRoundTrip.test.tsx`.
  SQLite local dans cette recette, pas D1 : le proxy synchrone Miniflare n'est
  pas compatible avec les globals jsdom. Test D1/workerd séparé du même
  collecteur dans `d1.productMeasurement.test.ts`, concurrence au plafond,
  rollback sur panne, authentification stricte réelle avec Google simulé.
- Tests service : scopes compte/crypto, fence IDB, OFF→ON, retrait quota,
  réentrance A→B lors d'abort, jeton expiré/refresh déjà en attente, fermeture
  après mise en file et retour visible ; aucun fournisseur réel appelé.
- Objections intégrées : garde du préfixe après commit ; finalisation dans
  un stream remplacé ; abandon pré-adoption ; propriétaire capturé avant
  abort ; doublons JSON du consentement ; retrait non enregistré survivant
  au remount avec réessai OFF explicite.
- Dernier snapshot : deux GO techniques indépendants après correction du
  retrait, puis `npm run verify` final réussi : **325 suites, 4 181 tests
  réussis, 1 ignoré**, typecheck/build/no-CASA/add-on/worker Office réussis.
  Journal local `.playwright-mcp/product-measurement-verify-final.log`.
- Recette Chrome locale du pilote prospectif : FR/EN, 390/1280 px, commande
  clavier, quota OFF, remount des paramètres, retry explicite et OFF durable,
  rapport lisible à défilement horizontal contenu. Aucun appel API et aucune
  erreur de page, 6 septembre 16:27:48–50 UTC. Flag ouvert uniquement dans la
  réponse du serveur local interceptée pour le test ; source toujours fermée.
  `.playwright-mcp/product-measurement-browser.mjs` et `.log`, captures
  `product-measurement-{fr,en}-{390,1280}.png` et variantes `withdraw`/`report`.
  Pas de téléphone physique ni de collecte Google/prod pour ces recettes.
- PR #479 ouverte. Son premier passage CI `34046137950` échoue avant cinq
  tests au chargement ESM de `node:sqlite` sous Node 22.23.2 (Android et Pages
  réussis). Reproduit sous ce Node exact ; import natif via `createRequire`
  uniquement dans le test, véritable SQLite conservé. Aucune exclusion de
  suite, réduction de couverture ou modification de la CI. [Documentation
  Node 22 : SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).
- Recette Office réelle App/Chrome pré-fusion : défaut Stop antérieur détecté,
  corrigé à la frontière événement DOM après deux contre-revues. Nouveau test
  vrai composeur + vrai hook rouge→vert, Chat/Home, voisin non annulé et
  partiel conservé. Recette imports/historique/retry/Stop clavier/exports :
  `OFFICE_BROWSER_RECIPE.md`. Aucun changement du gate de mesure.
- Vérification complète après ces corrections sous Node 22.23.2 : **326 suites,
  4 185 tests réussis, 1 ignoré**, typecheck/build/no-CASA/add-on/worker Office
  réussis. Journal `.playwright-mcp/product-measurement-verify-node22.log`.
  Repli `36d432d` compatible avec #478, mais réintroduirait le défaut Stop.
- À terminer : notice et décision de publication, puis nouvelle CI/Pages dans le
  périmètre retenu. Aucun résultat de production W10 n'est attesté ici.
  D7/D30, activation/cohortes et conversion restent ouverts.
