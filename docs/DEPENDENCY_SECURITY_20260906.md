# Dépendances : correctif de sécurité du 6 septembre 2026

## Périmètre et décision

Lot isolé depuis `main` `fb60325af8edc655af7964ca5e7bceebb6c7b444`.
Le candidat crédits/Creem reste sur une autre branche : aucune activation
marchande, migration D1, modification d'abonnement, de secret ou de feature flag
dans ce lot. Aucun `npm audit fix --force`.

Avant correction : audit complet **13 entrées** (8 high, 4 moderate, 1 low) ;
audit `--omit=dev` **6 entrées** (2 high, 4 moderate). Ces comptages npm ne sont
pas autant d'exploits démontrés dans Arty. Après `npm ci` avec Node 22.23.2 :
**0 vulnérabilité dans les deux audits**, au moment de cette vérification.

| Dépendance résolue | Version retenue | Portée |
| --- | --- | --- |
| DOMPurify, copie jsPDF dédupliquée | 3.4.15 | HTML des exports PDF |
| react-router-dom / react-router | 7.18.3 | Navigation client Declarative |
| Miniflare / workerd | 4.20260730.0 / 1.20260730.1 | Tests et benchmark locaux |
| Undici de Miniflare | 7.29.0 | Override limité à cette version de Miniflare |
| Sharp / libvips réellement chargé, Windows x64 | 0.35.2 / 8.18.3 | Dépendance native de Miniflare |
| PostCSS | 8.5.28 | Build |
| @xmldom/xmldom / tar | 0.8.15 / 7.5.22 | Outils Capacitor |
| brace-expansion / browserslist | 5.0.9 / 4.28.9 | Outils transitifs |
| update-browserslist-db / nanoid de PostCSS | 1.3.2 / 3.3.18 | Outils transitifs |
| postcss-selector-parser, copies concernées | 6.1.4 | Outils CSS transitifs |

