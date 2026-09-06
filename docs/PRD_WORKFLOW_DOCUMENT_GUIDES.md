# W08 — synthèse documentaire et réponse client préparée

6 septembre 2026, base main `59bfbc6` (#465). Première verticale synthèse
implémentée et validée localement ; publication suivie dans
`PROJECT_SYNTHESIS_RELEASE.md`. Réponse client encore à réaliser. Deux
diagnostics indépendants readonly examinés : produit/accès et sécurité/fidélité.

## Problème et objectif

L'indépendant dispose des projets, de la lecture documentaire, de la copie et
de l'export, mais les anciens templates lancent un prompt générique sans
préparation de source. Leur accès est en outre incohérent : App ne transmet
que byok/unknown alors que Templates attend pro/subscription.

Le résultat visé est un parcours utilisable de bout en bout : source choisie,
destination IA et contenu relus, génération confirmée, résultat conservé,
puis copie/export ciblés. Pas de nouvelle action connectée implicite.

## Découpage retenu

Deux entrées guidées, un moteur documentaire partagé :

1. Synthèse **des extraits sélectionnés** d'un projet existant, avec choix
   explicite des documents et mode aperçu, puis revue du véritable contexte.
2. Réponse client depuis demande et faits collés manuellement, sans projet
   ou Google implicite, conservée dans un fil documentaire neuf et détaché.

Le produit propose aussi une chaîne directe synthèse → copie adoptée → réponse
client. À garder en P1 : les deux entrées autonomes réduisent le couplage et
permettent de préparer une réponse sans synthèse préalable. Une liaison future
devra adopter explicitement une copie, ne pas transmettre l'ancien dossier ni
réutiliser un consentement IA/Agenda. Aucun CalendarContext pour préparer du texte.

## Histoires utilisateur et P0

- Comme indépendant, je choisis le projet et les documents dont je veux une
  synthèse, puis je vois les extraits et le fournisseur avant de confirmer.
  Projet vide, source verrouillée/supprimée ou aucun extrait : revenir à la
  sélection, pas de synthèse présentée comme documentaire sans source.
- Je colle une demande client et les faits autorisés, je renseigne objectif
  et ton, puis je relis le texte effectif. Ce contenu est une donnée, jamais
  une instruction autorisant mail, outils, rappel, URL ou mémoire automatique.
- Je comprends la capacité disponible, le chargement, la reconnexion et
  l'indisponibilité, sans faux renvoi « acheter ». Réutiliser l'accès effectif
  du moteur documentaire ; ne pas inventer une licence ni modifier silencieusement
  la politique Pro des anciens templates pour débloquer ces nouveaux parcours.
- Je retrouve le résultat après rechargement sans nouvel appel. Affiner ou
  relancer est explicite et potentiellement facturé ; une erreur/annulation
  garde les saisies et ne réutilise jamais une ancienne approbation.
- Je copie/exporte cette réponse, pas automatiquement tout le fil. Le résultat
  client indique effectivement « préparée, non envoyée » dans le contenu
  conservé et exporté, pas seulement dans un badge ou un prompt au modèle.

## Contraintes et ancrages d'implémentation à revalider

- Fil `hasProjectContext:true` **avant** tout send ; le mode detached existe
  dans `projects/chatPreparation.ts`. Un quickAction ou fichier factice ne
  remplace pas cette restriction durable. Conserver EU et `onAction` absent.
- `prepareProjectPayload` fournit hydratation/revue/budget ; source, sélection,
  fournisseur et portée `captureLocalReadScope` doivent précéder les attentes.
  Révoquer la revue sur édition et recontrôler après auth/avant sauvegarde.
- Le projet est borné à 20 passages/20 000 caractères, sans OCR/PDF nouveau.
  Afficher partial/noHit, lignes et références historiques, faits/inférences/
  informations manquantes ; ne jamais promettre une lecture exhaustive.
- Le formulaire projet actuel ne transmet que le projet, pas son aperçu ou
  ses cases cochées : nouvelle sélection annoncée ou sélection identifiée et
  revérifiée ; pas d'assimilation entre aperçu local et consentement d'envoi.
- Une projection applicative du statut client doit couvrir résultat final,
  partiels/Stop/crash (`useStreaming`) et writer de comparaison
  (`comparator/contextualRunner`), sans double préfixe ni faux tokens modèle.
  Les mappers Office/archives/Markdown/HTML conservent `content` ; un champ
  workflow nouveau exigerait une décision explicite de fidélité/versionnement.
- Les branches gardent déjà hasProjectContext. Vérifier aussi nouveaux résultats
  après retry/édition/comparaison/import ; ne pas inférer un mode exécutable
  depuis le texte d'une ancienne réponse. La restriction ne peut que persister.

## Recette et mesures

Critère de lancement : 100 % des cas synthétiques P0 réussissent, zéro appel
non confirmé, zéro endpoint mail/outil et aucune fuite entre comptes. Couvrir
VIP/abonné/BYOK/free/état inconnu, choix de source exact, source hostile,
modification/effacement, EU, limites, Stop/réseau, owner/crypto/fence/document,
reload/branche/retry/comparaison et copie/export/archive relus indépendamment.
Vrai App/router FR/EN 390/1440, clavier/Back, aucune double modale de focus.

Activation, temps jusqu'au livrable et retour D7/D30 seront des mesures W10,
pas des résultats inventés ici. Aucune baseline ni hausse de rétention/conversion
attestée ; fixer les cibles commerciales après une mesure réellement disponible.

## Non-objectifs et questions de réalisation

Pas d'envoi client, partage public, Gmail/Drive OAuth restreint, IMAP serveur,
nouveau fournisseur, OCR, synthèse exhaustive, sync W06 ou extension de droits.
Le partage public existant publie à distance : il n'est pas un export local.

Pour la réponse client : choisir la persistance du mode qui impose le statut
client à ses futurs résultats sans casser les archives/anciens clients.
La création atomique après approbation, le formulaire owner-scoped et l'accès
distinct de CurrentPlan sont implémentés pour la synthèse (ADR dédié).
Les tours suivants et retries du chat restent documentaires génériques ; refaire
une synthèse guidée demande de revenir au formulaire, sans ancien consentement.
Les choix propres à la réponse client sont à résoudre dans la tranche,
pas des demandes utilisateur bloquantes. Pas de délai contractuel donné.

Phases : synthèse d'abord, réponse client ensuite, puis écran de connexions.
Chaque implémentation reçoit deux contre-revues et ses preuves CI/publication.
