# Anthropic : un POST ne doit pas suivre une redirection

8 septembre 2026. Lot issu de `9d01e34` (#498), indépendant des candidats de
budget et de facturation. Aucun schéma, configuration, clé ou scope modifié.
État : correctif local reçu sur les tests ciblés ; vérification complète en
cours, aucune publication encore attestée.

## Défaut et correction

Le transport natif suivait les redirections par défaut. Le témoin workerd
307 a réellement observé un second POST à une autre origine, avec la même
clé `x-api-key` synthétique. Ce n'est pas la preuve d'une exploitation en
production, ni d'une fuite d'une vraie clé.

Le vrai handler impose `redirect: manual`. Toute réponse 3xx est arrêtée
avant lecture du corps ; aucune destination, aucun corps amont et aucune
clé ne sont communiqués à l'appelant, y compris BYOK. La demande d'annulation
du corps n'attend pas son acquittement. Son rejet est absorbé.

Un appel wallet a déjà été envoyé : une redirection ne prouve pas un coût nul.
Le handler réutilise le contrat existant `usageMeasured: false` de `wallet.ts`,
qui règle la réservation entière, sans inventer de mesure ni rendre le hold.
Les autres financements ne reçoivent aucun débit wallet. Les métadonnées du
compteur d'essai réellement consommé restent renvoyées.

La réponse `409 / upstream_outcome_unknown` est terminale pour la boucle
HTTP Anthropic existante (retries sur 429/529/5xx). Le nouveau client affiche
une explication FR/EN et propose de vérifier son solde avant de réessayer.
Ce code reste distinct de `wallet_reconciliation_pending` et ne ferme ni
les droits, ni les caches wallet. Aucun repli fournisseur dans le chemin
`runWithTools → useConversation.onErr` relu. Les anciens clients contenant
cette même boucle ne réessaient pas les409 ; ce n'est pas une recette de tous
les APK distribués, et leur ancien texte peut afficher le code machine brut.

## Preuves reçues

- Avant correctif,26tests :23échecs /3réussites,16,77s,10:08:46.
  Dix canaris transport et treize canaris D1 rouges ; témoins positif de
  redirection réelle et succès ordinaires verts.
- Deux canaris client FR/EN supplémentaires rouges,1,78s,10:09:56.
- Après correctif,104tests /3suites réussis,17,52s,10:10:33,session48984
  terminée avec exit0. Inclut toute la suite de refus de financement composée.
- Transport workerd :301/302/303/307/308 × clé Arty/BYOK ; nombre exact
  d'URLs/méthodes/clés, témoin volontairement vulnérable, réponses ordinaires.
- D1 local réel : cinq statuts, règlement unique et montant exact, témoins
  Free/trialGoogle/OTP/abonné/VIP/BYOK ; annulation de corps rejetée ou pendante.
- Client réel + authentification/crypto/caches synthétiques : erreur localisée,
  un seul appel, aucun token/tool/done, compte/essai/wallet inchangés.
- Deux contre-revues indépendantes en lecture seule. Leurs objections ont
  fait abandonner l'ajout prématuré d'un signal d'annulation et remplacer
  le502 réessayable proposé par un409 terminal.
- `npm run verify`,session62351 : TERMINÉ exit1. Coverage lancée10:12:05,
  226,50s ;384suites,366réussies/18échouées ;5425tests réussis/205échoués/
  27ignorés. Types/addon/no-CASA reçus ; build et worker Office non atteints.
  Les erreurs incluent `connect EADDRINUSE 127.0.0.1` dans Miniflare et des
  délais de hooks. Le défaut de concurrence quotidienne ne devient pas
  automatiquement un faux positif : contre-épreuve isolée nécessaire.
  Machine12cœurs ; cette campagne n'avait pas repris le réglage de deux
  workers déjà utilisé dans les réceptions antérieures. Aucun seuil/délai/
  assertion métier ne sera modifié pour sa reprise contrôlée.
- Contre-épreuve après la fin de62351 :31tests /2suites réussis,34,16s,
  10:17:17,session50426 terminée exit0. `accountDelete` et tous les cas de
  `d1.subsidizedDailyQuota`, dont le concurrent, inchangés et à un worker.
  Cela qualifie ces deux suites, pas tous les205échecs de la campagne.
- Reprise complète avec `VITEST_MAX_WORKERS=2; npm run verify` en cours
  après ces terminaux ; mêmes sources/assertions/délais/couverture.

Toutes les destinations et clés des tests sont synthétiques, transport
intercepté localement. Aucun achat ou appel fournisseur réel facturé.

## Ce que ce lot ne corrige pas

- Le plafond partagé des appels de chat. Le candidat préparatoire séparé
  `Arty-subsidized-memory-20260908` porte trois nouvelles régressions D1 rouges
  (`d1.anthropicSubsidizedGap.test.ts`) : budget nul, aucun ticket, mais un
  POST pour Free, essai Google et OTP. Pas de classement en réussite attendue.
- Les bornes financières d'une recherche native avec ses ré-inférences,
  les options tarifaires, le cache et les modèles non épinglés du chat.
  Une taille JSON maximale ou cinq recherches ne démontrent pas à elles
  seules un coût maximal par POST. Ne pas désactiver silencieusement la
  recherche ni présenter le calcul approximatif wallet comme une telle preuve.
- Les erreurs réseau/4xx/5xx historiques, la perte de règlement en cas de
  panne D1, le lien Stop/transport et le cycle SSE/EOF. Aucun signal nouveau
  ni changement du tee comptable dans ce lot. Ces dettes restent ouvertes.
- Les cinq scénarios financiers du candidat indépendant, le paiement réel,
  la sync deux appareils, la recette du dernier APK et les résultats W10.

## Publication et repli

Avant livraison : recevoir la vérification complète et qualifier tout échec,
les deux accords de revue, CI et aperçu Pages sur le commit exact. Vérifier
le rendu et la disponibilité publics sans POST payant de diagnostic. Recevoir
la distribution Android séparément de l'installation physique. Observer la
version publiée quinze minutes selon la procédure existante.

Ne pas importer les migrations/politiques préparatoires. Le refus de permission
D1 distant10000 reste un arrêt, pas une invitation à une autre identité.
Un repli sur l'ancien code réouvrirait le suivi des redirections : préférer
un correctif en avant conservant `manual`, ou une suspension explicitement
autorisée du chemin concerné si une régression critique est démontrée.
