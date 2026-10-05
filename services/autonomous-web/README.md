# Arty Index — première alternative indépendante à Linkup

Ce service possède sa collecte, ses copies de pages et son index SQLite FTS5.
Les recherches et lectures consultent uniquement notre base. Aucun moteur tiers,
cookie utilisateur, compte privé ou navigateur distant n'est utilisé.

## Essayer le paquet Windows

1. Décompresser le paquet fourni dans un dossier personnel.
2. Exécuter `Start.ps1` avec PowerShell, puis ouvrir `http://127.0.0.1:8789`.
3. Chercher `FTS5`, puis cliquer sur **Lire la copie enregistrée**.

Le paquet de démonstration contient six pages publiques de SQLite, collectées
réellement le 5 octobre 2026. Leur consultation expire après sept jours ; ensuite
le propriétaire doit rafraîchir le corpus. `Stop.ps1` arrête seulement le serveur
de cette copie. Aucun service Windows ou démarrage automatique n'est installé.

Python 3.12+ avec SQLite FTS5 et `lxml==6.1.1` est nécessaire. Le lanceur utilise
le runtime Codex déjà présent quand il est disponible. Sinon installer Python
depuis sa source officielle, puis `python -m pip install -r requirements.txt`.
La clé de service est créée dans `data/service.key` au premier lancement,
protégée par les droits du propriétaire et jamais incluse dans le navigateur.

## Ajouter des pages et les rafraîchir

Le propriétaire modifie `example.json` : domaines **exacts** autorisés et URL de
départ HTTPS. Les sous-domaines sont séparés. Le modèle et les clients ne peuvent
pas étendre cette liste. Ne pas ajouter de page personnelle ou nécessitant un
compte : le produit est destiné à un corpus public.

```powershell
python arty_index.py --data D:\ArtyIndex\data --config example.json crawl
python arty_index.py --data D:\ArtyIndex\data refresh https://www.sqlite.org/fts5.html
python arty_index.py --data D:\ArtyIndex\data remove https://www.sqlite.org/fts5.html
python arty_index.py --data D:\ArtyIndex\data serve
```

`crawl` reprend les liens découverts mais jamais les tentatives déjà admises.
`refresh URL` réadmet explicitement cette page et peut ensuite utiliser le budget
restant pour la file d'attente. Maximum par campagne : 50 pages, deux niveaux,
600 secondes, un seul collecteur. Les plafonds de l'exemple sont plus petits.
L'admission et la file d'attente sont persistées avant le réseau ; Ctrl+C arrête
le processus de collecte et aucune reprise automatique n'est lancée.

Une erreur, un refus robots, un HTTP 403/429/5xx ou un interstitiel connu retire
la page de la consultation courante. Les anciennes versions restent pour audit
jusqu'à `remove`, qui les supprime aussi. Après retrait d'un domaine dans la
configuration, aucune copie demandée **ou redirigée** vers celui-ci n'est servie.
Redémarrer le serveur après modification de configuration.

## Contrat de collecte et provenance

- HTML statique seulement, sans JavaScript, PDF, OCR, images, vidéos ou login.
- DNS public contrôlé puis connexion sur l'IP épinglée, certificat TLS et SNI
  du domaine d'origine. Chaque redirection et robots utilise ce même transport.
- Robots avec groupes exacts ArtyIndex, wildcard de repli, plus longue règle,
  égalité favorable à Allow, octets UTF-8, `*` et `$`. 404/410 indique un fichier
  absent ; autres erreurs refusées. Crawl-delay conservateur. Robots n'est pas
  une autorisation d'accès ; aucun refus n'est contourné.
- Processus enfant limité à 20 secondes, réponse à 2 Mo, extraction à 160 000
  caractères, maximum trois redirections. Réponses compressées refusées.
- URL demandée/finale, date de collecte, SHA-256 du texte UTF-8 exact et version
  d'extracteur. `truncated:false` signifie absence de coupe logicielle ; ne
  prouve pas que le site livre tout l'article, ni que ses affirmations sont vraies.
