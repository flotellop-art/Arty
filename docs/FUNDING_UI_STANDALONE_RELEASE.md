# Refus d'essai et de crédits — lot autonome

7 septembre 2026. **Candidat local non publié, vérification complète en cours.**
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
- `npm run verify` lancé sur `25526ec` avec deux workers, code/tests gelés.
  Résultat terminal encore à renseigner. Le rapport d'un autre candidat ne
  qualifie pas ce port et n'est pas recopié comme preuve de livraison.

Le réseau fournisseur/Google est synthétique dans les tests. Le cycle chiffré
de grant local et le hook hybride sont réels ; Claude est un dispatch observé.
La capture avec propriétaire inaccessible utilise un getter simulé qui lève.
Pas de recette de la bannière App complète, navigateur authentifié ou téléphone.

## Livraison et limites

Deux contre-revues indépendantes ont donné GO local sur `25526ec`, en vérifiant
l'ascendance publique, l'absence des lots exclus et les cinq cas d'adoption.
Leur GO ne remplace pas la campagne complète encore en cours. La CI du
dépôt vérifie et construit sans migration distante. Pages/bindings sont
configurés hors dépôt : l'isolation D1 d'une preview n'est pas attestée ; ne
pas y exécuter de login/paiement/test IA réel sur la supposition d'une sandbox.
Une fusion main déclenche aussi la construction/distribution Firebase prévue
par le dépôt. Aucun push, PR ou déploiement à ce stade ; aucun contournement
de l'arrêt d'authentification de l'inventaire D1 distant.
