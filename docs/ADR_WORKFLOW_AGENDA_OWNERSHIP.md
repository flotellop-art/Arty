# ADR W08 — propriété des requêtes Google avant les parcours métier

Statut : socle d'authentification **livré sur le web par #463**, main `2da5735` ;
transport Agenda implémenté et en recette avant publication ; les trois
parcours métier restent incomplets. Reçus et limites :
`GOOGLE_OWNERSHIP_RELEASE.md` et `CALENDAR_TRANSPORT_RELEASE.md`.
Date : 6 septembre 2026. Base : main `d80efb4`, W07 #462.
Décideur : root, après deux contre-revues indépendantes readonly produit/mobile
et sécurité/lifecycle. Aucun compte réel ni endpoint Google utilisé par cet audit.

## Contexte vérifié

W08 demande trois parcours complets (synthèse documentaire, réponse client
préparée, planification Agenda confirmée) et un état honnête des connexions.
Les templates actuels produisent des prompts ; cela ne prouve pas ces parcours.
Le verrou documentaire de W01/W04/W07 reste durable et ne doit pas être levé
pour rendre une instruction trouvée dans un document exécutable.

Les sources ci-dessous sont celles de la base `d80efb4` ; les numéros évolueront
avec le correctif. Les observations ont été relues par root, pas seulement
acceptées à partir des résumés d'agents.

- `src/services/googleAuth.ts:626-663` : les réponses 4xx et le profil invalide
  peuvent appeler logout/reconsent avant le contrôle de génération. Une réponse
  A tardive peut donc agir sur le compte B devenu courant.
- `googleAuth.ts:677-710` : retries et mutualisation reposent sur les credentials
  relus et sur owner/refresh token, sans incarnation complète de session/grant.
- `src/services/calendarClient.ts:6-26` et `googleApiHelper.ts:9-20` : attente
  d'auth puis POST sans bail du propriétaire initial ; body sérialisé après
  attente, donc encore mutable par son appelant.
- `src/components/layout/InputBar.tsx:1273-1288` : création directe via le helper
  Google, hors calendarClient ; erreur seulement console. Durcir un seul client
  sans raccorder ce chemin laisserait une voie utilisée hors contrat.
- `src/services/toolConfirmation.ts:26-54` : create/update Agenda ne sont pas
  confirmés par ce switch. Le bouton de rapport dans `useAppSetup.ts:191-193`
  ne présente que le titre ; ce n'est pas la revue complète attendue par W08.
- `src/hooks/useGoogleAuth.ts:32,72-81` : connecté signifie tokens présents,
  état conservé pendant une panne transitoire ; ce n'est pas une disponibilité
  attestée. iOS natif est explicitement non configuré (`162-165`).
- `functions/api/calendar/action.ts:83-117` : aucune idempotence ni reçu durable
  de création. Après dispatch et réponse perdue, l'issue est inconnue.

## Options et décision

1. Ajouter trois prompts/cartes : faible coût, mais ni parcours complets ni
   frontières de consentement résolues. Rejeté comme validation de W08.
2. Réactiver tools/data-action dans un fil documentaire : rejeté ; une donnée
   non fiable deviendrait une autorité d'action.
3. Livrer d'abord un socle de propriété des requêtes, puis des verticales guidées
   réutilisant le chat documentaire et les exports existants. **Retenu.**

### Premier lot borné : authentification ; transport Agenda au lot suivant

- Introduire une incarnation logique de grant RAM monotone, distincte de la
  génération des écritures chiffrées. Logout, reset, réinstallation/reconnexion
  et changement d'identité la révoquent, même avec le même email/refresh token.
- Le refresh ordinaire conserve cette incarnation. Son writer est privé et
  lié au bail capturé ; aucun booléen public permettant de préserver un grant
  arbitrairement. Examiner storeUser avant storeMailboxFreeGrant : une identité
  en cours de remplacement ne doit pas conserver un consentement ancien.
