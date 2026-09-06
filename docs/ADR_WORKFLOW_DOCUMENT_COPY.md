# ADR W08 — copie documentaire explicite vers Agenda

6 septembre 2026. Diagnostic readonly uniquement, aucun code de verticale
implémenté par cette préparation. Deux contre-revues indépendantes reçues,
produit/mobile et sécurité/lifecycle ; sources critiques relues par root.
Statut : décision de conception, non implémentée. Base main `a3724e3` (#464).
Reçus du transport : `CALENDAR_TRANSPORT_RELEASE.md`.

## Décision de découpage

Prochain incrément : une réponse documentaire terminée → copie explicitement
adoptée → brouillon Agenda manuel → revue contrôlée → une mutation autorisée.
La synthèse et la réponse client guidées viennent ensuite sur la même base
documentaire ; l'écran de connexions reçoit une recette distincte. Ni trois
prompts ni trois cartes ne suffisent à valider W08.

Le produit proposait de commencer par la synthèse de projet complète. C'est
cohérent, mais root privilégie d'abord le pont Agenda désormais raccordable au
transport testé #464 : incrément sans appel IA supplémentaire, qui ferme une
transition d'autorité précise. Cela ne transforme pas l'extraction de passages
en synthèse exhaustive ni un brouillon en événement déjà créé.

## Points d'ancrage vérifiés

- ConversationScreen:121 maintient onAction absent dans les fils documentaires.
  Ajouter un callback applicatif distinct passant des IDs locaux, en dehors du
  renderer/data-action ; ne pas toucher cette garde.
- MessageList/AssistantBubble ont une barre de réponse séparée du Markdown.
  `id !== 'streaming'` n'est pas preuve de complétude : Message.interrupted et
  isConversationBusy(sourceId) doivent interdire la capture active/partielle.
- storage.ts:140–159 fournit captureConversationForBackup sans bootstrap :
  projection allowlist indépendante synchroniquement, révisions/cache/owner,
  puis assertSnapshot contre mutation in-place. Ne pas créer de base à ce stade.
- officeExport/session.ts:24–38 autorise volontairement les réponses
  interrompues et ajoute les références historiques. Ne pas en réutiliser le
  prédicat comme preuve de réponse terminée. Les références [S1] ne sont pas
  une autorité pour relire la bibliothèque actuelle.
- CalendarProtocol borne titre/lieu à 1024, description à 8192 ; Paris et
  horaires explicites. Utiliser les garanties existantes, pas un nouveau POST.

## Contrat de copie et consentement

Avant adoption : conserver un ticket source stable, owner/crypto/fence/document
courants et une projection bornée. Afficher origine historique (conversation,
réponse/date) et texte readonly. Toute modification avant adoption refuse la
capture. Aucune requête IA/Google et aucune modification du fil original.

L'utilisateur choisit « Utiliser cette copie comme brouillon ». Après cette
adoption, le brouillon RAM est indépendant et annoncé comme tel : ne pas promettre
une source vivante jusqu'au POST et ne pas relire la bibliothèque. Capturer le
grant au début de cette intention et le conserver ; une reconnexion exige une
nouvelle proposition. Fermer/recharger abandonne brouillon et confirmation.

Le texte source n'est pas une commande. Ne pas injecter/tronquer toute la
réponse dans description. Titre, lieu, notes modifiables avec compteurs et
erreurs de limite ; début/fin Paris contrôlés. Un formulaire local avec revue
scrollable sémantique remplace toute dépendance aux longues notes d'une boîte
native. N'envoyer que les champs approuvés ; pas d'historique/fichier/HTML.

Owner/crypto/document/effacement/grant continuent de révoquer le brouillon. La
suppression ultérieure du fil ne supprime pas implicitement la copie adoptée,
ce qui doit être annoncé. Si on choisit un contrat source vivante à la place,
sa garde doit entrer dans la frontière pré-fetch après refresh (et non seulement
avant execute) : option distincte, plus coûteuse, non décidée ici.

## Autres constats W08 à ne pas oublier

- TemplatesScreen:64–66 → App:174–192 génère immédiatement depuis un prompt.
  Pas d'étape source/résultat. Le gating est incohérent : App:431 produit
  seulement byok/unknown, TemplatesScreen:49–59 exige pro/subscription.
  Vérifier la capacité/plan effectif avant raccordement, sans élargir de droits.
- ProjectReviewDialog:34–63 et chatPreparation:141–209 fournissent déjà
  sélection locale, aperçu borné, consentement et garde post-auth. Conserver
  noHit/partial, EU et texte d'annulation. Le projet ne garantit que des extraits
  sélectionnés (20k caractères/20 passages), pas tout le dossier/PDF/OCR.
- Réponse client à partir de texte collé doit devenir documentaire durable,
  pas seulement recevoir un prompt « n'envoie pas ». Copie/export ciblés sont
  suffisants sans connecteur d'envoi. « Préparée, non envoyée » doit rester dans
  le résultat relu et exporté. Les mappers archive/Office actuels ignoreraient
  un nouveau champ workflow : concevoir sa fidélité explicitement.
- Google isConnected signifie configuration en cache, pas accès distant vérifié.
  native/mailImap.ts:79–80 ne teste que la plateforme ; mailAccounts:42–46
  convertit erreur/plugin absent en [] : ce cache ne distingue pas « aucun
  compte » et « indisponible ». Connexions : support réel, configuration,
  initialisation, reconnexion, panne et vérification datée ; pas de réseau
  implicite à l'ouverture. Web/iOS doivent proposer le collage manuel.

## Recette bloquante du pont

Vrai App/router, FR/EN 390/1440, clavier/focus/Escape ; source hostile inerte,
source modifiée/ABA avant adoption, source originale identique après adoption,
owner/grant/crypto/fence/document perdus, réponse interrompue/travail en cours,
limites/champs Paris, annuler zéro POST, double-clic une tentative, succès
validé versus issue perdue, aucune reprise automatique, nouvelle ouverture
sans réutiliser un consentement. Rester uniquement synthétique, sans OAuth,
agenda personnel ni génération facturée pour les tests.
