# W10 — consommation technique wallet, rapport opérateur

6 septembre 2026. Premier lot validé localement, publication à confirmer ; pas W10 complet. Aucune collecte ajoutée,
aucun tableau d'administration public, aucune modification du wallet ou de ses
droits. Lecture seule d'agrégats, rendu local sans réseau.

## Question réellement traitée

Sur une fenêtre de **mouvements UTC** donnée, quels débits du registre possèdent
un coût technique enregistré avec usage explicitement déclaré mesuré, et quelle
part des lignes ne permet pas cette lecture ? L'écart entre ces débits et leurs
coûts peut être négatif. Ce n'est ni une marge commerciale, ni un revenu ou une
facture fournisseur rapprochée. Devise : USD, stockée en micro-USD, sans conversion.

Le writer `functions/api/_lib/wallet.ts` calcule avec les tarifs du code au moment
du règlement ; ses métadonnées `usageMeasured: true` ne prouvent pas à elles seules
la justesse des factures. `creditPricing.ts` n'inclut pas tous les coûts annexes,
et `pricing.ts` possède des tarifs de repli. Aucun recalcul historique au tarif
actuel dans ce rapport. Les appels hors wallet ou sans règlement réussi sont absents.

Les dates sont celles de l'insertion au registre, après le traitement/règlement,
pas celles du début de requête. Un règlement tardif peut modifier une période
passée ; une fin future ne rend pas la période close. Le snapshot est horodaté
par le SELECT. Dans un fichier importé, cet horodatage et la provenance ne sont
**pas attestés** par le moteur de rendu.

## Contrat et qualité des données

Une seule requête SELECT, sans création de table/index, mutation ni
`ensureWalletTables`. Le schéma runtime existant de `credit_ledger` est utilisé.
Fenêtre `[début inclus, fin exclue)`, dates canoniques UTC, 1 à 31 jours.

La lecture est plafonnée à 100001 lignes du **registre global avant filtre**.
Au-delà de 100000, le validateur refuse tout rapport : pas d'échantillon présenté
comme complet, pas de somme partielle publiée. Choisir moins de jours ne résout
pas cette limite globale. Matérialisation des seuls scalaires classifiés
(catégorie et INTEGER/NULL validés), pas du metadata brut ;
aucune promesse de borne exacte RAM, coût SQL ou latence D1. L'index actuel commence
par l'adresse utilisateur, pas par la date ; ce lot n'ajoute pas d'index.

Les lignes se répartissent exactement entre dates inassignables globales, dates
hors fenêtre, autres mouvements dans la fenêtre et quatre catégories de débits :

| Catégorie | Condition | Incluse dans les montants affichés |
|---|---|---|
| Déclaré mesuré | montant INTEGER ≤0, coût INTEGER ≥0, JSON objet valide, booléen true exact, aucun fallback | Oui, débit et coût des mêmes lignes |
| Sans indicateur | coût connu, indicateur absent, aucune contradiction ; ancienneté non attestée | Non |
| Inconnu | coût SQL NULL et absence d'indicateur, ou false sans contradiction | Non |
| Incohérent | type/signe/indicateur contradictoire, JSON invalide ou ambigu | Non |

Les bornes sont les entiers sûrs JS, individuellement puis sur les sommes.
`SUM` ne reçoit que des INTEGER ; sa sortie est convertie en texte décimal pour
éviter la perte de précision JSON/D1. Débordement SQLite ou JS : indisponible,
jamais flottant de secours ou faux zéro. Un vrai coût mesuré nul reste zéro ;
aucune ligne mesurée donne **montants indisponibles**, pas un coût inconnu nul.

Meta : texte RFC JSON objet, 8192 octets maximum, clés racines uniques, sans NUL
décodé. Les booléens numériques/chaînes sont exclus. `json_each` et égalité BINARY
évitent l'assimilation d'une clé contenant NUL à `usageMeasured`. Cette confusion
a été reproduite localement sous SQLite 3.51.2 avec JSON PATH ; aucune version
D1 distante n'est inférée. Dates non canoniques, nulles ou normalisées vers un
autre jour : inassignables, jamais noyées dans le dénominateur de la période.

Aucun email, modèle libre, identifiant, ref_id, metadata ou contenu utilisateur
dans la projection retournée. Les trois rendus partagent le même agrégat strict,
revalidé à chaque appel : HTML sans scripts/ressources/formulaires, CSV à libellés
fixes et nombres validés, JSON structuré. Un import valide ne prouve pas une
extraction authentifiée. Schéma absent, erreur SQL, réponse D1 incomplète ou fichier
contradictoire ne produisent aucun rapport de remplacement.

## Utilisation locale

Le CLI `scripts/wallet-measurement.mjs` ne fait **aucun appel réseau**.
`--output` crée exclusivement un fichier nouveau ; un fichier existant est refusé.
Sans ce paramètre, le résultat est retourné sur stdout. Exemple de génération :

```powershell
node scripts/wallet-measurement.mjs sql --from 2026-09-01 --to 2026-10-01 --output wallet-query.sql
```

L'opérateur authentifié exécute ce SELECT via la connexion D1 déjà autorisée de
son projet, puis enregistre **seulement la réponse agrégée**. Wrangler documente
`d1 execute <nom-ou-binding> --remote --file <requête.sql> --json` ; vérifier le
nom et l'environnement, la version installée et les droits avant toute exécution.
Ne pas créer de configuration racine Pages, ne pas réutiliser une clé VIP comme
rôle administrateur et ne pas extraire des credentials d'une autre session pour
contourner un accès expiré. Ce lot ne déclenche pas l'exécution distante.

