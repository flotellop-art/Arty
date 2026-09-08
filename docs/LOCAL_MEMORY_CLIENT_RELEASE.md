# Souvenirs personnels : lot client indépendant

8 septembre 2026. Base `19941871e79d62004aa145d4b7fb2ffaf7169d94` (#496),
confirmée par `git ls-remote origin refs/heads/main`. Branche
`codex/memory-client-release-20260908`. **Local, non publié.** La branche
locale nommée main étant périmée, elle n'est pas utilisée comme base.

## Ce que cette livraison corrige

Une liste mémorisée devenait illisible par le lecteur JSON après chiffrement.
L'ajout suivant pouvait écraser les anciens souvenirs. Le lecteur hydrate
maintenant les anciennes listes JSON ou chiffrées, et les mutations attendent
une seule écriture chiffrée de la liste complète. Les deux tests de régression
originaux gardent leurs assertions de conservation A puis A+B.

Le cache est détaché et lié au compte, à la clé et au document courants. Une
lecture invalide n'autorise pas de liste vide écrasante. Les attentes sont
bornées côté consommateur ; un résultat périmé ne peut plus être publié.
Les anciens contenus longs et champs supplémentaires ne sont pas supprimés.
Le slot `local-memory-facts` et son inventaire d'effacement restent inchangés.

La modale distingue chargement/indisponible/vide, conserve le brouillon en cas
de panne et attend la persistance. Auth hydrate sans bloquer toute la connexion
sur une mémoire corrompue. Stop fonctionne pendant la préparation du chat ;
le prompt du tour est figé avant les attentes pour garder langue, consignes et
contexte Google filtré. La mémoire automatique attend désormais ses mutations,
ne remplace pas un fait modifié entre-temps ou transmis partiellement, et ne
réessaie pas automatiquement un préfixe dont la réponse est perdue.

## Périmètre exact et compatibilité

- Sept fichiers TypeScript/TSX : localMemoryService, localMemoryWait,
  autoMemory, LocalMemoryModal, useAuth, useAppSetup, useConversation.
- Trois traductions ajoutées à chaque locale FR/EN, par hunks uniquement.
- Huit suites client portées, plus le parcours `autoMemory.publicHandler`.
- Aucun changement dans functions, migrations, schéma, paramètres, package,
  workflow, handlers TTS/géo, souscriptions ou crédits. Les commits des
  branches préparatoires financières ne sont pas fusionnés.

Le body reste `{transcript,facts}`, l'en-tête Google est inchangé et la réponse
reste `{add,replace}`. Les dépendances de scope, crypto, grant et workspaceWriter
étaient déjà présentes à #496. Aucune politique D1 gratuite n'est requise pour
ce lot client. Cela ne signifie pas que le plafond de dépenses serveur est
activé ou terminé : l'ancien handler conserve ses limites actuelles.

## Preuves et réception

Le test `autoMemory.publicHandler.test.ts` raccorde le véritable client au
handler public inchangé, avec SQL exécuté par SQLite local et le vrai
chiffrement. Fournisseur et identité Google sont synthétiques : aucun appel
payant, aucune connexion Google externe, pas une recette native D1/workerd.
Trois tests PASS à05:35:05,1,46s : A+B puis recharge chiffrée, protection d'un
fait long contre remplacement partiel, cap quotidien429 sans réessai ni perte.
La première exécution échouait dans la fixture de chemin schema.sql sous
jsdom, avant toute action ; son chemin a été corrigé puis reçu avec succès.

Reçus supplémentaires, non additionnables :

- 99764 TERMINAL exit0 : types, **120PASS/9suites**,33,48s, début05:36:52,
  build7,68s et véritable worker Office. Avant les deux canaris ACK UI.
- Message d'erreur FR/EN neutralisé après contre-revue : une vraie suppression
  suivie d'un ACK perdu ne permet pas d'affirmer que rien n'a été effacé.
  Les deux canaris ont reproduit cette affirmation fausse, puis la relecture
  du vrai ciphertext vide a été validée. Aucun rollback des données.
- 13PASS/2suites,4,05s,05:40:29 : dix cas modale et trois parcours publicHandler.
  Tous les appels réseau sont enregistrés avant routage et leur liste exacte
  est vérifiée, y compris au cap429 ; pas de callback dont l'erreur avalée
  masquerait une requête inattendue. Une assertion de fin d'hydratation attend
  effectivement ready, pas seulement la disparition anticipée de l'alerte.

Les contre-revues indépendantes portent sur le client et sa compatibilité,
pas sur une activation du financement gratuit. La validation globale du
candidat préparatoire mémoire ne vaut pas réception de cet arbre différent.

Avant publication, recevoir sur cet arbre :

- Tests ciblés auth/chat/Stop/mémoire/restauration, puis vérification complète
  addon/no-CASA/types/couverture/build/worker Office.
- Deux avis finaux indépendants et diff ne contenant que ce périmètre.
- PR/CI, build Pages identifié et chaîne Android existante.
- Recette versionnée : souvenir A, ajout B, fermeture/rechargement, édition,
  suppression, changement de compte, erreur de stockage. Vérifier ensuite
  PWA et APK signé identifié, sans confondre distribution et installation.
- Observation après livraison ; toute perte A+B, donnée de A visible chez B,
  blocage du chat/Stop ou échec de connexion est un arrêt de réception.

## Repli et limites

Ne pas effacer les souvenirs, changer de clé ni convertir en clair pour
contourner un problème. Un retour vers l'ancien lecteur réintroduirait le
défaut : pas de rollback aveugle ni d'affirmation qu'un ancien APK est réparé
par la mise à jour du site. En cas de régression, conserver les données et
préparer un correctif versionné ; toute suspension protectrice des écritures
doit être explicite et testée, pas une suppression de stockage.

Le verrou de document protège les clients coopérants actuels ; les vérifications
d'octets ne sont pas une primitive atomique entre anciens bundles. La recette
de coexistence des APK demeure nécessaire. Le service de consignes personnelles
emploie encore le mélange lecture JSON/écriture chiffrée : il n'est pas corrigé
par ce lot. Ni synchronisation complète, ni paiement réel, ni anti-multi-compte,
ni préférence face à Mammouth ne sont déclarés terminés.
