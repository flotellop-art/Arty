# Protection des essais gratuits — extension obligatoire de l'objectif

Demande explicite de Florent, 7 septembre 2026 : empêcher l'abus des 30 messages
gratuits par multiplication des comptes email et changement d'IP/VPN.
Statut : **à réaliser**, pas une protection déjà livrée. Responsable : agent
principal Arty. Priorité P0 avant ouverture commerciale/acquisition à grande
échelle ; les obligations W01–W10, abonnements et crédits restent inchangées.
Le calendrier dépend du diagnostic, des contre-revues et des recettes ; aucune
date de livraison ou efficacité chiffrée n'est inventée.

Avancement au 7 septembre : admission subventionnée stricte livrée dans la
[PR491](https://github.com/flotellop-art/Arty/pull/491), avec tests et observation
production documentés dans [FREE_ADMISSION_SAFETY_RELEASE.md](FREE_ADMISSION_SAFETY_RELEASE.md).
Cela corrige le repli permissif sur incident décrit au point de départ ci-dessous.
Le budget global et l'éligibilité multi-compte ne sont pas encore réalisés ;
aucun de leurs critères n'est clos par cette livraison.

Complément livré : [PR492](https://github.com/flotellop-art/Arty/pull/492),
main `96daa8d`, corrige les bornes des appels recherche/mémoire ; 5208 tests
réussis en CI et observation publique de 15 minutes réussie. Le
[noyau de budget cumulatif](SUBSIDIZED_BUDGET_LEDGER.md) est développé localement,
sans raccord ni activation. Il ne ferme pas encore les critères 2 à 4.

Le noyau est maintenant fusionné via PR493, main `69dd37e`, avec 5274 tests
réussis en CI ; migration et raccord restent désactivés. Le prochain candidat
[précontrôle Anthropic](ANTHROPIC_PREFLIGHT_RELEASE.md) refuse les transports
invalides avant débit, sans prétendre valider tout le schéma fournisseur ni
remplacer les règles d'éligibilité multi-compte à venir.

## Résultat attendu

Rendre le renouvellement abusif des essais difficile et borner la dépense
financée par Arty, même si certains comptes abusifs passent les premiers filtres.
Un VPN, une IP ou un identifiant d'installation ne prouvent pas une personne.
Ne pas promettre une interdiction absolue de tout multi-compte.

## Point de départ vérifié dans le code

- Google et OTP disposent chacun d'un compteur serveur cumulatif de 30,
  séparé par identité ; le VPN seul ne réinitialise pas le même compteur.
  Le cumul entre canaux/plusieurs comptes contrôlés reste à traiter sans
  fusionner leurs données ni leurs droits.
- OTP possède déjà limites email/IP, filtrage partiel d'adresses et CAPTCHA
  sur les hôtes production connus. Ces protections ne prouvent pas l'unicité
  humaine ; le parcours Google et tous les hôtes accessibles sont à couvrir.
- Les consommations d'essai Google/OTP peuvent échouer ouvertes sur panne D1.
  Un débit tardif peut ensuite être compensé : ce comportement ne fournit pas
  une borne de dépense en incident.
- L'offre Free quotidienne et la voix ont d'autres compteurs : 30 messages
  d'essai ne couvrent pas à eux seuls tous les coûts des clés serveur.
- L'effacement de compte conserve déjà les compteurs de quota : ne pas
  présenter la suppression/recréation comme un contournement démontré.

Sources de code : `functions/api/_lib/checkAllowedUser.ts`, `emailTrial.ts`,
`atomicQuota.ts`, `freeQuota.ts`, `accountErasureData.ts`,
`functions/api/trial/init.ts`, `functions/api/auth/email/request-otp.ts`.
Deux contre-revues indépendantes en lecture seule ont challengé le périmètre.
Ces constats ne valent ni attaque réelle exécutée ni configuration live attestée.

## Critères obligatoires de réception

1. **Compteurs serveur fiables.** Aucun renouvellement du même avantage par
   reconnexion, changement d'IP, stockage effacé, réinstallation, Web/PWA/Android
   ou ancien APK. Dernier message concurrent et requêtes directes testés.
2. **Abus multi-compte.** Règle explicite d'éligibilité Google/OTP, alias et
   nouvelles inscriptions répétées ; protections graduées combinant plusieurs
   signaux, sans dépendre uniquement de l'IP ni d'un identifiant client falsifiable.
   Ne jamais fusionner les identités d'autorisation, contenus ou accès payants.
3. **Dépense bornée.** Budget global configurable des appels gratuits financés
   par Arty, réservation atomique avant fournisseur, plafonds de tokens et
   d'appels auxiliaires. Concurrence, multiples comptes/IP, panne du compteur,
   timeout et résultats tardifs/inconnus ne doivent pas autoriser une dépense
   non bornée. Valeurs de budget à calibrer et documenter avant activation ;
   aucun plafond fournisseur supposé actif sans preuve.
4. **Couverture complète.** Matrice route × identité × modèle × modalité,
   incluant outils, recherche, voix, streaming, retry, comparaison et BYOK.
   Ne pas déplacer l'abus vers un autre service ou une URL de preview utilisant
   les ressources de production. Préserver les droits VIP/abonnés et les crédits.
5. **Usage légitime préservé.** Cas positifs famille/bureau/Wi-Fi partagé,
   VPN légitime et appareils partagés ; vérification supplémentaire accessible,
   message de refus compréhensible, délai de reprise et recours. Pas de
   bannissement permanent ou de retrait de droits payants sur l'IP seule.
   Une fonction interdite ou un échec non servi ne doit pas vider l'essai ;
   annulations, retry et compensations ont une politique testée.
6. **Données minimales.** Inventaire et rétention bornée des signaux anti-abus,
   purge démontrée et métriques sans conversations, clés, tokens ou données
   Google Workspace. Pas de fingerprinting matériel invasif ; un pseudonyme
   n'est pas une preuve d'identité. Vérifier la cohérence de l'information
   publique avant toute nouvelle collecte ; pas de validation juridique présumée.
7. **Preuves avant livraison.** Tests multi-comptes/IP synthétiques isolés,
   courses et pannes avec D1 réel local, deux contre-revues, suite complète,
   recette Web/Android disponible, déploiement versionné et contrôle production.
   Rapport séparant blocages justifiés, faux positifs, coût maximal testé et
   limites résiduelles ; aucune création abusive de comptes chez un tiers.

## Bornes de la demande

L'offre de 30 messages n'est pas réduite par ce cadrage. Carte bancaire,
téléphone/SMS payant, pièce d'identité, nouveau service payant ou exclusion
générale des VPN ne sont pas décidés implicitement. Aucun nouveau blocage ou
collecte n'est activé par cet ajout documentaire.
