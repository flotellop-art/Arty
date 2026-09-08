# Essai simple : Haiku, recherche web, mémoire locale

Décision utilisateur du 8 septembre 2026. Lot local préparé après le commit
`0e4c726`. Aucun déploiement, appel fournisseur réel ou activation de budget.

## Ce que fait cette version

- Le chat offert utilise Haiku et sa recherche web native. Le serveur refuse
  les autres outils sur le financement gratuit. Les plafonds déjà implémentés
  restent 2 000 tokens et une recherche **par tentative HTTP**.
- Gemini, OpenAI et Mistral ne consomment plus de messages d’essai : ils refusent
  l’essai actif avant toute écriture de quota. L’essai Google épuisé peut toujours
  rejoindre la réservation réelle des crédits. L’essai email reste séparé.
- La recherche externe Linkup/Brave, la lecture d’URL Linkup, le géocodage Maps,
  la voix serveur et l’extraction automatique de souvenirs exigent un plan
  subscription, Pro ou VIP. Une vraie clé OpenAI personnelle conserve l’accès
  à la voix. Un solde de crédits ne finance pas implicitement ces auxiliaires.
- Les souvenirs peuvent être ajoutés, modifiés et effacés dans **Réglages →
  Mémoire locale**. Le texte exact est enregistré avec le stockage chiffré et
  les gardes de compte existants. Aucun appel IA supplémentaire pour cet ajout.
  Ces faits peuvent ensuite accompagner le contexte envoyé au modèle : ce
  stockage local ne signifie pas que le chat fonctionne hors ligne.
- Pendant l’essai, Arty ne charge plus automatiquement la mémoire distante,
  n’utilise plus l’outil `update_memory` et refuse les nouvelles écritures D1.
  Les anciennes données restent consultables et supprimables par leur propriétaire.
- L’extraction automatique, le brief, la compression des longues conversations,
  l’amélioration de prompt et le second appel de vérification ne dépensent plus
  l’essai en arrière-plan. Les chemins réellement BYOK de compression et
  d’amélioration restent disponibles. Les anciennes préférences sont conservées.
- Le comparateur refuse les accès financés par l’essai actif ; les accès payants,
  les clés personnelles et les crédits effectivement disponibles restent distincts.
- Une admission Haiku sans clé serveur configurée restitue son unité d’essai
  confirmée avant de répondre, sans appel fournisseur.

## Contrôles et limites

Deux agents indépendants ont challengé les chemins serveur/financement et
client/mémoire. Les corrections comprennent aussi le brief payant lorsque la
vérification du plan arrive après le premier déclencheur au démarrage.

Les recettes utilisent des fournisseurs simulés, du SQLite ou D1 local et le
vrai stockage chiffré. Les reçus JSON sont conservés dans `artifacts/` ; le bilan
final est ajouté à la fin du document après exécution.

Ce lot simplifie le périmètre offert ; il ne résout pas les points suivants :

- Les 30 unités sont encore des admissions HTTP, pas 30 réponses visibles.
  Une continuation ou une nouvelle tentative peut consommer une autre unité.
- Google et email ont encore leurs compteurs distincts dans ce candidat.
  Le chantier Gmail/OTP existant doit être intégré et réceptionné séparément.
- Le budget de 100 USD reste préparé **désactivé**. La migration financière et
  le code ne sont pas mis en production par ce lot.
- Pas de réception sur téléphone réel, ni de nouvelle publication PWA/APK.
- Les fonctions locales sans appel IA (consultation, réglages, édition des
  souvenirs) ne nécessitent pas d’abonnement. Ce lot ne constitue pas une
  refonte exhaustive des droits de toutes les intégrations d’Arty.

Avant ouverture publique : réunir la limite d’essai, vérifier le budget choisi,
déployer le candidat et effectuer un parcours réel contrôlé sur téléphone.

## Résultat de la recette locale

- 501 tests ciblés passent dans 30 fichiers distincts, zéro échec ni test
  ignoré dans les derniers reçus de chaque fichier. Les essais intermédiaires
  sont conservés, y compris les échecs de fixtures corrigés ; ce total ne
  compte pas plusieurs fois les tests rejoués.
- Reçus : `artifacts/simple-trial-first.json`, `simple-trial-regression.json`,
  `simple-trial-admissions.json`, `simple-trial-ui.json` (dans le même dossier).
- TypeScript application + Functions : succès.
- Construction de production Vite : succès. Avertissements sur des imports
  mixtes et la taille de certains paquets ; pas d’échec de compilation.
- `git diff --check` : succès.
- Pas de campagne CI complète ni de validation PWA/APK sur appareil réel.
