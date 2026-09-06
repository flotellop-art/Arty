# W07 — checklist de livraison de la comparaison contextuelle

Date : 6 septembre 2026. Base main : `ca31dce` (#461).
État : candidat local validé ; publication non encore attestée.

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
- [ ] PR, CI et preview vérifiées sur le SHA candidat exact.
- [ ] Fusion sans bypass, CI main, production Pages et APK vérifiés.

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
