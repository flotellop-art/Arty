# W08 — formulaire de réponse client préparée

6 septembre 2026. Base main `225f560` (#467). Validation locale ; pas encore
reçu de publication de cette tranche. La fondation et ses preuves de production
sont dans `CLIENT_REPLY_DRAFT_FOUNDATION.md`.

## Contrat et périmètre

- Templates → formulaire manuel → une revue exacte → un nouveau fil marqué.
  Demande/faits 8192 caractères chacun, objectif 1600, ton prédéfini ; absence
  de faits confirmée explicitement. Aucun collage tronqué. Choix explicite
  Claude/Mistral EU ; le fournisseur ne vient pas du modèle global choisi.
- Le contrôle d'accès réutilise l'éligibilité réelle documentaire, pas
  CurrentPlan ni la politique incohérente des anciens templates. Compte/clé/
  quota revalidés au serveur ; aucune réservation promise. Retour conserve
  le brouillon RAM, pas après reload ou changement owner/crypto/fence.
- Shape initial allowlisté, sans projet/historique/fichier/action/provenance
  étrangère ; validation avant IDB/revue. Texte canonique complet conservé,
  pas une invocation sérialisée. Aucune lecture de bibliothèque ni contexte
  Google ajouté. Une identité de proxy reste nécessaire selon le compte.
- Même moteur et adoption que synthèse : annulation avant commit sans fil,
  insertion atomique demande+marqueur, stream détaché du formulaire ensuite,
  propriétaire et Stop toujours gardés. Exceptions UI isolées après adoption.
- Réponse brute intacte, notice applicative héritée de #467 à l'affichage,
  copie/partage/export. Aucune messagerie ouverte, brouillon mail créé ou
  réponse envoyée. Association de projet interdite ; relance longue conserve
  question et titre, revue documentaire générique annoncée.

## Preuves locales

- `npm run verify` final exit 0 : **296 suites, 3599 tests réussis + 1 ignoré**,
  typechecks front/back, no-CASA/addon, couverture, build et vrai worker Office
  en VM isolée. Couverture statements/branches/fonctions/lignes :
  71,31 / 66,11 / 77,07 / 73,24 %. App 925,05 Ko, gzip 284,48 Ko ; alerte
  préexistante de taille de chunk. Deux GO readonly bornés au code après
  corrections, séparés des recettes effectuées par l'agent principal.

- Deux diagnostics readonly avant code ; corrections des contre-revues :
  métadonnées étrangères refusées, ton localisé, reprise scope indisponible,
  notice démo, titre stable au retry et labels de sélection explicites.
- 49 nouveaux tests : 30 de service (crypto/IDB réels, deux budgets/provider,
  snapshot, limites/type, consentement, owner/crypto/fence, dix canaris de
  provenance avant IDB) ; 8 de transport (vrais clients Claude/Mistral, HTTP
  simulé, demande >16k, retry/reload, annulation, quota d'insertion, Stop et
  callback adoption réentrant/exception) ; 11 de formulaire/revue (saisie,
  faits absents, focus, doublon, revue obsolète, accès, propriétaire et démo).
- Régressions de synthèse et préparation documentaire dans les suites ciblées.
  Le test isolé loginRoute simule désormais aussi le nouveau contrôleur ;
  il ne constitue pas une preuve du formulaire, couvert séparément.
- Vrai App/router/crypto/IDB et deux clients sous HTTP synthétique,
  **07:57:59.986 UTC**, FR/EN × 390/1440 : entrée Templates, collage long
  intact et bloqué, faits absents confirmés, annulation/Retour sans appel,
  revue exacte des champs et ton localisé, double confirmation un seul HTTP,
  aucune action/outils, question et mode durables, copie de notice, reload
  zéro HTTP. DOCX ciblé réellement téléchargé puis ZIP/XML relu : 88 m² et
  notice présents, demande utilisateur et URL hostile exclues.
- Vrai App quota synthétique, **07:58:37.967 UTC**, FR390 : ancien brouillon
  synthèse conservé en parallèle, un HTTP 403, demande durable marquée,
  Retour vers le bon formulaire client intact sans régénération. Zéro autre
  endpoint, zéro erreur JS. Captures mobiles relues, aucun débordement.
- Fixtures/logs ignorés `.playwright-mcp/client-reply-form-*`, uniquement
  localhost, réseau externe bloqué, identités/données fictives et presse-papier
  intercepté dans la page. Aucun compte ou document utilisateur utilisé.

## Promotion et repli

Verify final → deux GO code → PR/CI/Pages preview → fusion normale → comparer
les assets immutables avec tryarty.com ; vérifier CI main et APK Firebase
séparément. Aucun secret/config Android, dépendance ou migration ajouté.
Revert normal du formulaire via cette chaîne en cas de régression ; garder
les lecteurs, marqueurs et protections du socle #467 pour les fils produits.
Bloquer la promotion si consentement/owner/fidélité ou CI/Pages divergent.

W06 restore/sync restent OFF. Connexions W08 et chaîne directe synthèse →
copie adoptée → réponse (P1) restent à réaliser. Pas de métrique terrain,
surveillance globale 15 minutes, OAuth, fournisseur facturable, VIP réel,
installation Android physique ni Store attestés. L'ancien écran Office et
sa notice exportée restent français, même dans l'application anglaise ; le
nouveau formulaire, la revue, l'affichage et la copie du chat sont bilingues.
