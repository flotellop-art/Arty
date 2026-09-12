# Lecture TikTok dans les conversations — 11 septembre 2026

## Résultat et périmètre

Un lien TikTok public envoyé explicitement dans une conversation peut être récupéré avec son image et son son, puis décrit par Gemini 3.8 Flash. Les observations sont fournies au modèle choisi par l'utilisateur et conservées séparément du message original pour les questions suivantes et les relances. Le détail est consultable sous le message.

Limites : une vidéo par envoi, 180 secondes et 24 Mio au maximum. Les conversations limitées à l'Europe et les nouvelles demandes vidéo dans les parcours documentaires sont refusées avant récupération. Les observations déjà conservées restent utilisables dans les suivis documentaires. Une vidéo inaccessible produit une erreur explicite, jamais un résumé tiré de sa seule description.

La vidéo est une source non vérifiée : ses affirmations ne sont pas des faits établis. Le rapport ne peut pas autoriser la lecture d'autres liens vidéo. Les comparaisons et traitements de fond ne déclenchent pas cette récupération.

## Accès, coût et conservation

Le serveur utilise uniquement les cookies publics reçus pendant cette récupération, sans session TikTok de l'utilisateur. Les hôtes, redirections, durées et tailles sont contrôlés. Aucun lien signé ni cookie n'est enregistré dans la conversation. Le bouton d'arrêt et le changement de session empêchent la poursuite et la conservation tardive côté client.

L'analyse passe par le contrôle existant des clés, quotas et crédits. Elle ajoute un appel Gemini avant la réponse du modèle choisi. Une analyse déjà enregistrée pour le même lien est réutilisée, y compris lors d'une relance créant une branche. La réserve financière est calculée avant récupération avec un plafond conservateur. Le fichier Google temporaire possède un nom connu avant son envoi ; sa suppression est tentée en fin de requête, y compris après une erreur. Une panne réseau peut retarder cette suppression.

Le modèle dédié est `gemini-3.8-flash`, avec les réglages compatibles de cette génération. Le routage général des conversations et de la recherche ne change pas. La tarification client et serveur est partagée : 0,75 $ en entrée et 3,75 $ en sortie par million de tokens jusqu'au 31 décembre 2026, puis 1,50 $ et 7,50 $. Aucun gain de vitesse ou de fiabilité n'est encore mesuré sur Arty. Sources officielles vérifiées : [tarifs](https://ai.google.dev/gemini-api/docs/pricing), [migration](https://ai.google.dev/gemini-api/docs/generate-content/latest-model), [vidéo](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding), [fichiers](https://ai.google.dev/api/files).

## Preuves et limites de validation

- Récupération réelle du lien fourni avec le nouveau code dans le moteur local Workers : 20 491 813 octets, durée déclarée de 178 secondes ; décodage intégral image et son réussi avec FFmpeg. Commande reproductible : `node scripts/check-tiktok-retrieval.mjs https://vm.tiktok.com/ZN8jJBpVS/`.
- L'expérience contrôlée préalable sur ce lien a isolé la présence des cookies publics comme différence entre refus et succès. Ce résultat ne garantit pas l'accès à toutes les vidéos ni depuis une adresse Cloudflare hébergée.
- 205 tests réussis couvrant notamment paiement, essai, routage, sources vidéo, documents, projets, synchronisation et prix ; après le dernier correctif de relance, 52 tests réussis couvrant récupération, client, conversation TikTok et conservation des images.
- Contrôle TypeScript client et serveur réussi. Compilation finale `npm run build` réussie ; avertissements Vite sur les imports mixtes et la taille des fichiers produits.
- Deux contre-revues indépendantes en lecture seule ont challengé l'intégration. Leurs corrections concernent le nettoyage des fichiers, l'autorisation des liens secondaires et la réutilisation des analyses lors des relances.

Pas de clé Gemini disponible dans cet environnement : l'analyse réelle par Google et la comparaison mesurée 3.5/3.8 restent à vérifier. Les tests de cette étape simulent Google. Aucun déploiement hébergé ni paquet Android n'a été réalisé ; client et serveur doivent être livrés ensemble.

## Point de reprise

Candidat de livraison isolé : `D:\CodexData\worktrees\37fe\Arty-tiktok-release-20260911`, branche `codex/tiktok-release-20260911`, sur `origin/main` `9d01e34e81d3e228c2bf41dfdcccd4cfc957d6cd`. Le seul ajout TikTok `64b8ef9f` a été reporté en `11048de9`. Les conflits ont conservé le refus d'admission serveur et la garde de session de la recherche hybride. Le client TikTok a ensuite été raccordé au traitement actuel des refus d'essai et de crédits, avec 97 tests ciblés réussis après cette adaptation. Types, compilation, contrôles OAuth publics et export documentaire réussis. Deux contre-revues ont validé les raccords à cette nouvelle base.

La branche de développement initiale `codex/tiktok-video-reading-20260911` dans `D:\CodexData\worktrees\37fe\Project Arty` conserve les autres travaux de l'utilisateur ; ne pas la publier comme un lot isolé.

État Cloudflare vérifié le 11 septembre : production `9d01e34`, URL immuable `https://1394b9ff.appfacade.pages.dev`. La clé Gemini est configurée en production, mais son nom est absent des variables de Preview. La Preview utilise aussi la base `arty-db` de production. Aucune clé n'a été copiée, aucune configuration d'accès ou base modifiée. L'absence de clé locale n'implique donc pas l'absence de clé sur le site public.

Prochaine validation utile : un parcours réel complet du candidat avec une clé Gemini disponible et une identité Arty réelle, en sachant quels compteurs seront utilisés. Vérifier ensuite le modèle servi, la récupération depuis Cloudflare et le suivi sans seconde analyse. Une session de démonstration ou le serveur Vite seul ne prouvent pas ce parcours. L'enquête sur le fact-checking demandée ensuite constitue une mission séparée.
