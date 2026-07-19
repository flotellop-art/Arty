# Runbook — validation mémoire Cloudflare A11

**Statut :** procédure prête, exécution bloquée tant que le compte Cloudflare
n'est pas réauthentifié et que le projet isolé n'existe pas.<br>
**Périmètre :** transport Vision Terra du proxy OpenAI uniquement.<br>
**Hors périmètre :** routage PDF, qualité visuelle, normalisation mobile et
activation production.

## 1. Verdict attendu

Le GO mémoire exige, pour chacun des scénarios serveur concurrence 1, 2 et 4 :

- 100 réponses HTTP 200 intégralement drainées, réparties W1/W2/W3 en
  34 + 33 + 33 ;
- P999 mémoire Cloudflare inférieur ou égal à **100 663 296 octets**
  (96 Mio) sur chaque fenêtre ;
- zéro `exceededMemory`, `exceededResources` et erreur 1102 ;
- aucun trafic parasite ni changement de SHA/configuration ;
- une invocation et un rapport séparés pour chaque cellule concurrence/fenêtre.

Un 429 `vision_busy` est un signal utile mais pas une condition du GO :
Cloudflare peut répartir une rafale entre plusieurs isolats. Il ne compte jamais
parmi les 100 réponses acceptées et ne justifie pas, à lui seul, de rejouer une
campagne payante.

Le BYOK du chat Arty appelle OpenAI directement. Il n'entre pas dans la métrique
Cloudflare. Le chemin `x-openai-key` du proxy est seulement un contrôle défensif.

## 2. Garde-fous non négociables

Créer un projet Pages Direct Upload séparé nommé
`arty-vision-a11-staging` :

- aucune connexion Git automatique ;
- aucune DB, KV, Queue, R2, route ou domaine de production ;
- branche de production factice `never-production` ;
- déploiement de mesure uniquement en Preview, branche `a11` ;
- politique Cloudflare Access sur toutes les previews ;
- policy `Service Auth` limitée à un service token jetable ;
- clé serveur OpenAI jetable, dans un projet OpenAI de test ;
- clé BYOK jetable distincte ;
- compte Google de test explicitement allowlisté ;
- production inchangée : flags client OFF, `OPENAI_VISION_ENABLED=false`.

Les budgets de projet OpenAI sont des alertes et ne remplacent pas un arrêt
dur. Le générateur accepte uniquement l'URL atomique dont le `short_id` a été
vérifié pour le projet A11, refuse les hôtes prod/alias/ports/paramètres, les
redirections, les débits supérieurs à 60 requêtes/minute et toute matrice hors
protocole. Il n'effectue aucun retry après timeout ou résultat inconnu et garde
un rapport partiel expurgé si une cellule s'arrête.

## 3. Préparer l'artefact immuable

Depuis un worktree jetable, détaché exactement sur le `main` à mesurer :

```powershell
git fetch origin main
git switch --detach origin/main
$a11Sha = git rev-parse HEAD
if ($a11Sha -ne (git rev-parse origin/main)) { throw "HEAD != origin/main" }
if (git status --porcelain=v1 --untracked-files=all) { throw "Worktree non propre" }
npm ci
npm run verify
npm run build
if (git status --porcelain=v1 --untracked-files=all) { throw "Build non reproductible ou worktree modifié" }
```

Le harness revérifie lui-même `HEAD`, le SHA et la propreté avant tout réseau.
Archiver le SHA complet. Toute correction ou tout nouveau déploiement invalide
les fenêtres précédentes.

## 4. Créer et verrouiller le projet Cloudflare

Wrangler est figé à la version validée **4.112.0**. Définir le profil et l'ID
du compte Cloudflare payant attendu, puis réauthentifier :

```powershell
$a11Profile = "arty-a11"
$a11AccountId = Read-Host "Cloudflare account ID attendu"
$env:CLOUDFLARE_ACCOUNT_ID = $a11AccountId
npx --yes wrangler@4.112.0 auth create $a11Profile
npx --yes wrangler@4.112.0 auth activate $a11Profile (Get-Location)
$a11Identity = npx --yes wrangler@4.112.0 whoami --json | ConvertFrom-Json
npx --yes wrangler@4.112.0 whoami --account $a11AccountId
```

