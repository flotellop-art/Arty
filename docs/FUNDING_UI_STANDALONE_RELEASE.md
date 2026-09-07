# Refus d'essai et de crédits — lot autonome

7 septembre 2026. **Web livré par PR #495, observation terminée et APK distribué
par Firebase ; recette physique non effectuée sur cette version.**
Base publique `2e0504ee7c2ab5e70cf50c06f9974c38250ebd89` ; branche
`codex/funding-ui-release-20260907`. Delta fonctionnel `5a1e035`, adaptation
autonome `25526ec`. Aucun droit marchand ou plafond financier activé.

## Exigences et effet

1. Refus exact 403 `trial_expired` : texte FR/EN compréhensible et compteur zéro
   réservé au compte/grant/invocation encore courant. Les anciens headers et
   anciens refus sont retirés par révision ; une nouvelle vérification peut
   attester une compensation serveur. Aucune réduction des 30 messages.
2. Refus exact 409 `wallet_reconciliation_pending` : badge et accès financés
   par crédits fermés immédiatement, anciennes lectures retirées, aucune
   suppression des montants ou des droits VIP/abonnement/Pro. Aucun portefeuille
   inventé si le client ne possédait pas de snapshot vérifié.
3. Aucun retry Mistral forcé ni continuation Gemini→Claude après ces refus.
   Le secours d'une recherche ordinaire en panne demeure. Les replis OpenAI
   modèle/outils revérifient l'invocation après lecture du corps et avant HTTP.
4. Le cache optionnel des compteurs ne ressort pas une ancienne valeur positive
   quand le stockage échoue. Override RAM par propriétaire, supprimé à la
   prochaine écriture réussie. Transport pré-login et signatures existants
   conservés : l'adoption garde ses exceptions, dont celle de suppression du
   tampon ; une écriture scoped réussie remplace l'ancien override.
5. Le message vocal 429 ne promet plus Pro/illimité. L'UI ne confond pas un
   rate-limit fournisseur avec le quota gratuit quotidien ; le texte du quota
   serveur connu conserve sa précision. Aucun nouveau budget vocal annoncé.

## Séparation vérifiée

Pas de changement de schéma, migration, binding, environnement, dépendance npm,
workflow, checkout, webhook, retenues partielles, bénéfice Gmail serveur ou
financement vocal. Le seul delta Functions est la chaîne du refus quotidien
dans `functions/api/ai/tts.ts`. Les contrats trial/wallet étaient déjà présents
dans la base publique. Les corrections de cache restent de la présentation,
jamais une preuve de droit serveur.

Les anciens mécanismes de bienvenue/transport pré-login ne sont pas corrigés
par ce lot. Le regroupement des alias Gmail, la protection multi-comptes, les
abonnements/crédits opérationnels et W01–W10 restent des obligations distinctes.

## Réception de cet arbre

- Typechecks frontend/serveur PASS sur le port initial.
- **82 tests PASS / trois suites, 12,28 s** : 76 parcours composés réels
  client/cache/badge/plan, trois hooks hybrides et trois canaris du cache porté.
- Deux cas d'adoption supplémentaires ensuite : suite cache **5/5 PASS**.
  Ne pas additionner ces sous-ensembles ni les présenter comme la suite complète.
- `npm run verify` sur `25526ec` avec deux workers, code/tests gelés :
  **PASS, exit 0**. 369 suites, **5452 tests PASS et un SKIP**, durée de tests
  799,13 s. Contrôles addon/no-CASA et typechecks PASS ; build 7,17 s ; worker
  Office exécuté dans une VM isolée avec exports synthétiques régénérés PASS.
  Le rapport d'un autre candidat ne qualifie pas ce port et n'est pas recopié
  comme preuve de livraison. Les commits suivants ne changent que ce reçu.

Le réseau fournisseur/Google est synthétique dans les tests. Le cycle chiffré
de grant local et le hook hybride sont réels ; Claude est un dispatch observé.
La capture avec propriétaire inaccessible utilise un getter simulé qui lève.
Pas de recette de la bannière App complète, navigateur authentifié ou téléphone.

## Livraison et limites

Deux contre-revues indépendantes ont donné GO local sur `25526ec`, en vérifiant
l'ascendance publique, l'absence des lots exclus et les cinq cas d'adoption.
Leur GO est complété par la campagne locale complète ci-dessus. La CI du
dépôt vérifie et construit sans migration distante. Pages/bindings sont
configurés hors dépôt : l'isolation D1 d'une preview n'est pas attestée ; ne
pas y exécuter de login/paiement/test IA réel sur la supposition d'une sandbox.
Une fusion main déclenche aussi la construction/distribution Firebase prévue
par le dépôt. La livraison ci-dessous utilise cette chaîne existante ; aucun
contournement de l'arrêt d'authentification de l'inventaire D1 distant.

## Livraison du 7 septembre — PR #495

- CI de PR `34152920063` entièrement verte : application, growth-orchestrator,
  lint/tests/compilation Android et inspections manifest/APK. Build web 11,63 s
  et exports Office VM PASS. Ce contrôle Android porte sur le debug, pas une
  distribution release Firebase.
- Prévisualisation `c63cde47-ca7a-4130-85c8-1d5e98dfaf1b` réussie, source
  `335fa76707cf52331afd9720cdebf530c9f387c4`. À 18:48 UTC : HTML et JS servis,
  wallet anonyme refusé 401. Aucun test connecté ni donnée de preview utilisée.
- Fusion à 18:57:16 UTC : `cac505a30f7358c51dcb35c21062dd8bc82ed246`.
  Arbre Git identique à celui du candidat revu et testé, comparaison vide.