```powershell
node scripts/wallet-measurement.mjs render --input wallet-aggregate.json --format html --output wallet-report.html
node scripts/wallet-measurement.mjs render --input wallet-aggregate.json --format csv --output wallet-report.csv
node scripts/wallet-measurement.mjs render --input wallet-aggregate.json --format json --output wallet-report.json
```

Entrée : objet agrégé exact ou enveloppe Wrangler d'une seule requête réussie,
avec une seule ligne ; 64 Kio maximum, lecture bornée depuis un seul descripteur.
Ne pas fournir un export du registre brut. Le JSON rendu est un **rapport enrichi**,
pas un agrégat d'entrée : produire les trois formats depuis le même fichier D1.
Les erreurs CLI sont génériques, sans données ni chemins d'entrée, exit 1 et
stdout vide. Ces rapports opérateur ne doivent pas être publiés sur le site.

## Ce qui ne peut pas être conclu

Activation, succès métier, D7/D30, conversion et préférence face à Mammouth restent
**non instrumentés** par ce lot. Les compteurs existants `quota_model.count` ne
constituent pas un journal idempotent de parcours réussis ; les historiques locaux
et les données d'acquisition ne sont pas une cohorte consentie de rétention.
Il n'existe pas de métrique fiable à déduire rétroactivement de ces compteurs.

Étape W10 ultérieure : définir des événements minimaux sans contenu, leurs bases
d'usage, leur rétention/suppression, dédoublonnage, cohorte et consentement avant
collecte. Les hypothèses de performance du CDC restent des cibles, pas des chiffres
acquis. W06 reste OFF ; ce rapport ne change aucun parcours utilisateur.

## Validation du candidat

Deux contre-revues readonly pré-code, produit et sécurité, ont fixé coût déclaré
vs facture, date de mouvement, sous-ensemble commun, capacité globale, types JSON,
NUL, dépassements, erreurs non converties en zéro et absence de PII.

67 tests ciblés passent : Node SQLite en mémoire et D1 Miniflare isolé avec
le **vrai writer** (mesure nulle, réservation inconnue, débit plafonné/écart négatif).
Le harnais SQL a d'abord échoué sur un libellé BigInt et un placeholder de fixture
en trop ; ils ont été corrigés, aucune erreur produit masquée. Le vrai CLI réalise
`sql → SQLite → enveloppe D1 → HTML/CSV/JSON` à partir d'un même snapshot ;
refus d'écrasement, fichiers invalides et bornes de lecture sont vérifiés.

Deux GO finaux readonly après correction des réévaluations SQL et de la lecture
stat/puis readFile non bornée : matérialisation des petits scalaires seulement,
un descripteur et un buffer de 65537 octets. Tests de lectures partielles, croissance,
64 Kio pile/+1, fermeture en erreur et 100000 débits mesurés denses réussis.

`npm run verify` final exit 0 : **312 suites / 3890 tests réussis + 1 sauté**,
typechecks front/back, no-CASA, build et worker Office réel isolé. Couverture
globale 71,58 / 66,42 / 77,24 / 73,44 %. Ce lot hors bundle ne prétend pas augmenter
la couverture des écrans. Log ignoré `wallet-measurement-verify-final.log`.

Exemple **synthétique**, trois rendus locaux issus du même agrégat : recette Chrome
isolée 390/1280 px à 11:49:13.353 UTC, sans JavaScript, aucun débordement ou appel
externe. Capture 1280 px inspectée visuellement. HTML volontairement documentaire,
pas un nouvel écran public Arty. Fichiers ignorés `wallet-demo.{html,csv,json}`,
`wallet-demo-{390,1280}.png` et `wallet-measurement-demo.log` dans `.playwright-mcp/`.
Publication : [PR #475](https://github.com/flotellop-art/Arty/pull/475), squash
`ff118b426ab2572465edeab981e5d89fe4415db5` le 6 septembre à 12:00:17 UTC.
CI PR `34031528936` et main `34031826279` réussies. Pages main
`9edef9f5-c0f4-4dcf-824a-35a762b9bd63` réussi à 12:01:13 UTC.
GET anonymes de tryarty.com et de cette version immuable à 12:05:32–33 UTC :
guide FR/EN/CSS/SW et six assets de l'application identiques. Cela vérifie les
artefacts web, pas un nouveau tableau de bord ni des métriques réelles.

Android/Firebase `34031826128` : première tentative arrêtée sur le délai de
250 ms de `reserveCredits` dans la fixture D1 (`db_unavailable`), pas sur le SQL
du rapport. Le test isolé a repassé ; relance intégrale du job sans modifier
le délai de production ni retirer un test, réussie (tentative 2). Identité APK
vérifiée à 12:14:06 UTC, distribution Firebase à 12:14:13 UTC et reçu JSON
téléversé à 12:14:14 UTC. Installation physique non attestée ; aucun reçu APK
téléchargé pour ce lot. Le premier échec demeure dans l'historique CI.

Aucune donnée de production extraite ni mesure commerciale réelle présentée.
Sources primaires consultées le 6 septembre 2026 :
[D1 JSON](https://developers.cloudflare.com/d1/sql-api/query-json/),
[Wrangler D1](https://developers.cloudflare.com/d1/wrangler-commands/),
[SQLite JSON](https://www.sqlite.org/json1.html),
[SQLite agrégats](https://www.sqlite.org/lang_aggfunc.html).
