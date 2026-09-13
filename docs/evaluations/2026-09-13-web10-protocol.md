# Dix demandes de recherche web dans Arty sur Android

Protocole fixé le 13 septembre 2026 avant l'envoi du premier essai. La sélection des références a reçu deux contre-revues indépendantes en lecture seule. Les questions exactes et les observations seront conservées dans le JSON du rapport.

## Périmètre

40 réponses : les mêmes dix questions pour Gemini 3.8 Flash, GPT-5.6 Luna, GPT-5.6 Terra et Claude Sonnet 5. Chaque envoi démarre une nouvelle conversation dans l'application installée sur le OnePlus 12R. Sélection manuelle du modèle, réflexion Auto, style Normal. L'ordre tourne à chaque question : Gemini/Luna/Terra/Sonnet, puis Luna/Terra/Sonnet/Gemini, puis Terra/Sonnet/Gemini/Luna, puis Sonnet/Gemini/Luna/Terra.

Version figée : **1.0.108 (109)** ; source fonctionnelle `31d1a4101bb96951ffa16f03c3f780a29c0017ce`. Aucun changement de l'application pendant la série. Les références officielles sont vérifiées séparément des réponses testées.

## Questions et faits attendus

| Cas | Domaine | Question | Faits attendus | Référence |
|---|---|---|---|---|
| Q01 | Espace | Europa Clipper : lancement réel, insertion prévue, planète orbitée | 14 octobre 2024 ; avril 2030 prévu ; Jupiter | [NASA](https://science.nasa.gov/mission/europa-clipper/mission-timeline/) |
| Q02 | Culture | Louvre : fermeture hebdomadaire, gratuité avant 18 ans, nocturnes mercredi/vendredi | mardi ; toutes nationalités ; 21 h | [Louvre](https://www.louvre.fr/visiter/horaires-tarifs) |
| Q03 | Voyage | Eurostar Londres–Paris, adulte Standard : bagages inclus | 2 grands ; 85 cm chacun ; 1 petit supplémentaire | [Eurostar](https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage) |
| Q04 | Informatique | Raspberry Pi 5 : processeur, fréquence, alimentation officielle recommandée | Broadcom BCM2712 ; 2,4 GHz ; Raspberry Pi 27W USB-C Power Supply | [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-5/) |
| Q05 | Sport | Finale du 100 m féminin aux JO de Paris 2024 : gagnante, pays, temps | Julien Alfred ; Sainte-Lucie ; 10,72 s | [Résultats officiels, p. 358](https://iaafmedia.s3.amazonaws.com/misc/olympics/OG2024_ATHLETICS.pdf#page=358) |
| Q06 | Science | Nobel de physique 2024 : deux lauréats et motif | John Hopfield ; Geoffrey Hinton ; découvertes et inventions permettant l'apprentissage automatique avec des réseaux neuronaux artificiels | [Nobel](https://www.nobelprize.org/prizes/physics/2024/press-release/) |
| Q07 | Patrimoine | Galápagos : pays et première inscription UNESCO | Équateur ; 1978 | [UNESCO](https://whc.unesco.org/en/list/1/) |
| Q08 | Consommation | Nouveaux appareils rechargeables par câble dans l'UE : port commun et dates smartphone/portable | USB-C ; 28 décembre 2024 ; 28 avril 2026 | [Commission européenne](https://commission.europa.eu/news-and-media/news/eu-common-charger-rules-power-all-your-devices-single-charger-2024-12-28_en) |
| Q09 | Musique | Eurovision 2024 : gagnant, pays, chanson | Nemo ; Suisse ; The Code | [Eurovision](https://www.eurovision.com/stories/switzerlands-nemo-wins-the-eurovision-song-contest-2024/) |
| Q10 | Internet | Wikipédia : lancement, hébergeur, statut lucratif | 15 janvier 2001 ; Wikimedia Foundation ; sans but lucratif | [Anniversaire](https://wikimediafoundation.org/wikipedia25/), [Fondation](https://wikimediafoundation.org/who-we-are/) |

Chaque question demande explicitement une recherche web, une réponse brève sans tableau et une ou deux URL officielles exactes. La saisie ADB emploie la même version française sans accents pour tous les modèles.

## Mesures distinctes

- **Exactitude** : un point par fait demandé explicitement correct ; zéro si faux ou omis. Q07 a deux faits, les autres trois. Chaque question a le même poids après normalisation. Un échec de livraison reste un échec ; il n'est pas retiré discrètement du dénominateur.
- **Sources** : examiner l'authenticité, la pertinence et les faits effectivement corroborés par les adresses affichées. Un domaine officiel seul ne suffit pas. Une redirection vers une page d'accueil ne prouve pas le fait demandé. Un accès automatisé refusé ne démontre pas une source fausse.
- **Restitution Arty** : distinguer les liens initialement fournis, leur éventuelle neutralisation ou substitution et le badge de vérification. Une vérification partielle n'est pas une preuve de fausseté. L'ouverture effective au clic sur téléphone doit être explicitement attestée pour être revendiquée.
- **Temps** : du clic d'envoi à la première capture montrant la disparition du bouton Stop après son apparition ; échantillonnage d'environ 1,7 s. La saisie du prompt est exclue. Une capture initiale et une capture après 30 s supplémentaires documentent le contrôle asynchrone. Le temps d'affichage de la réponse n'est donc pas celui d'une vérification exhaustive.

Limite de réponse : 120 s, puis arrêt de la génération si elle continue ; échec conservé. Pas de nouvelle tentative fournisseur pour améliorer le score. Une erreur de manipulation avant envoi peut être corrigée et documentée.

## Incidents de mesure et limites prévus dans l'analyse

Le premier essai Q01 Gemini a révélé une détection du bouton Stop incompatible avec le thème sombre. La réponse est conservée mais son temps précis n'est pas exploitable ; la détection a été corrigée avant l'essai suivant. Pour une comparaison temporelle appariée, le bilan principal utilisera Q02–Q10 pour les quatre modèles. Les ajustements du harnais de capture ne modifient pas l'application.

Ce petit échantillon teste des demandes factuelles courtes et des liens, dans dix domaines. Plusieurs faits sont historiques et peuvent être connus sans recherche. Une réponse correcte, une URL plausible ou un badge ne prouvent pas, à eux seuls, l'exécution effective d'une recherche web. Les preuves visuelles de l'application, les validations externes des pages et les traces d'outils disponibles sont rapportées séparément. Les résultats mesurent l'ensemble application–modèle–réseau ; ils n'isolent pas la qualité intrinsèque du fournisseur et ne constituent pas un classement universel ou une mesure de recherche approfondie.