Vérifier dans le dashboard que `$a11AccountId` est bien le compte couvert par
l'abonnement payé. L'abonnement augmente la limite de body du plan ; il ne
relève pas la limite mémoire de 128 MB par isolat.

Créer le projet une seule fois :

```powershell
npx --yes wrangler@4.112.0 pages project create arty-vision-a11-staging `
  --profile $a11Profile `
  --production-branch never-production `
  --compatibility-date 2026-07-01
```

Avant tout déploiement de l'application :

1. Cloudflare Pages > projet > Settings > General > activer la politique
   Access pour les Preview deployments.
2. Zero Trust > Access controls > Service credentials : créer un service token
   court nommé `arty-vision-a11-runner`.
3. Ajouter à l'application Access une policy **Service Auth** ciblant uniquement
   ce token.
4. Dans la configuration **Preview seulement**, poser :
   - `OPENAI_VISION_ENABLED=true` ;
   - `GOOGLE_CLIENT_ID=<client public Arty>` ;
   - `ALLOWED_EMAILS=<compte Google de test>` ;
   - `OPENAI_API_KEY=<clé serveur jetable>` en secret.
5. Vérifier que Preview n'a aucun binding DB/KV/R2/Queue/Service de production.
6. Activer Workers Logs/observabilité avec un échantillonnage de tête à 100 %.
7. Capturer la configuration non secrète, le nom du preview script et la preuve
   que la production reste OFF.

Les previews Pages sont publiques par défaut. Ne déployer l'application qu'une
fois Access vérifié sur une page neutre ou un déploiement vide.

## 5. Déployer le SHA en Preview

Depuis la racine du dépôt — Wrangler embarque alors `functions/` avec `dist/` :

```powershell
npx --yes wrangler@4.112.0 pages deploy dist `
  --profile $a11Profile `
  --project-name arty-vision-a11-staging `
  --branch a11 `
  --commit-hash $a11Sha `
  --commit-message "A11 vision memory staging" `
  --commit-dirty=false
```

Récupérer les métadonnées auprès de Cloudflare, sans recopier une valeur depuis
la seule sortie du déploiement :

```powershell
$a11Deployments = npx --yes wrangler@4.112.0 pages deployment list `
  --profile $a11Profile `
  --project-name arty-vision-a11-staging `
  --environment preview --json | ConvertFrom-Json
$a11Deployment = $a11Deployments | Where-Object {
  $_.deployment_trigger.metadata.commit_hash -eq $a11Sha -and
  $_.deployment_trigger.metadata.branch -eq "a11" -and
  $_.deployment_trigger.metadata.commit_dirty -eq $false -and
  $_.latest_stage.status -eq "success"
} | Sort-Object created_on -Descending | Select-Object -First 1
if (-not $a11Deployment) { throw "Déploiement A11/SHA introuvable" }
$a11DeploymentId = $a11Deployment.id
$a11ShortId = $a11Deployment.short_id
$a11Endpoint = "$($a11Deployment.url)/api/ai/openai-proxy"
if (([uri]$a11Deployment.url).Host -ne "$a11ShortId.arty-vision-a11-staging.pages.dev") {
  throw "URL non atomique ou alias mouvant"
}
```

Noter : deployment ID, `short_id`, URL atomique, alias, preview script name et
heure UTC. Ne jamais utiliser l'alias mouvant dans les mesures. L'API
Cloudflare expose bien `id`, `short_id`, `url`, `environment` et
`deployment_trigger.metadata.commit_hash` ; ces valeurs doivent toutes rester
identiques pendant W1/W2/W3.

Vérifier avant charge :

- sans token Access : accès refusé ;
- avec le service token : endpoint accessible ;
- SHA Cloudflare = `$a11Sha`, deployment ID = `$a11DeploymentId` et
  `short_id` = `$a11ShortId` ;
- killswitch staging ON ;
- aucune donnée ou binding prod.

## 6. Charger les secrets localement

Ne jamais passer les secrets dans les arguments, l'historique shell ou un
rapport. Les quatre variables sont lues en mémoire :

