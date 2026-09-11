# Fact-checking : preuves, contexte et contestation indépendante

Suite explicitement autorisée au premier lot `9324324` décrit dans
`FACT_CHECK_INTEGRITY_20260911.md`. Branche de livraison :
`codex/fact-check-integrity-20260911`, PR #502, base main `9d01e34`.

## Comportement livré pour revue

1. La passe approfondie propose une correction et des sources. Le serveur lit
   au maximum trois pages via le service Linkup existant, puis fait contrôler
   les affirmations et corrections ensemble à partir du texte des pages.
   Le contrôle demande de vérifier personne, date, version, pays, restrictions,
   négations et contradictions. Rapporter fidèlement un propos faux dans une
   vidéo ne doit pas être corrigé comme si l'agent affirmait lui-même ce propos.
2. Un extrait doit exister exactement et sans ambiguïté dans une page lue.
   Le reçu contient URL, extrait, contexte autour de l'extrait, empreinte du
   texte lu et date de consultation. Cette date n'est pas une date de publication.
   Le reçu est lié à l'affirmation et au remplacement exacts ; la normalisation
   des passages est partagée par le serveur et le client, sans troncature des
   cibles de remplacement.
3. Pour une correction sensible soutenue par une preuve, un autre fournisseur
   cherche activement une erreur : Gemini après Claude, Claude après Gemini.
   Le modèle servi doit être attesté par la réponse du fournisseur. Aucune
   reprise vers le premier fournisseur n'est autorisée à cette étape.
   Échec, objection ou preuve insuffisante interdisent la correction automatique.
4. Gemini 3.8 Flash est un choix explicite dans les réglages. Il devient le
   premier secours Gemini, suivi de 3.6 puis 3.5. Le parcours automatique
   conserve Haiku puis Sonnet : aucun gain mesuré ne justifie encore de remplacer
   ce choix par défaut. Haiku seul peut proposer, mais ne certifie pas les preuves.
5. Les preuves et objections sont consultables dans le détail du contrôle et
   conservées dans les sauvegardes et la synchronisation. Un contrôle partiel
   n'applique aucune correction, même si certains points ont leurs preuves.
   Une réponse modifiée pendant la recherche ou la vérification reste intacte.

## Limites et coûts

- Authentification et accès subscription/VIP inchangés. Les nouvelles opérations
  exigent une consommation atomique confirmée ; absence ou panne de D1 bloque
  l'appel payant au lieu de poursuivre sans plafond.
- Plafonds conservés : 60 premières passes Haiku/jour et 15 appels approfondis
  partagés entre Sonnet, Gemini, lectures de preuves par modèle et contestations.
  Une vérification complète sensible consomme donc jusqu'à trois unités de ce
  second plafond. Pages Linkup : au plus 45 lectures/jour et trois par requête.
- Aucun téléchargement d'URL arbitraire depuis le Worker : URL publique validée
  transmise uniquement à l'endpoint fixe Linkup. Aucun cookie ni texte de la
  conversation transmis à ce service de lecture. Pas de cache inter-utilisateurs.
- Chaque page : 160 000 octets de réponse, 20 000 caractères de Markdown,
  12 secondes au plus. Une page trop grande ou explicitement tronquée est refusée.
  L'empreinte atteste le texte retourné par Linkup, pas l'intégralité du site.
- Une requête serveur : délai global 70 s pour Haiku, 125 s pour une passe
  approfondie ; nouvelles revues sans reprise, 35 s et 4 000 tokens chacune.
  Les erreurs upstream restent masquées. Les reprises historiques de première
  passe restent possibles dans le délai global.
- Les consommations des nouvelles revues sont comptées en D1 et relayées au
  compteur local. Le prix du service de lecture et les appels interrompus sans
  relevé fournisseur ne sont pas une facture complète dans ce compteur.
- Gemini 3.8 : prix standard d'entrée/sortie de 0,75/3,75 USD par million de
  tokens jusqu'au 31 décembre 2026, puis 1,50/7,50 à partir du 1er janvier 2027.
  Lecture de cache : 0,075 puis 0,15. Recherche : borne analytique de 14 USD pour
  1 000 requêtes, distincte de la facture et de l'allocation gratuite partagée.
  Le tarif et son expiration sont partagés par client et serveur.

