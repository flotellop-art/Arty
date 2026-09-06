# W08 — copie documentaire vers Agenda : recette et promotion

6 septembre 2026. Branche `codex/workflow-calendar-copy`, base main `a3724e3`
(#464). Candidat local ; ne pas confondre avec une publication déjà confirmée.

## Périmètre

Bouton applicatif séparé des réponses documentaires terminées : capture
synchrone de la réponse et du compte initial, aperçu texte brut, adoption
explicite d'une copie RAM indépendante, champs manuels, revue figée, une
tentative Calendar v1. Modifier invalide l'ancienne revue ; annuler ne fait
aucun POST ; perdre la réponse après envoi est une issue inconnue sans retry.
Une création attestée ne devient pas rétroactivement inconnue lors d'une
révocation ou d'un poll tardif. Connexion absente : Accueil → Agenda puis
nouvelle copie explicite. Horaires Paris et offsets DST explicites possibles.

Pas d'IA supplémentaire, de lecture Agenda, de détection des conflits, de
relecture de fichier/bibliothèque, de sauvegarde du brouillon ou de changement
de source. Texte de réponse limité à 200 000 caractères, 100 références
historiques, titre/lieu 1 024, notes 8 192 : refus plutôt que troncature.
Images/pièces jointes exclues ; balises/URL littérales inertes dans Arty, pas
de garantie sur leur présentation dans Google. Le callback documentaire
`onAction` reste absent. Aucun prix/VIP, scope OAuth, schéma, flag W06, secret,
signature Android ni API serveur changé. Anciennes APK/protocole inchangés.

La notification locale de révocation Google ferme le brouillon avant qu'une
installation suspendue/échouée ne puisse laisser des champs privés visibles.
Réentrance testée : mutation de l'owner pendant notification directe OU depuis
ensureCacheOwner ; les opérations ne changent pas implicitement de propriétaire.

## Checklist pré-déploiement

- [x] Deux diagnostics readonly indépendants examinés avant code.
- [x] Objections intégrées : revue remplacée, notification immédiate et
  réentrance, succès monotone, pending historique, véritable entrée Google,
  Ctrl/Cmd+K mobile, saisie de décalage DST, portée des chaînes HTML.
- [x] Tests permanents service/contrôleur/UI avec vrais comptes synthétiques,
  crypto et IDB ; HTTP intercepté. Source in-place/ABA/écriture étrangère,
  suppression après adoption, limites, getters non exécutés, grants ABA,
  crypto/fence, double-clic, note exacte, revue remplacée, StrictMode, route,
  focus, installation suspendue, succès puis relink et échec tardif du poll.
- [x] Première verify complète : exit 0, 285 suites / 3 435 réussis / 1 ignoré,
  no-CASA/addon, typechecks front/back, couverture, build et worker Office.
  Un delta ultérieur de réentrance ensure et de poll tardif exige la verify
  finale avant promotion ; ne pas utiliser ce premier reçu comme preuve finale.
- [x] Recette Chromium headless du vrai App/router à 05:34:35.473 UTC :
  FR/EN × 390/1440 px, fuseau America/New_York, admission réelle, crypto/IDB
  réels ; données/grants/HTTP fictifs, réseau externe bloqué. Cancel zéro POST,
  revue exacte, double-clic une tentative, Paris +02:00, relink efface la revue,
  succès reste confirmé, fermeture pendant POST ne restaure aucune confirmation,
  Ctrl+K ne rend pas la modale inerte, aucun débordement ni erreur JS.
  Capture mobile relue. Fixture locale ignorée `.playwright-mcp/calendar-copy-*`.
- [x] Deux GO finaux après derniers correctifs ; sécurité et produit limitent
  leur GO à ce pont, sans valider les autres verticales ou Google réel.
- [x] Verify intermédiaire après réentrance owner et poll : 285 suites /
  3 444 réussis / 1 ignoré, couverture 70,85 / 65,46 / 76,68 / 72,81 %,
  exit 0. Dernier delta : priorité de l'installation réentrante même owner
  pendant ensure (+6 tests), ancien pending sans status (+1).
- [x] Recette vraie App répétée après tout le code à 05:43:22.208 UTC :
  quatre combinaisons vertes, mêmes assertions et zéro erreur JS.
- [x] Verify de livraison sur tout le code : exit 0, 285 suites /
  **3 451 réussis + 1 ignoré**, couverture 70,86 % statements / 65,49 %
  branches / 76,68 % fonctions / 72,82 % lignes. Front/back, no-CASA/addon,
  build et worker Office isolé verts. App local 902,91 Ko, gzip 277,46 Ko ;
  avertissement de gros chunk préexistant. Aucun code produit changé ensuite.
- [ ] CI PR, preview statique et diff final vérifiés avant fusion.
- [ ] Fusion normale, Pages et assets canoniques/immutables concordants.
- [ ] CI main et APK Firebase vérifiées séparément.

## Déploiement, repli et limites

Chaîne existante branche → PR → CI/preview → fusion → Pages/main/APK. Relever
les SHA, runs, ID de déploiement et octets/hash des assets par GET publics
sans auth. Bloquer la promotion si un check échoue ou si les assets divergent.
En cas d'écriture sans revue, confusion de compte, répétition d'une issue
inconnue ou contenu privé après révocation : suspendre la promotion suivante,
investiguer et corriger/revert le raccord UI par PR/CI normale. Conserver le
validateur Calendar v1 côté serveur compatible avec les clients installés.
Aucune compensation Agenda automatique : une création distante n'est pas
annulée par fermeture ; toute suppression demande un consentement distinct.

Cette recette ne prouve ni OAuth réel, ni un compte client/VIP, ni une mutation
Google réelle, ni installation physique/Store. Pas de métriques globales
erreur/latence consultées : « 15 minutes nominales » non attestées. Pas d'équipe
d'astreinte notifiée ni ticket tiers fermé ; suivi dans le fil et la PR.
W08 demeure partiel (synthèse/réponse client guidées et écran de connexions),
W06 restauration/synchronisation OFF et W09–W10 non terminés.