Miniflare reste sur une version 4 stable ; la version 5 alpha n'est pas choisie.
L'override Undici est exactement `miniflare@4.20260730.0`, pas global. Lors du
prochain changement Miniflare, supprimer l'override seulement après contrôle
de la version Undici résolue, des audits, du smoke runtime et du benchmark.
Voir la [release officielle Miniflare](https://github.com/cloudflare/workers-sdk/releases/tag/miniflare%404.20260730.0).

## Frontières de sécurité et compatibilité

- DOMPurify est réellement appelé avant insertion dans le DOM d'export PDF.
  Le cas `IN_PLACE` avec hook détachant le nœud de
  [l'avis DOMPurify](https://github.com/cure53/DOMPurify/security/advisories/GHSA-55q2-fjhq-7xh7)
  n'est pas le mode employé par Arty. Le durcisseur des rapports supprime aussi
  les ressources distantes ; le sanitizer PDF générique n'est pas présenté
  comme un pare-feu réseau universel.
- React Router reste en mode **Declarative**, sans SSR, Data Router,
  RouterProvider ni nouveau plugin Vite. Les trois `BrowserRouter` fixent
  `useTransitions={false}` pour conserver l'ordonnancement v6. Les routes et
  callbacks OAuth ne changent pas. Les imports `react-router-dom` restent
  compatibles avec v7. Voir [transitions dans la version exacte](https://github.com/remix-run/react-router/blob/react-router%407.18.3/docs/explanation/react-transitions.md).
- La correction v6.30.6 seule ne traite pas
  [le contournement de navigation](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6).
  En revanche, [l'avis hydration SSR](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg)
  exclut explicitement le mode Declarative : pas d'exposition SSR revendiquée.
- La sécurité native est attestée par **libvips réellement chargé**, pas par
  le seul numéro Sharp. Le test ancré sur la dépendance de Miniflare exige
  libvips >= 8.18.3 et encode/redimensionne un PNG. Windows passe ; le même
  test doit passer en CI Linux avant fusion. Voir [l'avis Sharp](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj).

## Preuves locales et limites

- `npm ci`, typechecks front/back, contrôles no-CASA, couverture, build et
  exécution du vrai worker d'export Office : dernière passe complète verte,
  **330 suites, 4 227 tests réussis, 1 ignoré préexistant**, incluant les quatre
  tests de panne du benchmark. Deux contre-revues readonly indépendantes
  (sanitizer/routage et toolchain/runtime) : GO code borné, CI encore requise.
- Tests ajoutés : vrai App/BrowserRouter avec navigation, écran suspendu,
  modale fermée et historique retenu ; vrai sanitizer à la frontière DOM
  connectée du PDF et nettoyage après échec de rasterisation ; vrai
  Miniflare avec POST binaire exact, premier fragment SSE, annulation du
  lecteur et réutilisation du worker. Ce dernier test ne prouve pas
  l'annulation d'un fournisseur distant.
- Recette Chrome locale du 6 septembre, 20:08 UTC : vrai App, vraies pièces
  DOCX/XLSX et exports, FR 1280 px et EN 390 px, mais session/réponses IA
  synthétiques et réseau externe bloqué. Lecture, historique à froid, retry,
  Stop par clic/Entrée/Espace, rejet de fragment tardif et fichiers exportés
  relus par python-docx/openpyxl réussis. Ni rendu Microsoft Office, ni vrai
  fournisseur, ni téléphone attestés par cette recette.
- Recette Chrome complémentaire, 20:20:12–14 UTC : Chat → Connexions → Accès
  puis retours navigateur conserve deux messages et un brouillon, sans
  nouvelle requête IA. En mobile le parcours passe par l'accueil puis Menu.
  Vrais DOMPurify/html2canvas/jsPDF : PDF téléchargé, signature `%PDF-`
  vérifiée, canari exécutable resté à zéro, aucun réseau inattendu. Pas de
  revendication de conformité visuelle/page à page à partir de cette preuve.
- Benchmark workerd, chemins BYOK et serveur, concurrence 1 et 2, quatre PNG
  distincts de 1 Mio, requête 5 593 004 octets : 200 puis [200, 429], un seul
  upstream actif, octets exacts, pics locaux 16,58–18,49 Mio sous gate 96 Mio
  dans la dernière exécution (la précédente mesurait 21,13–23,27 Mio).
  Un échantillon par scénario : ce n'est ni un P99.9, ni une attestation de
  mémoire ou de latence Cloudflare en production.
- Le premier benchmark échouait car sa simulation `tokeninfo` ne portait
  pas l'identité vérifiée exigée par le code actuel. Seule la fixture a été
  corrigée : aucune relaxation de l'authentification de production. Les
  erreurs précoces transport/401/inspecteur sont désormais observées sans
  attendre un upstream impossible ; abort, drainage et boucle de refus sont
  bornés. Sept tests du harness passent, dont préservation de la cause
  initiale avec timeout cleanup et absence de timers résiduels.

Les reçus locaux de référence sont `dependency-security-verify-final.log`,
`dependency-security-vision-final.log`, `dependency-security-browser-final.log`
et **`dependency-security-office-browser-warmed.log`**. Les essais Office
antérieurs conservent leurs échecs de harness (reload Vite/optimisation de
dépendances), ils ne constituent pas le reçu de succès.
Les journaux et fixtures de navigateur synthétiques sont conservés localement
dans le répertoire ignoré `.playwright-mcp` ; aucun reçu privé de support,
document utilisateur ou clé n'est publié dans ce lot.

## Checklist de livraison et repli

Avant fusion : dernière passe `npm run verify`, deux contre-revues readonly,
CI PR web/orchestrateur/Android, attestation native Linux et smoke Pages
preview. Aucun changement des workflows ni affaiblissement des tests.

Après fusion : vérifier CI main, Pages et les octets des assets servis par
`tryarty.com`. Vérifier aussi les routes publiques et le maintien sans
redirection de `appfacade.pages.dev/api/*` pour les anciens APK. Observer
les sondes publiques pendant 15 minutes ; distinguer ces sondes de métriques
internes d'erreur/latence si ces dernières ne sont pas accessibles.

Déclencheurs de repli : régression reproductible de connexion/navigation,
perte de brouillon/historique, export cassé, API héritée redirigée, ou erreurs
HTTP nouvelles répétées sur les sondes. Revert Git de cette PR puis chaîne
Pages habituelle. Pas de migration de données à inverser. Le repli peut
réintroduire les dépendances vulnérables : correctif prioritaire ensuite.
Un APK installé garde son ancien bundle tant qu'il n'est pas mis à jour ;
CI Android verte n'est pas une preuve d'installation sur téléphone.

Ce lot ne clôt pas le CDC global : onboarding marchand et essais de paiement,
recettes terrain/mobile, synchronisation distante et mesures d'activation
restent des gates séparés.