```powershell
$env:ARTY_A11_GOOGLE_TOKEN = Read-Host "Token Google test" -MaskInput
$env:ARTY_A11_CF_ACCESS_CLIENT_ID = Read-Host "Access Client ID" -MaskInput
$env:ARTY_A11_CF_ACCESS_CLIENT_SECRET = Read-Host "Access Client Secret" -MaskInput
$env:ARTY_A11_OPENAI_BYOK_KEY = Read-Host "Clé OpenAI BYOK jetable" -MaskInput
```

Rafraîchir le token Google avant chaque fenêtre. Le générateur ne journalise ni
headers, ni base64, ni contenu de réponse.

## 7. Dry-run et pilotes

Le dry-run est local et n'effectue aucun appel réseau :

```powershell
npm run bench:vision:cloudflare
```

Il doit annoncer quatre PNG 32×32 de 4 Mio, 16 Mio binaires, un JSON proche de
21,33 Mio et quatre patches image.

Faire cinq appels pilote serveur, puis cinq appels défensifs BYOK-proxy. Ils ne
comptent pas dans W1 :

```powershell
npm run bench:vision:cloudflare -- --execute `
  --mode=pilot `
  --endpoint=$a11Endpoint `
  --deployment-id=$a11DeploymentId --deployment-short-id=$a11ShortId `
  --deployment-sha=$a11Sha --window=PILOT `
  --acknowledge=arty-vision-a11-staging `
  --path=server --concurrency=1 --accepted=5 `
  --report-file=artifacts/vision-a11/PILOT-server.json

npm run bench:vision:cloudflare -- --execute `
  --mode=pilot `
  --endpoint=$a11Endpoint `
  --deployment-id=$a11DeploymentId --deployment-short-id=$a11ShortId `
  --deployment-sha=$a11Sha --window=PILOT `
  --acknowledge=arty-vision-a11-staging `
  --path=byok-proxy --concurrency=1 --accepted=5 `
  --report-file=artifacts/vision-a11/PILOT-byok-proxy.json
```

Exiger : cinq 200, EOF + `[DONE]`, modèle Terra confirmé et usage présent. Si
OpenAI refuse le chunk ancillary paddé, arrêter : ne pas remplacer les erreurs
par des retries et ne pas lancer la campagne.

Le harness arrête la cellule au premier usage supérieur à 2 000 tokens prompt
pour la fixture 32 px, 70 000 pour la sentinelle 4096², ou un token de sortie.
Ce garde-fou empêche de poursuivre si le fournisseur facture anormalement le
padding ancillary.

Avant le premier POST de chaque invocation proxy, le harness exige qu'un GET
sans identifiants Access soit refusé puis que le même GET avec le service token
retourne 200. Les POST portent l'`Origin` fixe déjà autorisée par le middleware
Arty ; aucune origine staging n'est ajoutée à l'allowlist applicative.

## 8. Exécuter W1, W2 et W3

W1 se fait juste après le déploiement. W2 utilise le même artefact plus tard et
inverse idéalement l'ordre des scénarios. W3 se fait sur une autre plage horaire
ou le lendemain. Aucun redéploiement entre les fenêtres.

Commandes W1, une cellule par invocation pour garder des intervalles métriques
non ambigus :

```powershell
foreach ($a11Concurrency in 1, 2, 4) {
  npm run bench:vision:cloudflare -- --execute `
    --mode=campaign `
    --endpoint=$a11Endpoint `
    --deployment-id=$a11DeploymentId --deployment-short-id=$a11ShortId `
    --deployment-sha=$a11Sha --window=W1 `
    --acknowledge=arty-vision-a11-staging `
    --path=server --concurrency=$a11Concurrency --accepted=34 `
    --rpm=30 `
    --report-file="artifacts/vision-a11/W1-server-c$a11Concurrency.json"
  if ($LASTEXITCODE -ne 0) { throw "Échec cellule W1/c$a11Concurrency" }
  Read-Host "Capturer les métriques de la cellule, puis Entrée pour continuer"
  Start-Sleep -Seconds 65 # vider le rate-limit isolate avant la cellule suivante
}
```

