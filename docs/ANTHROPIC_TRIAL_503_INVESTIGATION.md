# Enquête ciblée : essai épuisé, 503 au lieu de 409

## Reprise : observation du cas original et comparaison des moteurs

Le test original des six changements de financement est désormais instrumenté
par `admissionTrace.ts` : SQL, préparation/bind, programmation/déclenchement/
annulation du vrai timer de 250 ms, réponse avant règlement et état financier
avant les assertions. Les handles et délais réels sont conservés. L'oracle
reste strictement 409 ; les assertions gagnent le contrôle du wallet et des
rejets SQL/background. Six cas réussis, 51 autres non sélectionnés ; le test
trial-to-wallet a annulé son timer après environ 117 ms, sans déclenchement.

Une expérience supplémentaire exécute quatre paires dans un ordre alterné :
le même handler, la même requête et la même instance D1, depuis Node puis
depuis workerd. Aucun ralentissement injecté. Les huit appels répondent 409,
sans déclenchement du timer ni modification financière. Quatre tests réussis.

Miniflare expose à Node un proxy D1 : certaines opérations franchissent un
pont synchrone utilisant `Atomics.wait` (version installée, `index.js`,
`getD1Database`, `#syncCall`, `SynchronousFetcher`). Le handler natif utilise
directement son binding D1 dans workerd. L'expérience complète prend localement
619–643 ms côté Node contre 29–38 ms côté workerd. Ces chiffres incluent le
règlement et les cinq lectures de contrôle financier : ils ne représentent
pas la latence d'admission et ne mesurent pas une accélération du produit.
Les horloges internes des moteurs ne sont pas assimilées à une seule horloge.

Conclusion : un effet de la topologie du banc est mesuré ; aucun nouveau
timeout spontané n'est reproduit. L'origine de la CI historique reste inconnue.
Deux contre-revues acceptent l'instrumentation et ces limites. Une seule
nouvelle CI est justifiée pour recevoir les traces du cas original sur le
runner réel ; aucune modification applicative, de deadline ou d'oracle.

Preuves locales : `.playwright-mcp/original-admission-traced.log`,
`original-admission-traced-tests.json`, `admission-topology.json` et
`admission-topology-tests.json` dans le même dossier. Leurs résultats sont
distincts de la CI complète, encore à recevoir pour cette instrumentation.

## Enquête précédente

8 septembre 2026. Code applicatif examiné : `51b846a`, PR #500.
La CI historique reste en échec : 5806 tests réussis, un échec, un ignoré.
Cette enquête ne déploie rien et ne modifie aucune protection applicative.

## Conclusion

Le dépassement du délai d'admission reproduit le symptôme, sans débit dans les
scénarios contrôlés. Il reste une cause plausible de la CI historique, pas une
cause rétrospectivement prouvée : une erreur SQL ou un résultat corrompu
produisent aussi le même 503. Le log historique ne contient ni le body de ce
503 ni les opérations D1 nécessaires pour départager ces causes.

Dans ce scénario, la présence d'un portefeuille positif ne doit pas entraîner
sa lecture : le refus intervient avant tout accès au portefeuille.

## Chemin observé

Identité Google synthétique valide → abonnement trial → création de table
idempotente → INSERT conditionnel sans modification car `used=30` → SELECT
confirmant `used=30` → essai épuisé → refus `409 continuation_funding_changed`.

`consumeTrialCounter` dans `functions/api/_lib/trialAdmission.ts` couvre les
deux opérations sous une deadline de 250 ms. Si leur résultat n'est pas disponible
à temps, il renvoie `unavailable` ; `functions/api/ai/proxy.ts` répond alors
`503 admission_unavailable`. Il conserve la promesse du travail tardif via
`waitUntil`, sans relancer l'opération ni autoriser un appel fournisseur.

La durée totale du test ou de la requête ne prouve pas le timeout : identité,
lecture du plan et préparation initiale sont hors de cette fenêtre. Le témoin
de cette enquête répond 409 après environ 415 ms pour la requête entière,
mais environ 134 ms depuis le début de l'exécution de l'INSERT.
Cette dernière mesure est un repère, pas une instrumentation interne du timer.
Les préparations et liaisons des statements sont aussi tracées : leur coût
local s'ajoute à celui de l'exécution SQL et dépend du harnais Miniflare/workerd.

## Expériences indépendantes sur D1 locale

Une invocation par scénario, pas de retry jusqu'au succès. Authentification et
fournisseur synthétiques ; mêmes handlers et primitives d'admission que la PR.
Les retards portent sur la restitution des réponses SQL, sans modifier la
deadline de production ou accepter plusieurs statuts pour le témoin nominal.

| Scénario | Résultat exigé et obtenu |
| --- | --- |
| Aucun défaut injecté | 409, catégorie de financement changée |
| Réponse de l'INSERT retardée de 350 ms | 503, admission indisponible |
| Réponse du SELECT retardée de 350 ms | 503, admission indisponible |
| Chaque réponse retardée de 150 ms | 503, délai cumulé dépassé |
| Erreur SQL sur l'INSERT | 503, admission indisponible |
| SELECT renvoyant un compteur corrompu | 503, admission indisponible |
| Erreur SQL sur la lecture du plan | 503, admission indisponible |

Après règlement des promesses D1 exactes et des travaux background, chacun
des sept scénarios atteste : compteur toujours à 30 et horodatage inchangé,
portefeuille inchangé, aucun crédit réservé, aucune réservation ou ticket
budgétaire et aucun appel fournisseur. Les rejets injectés sont comptés ;
les travaux background se terminent sans rejet. Ces résultats concernent ces
expériences, pas l'état financier du cas historique dont l'assertion de statut
interrompait les vérifications suivantes.

Validation finale : **7 tests réussis en 17,63 secondes**. Une première campagne
de sept tests avait validé les injections ; la seconde ajoute la mesure de
prepare/bind et l'inspection explicite des rejets. Aucune campagne complète.

## Preuves et reproduction

Test conservé : `src/__tests__/functions/d1.trialFundingDiagnostic.test.ts`.
Rapports locaux ignorés par Git :

- `.playwright-mcp/trial-funding-investigation-detailed.json` : ordre, résultats,
  durées, body et état financier après règlement ;
- `.playwright-mcp/trial-funding-investigation-detailed-tests.json` : verdict Vitest ;
- `.playwright-mcp/ci-34228631794-failed.log` : échec historique, inchangé.

```powershell
$env:ARTY_TRIAL_DIAGNOSTIC_REPORT = '.playwright-mcp/trial-funding-investigation-detailed.json'
npx --no-install vitest run src/__tests__/functions/d1.trialFundingDiagnostic.test.ts --maxWorkers=1
```

## Ce qui reste ouvert

L'origine exacte du 503 historique ne peut pas être récupérée depuis les logs
existants. Pour la prochaine reproduction du cas original en CI, il faut
capturer son body, l'ordre/durée/résultat des opérations D1 et son état financier
après règlement, avant l'assertion de statut. Ne pas annoncer une CI réparée,
augmenter arbitrairement les 250 ms, ignorer le test ou remplacer 409 par
« 409 ou 503 ». Les exigences budgétaires de publication restent distinctes.
