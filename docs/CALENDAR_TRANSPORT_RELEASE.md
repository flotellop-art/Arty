# W08 — transport Agenda, recette et promotion

6 septembre 2026. Base main `2da5735` (#463), branche
`codex/calendar-owned-transport`. **Testé localement ; pas encore livré.**
Les trois verticales guidées et l'écran de connexions restent à terminer.

## Périmètre et compatibilité

Client Calendar partagé, protocole v1 et appelants CalendarView/InputBar v1-v2,
outils/rapports/chat, briefs visuel/proactif/vocal. Capture initiale du compte
Google/grant et du bail local/documentaire ; contrôle durable readonly après
auth et avant publication. Confirmation de l'allowlist sérialisée avant
attente, une tentative, refus attesté avant Google distinct d'issue inconnue
après envoi. Paris explicite, DST et formats v1 validés client/serveur.

Anciennes requêtes sans calendarProtocol conservées, sans leur attribuer les
garanties v1. Liste toujours limitée à 20 événements, aucune détection
exhaustive des conflits. Outils OpenAI interdits comme avant ; fils documentaires
inertes. Aucun scope Google restreint, prix/plan/VIP, secret, signature APK,
schéma D1/IDB ou activation W06 modifié. Aucun effacement de données.

## Pré-déploiement

- [x] Deux challenges readonly avant code et GO finaux sur le diff ; angles
  produit/mobile et sécurité/lifecycle. Objections traitées : contexte exact
  avant attente, invalidation UI après relink, verrou d'incarnation de vue,
  carte conservée après Masquer/restaurer, garde post-auth après lecture Agenda,
  refus ancien second handle distinct de « non envoyé », FR/EN.
- [x] Première verify complète locale : 280 suites / **3 376 tests réussis,
  1 ignoré**, no-CASA/addon, typechecks front/back, couverture, build et worker
  Office réel en VM réussis. Couverture 70,44 % statements / 65,19 % branches /
  76,09 % fonctions / 72,39 % lignes. Avertissement de gros chunks préexistant.
- [x] Verify finale après deux retouches CSS disabled/indentation : exit 0,
  démarrage à 06:35:32 Europe/Paris, mêmes 280 suites / 3 376 réussis / 1 ignoré.
  Couverture finale 70,43 / 65,19 / 76,09 / 72,38 %. Typechecks front/back,
  no-CASA/addon, build et worker Office isolé réussis. Aucun code produit
  modifié ensuite. Bundle App local 890,53 Ko / gzip 273,65 Ko.
- [x] Recette Chromium headless 04:35:41.804 UTC, huit combinaisons FR/EN,
  390×900 et 1440×900, InputBar v1/v2, timezone America/New_York : vrais
  composants, crypto, grant et admission documentaire ; HTTP synthétique.
  Review Paris exacte, annulation zéro POST, issue inconnue après une tentative
  avec bouton désactivé, focus/Escape sur suppression, relink invalidant puis
  lecture explicite autre compte. Zéro erreur JS et débordement horizontal.
  Captures de review/erreur/suppression mobile relues. Réseau externe interdit.
- [x] Tests permanents de protocole, client, route Pages, handlers, composants
  et hooks réels : crypto/fence/document, A→B et ABA, timeout avant/après,
  réponse JSON invalide, refus versionné, double-clic, annuler/Stop/démontage,
  mutation réussie puis lecture indisponible, perte du document réel, cartes
  conservées et ancienne action après relink. Vraie boucle Claude/SSE/aiHttp
  avec Calendar fictif : données transmises normalement, second POST IA bloqué
  si la barrière IDB change après lecture Calendar. Aucun appel IA facturé.
- [x] Repli et limites documentés ci-dessous ; pas de migration à appliquer.
- [x] Diff final contrôlé ; liste de staging explicite, marketing utilisateur
  exclu. OpenAI sans changement sémantique et exclu du commit.
- [ ] CI PR web/Android/orchestrateur verte ; preview Pages vérifiée.
- [ ] Fusion normale, CI main et production Pages attestées séparément.
- [ ] APK signé/distribué Firebase attesté séparément.

Pas d'équipe d'astreinte ni notification externe déclenchée par cette checklist.
Le suivi est dans le fil et la PR. Aucun ticket tiers fermé implicitement.

## Déploiement et après-déploiement

Publier par branche/PR/GitHub CI/Pages existants, attendre les contrôles, vérifier
les GET publics de la preview avant fusion. Relever head PR, squash main, runs
CI, identifiant Pages et octets/hash des assets canonique et immutable. Vérifier
la distribution APK, sans l'assimiler à une installation ou au Play Store.
Arrêter la promotion si l'une de ces vérifications échoue.

Les essais synthétiques ne prouvent pas un consentement OAuth live, l'état
d'un compte client, les longues notes dans une boîte native ni un parcours
complet App/WebView. Pas de télémétrie globale erreurs/latence ni baseline
chiffrée consultée : surveillance « 15 minutes nominales » non attestée et
aucun taux inventé. Le contrôle de publication par assets ne remplace pas
la recette fonctionnelle d'une intégration réelle.

## Déclencheurs et plan de repli

Bloquer avant fusion si CI ou preview échoue, ou si le manifeste et le POST
divergent. Après fusion : anomalie de compte, écriture sans revue, répétition
après issue inconnue, résultat obsolète divulgué ou assets canoniques divergents
imposent investigation et suspension de la promotion suivante. Préférer une
correction compatible ou un revert par PR/CI normale, sans suppression locale.

Ne pas restaurer un serveur pré-v1 derrière des clients v1 encore installés
en prétendant conserver le contrôle calendarAccount. Au besoin, conserver le
validateur/attestation serveur additifs et revenir seulement sur le raccord UI,
ou fermer explicitement les mutations v1 avant tout retrait serveur. Aucune
annulation réseau ne défait une écriture déjà reçue par Google ; vérifier
l'agenda et demander un nouveau consentement avant une action compensatrice.
Le socle Google #463 et son marqueur de transfert chiffré restent compatibles.
Les anciennes APK demeurent leurs bundles jusqu'à mise à jour installée.
