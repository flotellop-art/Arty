# Consignes personnelles — conservation et utilisation réelles

8 septembre 2026, candidat basé sur `22444494a409fc314cb628e98668c3914247df5f`
(PR497 mémoire déjà publiée). Branche `codex/custom-instructions-20260908`.
Statut : corrigé et reçu localement sur les parcours ci-dessous, pas encore publié.
L'objectif complet W01–W10, abonnements/crédits et anti-abus reste ouvert.

## Défaut, décision et périmètre

Le getter JSON retournait un faux vide après l'écriture chiffrée. Le setter
appelé ensuite au blur pouvait effacer la consigne précédente. Les deux
oracles initiaux avec WebCrypto réel sont passés de RED (06:26, 1,60 s) à
PASS sans modifier leurs assertions de conservation. Pas de refactor global
de scopedStorage ni de suppression/migration des données.

Service dédié dans le slot existant `custom-instructions` : hydratation
stricte, snapshot durable synchrone, erreurs distinctes du vide, mutations
attendues et ordonnées avec un seul ciphertext. Scope propriétaire/epoch/clé,
admission documentaire et fences revérifiés ; comparaison des octets avant
écriture et relecture immédiate. Les textes historiques longs restent lisibles,
le plafond 500 ne s'applique qu'aux nouvelles modifications explicites.

Une interface remplaçant tout le texte doit fournir sa base exacte et la garde
du propriétaire de son brouillon. Après un échec, les commandes déjà en file
sont révoquées et une nouvelle lecture est requise. Une lecture débutée avant
l'échec ne peut pas réarmer la nouvelle génération. Aucun rollback automatique
si les octets ont été écrits mais que leur acquittement est perdu.

Le vrai champ Réglages conserve les brouillons, n'écrit pas au blur inchangé,
verrouille blur/clic avant le premier await et indique les erreurs honnêtement.
La relecture ne remplace pas une saisie : si le durable a changé, un choix
explicite décide quelle version garder. Un champ propre suit une nouvelle
version durable ; un brouillon ancien n'est pas présenté comme enregistré.
Fermeture et transitions vers les outils d'archive demandent confirmation avant
abandon d'une saisie non confirmée. Timeout/démontage révoquent l'écriture tardive.

Bootstrap, login après rememberSession et changement de compte hydratent les
consignes en parallèle des souvenirs, sans rejeter une connexion valide pour
une corruption locale facultative. Le chat attend avec son contrôleur Stop,
reconstruit son prompt puis le fige par tour. Les nouvelles consignes s'appliquent
au tour suivant, pas rétroactivement à un tour préparé. Les prompts documentaires
dédiés, serveurs, modèle de financement et scopes Google sont inchangés.

## Contre-revues et stratégie de tests

Deux revues indépendantes en lecture seule, produit et sécurité, avant code
puis sur le diff : objections intégrées pour la base exacte du brouillon,
la file après erreur, les sous-vues d'archives et le statut d'un éditeur périmé.
Les deux avis finaux donnent un GO local borné, pas une réception de production.

La stratégie de tests couvre le vrai chiffrement, les interactions du champ,
les vrais consommateurs auth/chat et un navigateur natif ; les fournisseurs
sont synthétiques. Aucun paiement ni appel IA externe n'est requis.

Reçus recouvrants, non additionnables :

- Deux suites, six tests PASS, 1,98 s à06:39:39 : oracles initiaux et constructeur.
- Trois suites, onze tests PASS, 5,69 s à06:43:08 : parcours mémoire/auth/chat existants.
- Deux suites, 24 tests PASS, 4,84 s à06:46:19 : durabilité et UI avant les derniers canaris.
- Six suites, 49 tests PASS, 13,49 s à06:48:48, session23908 TERMINAL exit0 :
  corruption, clé erronée, historique, effacement explicite, queue, ACK perdu,
  quota, source changée, base périmée, relecture ancienne, Settings/archives,
  auth Google/email synthétique, bootstrap/switch, vrai prompt et Stop.
