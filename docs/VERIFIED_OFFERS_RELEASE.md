# Statuts Offres, essai et crédits — lot du 6 septembre 2026

État : candidat local, non livré au moment de ce reçu. Ce lot ne clôt pas W02
ni l'extension commerciale `BILLING_OPERATIONAL_CDC.md`.

## Changement borné

- Upgrade utilise le vrai contrat partagé `/api/subscription/status` : VIP,
  abonnement et licence Pro distingués de la configuration BYOK et des états
  non vérifiés. Un callback de checkout n'est jamais une confirmation de paiement.
- Le contexte capture compte, session et grant Google. Un relink du même compte
  invalide tâches/cache/affichage ; un refresh normal reste compatible. Les
  continuations sont fermées après perte du document privé.
- Lectures de solde simultanées partagées uniquement dans le même contexte ;
  badge et hook ne s'annulent plus mutuellement. Cache et badge sont retirés
  après invalidation ou échec courant, sans réseau déclenché par l'invalidation.
- Retour crédits lié à l'action initiale, verrou libéré par son détenteur,
  aucun POST/navigation obsolète. Le texte signale une hausse de solde constatée,
  pas une preuve causale de règlement.
- Ancien compteur d'essai conservé mais non affiché aux VIP/abonnés/Pro/BYOK,
  aux états non vérifiés ou au prépayé utilisable. Essai encore actif : Haiku
  et compteur connu, pas une nouvelle promesse de 30 messages. FR/EN au singulier.
- Badges sans promesse d'illimité déduite de quotas absents. Prix, formules,
  quotas serveur et barrières d'achat natif inchangés.

Aucun changement Functions, migration D1, secret, fournisseur, produit live,
activation R2, OAuth, droit marchand ou politique de remboursement dans ce lot.
Les lacunes serveur/prestataires identifiées restent explicitement dans le CDC.

## Contre-revues et tests

Deux challengers indépendants en lecture seule : sécurité/lifetimes et
produit/mobile. Objections intégrées : admission tardive du grant, refresh503
après VIP chaud, gardes levantes après document perdu, verrou crédits bloqué
par recheck, notification réentrante, vieux badge wallet, lectures concurrentes,
fausse reconnexion sur refresh supplanté, essai global contradictoire.

GO code bornés obtenus après corrections ; conditionnés à la vérification finale.
Suites ajoutées : vrais Google/crypto + hook/Upgrade/WalletBadge, HTTP synthétique,
Creem réel avec token/HTTP/JSON suspendus, document réellement retiré et action UI
avant unmount, badge + plan dans les deux ordres de lecture. Frontière d'achat
natif conservée. Aucun paiement de recette.

Une exécution Node 22 complète a rencontré un timeout du writer D1 dans
`d1.walletMeasurement.test.ts` : `db_unavailable` au lieu de `reserved`.
Le test repasse seul sans modification. Cette exécution échouée n'est pas une
validation verte ; une nouvelle exécution complète est requise avant livraison.

Nouvelle exécution complète, même code sans neutralisation du test : **PASS**,
Node 22.23.2, 328 suites, 4 218 tests réussis et 1 ignoré préexistant. Typechecks
front/back, contrôles no-CASA/addon, couverture, build et test du vrai worker
Office compilé passent. Log de travail ignoré :
`.playwright-mcp/verified-offer-release-verify.log`.

## Recette du vrai App, navigateur local

Navigateur intégré, harnais ignoré `.playwright-mcp/offer-{boot.ts,ui.tsx,html}`.
Vrai App/router, admission du document, crypto, session Google et grant chiffré ;
profil et transport status/wallet synthétiques. URL limitée à
`http://127.0.0.1:5180`, fetch sans transfert fournisseur ; aucun bouton d'achat
ou portail externe activé. Ce n'est ni `main.tsx`, ni production, ni une preuve
d'autorisation serveur Google ou de paiement live.

Observations du 6 septembre vers 18:10–18:15 UTC :

- FR, VIP et ancien compteur 0 : accès VIP reconnu, aucune bannière d'essai ;
  clic Revérifier → statut d'accès vérifié, sans annonce d'activation payante.
- FR, abonnement et compteur 0 : abonnement reconnu, carte actuelle désactivée,
  pack premium et lien de gestion visibles, aucune bannière d'essai. Lien non ouvert.
- EN, Free + compteur 0 + crédits disponibles : ni bannière globale ni appel
  d'essai épuisé dans Upgrade. Aucun nouveau statut payant inventé.
- FR, Free + compteur 1 : compteur Haiku à 1, au singulier, dans la bannière et
  Upgrade ; CTA neutre vers les options.
- FR, HTTP status 503 : « Le plan n'a pas pu être vérifié », bouton Revérifier,
  aucune bannière d'essai ou mode payant présenté comme actuel.

Limites : pas de test responsive dimensionné sur ce harnais, pas de changement
de droit réel, pas de retour checkout live, pas de vérification Android du nouveau
bundle. L'ancien APK testé sur téléphone est documenté séparément dans
`MOBILE_RECEIPT_2026_09_06.md`, sans confusion de version.

## Livraison et retour arrière

Avant fusion : suite `npm run verify` sous Node 22, contre-revues, CI PR complète
et preview Pages. Après fusion : CI main/Firebase et commit/asset Pages réellement
servi, puis nouvelle recette du binaire identifié si disponible.

Déclencheurs de retour arrière : boucle de vérification/authentification, perte
de statut sous grant sain, solde obsolète, achat natif nouvellement ouvert ou
échec du chat. Revenir au déploiement Pages précédent par le workflow approuvé
et/ou PR de revert ciblée du commit de code ; aucune migration à annuler.
L'APK est un artefact distinct : ne pas prétendre qu'un rollback Web le remplace.
Surveillance métrique réelle et recette post-déploiement restent à attester.
