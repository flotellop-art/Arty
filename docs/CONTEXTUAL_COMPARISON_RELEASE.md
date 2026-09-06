# W07 — checklist de livraison de la comparaison contextuelle

Date : 6 septembre 2026. Base main : `ca31dce` (#461).
État : web livré par #462 ; CI main et distribution APK attestées. Recette
fournisseur/OAuth réelle et installation physique de l'APK non attestées.

## Pré-déploiement

- [x] Deux contre-revues indépendantes readonly : produit/mobile et sécurité/lifecycle.
- [x] Leurs objections ont été intégrées (voir ADR et CDC W07).
- [x] `npm run verify`, `VITEST_MAX_WORKERS=4` : exit 0 ; 271 suites,
  3 234 tests réussis et 1 ignoré, typechecks, no-CASA, build et worker Office.
- [x] Quatre cas supplémentaires ensuite : 54 tests ciblés réussis, sans
  modification du code produit après la verify complète.
- [x] Aucun nouveau store ni migration de base. W06 reste OFF ; aucun nouveau
  scope OAuth, aucun relâchement de quota/plan/EU, aucun changement de clé APK.
- [x] Retours arrière et limites documentés ci-dessous.
- [x] PR, CI et preview vérifiées sur le SHA candidat exact.
- [x] Fusion sans bypass, CI main, production Pages et distribution APK vérifiés.

## Reçus de publication

PR [#462](https://github.com/flotellop-art/Arty/pull/462), head
`8cd65461d641867b4ce48eab40a2d8ba6605ba2f` ; CI PR `34005734631` verte,
271 suites / 3 238 tests verts / 1 ignoré. Preview
`94eecd22-03a9-4407-bc4f-c1d1b4e21d37`, GET lecture seule le 6 septembre à
02:13:36.764 UTC : route et chunk contextualCompare servis. Le code de la
fusion correspond exactement à l'arbre relu, comparé par Git.

Fusion squash normale à 02:14:32 UTC, main
`d80efb413769b1a0ad818143f3dee0c306207a61` ; CI main `34005972879` verte
à 02:19:32 UTC, 271 suites / 3 238 tests verts / 1 ignoré. Couverture main :
68,76 % statements / 63,64 % branches / 74,56 % fonctions / 70,49 % lignes.

Pages production `973ff4b1-1b0d-4e11-b1ab-a95340936017` réussie à 02:15:59 UTC,
immutable <https://973ff4b1.appfacade.pages.dev>. GET à 02:16:30.907 puis
02:22:13.496 UTC : tryarty.com et immutable servent les mêmes trois assets :

| Asset | SHA-256 |
|---|---|
| `index-Dp_yJ6v6.js` (291 454 octets) | `5c66d81f60411a06963d7a5bf722eee7878ee951a1ec0fb6d60dcc259c23b246` |
| `App-ym5uZdAR.js` | `76469fa7141df59b53ac7c2778d3ee97f129a7554c3da1894d5ee490fad56e13` |
| `contextualCompare-BSZLIt5A.js` (5 466 octets) | `b13375bbd65171f70c6739aa31335b2f3dd04a58de2582dd51e3d68d3aadbcc5` |

Deep link public synthétique servi avec la même entrée ; aucune branche privée
lue. Régression reçu d'effacement à 02:16:31.895 UTC : GET invalide 400/no-store,
consultation synthétique aléatoire 200/unknown/no-store. Aucun POST, effacement,
authentification ou appel fournisseur. Ces GET ne mesurent pas les erreurs métier.

APK run `34005972893` entièrement réussi : APK signé à 02:21:34 UTC,
Firebase App Distribution à 02:21:41, nettoyage des secrets réussi. Ce reçu
ne prouve ni une installation ni une publication Play Store. Le serveur local
de recette a été arrêté ; aucun onglet/session personnel n'a été modifié.

[Reçu public consigné dans la PR](https://github.com/flotellop-art/Arty/pull/462#issuecomment-5556334079).

## Preuves locales et limites

| Zone | Preuve | Limite explicite |
|---|---|---|
| Préparation | contextualComparisonPreparation : préfixe, consentement commun, restrictions, Office, commit groupé | mocks de portée/fichiers/projet dans cette suite |
| Persistance/lifecycle | contextualRunner : vrais userSession, Web Crypto, IDB, projets, Office, fichiers, store et registre de streams | plan, clés disponibles et transports simulés ; setup fournit un verrou documentaire admis |
| Reprise chiffrée | attendre disparition du filet clair et déchiffrer le ciphertext final contenant A et B ; reset cache/bootstrap ; supprimer source/B puis getFile réel de A | même navigateur de test, pas synchronisation inter-appareils |
| Chat | vrai useConversation + MessageList + dialogues : première question, A→B, annulation, comparaison, retry en nouvelle branche, détachement et nouveau message documentaire | pas OAuth de production |
| HTTP | clients réels, requêtes/réponses simulées : prompt exact, attribution, borne Claude, auth/Stop et nouvelle garde après backoff | aucune consommation fournisseur réelle |
| Navigateur | Chrome headless isolé ; App, ConversationScreen et router réels, projet local, crypto/IDB et clients réels ; réponses HTTP fictives | compte/clé fictifs, réseau externe bloqué ; pas une recette APK physique |

Recette navigateur App : `2026-09-06T02:04:41.376Z`, viewport 390 × 844,
action visible x=212,59 y=248,25 largeur=161,41 hauteur=44 px, aucun débordement
horizontal. Annulation avant appel, A terminé/B refus crédit, aucun data-action
actif, deux appels seulement après reload et continuation. Desktop 1440 × 1000 :
deux panneaux côte à côte. Zéro erreur JavaScript de page. Une ressource externe
a été bloquée par l'intercepteur de recette. Captures relues localement.

Fixtures/captures ignorées : `.playwright-mcp/contextual-*`. Aucun fichier de
recette, passphrase fictive ou donnée personnelle n'entre dans le bundle publié.
Log complet hors dépôt : `../arty-contextual-comparison-final-verify-20260906.log`.

## Contrats utilisateur

- Deux modèles distincts d'un fournisseur compatible : Claude hors EU, Mistral
  sous contrainte EU. Le comparateur autonome W03 reste distinct.
- Documents actuels autorisés, pas reproduction d'anciens extraits exacts.
- Coûts indicatifs hors base64/réserve technique, inconnus pour multimodal ou
  modèle non confirmé. Compteurs partagés relus depuis le serveur, sans réservation.
- Poursuivre ouvre la branche sans appel et sans imposer le modèle historique.
- Export = une branche, pas le tableau comparatif ni ses coûts/états.
- Inline legacy, galerie générée et images/PDF EU non compatibles sont refusés,
  sans suppression silencieuse de données et sans ouverture à un autre fournisseur.

## Déploiement, observation et retour arrière

Chaîne habituelle uniquement : PR verte → squash sur le head exact → CI main /
Cloudflare Pages / distribution APK existante. Vérifier GET public et bundle
de la production contre le déploiement immuable, puis confirmer la route.
Pas de POST fournisseur ni de manipulation d'un compte personnel pour le smoke.
Taux d'erreurs métier et latence réelle ne sont pas attestables par de simples
GET publics : ne pas les présenter comme nominaux faute de télémétrie accessible.

Retour arrière si régression d'auth, du chat/Office, branche écrasée, fuite de
portée ou comparaison impossible : revert du squash par une nouvelle PR, même
chaîne CI, pas de reset forcé ni effacement de l'historique. Les branches restent
des conversations documentaires ordinaires ; leur contenu et leurs références
ne nécessitent aucune migration inverse. Ne jamais relancer les requêtes
automatiquement pour réparer une branche pending/interrompue.