- Bail avec propriétaire, époque de session, incarnation et provenance figée
  en closure ; aucun secret dans un handle UI. Supprimer les alias mutables des
  tokens en entrée/sortie sans modifier le format de stockage.
- Mutualiser par propriétaire + époque + incarnation. Valider avant/après les
  attentes, avant retry et avant toute action logout/reconsent/persistance.
  Portée perdue : null, pas d'essai sur B. L'annulation d'un consommateur ne
  doit pas annuler le refresh partagé des autres consommateurs.
- À l'entrée Agenda, ajouter au bail Google la portée documentaire/fence,
  figer le payload avant attente et transmettre le signal d'annulation.
  Raccorder les chemins réellement utilisés, dont le mini-formulaire InputBar.
  La capture du consentement doit précéder ses attentes ; une simple capture
  dans le dernier fetch ne suffit pas pour un ancien formulaire.
- **Ne pas mettre captureLocalReadScope dans getValidAccessToken globalement** :
  `accountService.ts:128` pose erasing avant l'auth de suppression (`44`). Le
  bail auth commun doit permettre cet effacement autorisé ; la garde Agenda
  contre effacement reste un niveau supplémentaire, spécifique au parcours.
- Aucun changement d'algorithme crypto, de scopes Google, de quota, de droit,
  de clé APK ou d'activation W06. Pas de nouveau relais ni connecteur.

### Ajustement issu des contre-revues : clés API et reconnexion

Changer ou simplement réenregistrer les clés API recrée le contexte crypto.
Révoquer les anciens baux sans chemin de reprise laisserait Google bloqué
jusqu'au reload. Forcer le bootstrap des caches chauds sous une autre clé
pourrait confondre indisponibilité et corruption. Le candidat vérifie donc les
deux snapshots sous l'ancienne clé, puis transfère explicitement les seuls
credentials Google sous la nouvelle incarnation. Les autres caches restent
soumis au contrat existant de `resumePendingLocalStorage`.

Le marqueur non secret `google-crypto-transfer-pending-v1`, scoped au propriétaire,
est posé avant le commit API. Présent (même malformé), il bloque les lecteurs,
les installations génériques et le bootstrap sans déchiffrement/purge/révocation.
Les deux blobs sont préparés avant toute écriture stricte, sans fallback plain.
La finalisation propriétaire ou une reconnexion fraîche strictement persistée
retire le marqueur. La compensation d'un échec ordinaire est CAS et garde
owner/session/grant/writers/crypto/effacement/nonce ; la séquence localStorage
n'est pas atomique. Les anciens bundles ignorant ce marqueur ne sont pas couverts.

Les réponses des reconnexions sont liées à leur intention avant les attentes,
puis à des reçus armés par chaque writer réellement commencé. Un rejet avant
writer ne peut pas adopter une époque créée par une autre connexion. Le hook
revalide entre identité et grant, après commit et avant cleanup/publication UI.
Les retries restent propres au getter ; les appels directs partagent seulement
l'essai HTTP + persistance, avec un résultat défensif par consommateur.

### Verticales suivantes, non incluses dans le socle

Faire évoluer l'entrée `/templates` avec une section « Parcours guidés »,
distincte des gabarits actuels et sans les supprimer. Intentions typées :
synthèse (objectif et sources), réponse client (message reçu, contexte et
engagements permis), planification (brouillon contrôlé). Les deux premiers
réutilisent le préparateur projet strict plutôt qu'un envoi automatique de prompt.

Source/projet choisi → aperçu des documents actuels autorisés → résultat
documentaire conservé → copie/export modifiable. La réponse client est un
contenu préparé, jamais un envoi implicite ; état permanent « Préparée, non
envoyée » après reload et export. Copier/exporter ne vaut pas envoi.

