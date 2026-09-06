# Socle Google W08 — vérification et livraison

6 septembre 2026. Base main `d80efb4` (#462). **Livré sur le web et distribué en
APK Firebase par #463**, contrôles main réussis. Aucun transport Agenda ni
parcours W08 validé par ce lot.

## Périmètre

- Baux Google liés au propriétaire, à la session, au grant monotone et à la
  crypto. Reconnexion identique, ABA, logout et changement crypto ne réarment
  pas un ancien bail. Réponses tardives refusées avant logout/reconsent/write.
- Chaque essai refresh partage HTTP et commit ; le getter garde ses retries,
  l'appel direct son essai unique. Aucune publication RAM avant persistance,
  résultats défensifs, et effacement Google autorisé toujours possible.
- BYOK : vérification de provenance sous ancienne clé, transfert chiffré strict
  avec marqueur durable avant commit API, compensation CAS et fermeture après
  interruption. La reconnexion fraîche est une issue testée après reload.
- Hook : intention initiale et reçus de writers réellement commencés, contrôles
  entre les étapes et avant nettoyage/UI ; aucun cleanup R1 sur un grant R2.

Le nouveau marqueur scoped est reconnu par l'inventaire de propriété. Aucun
algorithme/enveloppe AES, scope OAuth, tarif, droit VIP, secret configuré,
signature APK, endpoint serveur ou activation W06 n'est changé.

## Preuves locales

- [x] Reproductions rouges initiales : 14 courses/provenance, deux cas de
  refresh direct avant durabilité et deux sauvegardes BYOK avant correction.
- [x] `npm run verify`, 6 septembre à 05:18:55 Europe/Paris : 273 suites,
  **3 303 tests réussis, 1 ignoré** ; typechecks frontend/functions, no-CASA,
  addon, build et worker Office isolé réussis. Couverture globale
  69,06 % statements / 64,05 % branches / 74,80 % fonctions / 70,81 % lignes.
  Avertissement existant de taille de chunks ; pas assimilé à un échec.
- [x] Tests permanents : `googleGrantRace`, `ApiKeysModal.session`,
  `useGoogleAuth.grantRace`, `useGoogleAuth.reconsent`,
  `documentWorkspacePersistence`. Crypto réelle, réseau fictif, données
  synthétiques ; coupures 0/1/2 écritures, pending malformé, quotas, ABA,
  effacement block/release, perte du vrai document et nouveaux modules.
- [x] Recette Chromium jetable à 03:22:05 UTC, 390×900 et 1440×900 : vraies
  ApiKeysModal/ApiKeySetup, hook, crypto et stockage ; sauvegarde même clé puis
  autre clé, ancien bail refusé, reload connecté. Réseau bloqué, zéro erreur
  JavaScript et zéro débordement horizontal. Pas une recette App complète,
  Google OAuth réel, fournisseur facturé ou installation APK.
- [x] Deux contre-revues indépendantes readonly : produit/UX et
  sécurité/lifecycle ; objections examinées et corrigées, GO limité auth
  sous condition de verify, désormais satisfait.
- [x] `git diff --check` ; fichiers marketing utilisateur exclus de la livraison.

## Livraison à attester séparément

- [x] PR #463, head `cf0e37d5ab27d8b3a21d0bc40d0a11d55a6411a1`,
  CI `34008889873` réussie (verify-app terminé à 03:28:54 UTC).
- [x] Fusion normale squash à 03:29:29 UTC,
  main `2da5735e01c62a8899b537f1f452cd9536983a2d`.
- [x] CI main `34009120936`, verify-app terminé à 03:34:22 UTC :
  273 suites / 3 303 tests réussis / 1 ignoré. Couverture CI :
  69,07 / 64,06 / 74,77 / 70,82 %. Android et growth également réussis.
- [x] Pages production réussi ; mêmes octets d'assets sur domaine canonique
  et déploiement immutable, y compris présence du marqueur/texte de reprise.
- [x] APK signé puis upload Firebase réussi. Cela ne prouve pas une
  installation physique, une publication Play Store ou une connexion Google.

Pages production `4682e2dd-9a9d-4c2f-933e-463b47cf2e83`, terminé à
03:30:56 UTC. GET publics sans redirection à 03:31:16.168 UTC :
`https://tryarty.com` et `https://4682e2dd.appfacade.pages.dev` identiques.
Second contrôle identique à 03:36:39.047 UTC, sans session ni requête privée.

| Asset servi | Octets | SHA-256 |
|---|---:|---|
| `index-DFBpdrbj.js` | 292 103 | `419d7f66f4b2b4726265fd51deb1868055d7a1cdbe68aebe368da1a7d6929231` |
| `App-BIZ28alF.js` | 882 216 | `187b97ad6c27bec6d03c54588bcd1c768abe84df6e5d9cd573f03c131e51b714` |

Marqueur de transfert et clé de texte de reprise présents dans les assets.
Préversion `e16270a7-2c1c-409c-bfc8-114fe4eebe05` également vérifiée avant fusion
à 03:25:54.572 UTC ; ce n'est pas le reçu production. APK run `34009120945`
sur le même SHA main : build signé à 03:36:58 UTC, distribution Firebase et
nettoyage des fichiers secrets réussis à 03:37:05 UTC, job terminé à 03:37:07.

## Surveillance et reprise

Déclencheurs : échec de bootstrap/reconnexion ou perte d'un grant après une
sauvegarde BYOK, asset canonique différent du déploiement attesté, échec CI ou
distribution. Arrêter la promotion en cas d'échec avant fusion. Après fusion,
privilégier une correction compatible ; **ne pas revenir aveuglément à un
bundle ignorant `google-crypto-transfer-pending-v1`**. La fermeture durable
n'est garantie que pour les lecteurs compatibles. Ne jamais retirer ce marqueur
ou supprimer des blobs pour donner l'apparence d'une récupération réussie.

Une sauvegarde API déjà committée n'est pas annulée par une erreur Google : le
message dirige vers Accueil → Agenda → reconnexion. La paire localStorage n'est
pas atomique ; les copies anciennes peuvent rester protégées sous l'ancienne
clé. Pas de restauration implicite des autres caches ni de nouvelle autorité
Google depuis un document. Pour continuer W08, raccorder le transport et les
consentements Agenda selon `ADR_WORKFLOW_AGENDA_OWNERSHIP.md`.