- Pages production réussi : `1202de61-e2e6-4e57-bd6a-a6dffe821947`, lié au
  SHA fusionné par le check GitHub. À 18:59:48 UTC, tryarty.com et l'URL
  immuable servent `/assets/index-C_HK8I33.js`, SHA-256
  `f2b4b96019e286c307fd7df6f65280ee9484f5697271f199d7363d541c101adf`.
- Sondes anonymes : HTML/JS 200 avec types attendus ; wallet 401 et JSON exact ;
  prévol 204 sans redirection sur les deux domaines, origine localhost, méthode
  GET et headers content-type/x-google-token autorisés. Timeout incluant le
  corps, taille de lecture bornée, chaque latence et échec conservé sans retry.
- Observation terminée : **16/16 passages PASS**, du 7 septembre à 18:59:47,703
  jusqu'à 19:14:48,347 UTC, soit **900,644 secondes**, exit 0 ; aucune tentative
  remplacée par un retry. Ces sondes ne prouvent pas l'exécution React, les caches
  PWA, des droits connectés, la disponibilité D1 ou une télémétrie globale.
- CI main `34153688927` entièrement SUCCESS. Firebase `34153688988` SUCCESS :
  vérification, construction signée, contrôle de l'identité exacte, distribution
  et téléversement du reçu d'identité tous réussis. Le reçu allowlisté
  `arty-apk-identity-cac505a30f7358c51dcb35c21062dd8bc82ed246-1` (artefact
  `10030499019`) a été téléchargé et relu séparément, sans télécharger l'APK.
  Il atteste `com.arty.app`, version `1.0.99`/code `100`, **4 427 323 octets**,
  SHA-256 `dc7d027e684e9000463c321f170847e1bfef50c5f83ac6423ccc8072f679e2cd`,
  signature vérifiée et commit `cac505a`. Le numéro de version seul ne suffit
  pas à identifier ce binaire. La preuve de distribution vient de l'étape
  Firebase, pas du JSON seul ; pas d'attestation indépendante de reproductibilité.
- À 19:13:03 UTC, le fichier assetlinks servi par tryarty.com égale le fichier
  vérifié par ce reçu (SHA-256
  `3f6c4530b85bdb3a4b05ea0103e54ec3bd883666c4ef2814690f76ef69ddd78c`). Ce constat
  ne prouve pas la vérification des liens par Android ou un parcours OAuth.
- À 18:49 UTC,
  `adb devices -l` ne détectait aucun téléphone : recette physique absente pour
  ce SHA. Le reçu mobile du 6 septembre concerne une autre version.

Retour arrière possible vers la référence production ci-dessous si une
régression est attribuée au lot. Une autre livraison simultanée impose d'abord
de vérifier la nouvelle source ; ne pas annuler aveuglément le travail d'autrui.
Un retour Pages ne rappelle pas un APK déjà distribué et réintroduit les anciens
défauts UI. Aucun retour arrière ne doit remettre à zéro données ou compteurs.

## Référence publique avant livraison — 7 septembre, 18:40 UTC

La base `2e0504e` a un check Pages réussi, déploiement
`293c6d14-a6a2-407d-a9ec-e4c63389938a`. Les lectures anonymes de
`https://tryarty.com` et `https://293c6d14.appfacade.pages.dev` ont vérifié :

- `/workspace/upgrade` : HTTP 200 ; même entrée `/assets/index-Bz2LA1Xh.js` ;
- SHA-256 du bundle :
  `a3b986c3a01a0f777cd0dba8191e16035cf6f07701c378a6df699214ab3bc62f` ;
- `/api/wallet/balance` sans identité : 401 `Authentication required` ;
- prévol OPTIONS `/api/subscription/status`, origine `https://localhost` :
  204 sans redirection sur tryarty.com et appfacade.pages.dev, origine autorisée.

Ces observations n'attestent ni session connectée, ni droits réels d'un compte,
ni isolation de preview, ni parcours APK. Aucun login, paiement ou appel IA.
Cette référence décrit la version publique **avant** le lot UI, pas sa livraison.

La CI principale de cette base est verte (run `34130086307`), mais le run
Firebase `34130086225` est rouge à « Verify web app and Functions », avant
fabrication/distribution APK : 365 suites passent, une échoue ; 5367 tests
passent, un échoue et un est ignoré. Échec à
`anthropicPreflight.workerd.test.ts:48`, `dispatchFetch` :
`TypeError: fetch failed`, cause `write ECONNRESET`, avant l'assertion 413.
Deux contre-revues indépendantes trouvent plausible une annulation précoce
du corps entrant pendant l'envoi HTTP chunked, mais la cause n'est pas encore
reproduite. Ce test et le lecteur serveur sont inchangés dans le présent lot.
Ne pas transformer une coupure en succès ni annoncer l'APK de cette base livré.
Le nouveau run Firebase de `cac505a` est vert ; cela ne reproduit ni n'explique
la cause du run précédent. Le test et les gardes n'ont pas été assouplis.

Après qualification locale et CI du lot exact, la livraison devra vérifier
l'identité du bundle public, les mêmes sondes anonymes et le résultat distinct
du workflow Android. Sur régression attribuable au lot (chargement, droits
courants ou isolation intercomptes), revenir au déploiement production précédent
ou révoquer le delta par Git ; ne pas réinitialiser les compteurs ni les données.
Les sondes publiques ne remplacent pas une recette connectée et ne fournissent
pas de télémétrie générale des erreurs/latences.
