# W08 — fondation du statut de réponse client

6 septembre 2026, base main `2c114cf` (#466), branche
`codex/client-reply-draft`. **Socle validé localement ; formulaire client absent,
pas encore de livraison de ce lot.** Décision : `ADR_CLIENT_REPLY_DRAFT.md`.

## Ce que fait ce lot

Restriction canonique `client-reply-draft-v1`, monotonie garantie par un index
privé indépendant des alias du cache, publié après écriture locale réussie.
Mode documentaire, clés de revue/engagement et branches conservés. Aucun champ
destinataire ni capacité mail/Google ; aucune modification de token modèle.

Projections finale/en cours/incomplète dans bulle et comparateur ; copie/TTS,
Markdown/HTML-PDF, partage explicite et signalement conservent la notice.
Word et feuille Informations Excel la conservent, sans modifier les cellules.
Résumé secondaire et copies de fragments désactivés pour ce mode ; boutons
générés inertes. Les chats ordinaires gardent ces fonctions.

JSON restreint v2 : brut conservé, galeries exclues et comptées séparément,
anciens placeholders interrompus avant remappage. Archive v3/minReader3
seulement si marqueur, fichiers selon v2, lectures v1/v2 conservées, planner
toujours historique/inert et publication non autorisée. W06/sync restent OFF.

## Preuves locales

- Deux diagnostics readonly avant code, deux contre-revues après corrections,
  puis deux GO bornés au socle. Objections intégrées : alias mutable, copie
  CodeBlock, résumé sans provenance, partiel JSON, omission d'image prise à
  tort pour du texte généré et faux boutons focusables.
- `npm run verify` exit 0 : **293 suites, 3 550 tests réussis + 1 ignoré**,
  typechecks front/back, couverture, build, no-CASA/addon et worker Office
  réel en VM isolée. Couverture statements/branches/fonctions/lignes :
  71,14 / 65,94 / 76,88 / 73,10 %. App 916,94 Ko, gzip 281,95 Ko ; avertissement
  de taille de chunk préexistant. 46 tests ajoutés au total.
- Guards/import/archives : valeur inconnue, downgrade en place, reload durable,
  JSON aller-retour, v3 authentifié, minReader falsifié, ancien lecteur refusant
  le nouveau champ, fidélité v2 des fichiers et planner sans publication.
- Vrais writers/hook/crypto/stockages avec faux transport : fin, Stop,
  récupération simulée, retry générique, branche avant/après réponse, deux
  comparaisons et reload, contenu brut et métriques non gonflées. Le test
  « crash » simule la récupération du filet de sauvegarde, pas une coupure
  physique du processus.
- Recette **vrai App/router/crypto/IDB/worker Office**, Chromium headless à
  07:24:42.314 UTC, FR/EN × 390/1440, fil prérempli synthétique. Notice copiée,
  copies de blocs absentes, action injectée textuelle, reload sans HTTP,
  Word et Excel ciblés téléchargés puis ZIP/XML relus indépendamment dans
  les quatre variantes. Notice dans l'aperçu et les artefacts, demande
  utilisateur exclue, 88 m² inchangé. Capture FR mobile relue, pas de
  débordement ni d'erreur JS. Presse-papier intercepté dans la page de test ;
  aucun presse-papier privé lu et aucun compte utilisateur utilisé.
- Fixtures et logs locaux ignorés : `.playwright-mcp/client-reply-*`.

## Promotion et limites

Socle fusionné normalement par #467 à 07:33:00 UTC, main
`225f560ceca729412d3b454dde8caf39b1df9d4d`. CI PR `34019181453` verte ;
preview `5f56d12f-aef8-431a-8a62-70439a64b432` à 07:28:09 UTC, assets contrôlés
à 07:32:36.310 UTC. Pages production `e0cd4933-c6d1-4de8-9e68-fc9b71917040`
réussie à 07:34:21 UTC. GET publics à 07:36:41.324 UTC : chemins, octets et
SHA-256 identiques entre tryarty.com et `https://e0cd4933.appfacade.pages.dev`
pour index, App, contextualCompare, officeExport.worker, ProviderPanel et
SharedConversationView. App `DbCteNoo` : 919 590 octets,
SHA-256 `e139ff8494b645d7ae58bc57a6a5c7e5e59e525b05828b8d05f9bbf52d93c366`.
CI main `34019451600` réussie ; APK `34019451598` réussie, distribution
Firebase terminée à 07:41:07 UTC. Pas d'installation physique ou Store attestés.
La sonde suit les dépendances réellement déclarées : le helper est factorisé
dans storage en preview, intégré dans App en production selon les flags.
L'identité byte-à-byte est vérifiée uniquement entre le domaine canonique et
son propre déploiement production, pas entre preview et production.

PR/CI et Pages preview avant fusion normale ; contrôler ensuite immutable
production contre tryarty.com, CI main et APK Firebase séparément. Pas de
migration physique ou perte de données, pas de dépendance nouvelle. Ne pas
activer le formulaire tant que son admission/revue et sa recette ne sont pas
terminées. Un ancien APK/lecteur JSON permissif n'est pas une garantie de
fidélité du nouveau mode. Une archive v3 doit rester refusée par un vieux
lecteur plutôt qu'être silencieusement dégradée.

Repli par revert normal si régression ; avant de produire des fils restreints
réels, le formulaire devra conserver ces lecteurs et protections. Pas de
relecture de bibliothèque pour un export, pas de nouvelle génération de fond.
Aucune fenêtre globale de surveillance 15 minutes, recette OAuth, fournisseur
facturable, installation physique, Store ou impact commercial attesté.

Le parcours client guidé et l'écran de connexions restent à réaliser. Ce lot
ne valide pas W08 complet ni le cahier des charges global.
