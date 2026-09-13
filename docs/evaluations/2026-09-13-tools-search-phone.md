# Outils personnels : Gemini, Luna et Terra sur Android

L'application Android 1.0.108 donne accès aux outils personnels existants avec le choix manuel Gemini 3.8 Flash, GPT-5.6 Luna ou GPT-5.6 Terra. Le mode Auto, le mode Europe, les documents de projet/Office et le parcours Terra vision conservent leurs règles. Les outils ne sont pas ouverts dans le comparateur de texte.

Sur le téléphone réel, les trois modèles ont donné des résultats de lecture concordants, créé un rapport local ouvrable et atteint la confirmation native d'une création d'agenda, ensuite annulée. Cela valide ces parcours précis, pas toutes les opérations du catalogue.

## Périmètre livré

- Agenda : liste et mutations via les mêmes handlers, contexte de compte et confirmations que Claude.
- Messagerie : liste des comptes, lecture récente, recherche et lecture d'un message, selon les comptes connectés. Aucun envoi de mail ajouté.
- Mémoire : lecture et mise à jour de catégories. Une mise à jour exige le reçu unique de la lecture précédente, dans le même tour et la même catégorie ; changement de compte/autorisation ou arrêt invalide l'opération.
- Fichiers locaux : outils déjà autorisés par la plateforme ; aucun déblocage de la navigation/lecture libre Android, qui reste désactivée en attente du parcours SAF.
- Rapports et questions interactives : handlers communs. Les rapports du compte courant s'ouvrent dans Arty sur Android ; un lien local inventé ou absent ne bénéficie pas de l'exception.

Les outils PC, WordPress et sentiers conservent leur parcours dédié. Drive/Contacts globaux restent désactivés pour tous. Les pièces jointes et documents gardent leur routage existant ; ceci n'est pas une migration générale de tous les outils Claude.

Les tours privés n'exposent ni recherche publique ni lecture publique d'URL et ne déclenchent pas de vérification publique après réponse. Les boucles Gemini/OpenAI vérifient les outils réellement déclarés, l'intégrité des appels, le propriétaire, l'annulation et les limites de tours/appels. Les écritures répétées et résultats incertains ne sont pas relancés automatiquement.

## Essais réels

OnePlus CPH2609, Wi-Fi ADB, application native, même protocole et une nouvelle conversation par cas. Les modèles exacts sont confirmés par les métadonnées du fournisseur dans l'interface. Réflexion Auto dans l'interface ; les paramètres de raisonnement internes diffèrent entre fournisseurs. Six cas par modèle, plus trois diagnostics de confirmation native et une reprise du rapport Gemini après correction : 28 cas évalués. Les incidents de manipulation de l'interface sont conservés séparément dans le JSON.

| Cas | Gemini 3.8 Flash | Luna | Terra | Sonnet 5 |
| --- | --- | --- | --- | --- |
| P1, comptes mail + mémoire en lecture | Résultat concordant | Résultat concordant | Résultat concordant | Résultat concordant |
| P2, agenda en lecture | Résultat concordant | Résultat concordant | Résultat concordant | Résultat concordant |
| P3, demande initiale de confirmation | Boutons puis refus respecté | Formulaire puis refus respecté | Récapitulatif seul, confirmation absente | Boutons puis refus respecté |
| P3D, appel explicite de l'outil natif | Confirmation affichée, annulation respectée | Confirmation affichée, annulation respectée | Confirmation affichée, annulation respectée | Non rejoué |
| T1, rapport réellement ouvert, total 22 € | Corrigé puis validé | Validé | Validé | Validé |
| R1, produits Weber et sources exactes | Partiel : liens neutralisés | Partiel : poids du sac non confirmé | Échec : source TE vers un autre produit | Informations demandées et liens corrects |
| R2, page inexistante, prix inconnu | Validé | Validé | Validé | Validé |

P1/P2 sont des observations de réponses cohérentes, sans reçu d'exécution indépendant de chaque lecture. La liste d'agenda existante porte sur un nombre de jours et est limitée à 20 événements ; elle ne garantit pas une recherche exhaustive d'une fenêtre horaire arbitraire. Aucune mémoire, aucun mail, aucun fichier utilisateur ni rendez-vous n'a été modifié dans ces essais. Les quatre rapports sont fictifs.

P3D est un diagnostic ajouté après avoir observé les préconfirmations : il demande directement l'appel de `create_calendar_event`, puis annule sa boîte native. Son succès ne remplace pas le résultat initial P3. Aucun bouton d'approbation de création n'a été activé.

## Rapidité observée

