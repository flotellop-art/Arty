# W08 — synthèse guidée de projet : recette et promotion

6 septembre 2026. Branche `codex/workflow-document-guides`, base main
`59bfbc6` (#465). **Validé localement, publication en attente de CI/Pages.**

## Périmètre

Entrées Templates métier et Projets vers un écran objectif/projet, puis sélection
explicite des documents en aperçu et revue du véritable payload documentaire.
Le fil et la première demande sont insérés atomiquement après confirmation ;
aucun fil fantôme ni appel en cas d'annulation. Même moteur, writers et exports
que le chat documentaire, aucun second client IA ni changement de protocole.

Objectif de 1 600 caractères maximum, collage conservé sans troncature ; limite
locale distincte d'un problème d'accès. Extraits bornés à 20 passages / 20 000
caractères : jamais une lecture exhaustive. Projet/révision/IDs vérifiés,
overview imposé, zéro extrait refusé. Aucun outil, Agenda, rappel, mémoire
automatique ou relecture de source distante. Pas de nouveau scope ni droit.

Le brouillon RAM conserve les champs et les IDs choisis durant la session,
même en revenant d'une résolution d'accès ; pas après reload. Son owner/crypto/
fence est capturé avant les attentes. Le stream adopte une portée indépendante
du formulaire après commit, avec identité d'invocation initiale et contrôles
post-auth. Retour/suppression/A→B/Stop réentrants ne republient pas sous B.
Une exception après publication est distinguée d'un échec de stockage.

La réponse et ses références historiques survivent au reload. Les suivis et
retries restent des échanges documentaires génériques avec nouvelle revue ;
revenir au formulaire pour refaire une synthèse guidée. Cap documentaire : pas
de fausse promesse de relance Mistral ; target/owner/epoch revérifiés au clic.
Une clé BYOK ne remplace pas l'identité exigée par les proxys ; compte email +
clé sans Google testé, Google rejeté requiert encore une reconnexion.

## Checklist et preuves locales

- [x] Deux diagnostics contradictoires readonly avant code ; alternatives
  création avant/après revue examinées. ADR `ADR_PROJECT_SYNTHESIS.md`.
- [x] Deux GO finaux sécurité et produit après corrections des objections :
  insertion exclusive, transfert de durée de vie, callbacks réentrants,
  accès/quota précis, collage entier, absence de target et origine Retour.
- [x] `npm run verify` exit 0 : **290 suites, 3 504 tests réussis + 1 ignoré** ;
  no-CASA/addon, typechecks front/back, couverture, build et worker Office isolé.
  Couverture statements/branches/fonctions/lignes : 71,10 / 65,76 / 76,86 /
  73,03 %. App local 913,68 Ko, gzip 281,00 Ko ; avertissement chunk préexistant.
- [x] 53 tests ajoutés : transactions/crypto réels (16), accès (9), contrôleur
  et formulaire/revue (6), cap documentaire (9), courses hook (+12), transport
  réel Anthropic avec HTTP fictif et rechargement (1). Les doubles de tests
  UI/hook ne sont pas une preuve de fournisseur ou de production.
- [x] Recette Chromium headless du **vrai App/router/crypto/IDB/client IA** à
  06:44:42.744 UTC : FR/EN × 390/1440, Templates sur mobile, Projects sur desktop.
  Long collage conservé/refusé, choix de source explicite, deux annulations sans
  HTTP ni fil, sélection conservée, Ctrl-K/Tab, aucune modale concurrente,
  double-clic = un seul HTTP, aucun document non coché dans le payload.
- [x] Résultat relu après nouveau bootstrap sans HTTP. Export ciblé : un seul
  message, téléchargement DOCX réel, ZIP/XML relus avec fflate, texte 88 m² et
  référence source.txt présents ; demande utilisateur et document non coché
  absents des messages exportés. Aucun appel Agenda/mail/outil.
- [x] Captures mobiles relues ; aucun débordement ni erreur JS. Fixture locale
  ignorée `.playwright-mcp/project-synthesis-*`, comptes et HTTP synthétiques,
  réseau externe bloqué. Aucun document/compte privé utilisateur utilisé.
- [ ] CI PR verte et preview identifiée/contrôlée.
- [ ] Fusion normale puis octets/hash Pages immutable et tryarty.com concordants.
- [ ] CI main et distribution APK Firebase vérifiées séparément.

## Promotion, rollback et limites

Branche → PR/CI/Pages preview → fusion normale → Pages production/CI main/APK.
Pas de migration, de nouveau feature flag, d'activation W06, de dépendance ni
de configuration/secrets Android. Repli par revert de la PR via cette même
chaîne, sans supprimer les fils déjà documentaires. Les anciennes APK et
archives ne peuvent pas activer la policy éphémère de cette nouvelle entrée.

Bloquer ou corriger/revert si un appel part sans revue, si l'identité/source
change sans annulation, si le résultat ne se conserve pas, ou si CI/Pages/les
assets publics divergent. Ne pas compenser un effet externe automatiquement.
Une source déjà envoyée n'est pas retirée par suppression locale.

Pas de métriques globales erreur/latence disponibles : « 15 minutes nominales »
non attestées. Pas d'astreinte notifiée ni de ticket tiers fermé ; preuves dans
la PR et ce fil. Pas de recette compte client/VIP réel, fournisseur facturable,
OAuth, installation physique ni Store. Le modal Office existant reste en
français même depuis l'interface anglaise ; le nouveau formulaire/revue est
bilingue, sans prétendre avoir internationalisé tous les exports historiques.

W08 demeure partiel : réponse client avec statut durable « préparée, non envoyée »
et écran de connexions restent à réaliser. W06 restauration/synchronisation OFF,
W09–W10 et validations terrain restent distincts.