Pour Agenda : bouton applicatif hors Markdown sur une réponse terminée →
formulaire contrôlé (titre, début/fin/fuseau, lieu, notes) → compte Google et
calendrier principal affichés → confirmation du brouillon exact → une seule
tentative. Modifier le brouillon ou reconnecter le grant désarme la confirmation.
Aucun outil, HTML, pièce jointe ou data-action du document n'est activé. Une
réponse perdue après dispatch impose « issue incertaine », jamais un retry
automatique ni une affirmation d'échec certain. Ne pas prétendre que AbortSignal
annule une écriture déjà reçue par Google.

Borner la première verticale au calendrier principal et aux rendez-vous horaires.
Le proxy actuel fixe Europe/Paris ; ne pas proposer un fuseau libre avant un
contrat testé de bout en bout. Son listing est limité à 20 événements sans
pagination exposée : pas de promesse de détection exhaustive des conflits.

Connexions : distinguer non pris en charge, non configuré, initialisation,
reconnexion nécessaire, panne temporaire et disponibilité effectivement vérifiée.
Pas de statut vert déduit uniquement de tokens présents. Pas de Gmail/Drive
OAuth restreint ; aucune promesse de relais IMAP serveur.
La présence Android seule n'atteste pas le plugin IMAP sur une ancienne APK :
tester sa disponibilité réelle, pas seulement la plateforme. Ne pas reprendre
le dialogue des templates sans ses contrats clavier, focus et erreurs visibles.

## Plan de tests et critères avant livraison

| Frontière | Preuve attendue |
|---|---|
| Refresh tardif | Suspendre fetch et lecture JSON ; A→B et A→B→A ; 4xx, invalid_scope_set, 200 profil invalide/valide : B tokens/user/marqueurs inchangés |
| Grant remplacé | Même owner, même email et même refresh token apparents : ancien consentement refusé définitivement |
| Backoff partagé | Switch pendant 1,5/3 s : aucun refresh B pour A ; refresh courant partagé positif et panne transitoire conservés |
| Annulation | Un consommateur abandonné n'annule pas les autres ; aucun POST Agenda après perte de scope/document/crypto/fence |
| Payload | Mutation du draft/tokens fourni pendant l'attente : aucune dérive silencieuse de body/provenance |
| Non-régression | Effacement Google autorisé, bootstrap chiffré, no-CASA et vrais 4xx courants toujours opérationnels |
| UI confirmée | Annuler = zéro POST ; double-clic = une tentative ; erreurs visibles ; issue incertaine distincte ; succès seulement après réponse validée |
| Parcours | App/router réels, viewport mobile, source originale intacte, copie/export, Agenda simulé confirmé ; aucune consommation ni donnée personnelle |

Recette HTTP simulée d'abord, puis verify complète, deux revues du diff final,
PR/CI/Pages/APK avec reçus distincts. Le plan ci-dessus n'est pas une preuve
d'implémentation, d'OAuth live, d'installation Android ou de livraison W08.

## Actions

### Reprise du prochain lot, base `2da5735`

Deux contre-revues readonly distinctes ont préparé le transport pendant la CI
#463. Root a relu `calendarClient`, `googleApiHelper`, la route Calendar,
`googleFetch`, `safeJson`, `calendarTools` et `captureLocalReadScope` ; aucun
code Calendar n'a été modifié ni testé par cette préparation.

- Composer bail Google + `captureLocalReadScope(signal)` (store.ts:77), puis
  `validateReadOnly()` avant dispatch ; aucun bootstrap/création de base pour
  cette vérification. Conserver le contexte depuis l'ouverture du formulaire,
  la lecture des événements ou le début du tour, pas depuis le dernier fetch.
- Construire une allowlist avant sérialisation : les spreads actuels de
  calendarClient:45/55 peuvent substituer `type`/`eventId` au runtime.
- Les catches proxy après appel mutateur amalgament pré-dispatch et issue
  inconnue. Ajouter une attestation additive/versionnée uniquement lorsque la
  route sait qu'elle n'a pas appelé Calendar ; pas de déduction du HTTP seul.