- Détection conservatrice de quelques interstitiels, aucune garantie universelle
  contre les pages de refus, paywalls ou erreurs renvoyées avec HTTP 200.

FTS5 recherche des mots présents dans le corpus, avec classement BM25, filtre
par domaine et déduplication URL finale/hash. Ce prototype ne traduit pas les
requêtes et n'a pas la couverture globale d'un moteur Web. Les sitemaps, flux,
PDF et rendu JavaScript sont des lots futurs, pas des fonctions livrées.

## API et branchement à Arty

API privée : POST `/search` avec `{query,maxResults,sources?}`, POST `/fetch` avec
`{url}` et `Authorization: Bearer <clé de service>`. Aucune route de crawl.
JSON entrant 8 Ko, sortant borné par l'adaptateur Arty à 1 Mo, huit connexions
simultanées, délai réseau client de dix secondes. Recherche vide : HTTP 200 avec
`results:[]`. Page absente/expirée/hors corpus : 404. Panne : 503. Aucun repli.

L'interface locale `/` et `/local/*` est limitée au port loopback exact,
Host+Origin+Sec-Fetch-Site du navigateur, sans clé serveur dans la page. Le texte
des pages passe exclusivement par `textContent`, jamais par HTML exécutable.

Pour le build Arty de cette branche :

```text
# Build frontend — booléen public, PAS de clé
VITE_AUTONOMOUS_WEB=true
# Environnement Functions — valeurs exclusivement serveur
SEARCH_PROVIDER=arty-index
AUTONOMOUS_WEB_URL=http://127.0.0.1:8789
AUTONOMOUS_WEB_LOCAL=true
AUTONOMOUS_WEB_KEY=<secret de data/service.key>
```

Le serveur est autoritaire. Il refuse les outils natifs Claude/Gemini (y compris
Maps et BYOK) et les recherches des anciens clients sans politique explicite.
Le nouveau client Claude utilise `web_search`/`fetch_url` personnalisés ; Gemini,
y compris hybride, reçoit le contexte de notre index avant génération.
Mistral/OpenAI conservent leurs boucles personnalisées, reliées au même index.
Le fact-checker collecte et relit ses sources dans ce corpus ; il garde ses
plafonds de preuve et ne transforme pas un snippet en document vérifié.

Les conversations EU sont refusées par le backend non attesté. Définir
`AUTONOMOUS_WEB_REGION=eu` seulement après vérification de l'hébergement et des
journaux ; l'autohébergement ne prouve pas cette implantation. Le fact-checker
EU reste désactivé par le contrat existant.

Cloudflare/Android ne peuvent pas joindre le localhost de ce PC. Pour les
brancher, héberger ce service derrière une passerelle **HTTPS privée**, exposer
seulement `/search` et `/fetch` avec la même authentification serveur, et bloquer
`/`, `/ui.js`, `/local/*` ainsi que toute autre route. Le service reste loopback.
Ne jamais placer la clé dans VITE, localStorage, l'APK, une URL ou un dépôt.
Ne pas activer le flag serveur sur la production avant déploiement du client
compatible et de cette passerelle. Ni production ni Android ne sont validés ici.

## Vérifier

```powershell
python -m unittest -v
# Windows : droits des fichiers existants, réparation et nouveaux journaux SQLite
.\Test-Permissions.ps1
# À la racine Arty, service lancé : preuve API/adaptateur sans modèle
node scripts/prove-autonomous-index.mjs D:\ArtyIndex\data
# Un seul appel IA cloud supplémentaire, uniquement si clé déjà configurée
node scripts/prove-autonomous-index.mjs D:\ArtyIndex\data --with-model
```

La preuve réelle atteste la collecte/index/API/adaptateur et un appel Claude
sans outil natif. Elle n'authentifie pas un utilisateur dans l'interface Arty et
ne valide pas un APK. Les tests de protocole utilisent des données fictives.
Les clés et la base restent hors Git. Sauvegarder la base par l'API SQLite
`backup` ou lorsque la collecte est arrêtée ; aucun ordonnanceur automatique
ni moteur local de génération n'est installé par ce premier lot.
