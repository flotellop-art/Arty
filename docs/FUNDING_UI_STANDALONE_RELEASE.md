# Refus d'essai et de crédits — lot autonome

7 septembre 2026. **Candidat local validé, non publié.**
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
par le dépôt. Aucun push, PR ou déploiement à ce stade ; aucun contournement
de l'arrêt d'authentification de l'inventaire D1 distant.

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

Après qualification locale et CI du lot exact, la livraison devra vérifier
l'identité du bundle public, les mêmes sondes anonymes et le résultat distinct
du workflow Android. Sur régression attribuable au lot (chargement, droits
courants ou isolation intercomptes), revenir au déploiement production précédent
ou révoquer le delta par Git ; ne pas réinitialiser les compteurs ni les données.
Les sondes publiques ne remplacent pas une recette connectée et ne fournissent
pas de télémétrie générale des erreurs/latences.