Sources officielles consultées le 11 septembre 2026 :
[modèle](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[tarifs](https://ai.google.dev/gemini-api/docs/pricing).
`generateContent` conservé ; réflexion `low`, car `minimal` n'est pas pris en
charge par 3.8. La tarification des autres modèles reste hors de ce lot.

## Validation et limites de preuve

- `npm run typecheck` : réussi pour le client et les fonctions serveur.
- `npx vitest run --coverage --maxWorkers=2 --testTimeout=15000` :
  **5 737 tests réussis, un ignoré, 385 fichiers réussis**, en 1 082,38 secondes.
  Le délai de test de 15 s conserve le réglage Windows déjà nécessaire pour les
  tests D1 de concurrence ; aucune assertion ni limite du produit n'est relâchée.
  Contrairement au premier lot, cette campagne complète est verte.
- Couverture : 77,93 % des instructions, 72,60 % des branches, 83,09 % des
  fonctions et 80,27 % des lignes, au-dessus des seuils du projet.
- Compilation Vite, contrôle du worker Office, manifeste de l'add-on et
  autorisations Google : réussis. Avertissement existant sur la taille de
  certains fichiers JavaScript conservé.
- Le code et les tests sont restés figés pendant la campagne complète ; seules
  la documentation et les données préparatoires publiques ont été complétées.

Deux contre-revues en lecture seule ont contesté le diagnostic avant le code,
puis examiné les changements. Leurs objections ont corrigé : l'écrasement après
recherche de liens, l'identité supposée du second modèle et le décalage entre
la cible contrôlée côté serveur et celle remplacée côté client.

Les tests nouveaux emploient des documents et réponses de modèles synthétiques.
Ils exercent le véritable endpoint, la lecture des pages, les deux sens de
contestation, l'admission, les citations inventées/répétées, les décisions
incomplètes, les reçus pour une autre cible, la concurrence et la persistance.
Ils attestent le fonctionnement du protocole, pas la justesse des jugements
des modèles sur des sujets réels.

La pertinence d'une preuve reste un jugement de modèle. Deux modèles peuvent
partager une erreur ; un extrait exact peut rester trompeur. Une page manquante,
ancienne, trop longue, un paywall ou une limite de quota peut imposer l'abstention.
Le contrôle ne garantit ni une recherche exhaustive ni la détection de tous les
faits omis par la première passe.

La recette réelle Gemini + Linkup et une mesure comparative de précision,
coût et durée restent à effectuer : ces deux clés ne sont pas disponibles dans
le contexte local. Aucune clé de production n'a été copiée vers la preview.
Aucun remplacement du modèle par défaut, merge, déploiement de production ou
validation Android réelle n'est prétendu ici. Les nouveaux contrôles nécessitent
le client et le serveur de ce lot ; un ancien client ne connaît pas les reçus.

## Protocole de comparaison à exécuter avant de changer le défaut

Un premier jeu de six cas publics, par paires correcte/incorrecte, est préparé
dans `evaluations/fact-check-public-seed-20260911.json` : histoire de la hauteur
de la tour Eiffel, unités de vitesse dans le SI et distance de L2 pour Webb.
Les trois pages primaires ont été lues le 11 septembre 2026 ; les réponses de test
sont rédigées, et aucun résultat de modèle n'est prétendu. Ce jeu ne remplace pas
les cas sensibles ni l'archivage des pages complètes lors de l'évaluation.

Conserver un corpus daté avec question, réponse, documents figés, URL, empreinte
et réponse attendue cachée aux modèles. Comparer les mêmes dossiers dans les
deux sens Sonnet/Gemini, avec modèle réellement servi, reprises et consommation
de chaque étape. Séparer cette comparaison de jugement d'un second essai où les
modèles cherchent eux-mêmes les pages. Commencer par deux paires seulement pour
respecter le plafond partagé, puis examiner les erreurs avant d'élargir.

Cas à inclure et leurs variantes correctes inédites : correction justifiée,
homonyme, citation TikTok fidèle de propos faux, négation avec exception, mauvaise
version, promotion expirée, pays/devise/taxes, sources contradictoires, instruction
hostile dans une page sans preuve, valeur répétée, restriction d'âge médicale et
rendement financier présenté à tort comme garanti. Les fixtures fictives servent
au contrôle de procédure ; compléter par des cas publics sourcés avant toute
affirmation d'amélioration en situation réelle.

Rapporter les nombres de corrections justes et nuisibles, affirmations correctes
accusées à tort, faux verdicts vérifiés, erreurs manquées et abstentions justifiées
ou excessives. Vérifier la pertinence des citations à l'aveugle du modèle ; son
accord avec un autre modèle n'est pas la vérité attendue. Inclure échecs et délais
dans les résultats. Avec un petit corpus, publier chaque erreur plutôt qu'un
classement ou un percentile donnant une précision illusoire.
