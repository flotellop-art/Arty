# W09 — transport API des anciens APK

6 septembre 2026. Travail local validé, publication encore à confirmer. Base main
`3d99585bcf001500bf9a2b0f1bf48073ab914d24` (#470), branche
`codex/mobile-compatibility`.

## Problème vérifié et contrat

La demande historique précise que les APK déjà installés (notamment 1.0.97)
peuvent encore utiliser `appfacade.pages.dev/api/…`. Une redirection de page
ne doit pas interrompre leur transport API. Il ne s'agit ni de modifier un
APK déjà installé à distance, ni de garantir tous ses contrats applicatifs.

Sondes publiques **OPTIONS uniquement**, sans identifiants, body, compte ni
appel fournisseur, avec `Origin: https://localhost`, méthode demandée POST et
headers demandés `content-type,x-google-token` :

| Hôte / route | 09:48:01.375 UTC et 09:53:33.310 UTC |
|---|---|
| `appfacade.pages.dev/api/subscription/status` | 308 vers tryarty, sans ACAO |
| `tryarty.com/api/subscription/status` | 204, ACAO `https://localhost`, POST autorisé |

Le second relevé est conservé localement dans le log ignoré
`legacy-api-before.log`. Ce défaut de préflight ne constitue pas une observation
d'un ancien APK physique en panne.

## Modification bornée

- Hôte **exact** `appfacade.pages.dev`, segment `/api` ou `/api/…` : passage
  à `context.next()` pour toutes les méthodes, sans recréer la Request,
  réencoder son corps, réécrire l'URL, ajouter des headers ou décoder le chemin.
  Laisser `/api` à next ne garantit pas qu'une route racine existe.
- Pages et politique `www.tryarty.com` inchangées : 308 vers tryarty,
  query conservée, double slash jamais interprété comme un hôte externe.
- Middleware API, CORS, quotas, authentification, scopes et HMAC des webhooks
  inchangés. L'origine navigateur `https://appfacade.pages.dev` reste refusée.
  Un préflight refusé reste 204 avec ACAO vide ; un POST ordinaire refusé reste
  403. Les endpoints Add-on conservent leur audience/origine exacte.
- **Dépendance anti-abus corrigée** : appfacade est classé hôte API de production
  dans `emailTrial.PRODUCTION_HOSTS`, sans devenir une Origin autorisée. Ainsi
  l'absence de secret Turnstile continue de bloquer l'OTP avant D1/Resend.

La fenêtre historique demandée est au moins jusqu'au **30 septembre 2026**.
Pas de coupure automatique : retirer ce transport exigera des preuves sur les
versions encore installées et une décision explicite. Aucun appId, certificat,
OAuth/Firebase, permission Android, signature APK ou donnée utilisateur modifié.

## Contre-revues et reproduction

Deux contre-revues indépendantes en lecture seule, angles produit/mobile et
sécurité. Objections examinées avant correction :

1. P1 produit : une simple exemption de redirection aurait classé l'ancien
   hôte en preview et désactivé Turnstile en cas de secret manquant. Reproduit
   après exemption seule : le vrai handler OTP atteint le faux D1, renvoie
   429 au lieu du 503 attendu. Corrigé par la classification de production.
2. P2 produit, également relevé par l'implémenteur : le harness fermait sur
   la Request d'origine ; sa seule assertion d'identité ne détectait pas
   `next(new Request(...))`. Assertions exactes d'appels sans arguments aux
   deux niveaux ajoutées.
3. Sécurité : `/subscription/status` répond intentionnellement Free/200 sans
   token. Le négatif auth utilise donc le **vrai handler Calendar**, qui refuse
   avant lecture du corps et réseau ; aucun contrat d'abonnement changé.
4. Les anciens 308 portaient un cache d'une heure. Une sonde fraîche réussie
   ne prouve pas l'effet immédiat sur un client ayant conservé ce cache. Ne
   conseiller ni suppression de données ni réinstallation pour ce seul motif.

Tests composés : vrais middlewares root/API, vrais handlers Calendar, OTP et
webhooks, crypto HMAC réelle, aucun fetch externe. L'observateur terminal de
corps/headers ne remplace pas un test d'authentification. Cas couverts : sept
méthodes, frontières de segment/casse/encodage, CORS natif et refusé, corps
POST octet pour octet et headers intacts, 401 Calendar, 503/403 OTP avant D1,
HMAC absent ou corps altéré refusé, événement signé inconnu sans écriture,
rate-limit existant, gate non-browser de l'Add-on.

Reproduction locale : **24 échecs / 45 tests** avant correction ; après
exception root seule, **1 échec OTP / 45** ; après correction complète,
**101 tests réussis / 6 suites**. Logs ignorés `legacy-api-red.log`,
`legacy-api-turnstile-red.log`, `legacy-api-targeted.log`. Verify complet,
CI et publication distingués ci-dessous.

Deux GO finaux code/tests readonly, sans objection bloquante restante. Aucun
reviewer n'a exécuté de suite ni modifié de fichier ; les exécutions sont celles
de l'implémenteur. `npm run verify` complet **exit 0** : **304 suites,
3 716 tests réussis + 1 sauté**, couverture 71,58 / 66,42 / 77,24 / 73,44 %.
Typechecks front/back, contrôles scopes/no-CASA/add-on, build App 930,31 Ko
(gzip 286,07), export Office réel en VM isolée réussis. Avertissement historique
de chunks >500 Ko inchangé. Log local ignoré `legacy-api-verify.log`.

## Limites et livraison

Libellé autorisé après preuve de déploiement : **transport API historique
rétabli**. Pas « anciens APK entièrement compatibles ». Le profil OAuth,
l'authentification, le droit VIP et les autres contrats backend ne sont pas
validés par ce patch ; aucun test sur téléphone installé n'est affirmé.
PWA/guide d'installation, reçu d'identité d'APK signé et validations terrain
restent des sous-lots distincts de W09. W06 restauration/synchronisation reste OFF.

Promotion via PR/CI/Cloudflare existants seulement. Recette production limitée
aux OPTIONS/GET publics : absence de redirection des préflights API natifs,
refus de l'origine historique, redirections pages/www conservées. Aucun OTP,
email, action Calendar, webhook de paiement ni credential réel envoyé.
Repli : revert ciblé par PR ; il restaure aussi le défaut de transport observé,
donc décider selon l'incident, sans effacer ni migrer des données.
