# ADR W08 — propriété des requêtes Google avant les parcours métier

Statut : décision de découpage acceptée, **implémentation non commencée**.
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

### Premier lot borné : authentification et transport Agenda

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

- [x] Deux diagnostics contradictoires examinés et découpage accepté.
- [ ] Reproductions permanentes des courses, puis correctif de propriété.
- [ ] Revue, recette et livraison du socle.
- [ ] Trois verticales et écran connexions : validation complète séparée.
