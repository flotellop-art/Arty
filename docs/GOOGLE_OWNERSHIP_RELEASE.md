# Socle Google W08 — vérification et livraison

6 septembre 2026. Base main `d80efb4` (#462). **Candidat vérifié localement,
pas encore livré**. Aucun transport Agenda ni parcours W08 validé par ce lot.

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

- [ ] PR et CI du head exact.
- [ ] Fusion main sans contournement de protection, CI main.
- [ ] Pages production réussi ; mêmes octets d'assets sur domaine canonique
  et déploiement immutable, y compris présence du marqueur/texte de reprise.
- [ ] APK signé puis upload Firebase réussi. Cela ne prouve pas une
  installation physique, une publication Play Store ou une connexion Google.

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
