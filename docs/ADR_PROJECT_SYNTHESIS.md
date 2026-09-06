# W08 — première synthèse guidée de projet

6 septembre 2026. Décision de réalisation, preuves de livraison à compléter.

## Choix et alternatives

Le formulaire est un écran non modal. La sélection des documents et la revue
du payload utilisent le dialogue documentaire existant, seul propriétaire du
focus. La sélection d'un aperçu local dans Projets n'est pas un consentement IA.

Créer un fil avant la revue serait plus court mais laisserait une réservation
vide après annulation. Un moteur de génération supplémentaire dupliquerait les
gardes Office, le routage et les writers partiels. Le raccord retenu est une
admission interne de conversation neuve dans le moteur existant : objet en
mémoire, aucun ID déjà présent, puis même commit local du fil et du premier
message après la revue. L'admission ne provient jamais d'un champ importé.

Le formulaire conserve ses saisies en mémoire sous sa portée owner/crypto/fence,
au-dessus des routes. Annulation/Back invalident seulement la tentative ; aucune
relance automatique au retour. Une adoption locale n'est pas un succès modèle.
Après commit, le stream possède sa durée de vie ; fermer le formulaire ne doit
ni l'annuler ni retirer ses gardes de compte et d'effacement.

La politique éphémère de première synthèse impose un projet et une révision
précis, le mode aperçu, une sélection explicite non vide et des extraits non
vides. Les tours suivants restent des échanges documentaires génériques, avec
leur nouvelle revue : refaire une synthèse guidée repasse par le formulaire.
Aucun marqueur de workflow n'est inféré depuis le texte ou activé par import.

L'accès annoncé combine état de compte vérifié et fournisseur documentaire
effectif ; `CurrentPlan`, `canExecuteRoute` et `availability.claude` seuls ne
constituent pas une preuve. Le serveur garde la décision sur les quotas et clés.
Un cap documentaire ne doit pas proposer une fausse relance vers Mistral alors
que le routeur impose Claude. Aucun CalendarContext, outil, rappel ou mémoire
automatique n'est nécessaire pour cette préparation.

La clé BYOK n'est pas une identité Arty : les proxys exigent encore une identité
Google ou email avant de traiter une clé personnelle (`api/ai/proxy.ts`). Une
session email avec sa clé n'a pas besoin de Google ; une identité Google rejetée
doit être rétablie, conformément à `aiHttp.ts`, même si une clé est présente.
Cette tranche ne contourne ni cette authentification ni les quotas existants.

## Plan de tests

- Préparateur : création absente jusqu'au commit, collision ID, acceptation
  unique, sélection vide/forgée/search, projet vide ou texte blanc, révision
  changée à chaque attente, anciennes callbacks, validation post-auth.
- Hook et UI : annuler chaque étape garde objectif et sélection ; double clic,
  Back, changement de projet et A→B ; aucune sauvegarde/appel avant accord ;
  transfert au stream, refus quota, Stop et partiel ; accès VIP/abonné/free/BYOK,
  chargement/reconnexion/indisponibilité et EU sans repli.
- Intégration locale réelle : crypto/IndexedDB et vrais clients avec HTTP
  synthétique ; App/Templates/Projects → revue → réponse → reload sans HTTP →
  export ciblé. Sources hostiles, limites et références historiques conservées.
- Recette navigateur : FR/EN, 390/1440, clavier, Escape/Back/Ctrl-K ; aucune
  double modale. Deux contre-revues readonly puis vérification complète et CI.

## Limites

Synthèse des extraits, jamais lecture exhaustive (20 passages / 20 000
caractères). Pas d'envoi client, de connexion Google ni d'extension de droits.
Réponse client avec statut durable « préparée, non envoyée », écran de
connexions et autres lots du CDC restent à réaliser séparément.
