# Luna : essai gratuit et contrôle sur téléphone

## Résultat et périmètre de livraison

Candidat fonctionnel : `190eb364c898870a7f502b6b65fed14438872a58`, branche `codex/luna-factcheck-20260913`, [PR 513](https://github.com/flotellop-art/Arty/pull/513), empilée sur la PR 512. Le commit `2e51aa95d81ae79f82514d81a9f93435a79af14e` actualise uniquement les assertions de collecte du routage.

Luna devient le choix Auto des discussions ordinaires et recherches factuelles simples lorsque le compte y a accès. Les demandes initiales reconnues d'agenda, mails et mémoire utilisent ses outils personnels portables sans recherche publique. Les parcours spécialisés gardent leurs règles ; les conversations contenant déjà un historique privé restent traitées prudemment. Terra reste disponible au choix manuel pour les comptes éligibles.

L'essai serveur autorise exactement `gpt-5.6-luna`. Il n'ouvre pas Terra, Sol, Astra, ni les autres modèles de la famille complète OpenAI. Le cache du téléphone indique la disponibilité ; seul le serveur authentifie le compte et décide du débit réel.

**Limite de l'offre actuelle : 30 appels au modèle, pas 30 échanges complets garantis.** Une demande utilisant des outils peut nécessiter plusieurs appels décomptés. Le texte d'aide l'indique. Cette unité de facturation existante n'a pas été remplacée par un identifiant de continuation fourni par le client.

Les appels Luna financés par l'essai sont bornés à 65 536 octets de JSON UTF-8 et 4 096 tokens de sortie maximum, une réponse et le tarif standard. Un refus ou un échec fournisseur rembourse le débit. Un historique ou résultat d'outil volumineux peut dépasser la limite ; une action déjà effectuée avant ce refus n'est pas annulée par le remboursement.

## Validation du compteur

Les tests `d1.lunaTrialProxy.test.ts` exécutent le vrai proxy, l'admission et les remboursements dans workerd/D1 local, avec fournisseur simulé. Pour chaque type de compte, Google et email, 30 appels servis sont acceptés ; le 31e est refusé sans nouvel appel fournisseur. Après un appel servi, les refus Terra et erreurs fournisseur préservent effectivement le compteur attendu. Les tests d'admission D1 existants couvrent également la concurrence sur le dernier crédit.

Cela valide le code et la base locale. Le compte du propriétaire utilisé sur le téléphone n'est pas un compte d'essai créé pour cette campagne. Aucun compteur réel de client n'a été réinitialisé pour les tests.

## Quatre essais réels dans l'application Android

OnePlus 12R, application `com.arty.app`, APK **1.0.109 / code 110**, installé avec conservation des données. Signature vérifiée et identique à celle de l'APK précédemment installé. SHA-256 : `5ba4e8b43c406be502d5ba92648dbb2e04de100b2673e2905af6fff07530aa8c`.

Chaque demande est partie d'une nouvelle conversation en Auto, sans renvoi ni régénération. Les quatre panneaux de détail affichent le modèle demandé et le modèle signalé par le fournisseur : **`gpt-5.6-luna`**.

| Essai | Résultat observé | Fin de génération détectée |
|---|---|---:|
| Organisation de la journée en deux phrases | Réponse en deux phrases | 3,4 s |
| Date du lancement d'Europa Clipper, source NASA | 14 octobre 2024 et lien NASA affichés | 6,6 s |
| Lecture de l'agenda, sans modification | Réponse numérique rendue, route d'outils personnels attestée | 5,0 s |
| Rapport « Test Luna », lignes 10 € et 12 € | Rapport créé, lien ouvert puis rouvert ; deux montants présents | 5,0 s |

Les durées vont du clic d'envoi à la première capture où le bouton d'arrêt a disparu. L'échantillonnage est d'environ 1,6 seconde ; ce ne sont ni des temps réseau exacts ni des médianes de performance. Le nombre de rendez-vous n'a pas été confronté indépendamment à un export du calendrier ; les informations d'agenda privées ne sont pas republiées.

Les captures et journaux restent locaux dans `.playwright-mcp/luna-phone-20260913`. Le [reçu JSON](2026-09-13-luna-trial-phone.json) contient les empreintes des preuves sélectionnées, les horodatages et l'identité de l'APK, sans copies des écrans du compte. Le téléphone a été rendu à l'accueil en mode Auto.

## Vérification factuelle : limites observées à traiter séparément

Le premier essai affiche un contrôle temporairement indisponible. Le deuxième finit en vérification partielle, avec 0/5 affirmations accompagnées de preuves contrôlées. Le rapport local finit également en vérification partielle, 0/2, et affiche une carte de recherche sans rapport avec le document, « Test et avis de Luna Capital ». Le lien du rapport reste fonctionnel après cette étape.

Ces observations ne permettent pas d'attribuer l'échec à un fournisseur ou au quota. Elles montrent que la chaîne de vérification complète sur téléphone n'est pas validée. Elles sont le point de départ d'une mission distincte : reproduire l'indisponibilité, contrôler la pertinence de la recherche sur un rapport local et vérifier la conservation des citations fidèles avant toute application automatique d'une correction.

La [comparaison séparée de 56 appels réels](2026-09-13-factcheck-models.md) teste le jugement des modèles sur huit dossiers documentaires figés : Sonnet 5 et Gemini 3.6 réussissent 8/8 ; les cinq autres 7/8. Elle ne remplace pas cette recette de bout en bout. Le correcteur de production reste inchangé.

## État de publication

Typecheck client et fonctions, build Vite, contrôles d'autorisations Google source et bundle Android, et compilation de l'APK release réussis. Le contrôle Android GitHub du candidat fonctionnel a également réussi. La première campagne GitHub a trouvé trois assertions obsolètes dans `gatherRouteInput`, avec 6 090 autres tests réussis ; les assertions ont été corrigées et les 22 tests du fichier ont ensuite réussi.

Le candidat fonctionnel dispose d'une [préversion Cloudflare](https://fd3f494e.appfacade.pages.dev). L'APK installé continue d'utiliser l'API de production `https://tryarty.com` : les essais du téléphone ne prouvent donc pas le déploiement du nouveau contrôle d'essai sur cette API. Aucune fusion en production ni distribution Firebase générale n'est attestée par ce lot.

La campagne complète locale a réussi : 413 fichiers, 6 093 tests réussis et un ignoré, en 1 001 secondes avec deux workers. La campagne GitHub du commit `2e51aa95` a ensuite réussi : tests avec couverture, typecheck, build, contrôles Android et orchestration. Son [exécution complète](https://github.com/flotellop-art/Arty/actions/runs/34778325397) est conservée dans le reçu. Les ajouts documentaires ultérieurs ne modifient ni ce code ni l'APK testé.
