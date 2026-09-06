# W08 — Connexions : capacité, configuration et vérification

6 septembre 2026, base main `96486f4` (#468). Spécification de réalisation,
pas attestation de livraison. Deux diagnostics readonly indépendants examinés :
produit/plateformes/navigation et sécurité/sources de vérité.

## Objectif et périmètre P0

Une route `/connections`, accessible depuis Sidebar et Réglages, permet de
comprendre ce qui fonctionne sur cet appareil et où le configurer. Trois
concepts séparés : capacité de la plateforme, configuration locale, validité
distante. « Configuré localement » ne signifie ni clé valide, ni quota, ni
serveur joignable. Unknown/loading/unavailable sont nécessaires : une erreur
d'inventaire ne devient pas « aucun compte ».

| Carte | Preuve locale | Action explicite |
|---|---|---|
| Session Arty | owner/epoch encore actif, méthode de connexion | Offre/accès via écran existant ; aucune nouvelle sonde automatique |
| Agenda Google | bootstrap, profil serveur, identité/grant admis, scope local | Parcours Google/Agenda existant, divulgation et bouton conformes ; pas de révocation distante implicite |
| Clés IA personnelles | installation liée owner/epoch, booléens selon hasPersonalKey | ApiKeysModal unique d'App ; aucune clé dans le DTO des cartes |
| IMAP Android lecture seule | plateforme ET plugin, inventaire local réussi | Configuration existante uniquement sur action ; pas de test IMAP réseau au montage |
| Drive/Gmail OAuth/Contacts/Sheets | profil public non pris en charge | Explication sans CTA de configuration ; documents locaux restent un autre parcours |

Ni WordPress propriétaire configuré sur serveur, ni OrchestratorSync historique
ne deviennent un connecteur utilisateur universel. Aucun W06 restore/sync
activé. Pas de nouvelle intégration, nouvelle licence ou clé obligatoire pour
les abonnements/essais Arty. Le réglage BYOK existant est collectif et impose
encore Anthropic : ne pas promettre une configuration Mistral-seul indépendante.

## Contrat de lecture et durée de vie

- Pas de seconde instance useGoogleAuth/usePlanStatus/useApiKeys ; pas de
  bootstrap, refresh OAuth, sonde IA/Agenda, mail réseau ou localhost à
  l'ouverture. Les tâches existantes d'App restent séparées : ne pas promettre
  que toute l'application est sans réseau.
- Capturer le scope local avant attente, valider la barrière durable readonly
  avant publication ; snapshot metadata-only et révocable. Owner/epoch/crypto/
  fence/effacement et changement de grant retirent les détails anciens. Aucun
  token, clé, capacité exécutable ou erreur brute dans le DTO rendu.
- Google isConnected n'est que présence de tokens ; storageReady ne prouve pas
  bootstrap réussi. Exiger profil actuel, identité vérifiée et admission du
  grant/CalendarContext sans getAccessToken. Expiration de l'access token ne
  prouve pas révocation ; vérification serveur lors de l'utilisation.
- authRejected du plan n'est pas un refus Agenda et ne justifie ni logout ni
  reconsentement. Email/BYOK Arty peut avoir un autre compte Agenda ; session
  Google doit respecter son identité selon le flux existant.
- Ajouter une projection de l'installation de clés liée à owner/epoch sans
  modifier les getters/règles de routage existants. Valeur server-provided
  et blancs ne sont pas des clés personnelles.
- Le cache mail distingue unknown/loading/ready/failed sous owner/epoch et
  génération. Le plugin historique masque une erreur de déchiffrement par [] :
  même une réponse vide réussie reste « inconnu » sur la carte Connexions.
  Une liste positive prouve seulement une configuration locale, pas une
  authentification distante. Android ne suffit pas à établir présence du bridge.
  Ne pas lire de message ni authentifier IMAP pour un badge.

## Navigation et configurations

Route non modale, une seule configuration à la fois, fermée avant changement
owner ou route. Réglages ferme son dialogue avant navigation. Réutiliser
l'ApiKeysModal d'App et actualiser les statuts après fermeture/sauvegarde.
La configuration mail doit être montée conditionnellement sous owner/epoch,
pas simplement masquée avec ses mots de passe en mémoire. Une ancienne réponse
asynchrone ne ferme pas une nouvelle configuration.

Agenda doit être vraiment déplié et focalisé, pas seulement recevoir un hash
non consommé. Le retour de configuration doit rester explicite et testable.
Ne pas détourner le dialogue « restaurer le plan » pour une première liaison
Agenda. Aucun changement du protocole OAuth pour construire un badge ; toute
amélioration de retour après redirection doit être bornée à une destination
interne fixe, jamais une URL libre ou une nouvelle autorité.

## Critères de validation

Tests zéro appel ajouté en montage/StrictMode ; bootstrap en cours/échoué,
grant expiré localement admis, profil ancien, reconnexion même owner/ABA,
ancien authRejected, invalidations durant lecture, clés personnelles/serveur
et propriétaire remplacé, Android plugin absent/inventaire vide/échec distincts.
Anciens boutons inertes, capacités retirées sans activation. Statuts sans secrets.

Vrai App Sidebar/Réglages → Connexions → configuration → retour, Agenda déplié,
FR/EN 390/1440, Tab/Shift-Tab/Escape, relecture visuelle et aucune requête externe
sur fixtures. Web/PWA, Android plugin présent/absent, iOS et démo testés via
injection de plateforme ; cela ne prouve pas une installation physique.

Deux contre-revues après code, verify complet, PR/CI/preview puis production
contrôlée distinctement. Pas de délai ni résultat commercial inventé.

## Journal du socle — non publié, écran encore absent

Reprise sur disque D:, puis main #469 intégré. Les 41 tests ciblés du lecteur,
du hook et de la modal mail passent, avec crypto/IDB réels pour les services et
un signal documentaire simulé pour le hook. Les trois nouveaux fichiers sont
`connectionsStatus.test.ts`, `useConnectionsStatus.test.tsx` et
`MailAccountsModal.session.test.tsx`. Le bridge réseau est simulé ; aucun compte
réel ou appel facturable. Le premier verify du socle a été interrompu sans
verdict global après un échec du contrôle de source `privacyClaims` : sa regex
attendait l'ancien disabled exact. Elle a été adaptée à la garde additionnelle
`!admitted`, sans retirer consentement/submitting ; le comportement est désormais
testé dans la modal. Une exécution verbose de diagnostic reste distincte du
verify complet final.

Corrections de revue déjà intégrées : preuve de génération même sans clés
installées ; révision à la fin d'inventaire ; cache A effacé avant ownership B ;
revalidation après les notifications synchrones ; anciens callbacks du hook
inertes et retrait terminal sans refresh ; modal liée à son ouverture, verrou
ref commun add/remove, gardes avant/après await, mots de passe retirés à Fermer.

Les contre-revues intermédiaires ont d'abord refusé le raccordement pour les
limites ci-dessous. Elles sont désormais corrigées et testées dans le socle :

- Dans le bridge `invoke`, revalider immédiatement après `await captureMail()`
  et avant `call` (list/remove). Vérifier le micro-interleaving avec retrait réel.
- Rendre `mailAccounts.current()` total après perte du document, sans nouvelle
  lecture/callback ni rejet tardif non traité. Tester le vrai runtime avec
  retrait volontaire et perte du verrou, pas seulement un AbortSignal simulé.
- Une mutation native achevée après fermeture invalide l'inventaire de son seul
  owner exact, même après ABA, indépendamment de l'ouverture et de son epoch.
  Aucun rechargement du compte B ; une notification ne donne pas d'autorité.
- Le reload UI doit lire un reçu/cache courant validé, pas transformer le []
  d'une tentative supersédée par un rafraîchissement externe en liste vide.
- Le plugin Android historique transforme aussi une erreur de déchiffrement
  en [] (`MailImapPlugin.loadAccounts`). Un succès vide de ce plugin ne prouve
  pas l'absence de comptes : lecture stricte dédiée ou état explicitement non
  vérifiable requis, y compris pour anciens APK.

Les routes, cartes et parcours Sidebar/Réglages/Agenda restent à construire.
Ces preuves de socle ne valent ni validation W08, ni recette d'interface native.

### Validation du socle, 6 septembre, 09:16 UTC

Boucle de réinitialisation de la modal corrigée : une fonction de traduction
instable ne recrée plus l'ouverture. StrictMode, changement FR/EN pendant
mutation et conservation de la saisie/consentement testés sans modifier le mock
révélateur de WorkspaceArchive. L'exécution verbose précédente a été interrompue
pour ce diagnostic, et n'est pas un succès de suite complète.

Sept tests utilisent le vrai runtime documentaire et crypto/IDB : retrait et
perte de Web Lock, callbacks du hook devenus inertes, garde microtâche avant
list/remove/read natif et règlement sans publication d'une liste tardive.
Cinq de ces tests reproduisaient les défauts avant correction. Les notifications
de mutation réussie ou rejetée invalident génération/cache avant tout observateur
réentrant ; tests ABA, préservation B et liste suspendue. La modal écoute seulement
les métadonnées courantes, sans bridge ni effacement d'un nouveau brouillon.

Le nouvel abonnement a révélé un défaut d'admission : lecture externe publiée
avant validation durable. Deux tests le reproduisaient ; une garde `validated`
propre au ticket interdit désormais cet affichage. Cas positif et divergence
réelle du fence IDB testés. L'ancien verify du socle a été interrompu pour intégrer
cette objection, pas présenté comme une validation finale.

Deux GO indépendants readonly (produit et sécurité), bornés au socle. Puis
`npm run verify` complet **exit 0** : **302 suites, 3 661 tests réussis + 1 sauté**,
couverture 71,53 / 66,34 / 77,27 / 73,38 %, build App 928,16 Ko (gzip 285,56),
avertissement historique >500 Ko inchangé, worker Office réel exécuté en VM
isolée avec fixtures. Log local ignoré `connections-admitted-verify.log`.
Ni publication de cette branche, ni route Connexions, ni vraie connexion IMAP
ou installation physique ne sont attestées par ces tests.