Secondes de l'envoi à la disparition visible du bouton Arrêter, arrondies ; précision de capture environ deux secondes. Ce temps n'inclut pas la fin de la vérification asynchrone. Une observation par cellule, pas un classement statistique. P3D est exclu car il inclut notre attente avant annulation.

| Cas | Gemini | Luna | Terra | Sonnet |
| --- | ---: | ---: | ---: | ---: |
| P1, deux lectures | Non mesuré précisément | 9,0 | 5,7 | 6,9 |
| P2, agenda | Non mesuré précisément | 5,6 | 5,5 | 12,1 |
| T1, rapport sur la version corrigée | 8,7 | 5,6 | 5,6 | 12,1 |
| R1, recherche Weber | 8,7 | 59,5 | 45,6 | 26,8 |
| R2, URL invalide | 5,7 | 7,1 | 5,2 | 8,3 |

Luna/Terra conviennent aux outils simples dans cette série. Pour la recherche demandant des références exactes, Sonnet reste la référence observée ici : Gemini est plus rapide mais ses sources ont été neutralisées ; Luna signale une information non confirmée ; Terra associe TE à `weberprocalit-f`. Les accès web, extraits indexés et outils diffèrent entre fournisseurs : ces durées mesurent Arty de bout en bout, pas seulement la génération du modèle. Les tarifs et leur périmètre figurent dans [l'évaluation des modèles](2026-09-13-models-phone.md) ; aucune facture complète par tour n'a été mesurée ici.

La vérité terrain R1 a été relue le même jour sur les fiches officielles : [weberpral F](https://www.fr.weber/facades-neuves/les-enduits-monocouches-projetes/weberpral-f), +5 à +30 °C et exclusion du béton cellulaire ; [weberpral TE](https://www.fr.weber/facades-neuves/les-enduits-monocouches-projetes/weberpral-te), +5 à +35 °C, sac de 25 kg. Le maximum TE de la réponse Gemini n'a pas été complètement capturé dans le tableau débordant ; il n'est pas compté comme vérifié. Les conseils supplémentaires non demandés ne sont pas évalués.

## Corrections et validation

- Deux contre-revues indépendantes en lecture seule : protocole fournisseur/écritures et autorité/compte/documents. Leurs objections sur les flux incomplets, appels dupliqués, reçus mémoire, annulation et données privées ont été traitées.
- TypeScript client/serveur et contrôle des permissions Google sans CASA : réussis. Compilation web, synchronisation Android et assemblage signé : réussis.
- Suite complète initiale : 408 fichiers, 6 000 tests réussis, 21 échecs, 1 ignoré. Les échecs ont révélé quatre contrats de tests à actualiser, une régression de métadonnées documentaires corrigée et deux dépassements du délai de 5 secondes sur les tests D1 concurrents existants.
- Reprises ciblées réussies après correction, dont 130 tests de routage, 35 sur le parcours documentaire/attribution/données privées, puis 47 sur les liens locaux/rendu/vérification. Les deux tests D1 concernés passent avec un délai de test de 15 secondes, sans changement de la facturation. Les lots antérieurs de boucles et d'autorité sont conservés ; leurs nombres se recouvrent et ne sont pas additionnés. La suite complète n'a pas été rejouée après les corrections.
- Le premier rapport Gemini a révélé deux défauts Android : neutralisation du lien `localhost/report/...`, puis ouverture externe au silo de l'application. Corrigés avec un validateur de rapport local du compte courant et une navigation interne. Rapport régénéré et ouvert sur téléphone avec les trois nouveaux modèles, puis Sonnet.

Les premiers cas Gemini et Luna utilisent 1.0.107 (`b199524d`). Les cas suivants et les confirmations natives utilisent 1.0.108 (`31d1a4101bb96951ffa16f03c3f780a29c0017ce`). Les corrections portent sur les reçus documentaires, l'ouverture des rapports et l'étiquette du modèle manuel ; les lectures déjà validées ne sont pas rejouées sans raison.

APK installé et vérifié sur le téléphone : **1.0.108 / code 109**, SHA-256 **56fc89f4c5dd4594cc3d5acee5d4f61cb36aec86d46c7d995ea497359c10f3fd**. Signature identique à l'application précédente. La fusion, le déploiement web et la distribution générale restent distincts de cette installation locale confirmée.

Les captures, y compris les confirmations affichant le compte, restent exclusivement locales. [Résultats expurgés et horodatages](2026-09-13-tools-search-phone.json). Non validés sur appareil : écriture mémoire, modification/suppression effective d'événement, lecture de pièces jointes binaires et opérations destructives de fichiers.