- Deux suites UI, 13 tests PASS, 4,67 s à06:50:45 : incluant timeout et
  vraie transition useAuth A→B→A pendant une écriture suspendue.
- Types front/back PASS. Build7,30 s puis véritable worker Office dans VM
  PASS, session42251 TERMINAL exit0. Avertissements de taille/import préexistants.
- Vérification complète finale à recevoir sur le candidat figé ; aucun total
  de campagne globale n'est acquis par les reçus ciblés ci-dessus.

## Recette navigateur froide

Surface locale authored `.playwright-mcp/custom-instructions-browser-recipe`
dans le workspace opérationnel : vraie admission DocumentWorkspaceGate,
vrais SettingsModal/CustomInstructionsField, WebCrypto et localStorage natifs.
Port53198, aucune route API/proxy, CSP connect-src none ; origine et données
locales contrôlées avant toute identité synthétique. Aucun compte réel ni jeton.
Le serveur enregistre les empreintes des sources et refuse de servir après
modification d'un module concerné.

Recette via CUA, onglet27, entre06:53 et06:56 Paris :

1. Profil A : saisie UI multiligne `RECETTE A — Vouvoie-moi.` puis
   `Réponds en français, avec les unités m² et €. 🧱`, sauvegarde confirmée.
   SHA256 ciphertext `1d816652dd578867d7b65a2f24c970c10d09235ed8723756ab792556121fd6b6`.
2. Recharge complète du document, relecture puis ouverture des vrais Réglages :
   texte exact retrouvé, même empreinte. Focus du champ puis fermeture sans
   modification : même empreinte, aucune réécriture.
3. Navigation complète B : vide légitime et slot absent, aucune consigne A.
   Saisie UI `RECETTE B — Donne des réponses courtes.`, ciphertext SHA256
   `551bda873f83b7c341d438d74b24cacd87fb4da789a1479fc05cb4584656c4d2`.
4. Retour complet A : texte original retrouvé et SHA identique au point1.
5. Contrôle serveur à06:56 :693GET, zéro /api, sources inchangées. Le compteur
   local ne remplace pas une capture réseau navigateur globale ; CSP interdit
   les connexions et aucun backend n'existe dans cette surface.

Premier chargement du harnais : optimisation Vite ayant chargé deux modules
React, Invalid hook call. Une recharge après stabilisation a permis la recette,
sans modification applicative. Cet incident de harnais n'est pas masqué.

Empreintes principales reçues : service
`7b7019416ac2e8acf7767ea2be75bb8aceb7827d57d7a15a7a46f312f45451af`, champ
`4e75e573ee94d158623ce3ff648c2caa40237fad14c45869e1fbad8be80a1ddb`, Settings
`0149f5acb27146971a23407708a075db12b02800e17b5015661bed772674beb7`.

Portée : composants/source locaux, profils synthétiques à froid et navigateur
natif. Pas de bundle de production exécuté, OAuth fournisseur, PWA/APK installé,
layout isolated-v1 ou recette distante d'effacement. Les tests A→B→A chauds
exercent useAuth réel en jsdom, pas Google connecté.

## Publication, compatibilité et condition de fin

Recevoir la vérification complète addon/no-CASA/types/couverture/build/Office,
puis PR/CI, version Pages identifiée et contrôle post-publication. Distribuer
par la chaîne Android existante ; distribution ≠ installation physique.
Ne pas réintroduire le lecteur JSON ancien par rollback aveugle ni convertir
les consignes en clair. Les vieux APK ne sont pas corrigés rétroactivement.
Le verrou protège les clients actuels coopérants ; les raw checks ne sont pas
un CAS entre anciens bundles. Aucun changement de D1, facturation, budget,
sync ON, package, schéma ou workflow dans ce lot.