- Ne pas propager le « Réessaie » de safeJson aux mutations incertaines. Aucun
  retry mutateur ; schéma de réponse valide avant succès. Une fin explicite
  est nécessaire au premier parcours horaire Paris : le défaut actuel mélange
  interprétation du runtime et fuseau affiché. All-day hors première verticale.
- Inventaire à raccorder et vérifier intégralement : CalendarView, InputBar,
  useConversation → useAppSetup → calendarTools/toolConfirmation, boutons de
  rapport ; aussi useProactiveBrief, MorningBrief et morningBriefService.
  Les briefs doivent distinguer indisponibilité/portée perdue et agenda vide.
- Garder les outils et anciens boutons inertes dans les fils documentaires,
  Office, comparaisons et historiques restaurés. Le contexte local ne peut pas
  provenir des arguments du modèle ; la confirmation appartient à l'application.

Critères suivants : tests vraie UI → vrai client → HTTP synthétique, y compris
relink identique/ABA après ouverture, Stop/unmount/fence/document, payload modifié,
annulation et double-clic, écriture réussie puis réponse perdue, JSON 200 invalide,
suppression confirmée suivie d'un listing indisponible et formats mobile/clavier.
Ce relevé n'est pas une attestation d'implémentation ni une disponibilité Agenda.

- [x] Deux diagnostics contradictoires examinés et découpage accepté.
- [x] Reproductions permanentes des courses auth, puis correctif de propriété.
- [x] Revue, recette et livraison web du socle ; APK attesté séparément.
- [x] Transport Agenda, consentement initial et chemins InputBar/outils implémentés et testés localement ; publication suivie séparément.
- [ ] Trois verticales et écran connexions : validation complète séparée.

### Transport implémenté le 6 septembre, avant publication

Le client capture le grant Google et la portée locale/documentaire avant les
attentes. Il vérifie la barrière durable en lecture seule avant dispatch et
avant publication des résultats. Une autorité locale opaque contient le compte
Google vérifié ; aucun argument du modèle ne peut la créer ou la remplacer.
Le mini-formulaire v1/v2 capture à l'ouverture, CalendarView à la lecture puis
à l'édition, le chat au début du tour. Les briefs capturent avant leurs lectures
et ne confondent plus indisponibilité et agenda vide. Une carte structurée
conserve sa propre portée, indépendante du bouton Masquer, et l'ancien item
ne peut pas être réutilisé après reconnexion ou ABA.

Le protocole v1 ajoute calendarAccount et une allowlist partagée client/serveur.
Le corps exact est figé avant confirmation : opération, ID opaque, début/fin
RFC3339 Paris explicites ; dates invalides, trous/plis DST sans offset et
intervalles incohérents refusés. Le serveur vérifie le compte et atteste un
refus uniquement avant son appel mutateur. Après dispatch : issue inconnue
pour une réponse perdue/annulée/invalide, aucune relance automatique. Un handle
et son contexte ne permettent qu'une tentative ; refresh readonly distinct.
Les anciens clients sans version gardent leur contrat, sans recevoir les
garanties nouvelles de validation v1. Pas de migration ni nouveau scope.

Tous les appelants recensés ont été raccordés. Les outils restent inertes dans
Office/projets/comparaisons et la politique OpenAI refuse toujours les quatre
outils Agenda. Les vraies boucles Claude/Mistral reçoivent la garde durable
post-auth ; une recette Claude/SSE/HTTP fictif vérifie la seconde requête après
lecture Calendar. Confirmation create/update/delete par l'application, pas
par un booléen du modèle. Les boutons de rapport ouvrent une nouvelle proposition.

Deux contre-revues readonly ont donné GO code borné après corrections. La
preuve navigateur couvre les composants réels et le transport simulé, pas un
parcours complet App/OAuth/appareil. Notes longues dans le dialogue natif et
WebView physique ne sont pas attestées. Les trois verticales guidées et
l'écran de connexions nécessitent leur propre implémentation/recette.