Pour W2 et W3, remplacer la fenêtre et utiliser `--accepted=33`; inverser si
possible l'ordre `4, 2, 1` pour W2. Le harness refuse une matrice ou un volume
différent. Les rapports sont créés en mode exclusif : un nom existant n'est
jamais écrasé, le nom canonique est imposé pour empêcher une relance sous un
autre nom, et toute cellule partielle est marquée `traffic_failed` sans relance
automatique. Ne supprimer un rapport d'échec et ne rejouer sa cellule qu'après
avoir déclaré la fenêtre invalide et révoqué/renouvelé les clés si nécessaire.

Après la charge synthétique de chaque fenêtre, exécuter une sentinelle serveur
4096² et une sentinelle BYOK directe 4096² :

```powershell
npm run bench:vision:cloudflare -- --execute `
  --mode=sentinel `
  --endpoint=$a11Endpoint `
  --deployment-id=$a11DeploymentId --deployment-short-id=$a11ShortId `
  --deployment-sha=$a11Sha --window=W1 `
  --acknowledge=arty-vision-a11-staging `
  --path=server --concurrency=1 --accepted=1 `
  --fixture-dimension=4096 `
  --report-file=artifacts/vision-a11/W1-sentinel-server-4k.json

npm run bench:vision:cloudflare -- --execute `
  --mode=sentinel `
  --deployment-sha=$a11Sha --window=W1 `
  --acknowledge=arty-vision-a11-staging `
  --path=byok-direct --concurrency=1 --accepted=1 `
  --fixture-dimension=4096 `
  --report-file=artifacts/vision-a11/W1-sentinel-byok-direct-4k.json
```

Adapter `W1` dans les deux commandes pour les autres fenêtres. Le BYOK direct
est un smoke fonctionnel et n'est jamais inclus dans P999 Cloudflare.

## 9. Lire les métriques

Attendre l'ingestion Cloudflare. Pour chaque scénario, utiliser les timestamps
UTC exacts du rapport et le **preview script name** du projet isolé :

1. Workers & Pages > projet A11 > Metrics : relever le P999 mémoire.
2. Vérifier les invocation statuses et les Workers Logs persistés.
3. Interroger `workersInvocationsAdaptive` via GraphQL si le schéma du compte
   expose le quantile mémoire ; introspecter le nom du champ au lieu de le
   deviner.
4. Archiver valeur brute, unité, intervalle, deployment ID et capture.
5. Ne jamais moyenner les P999 des fenêtres.

Le *reservoir sampling* natif utilisé par Cloudflare pour calculer P50/P90/P99/
P999 est attendu et accepté. Une cellule est invalide si le P999 est absent, si
le volume métrique ne permet pas de couvrir ses invocations, si les **Workers
Logs** ont été configurés sous 100 % ou si un autre trafic est visible. Un seul
P999 >100 663 296 ou un seul événement mémoire/1102 est un hard fail. Archiver
aussi le nombre de 429 `vision_busy`, sans en faire une condition du GO.

## 10. Arrêt et nettoyage

En succès comme en échec :

1. remettre `OPENAI_VISION_ENABLED=false` dans le staging puis redéployer un
   placeholder ou laisser l'application protégée et inactive ;
2. révoquer le service token Access ;
3. révoquer les deux clés OpenAI jetables ;
4. effacer les variables d'environnement locales ;
5. vérifier à nouveau que la production n'a pas changé ;
6. conserver rapports et preuves sans secrets ni données utilisateur.

```powershell
Remove-Item Env:ARTY_A11_GOOGLE_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ARTY_A11_CF_ACCESS_CLIENT_ID -ErrorAction SilentlyContinue
Remove-Item Env:ARTY_A11_CF_ACCESS_CLIENT_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:ARTY_A11_OPENAI_BYOK_KEY -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
npx --yes wrangler@4.112.0 auth deactivate (Get-Location)
```

Ne pas supprimer le projet ou ses déploiements sans décision explicite : la
désactivation + révocation garde les preuves récupérables.

## Références officielles

- Cloudflare — [Preview deployments et Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- Cloudflare — [Direct Upload avec Wrangler](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- Cloudflare — [API des déploiements Pages](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/get/)
- Cloudflare — [Métriques Workers et P999 mémoire](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- Cloudflare — [Service tokens Access](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- OpenAI — [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- OpenAI — [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
