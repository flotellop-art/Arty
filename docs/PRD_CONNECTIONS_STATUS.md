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
  génération, vide connu différent d'échec. Android ne suffit pas à établir
  présence du bridge. Ne pas lire de message ni authentifier IMAP pour un badge.

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
