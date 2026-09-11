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

Dossier : `D:\CodexData\worktrees\37fe\Project Arty`. Branche : `codex/tiktok-video-reading-20260911`, issue du commit `322b58e46d2dc39749ea0399a4e22766d6645e27`. Le commit de ce lot doit contenir uniquement les fichiers TikTok et leurs raccordements ; les modifications documentaires déjà présentes sont hors périmètre. Cette branche contient également des travaux antérieurs non publiés : ne pas publier son ensemble comme une modification TikTok isolée.

Prochaine validation utile : exécuter un parcours réel complet sur un environnement disposant de la clé Gemini et des protections habituelles d'Arty, puis vérifier l'accès TikTok depuis l'hébergement cible. L'enquête sur le fact-checking demandée ensuite constitue une mission séparée.
