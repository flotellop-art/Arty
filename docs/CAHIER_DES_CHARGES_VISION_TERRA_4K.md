# Cahier des charges — Vision GPT-5.6 Terra en 4K dans Arty

**Statut :** proposition à valider avant implémentation<br>
**Date :** 19 juillet 2026<br>
**Périmètre :** analyse de photos par `gpt-5.6-terra`, routage automatique, préparation mobile, maîtrise des coûts et confidentialité<br>
**Nature de cette PR :** documentation uniquement ; aucun comportement de production n'est modifié

---

## 1. Résumé exécutif

Arty sait joindre et stocker des images, mais le chemin OpenAI est encore
texte-seul : les fichiers sont remplacés par une simple mention avant l'appel.
En mode Auto, toute pièce jointe est par ailleurs routée vers Claude, sauf une
image envoyée avec Mistral choisi manuellement.

Le produit cible est le suivant :

- une photo compatible, sans PDF ni autre document, peut être analysée par
  **GPT-5.6 Terra** en mode Auto ;
- l'image utile est normalisée à **4096 px maximum sur le grand côté**, sans
  agrandissement, avec `detail: "original"` ;
- le 200 MP brut n'est jamais envoyé au fournisseur ni conservé par Arty ;
- le mode Europe, les données privées et les documents non-image conservent
  leurs protections et leurs routes actuelles ;
- une image n'est pas renvoyée silencieusement à chaque message suivant ;
- le coût est calculé, réservé et mesuré à partir des tokens image réels, sans
  compter le base64 comme du texte ;
- le déploiement Auto n'a lieu qu'après un benchmark aveugle sur des photos
  Arty réelles face au chemin Claude actuel.

Le compromis 4K vise environ **12,6 MP** pour une photo 4:3
(`4096 × 3072`). Il fournit quatre fois plus de pixels que le stockage actuel
à `2048 × 1536`, tout en bornant le coût fournisseur à environ **0,031 $ par
photo 4:3** au tarif standard Terra de 2,50 $/M tokens d'entrée.

---

## 2. Problème à résoudre

Les utilisateurs mobiles d'Arty prennent des photos de façades, fissures,
étiquettes, documents de chantier et détails techniques. Une réduction à
2048 px peut effacer les petits défauts, mais conserver un capteur 48 ou
200 MP en entier augmente fortement le coût, le temps d'envoi, la mémoire
mobile et le risque d'échec.

L'état actuel présente aussi des incohérences :

1. `src/services/imageCompression.ts` ne redimensionne pas une image de moins
   de 500 Ko, même si ses dimensions dépassent 2048 px.
2. Si la version recompressée est plus lourde, le code retourne l'original,
   qui peut dépasser la dimension annoncée.
3. Le premier envoi peut utiliser le fichier original gardé en RAM, tandis
   qu'un retry recharge la copie persistée et compressée : le même message
   n'a donc pas toujours la même image.
4. `src/hooks/useConversation.ts` appelle `buildTextOnlyMessages` pour OpenAI :
   Terra ne reçoit actuellement aucun pixel.
5. `functions/api/_lib/walletBilling.ts` initialise son estimation sur le JSON
   complet. Le base64 multimodal risquerait d'être compté comme du texte au
   moment de la réservation, au lieu d'être estimé à partir des dimensions.
6. Le proxy OpenAI lit actuellement tout le corps avant d'appliquer une borne
   multimodale explicite.

Sans contrat commun avant le stockage, le routage et l'appel API, activer la
vision Terra créerait des coûts imprévisibles et des comportements différents
entre le premier envoi, l'édition et le retry.

---

## 3. Décisions produit retenues

| ID | Décision |
|---|---|
| D1 | **4096 px maximum sur le grand côté**, ratio conservé, aucune montée en résolution. |
| D2 | Le fichier normalisé, et non l'original du capteur, est la seule version utilisable par le stockage et les fournisseurs IA. |
| D3 | OpenAI reçoit explicitement `detail: "original"`. Dans ce contexte, « original » désigne l'asset déjà normalisé à 4K par Arty. |
| D4 | JPEG photo : qualité cible **0,90**. Une baisse contrôlée jusqu'à 0,85 est autorisée uniquement pour respecter la borne de poids. |
| D5 | **6 Mio maximum par image normalisée**, **4 images maximum** et **20 Mio binaires maximum** par message vision. |
| D6 | Une source image jusqu'à **32 Mio** peut être décodée puis réduite localement. Les autres fichiers gardent leur limite actuelle de 10 Mio. |
| D7 | En Auto, un message composé uniquement d'images compatibles est candidat à Terra. PDF, Office, texte brut joint ou lot mixte restent chez Claude. |
| D8 | `euOnly` reste un verrou absolu vers Mistral. Une conversation privée ou avec historique Google reste chez Claude. |
| D9 | Une image est envoyée au tour qui la joint. Les tours suivants utilisent l'historique textuel et ne renvoient pas automatiquement ses bytes. |
| D10 | Retry/édition du tour image : l'image normalisée peut être renvoyée, avec le coût normal d'un nouvel appel. |
| D11 | Le cap premium « 100 GPT-5 » reste compté par message ; aucun nouveau bucket n'est créé pour la vision en v1. |
| D12 | Le coût des images d'entrée suit la tarification de tokens d'entrée Terra et le markup texte existant. Le markup « image » actuel reste réservé à la génération d'images. |
| D13 | Le routage Auto vers Terra est conditionné à un benchmark de qualité. En cas d'échec du gate, la vision Terra sort d'abord en sélection manuelle. |

---

## 4. Objectifs

### 4.1 Objectifs utilisateur

1. Permettre l'analyse fiable d'une vue générale et d'un gros plan de chantier
   sans demander à l'utilisateur de redimensionner ses photos.
2. Préserver deux fois plus de détail linéaire que la copie actuelle à
   2048 px, soit quatre fois plus de pixels pour une photo de même ratio.
3. Afficher clairement quel fournisseur analyse la photo et pourquoi.
4. Éviter qu'un échange de suivi refacture silencieusement la même photo.

### 4.2 Objectifs produit et exploitation

1. Maintenir le coût fournisseur d'une image 4:3 sous **0,031 $** et celui
   d'une image carrée 4096 px sous **0,041 $**, hors texte et sortie.
2. Empêcher tout envoi hors Europe depuis une conversation `euOnly`.
3. Empêcher tout passage d'un historique Google privé vers OpenAI.
4. Disposer de métriques de coût, latence et erreurs sans journaliser le nom,
   le contenu ou le base64 des photos.
5. Pouvoir revenir au routage Claude sans migration de données.

---

## 5. Hors périmètre

- Conservation ou envoi automatique du **48/200 MP brut**.
- Diagnostic structurel certifié, mesure physique garantie d'une fissure ou
  remplacement de l'expertise humaine sur chantier.
- Analyse d'imagerie médicale.
- Vision Gemini, lecture de PDF par Terra ou conversion Office.
- Génération et retouche d'images ; ce flux reste séparé de l'analyse visuelle.
- Reconnaissance vidéo, panorama, fisheye ou flux caméra en temps réel.
- Stockage serveur durable des photos.
- Renvoi automatique d'une ancienne photo à chaque question de suivi.

---

## 6. Utilisateurs et user stories

### Façadier / professionnel de chantier

- En tant que façadier, je veux photographier une façade puis un détail afin
  qu'Arty relève les anomalies visibles sans manipulation préalable du fichier.
- En tant que façadier, je veux que la photo reste suffisamment détaillée pour
  lire une petite étiquette ou distinguer une fissure visible.
- En tant qu'utilisateur mobile, je veux recevoir une erreur claire si ma
  photo ne peut pas être décodée, au lieu d'un envoi silencieusement dégradé.

### Utilisateur attentif à la confidentialité

- En tant qu'utilisateur du mode Europe, je veux que toutes mes photos restent
  traitées par le fournisseur européen prévu, même si Terra est disponible.
- En tant qu'utilisateur, je veux voir « GPT-5.6 Terra — analyse photo 4K »
  lorsque le routage Auto choisit OpenAI.
- En tant qu'utilisateur d'une conversation contenant des données Google, je
  veux que l'historique ne parte jamais vers OpenAI avec une nouvelle photo.

### Exploitant Arty

- En tant qu'exploitant, je veux connaître le coût réel par photo et par
  message afin de contrôler la marge et le dimensionnement du cap GPT-5.
- En tant qu'exploitant, je veux désactiver rapidement le routage vision Terra
  si le taux d'erreur, le coût ou la qualité dérivent.

---

## 7. Routage cible

L'ordre des gardes reste un invariant de sécurité. La classification des pièces
jointes doit être enrichie : `hasFiles`/`hasPdf` seuls ne suffisent plus. Le
routeur doit recevoir au minimum `hasImages`, `hasPdf`, `hasOtherFiles` et
`hasSupportedVisionImages`.

| Priorité | Situation | Route cible | Raison machine |
|---:|---|---|---|
| 1 | `euOnly`, quel que soit le choix | Mistral | `eu_only` |
| 2 | Données privées détectées ou historique Google privé | Claude | `private_data` |
| 3 | PDF, autre document ou lot image+document | Claude | `files_to_claude` |
| 4 | Images seules + Claude manuel | Claude | `manual_selection` |
| 5 | Images seules + Mistral manuel | Mistral | `files_mistral_native` |
| 6 | Images seules + OpenAI manuel et disponible | OpenAI/Terra | `image_vision_openai` |
| 7 | Images seules + Auto + OpenAI disponible + feature activée | OpenAI/Terra | `image_vision_openai` |
| 8 | Images seules + Auto, OpenAI indisponible/désactivé | Claude | `fallback_no_provider` |
| 9 | Images seules + Gemini manuel tant que Gemini reste texte-seul | Claude + override visible | `files_to_claude` |

### Exigences de transparence

- Ajouter `image_vision_openai` à `ALL_REASON_CODES` et aux traductions FR/EN.
- Le footer du message doit afficher le modèle effectivement servi, y compris
  un éventuel fallback de modèle OpenAI.
- Une redirection qui contredit un choix manuel doit conserver le toast
  d'override existant.
- Aucun retry automatique vers un second fournisseur après qu'une photo a été
  reçue par l'upstream OpenAI. Une erreur doit être surfacée ; changer de
  fournisseur exige une nouvelle action utilisateur.

---

## 8. Préparation des images

### 8.1 Pipeline unique obligatoire

Créer une primitive unique, par exemple `normalizeImageForVision`, appelée
**avant** que l'image entre dans `pendingFiles`, IndexedDB ou un builder API.
Elle doit produire un asset canonique utilisé partout.

Étapes :

1. vérifier la taille de la source avant lecture complète ;
2. valider le type réel à partir de la signature et du décodage, jamais du seul
   nom de fichier ;
3. décoder en tenant compte de l'orientation EXIF ;
4. retirer les métadonnées par réencodage ;
5. conserver le ratio ;
6. réduire le grand côté à 4096 px s'il le dépasse ;
7. ne jamais agrandir une petite image ;
8. encoder en JPEG qualité 0,90 pour une photo opaque ;
9. préserver PNG/WebP seulement quand la transparence est utile et que la
   borne de poids est respectée ;
10. si l'asset dépasse 6 Mio, réduire la qualité jusqu'à 0,85 ; si nécessaire,
    réduire ensuite les dimensions de manière proportionnelle ;
11. retourner les dimensions, le MIME, la taille binaire et le base64
    normalisés ;
12. libérer immédiatement canvas, blob URL et buffers temporaires.

### 8.2 Invariants

- `max(width, height) <= 4096` pour 100 % des images envoyées ou persistées.
- La fonction ne retourne jamais l'original hors borne sous prétexte que son
  fichier est plus léger que la recompression.
- Une source légère mais très grande est quand même redimensionnée.
- La copie RAM du premier tour et la copie IndexedDB d'un retry sont identiques.
- Le champ `FileAttachment.size` décrit l'asset normalisé, pas la source.
- Ajouter `width`, `height` et une version de normalisation au record persistant
  afin de faire évoluer le pipeline sans ambiguïté.

### 8.3 Formats

P0 : JPEG, PNG et WebP. GIF animé, HEIC/HEIF non décodable et formats inconnus
sont refusés avec un message localisé et actionnable. La capture native doit
produire un JPEG compatible. La conversion HEIC robuste peut être traitée en
P1 après mesure des erreurs réelles sur iOS.

---

## 9. Requête OpenAI multimodale

La v1 conserve Chat Completions afin de ne pas mélanger activation vision et
migration vers Responses. `OpenAIMessage.content` devient une union texte ou
blocs multimodaux.

Forme attendue pour chaque image :

```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/jpeg;base64,…",
    "detail": "original"
  }
}
```

Le bloc texte du message suit les blocs image. Un message image-only reçoit le
texte de relais localisé « Analyse cette photo. ».

### Historique

- Le message qui joint l'image contient ses bytes pour son premier appel.
- Les messages historiques remplacent les bytes par une note textuelle stable.
- La réponse précédente du modèle sert de contexte aux questions suivantes.
- Retry ou édition du message source réhydrate et renvoie l'asset canonique.
- P1 : action explicite « Réanalyser cette photo » pour une question de détail.

Cette règle évite une croissance linéaire du coût à chaque tour tout en gardant
un comportement explicable.

---

## 10. Coûts et facturation

### 10.1 Ordres de grandeur fournisseur

Pour GPT-5.6 avec `detail: "original"`, le nombre de patches est :

```text
ceil(width / 32) × ceil(height / 32)
```

Au tarif standard Terra de 2,50 $ par million de tokens d'entrée :

| Asset | Patches/tokens image | Coût d'entrée estimé |
|---|---:|---:|
| 2048 × 1536 | 3 072 | 0,00768 $ |
| 3840 × 2160 | 8 160 | 0,02040 $ |
| 4096 × 3072 | 12 288 | 0,03072 $ |
| 4096 × 4096 | 16 384 | 0,04096 $ |
| 16 384 × 12 288, non autorisé | 196 608 | 0,49152 $ |

Quatre images carrées à la borne représentent au maximum environ **0,164 $**
d'entrée image, avant texte, raisonnement et sortie.

### 10.2 Réservation wallet

Le body JSON ne doit jamais servir directement d'approximation textuelle quand
il contient du base64.

P0 :

- retirer les payloads média du comptage texte de réservation ;
- calculer les tokens image depuis `width` et `height` normalisés ;
- ajouter cette estimation aux tokens texte avant `beginWalletBilling` ;
- garder le settle sur les vrais `prompt_tokens` remontés par OpenAI ;
- tester qu'un utilisateur sans solde suffisant ne peut pas créer un solde
  négatif important avec quatre images ;
- tester qu'une image 4K n'est pas sur-réservée comme plusieurs millions de
  tokens à cause de son base64 ;
- ne pas utiliser `applyMarkup(..., "image")`, réservé à l'image générée.

### 10.3 Quotas

- Un message vision consomme une unité du bucket premium GPT-5, comme un
  message Terra texte.
- Un retry utilisateur consomme une nouvelle unité.
- Un refus avant appel upstream ou un échec non servi rembourse quota, cap et
  réservation selon l'invariant existant « consommé si et seulement si servi ».
- Aucun double-débit ne doit être introduit par un fallback d'éligibilité
  `gpt-5.6-terra` vers `gpt-5` ; si le fallback ne supporte pas le contrat
  multimodal attendu, l'appel échoue sans changer silencieusement de provider.

---

## 11. Sécurité, confidentialité et limites réseau

### Client

- Source image : 32 Mio maximum ; autres fichiers : limite actuelle de 10 Mio.
- Traitement séquentiel des sources lourdes pour borner le pic mémoire mobile.
- Maximum 4 images vision et 20 Mio binaires normalisés par message.
- Aucun original 48/200 MP écrit dans IndexedDB ou localStorage.
- Métadonnées EXIF, dont la géolocalisation, retirées avant stockage/envoi.
- Aucun base64 dans les logs, rapports d'erreur, analytics ou événements UI.
- Une photo est considérée comme une donnée utilisateur potentiellement
  sensible. La v1 ne prétend pas déduire sa sensibilité depuis ses pixels : le
  choix manuel, le mode Europe et l'indication du fournisseur avant envoi sont
  les contrôles explicites.

### Proxy OpenAI

- Borne explicite de `Content-Length` avant `request.text()` ; réponse 413
  structurée et localisée côté client.
- Borne recommandée du JSON encodé : **30 Mio**, couvrant les 20 Mio binaires
  après expansion base64 et l'overhead JSON.
- Validation d'un maximum de quatre blocs image.
- Refus des URLs distantes en v1 : uniquement des data URLs issues du pipeline
  local, afin d'éviter SSRF, tracking et contenu mutable.
- MIME allowlisté et base64 valide ; rejet du SVG et de tout contenu actif.
- Authentification effectuée avant lecture du body, comme aujourd'hui.
- Le proxy ne journalise que modèle, dimensions agrégées, octets, tokens,
  durée, code d'erreur et identifiant de réservation ; jamais le contenu.

### Routage

- `euOnly` précède toute route vision Terra.
- `hasPrivateHistory` et les intentions privées précèdent toute route vision
  Terra.
- Les tests de précédence couvrent choix manuel, Auto, fournisseur indisponible,
  lot mixte, PDF et conversation privée.

---

## 12. Expérience utilisateur

### Avant l'envoi

- Afficher la vignette et, si disponible, « optimisée en 4K ».
- En Auto, afficher avant l'envoi la destination estimée : « Analyse par
  GPT-5.6 Terra (OpenAI) ». Le mode Europe affiche Mistral. Cette indication ne
  remplace pas le footer du modèle effectivement servi.
- Pendant une normalisation perceptible : état « Préparation de la photo… » ;
  le bouton Envoyer reste bloqué pour éviter un envoi de la source brute.
- Messages distincts pour : format non supporté, source >32 Mio, échec de
  décodage, trop d'images et lot normalisé >20 Mio.

### Après l'envoi

- Footer : « GPT-5.6 Terra · analyse photo 4K » avec la raison de routage.
- Ne pas promettre une mesure physique ou un diagnostic certain.
- Pour une microfissure ou un détail trop petit, la réponse doit demander un
  gros plan plutôt que d'inventer.
- Une question nécessitant les pixels d'une ancienne image propose de la
  joindre à nouveau ou d'utiliser l'action P1 de réanalyse.

---

## 13. Exigences P0, P1 et P2

### P0 — indispensable au lancement

- Pipeline canonique 4096 px appliqué avant RAM, stockage et API.
- Builder OpenAI multimodal avec `detail: "original"`.
- Images historiques non renvoyées automatiquement.
- Routage et précédences du tableau §7.
- Bornes client et proxy §11.
- Estimation wallet par dimensions et settle par usage réel.
- Raison de routage et modèle visibles en FR/EN.
- Feature flag désactivé par défaut.
- Benchmark et matrice de tests verts avant activation Auto.

### P1 — amélioration rapide

- Conversion HEIC/HEIF robuste sur iOS.
- Action « Réanalyser cette photo » avec coût explicite.
- Sélection d'une zone/crop haute définition par l'utilisateur.
- Envoi d'une vue 4K et de crops ciblés plutôt qu'une image 200 MP entière.
- Estimation de coût visible dans les outils owner.

### P2 — futur

- Routage comparatif Terra/Sonnet selon la nature du détail.
- Pré-détection locale de flou, faible lumière et obstruction.
- Analyse structurée multi-photos avec repérage « vue générale / gros plan ».
- Migration du seul chemin OpenAI vers Responses après une PR et des tests
  dédiés, sans la coupler à la vision v1.

---

## 14. Plan de tests et critères d'acceptation

### 14.1 Normalisation

- [ ] Une source `8064 × 6048` produit un asset `4096 × 3072` maximum.
- [ ] Une source `4032 × 3024` n'est pas agrandie.
- [ ] Une source très légère mais `>4096 px` est redimensionnée.
- [ ] Une recompression plus lourde ne fait jamais ressortir l'original hors borne.
- [ ] L'orientation EXIF est appliquée et les métadonnées sont retirées.
- [ ] La sortie respecte 6 Mio ; quatre sorties respectent 20 Mio.
- [ ] Premier envoi, retry et édition utilisent le même hash d'asset canonique.

### 14.2 Routage

- [ ] Auto + JPEG seul + OpenAI disponible → Terra.
- [ ] OpenAI manuel + JPEG seul → Terra.
- [ ] Claude manuel + JPEG seul → Claude.
- [ ] Mistral manuel + JPEG seul → Mistral.
- [ ] `euOnly` + OpenAI manuel + JPEG → Mistral avec override.
- [ ] Historique Google privé + JPEG → Claude.
- [ ] JPEG + PDF → Claude.
- [ ] PDF seul → Claude.
- [ ] OpenAI indisponible + Auto + JPEG → Claude.
- [ ] Gemini manuel + JPEG → Claude avec override visible.
- [ ] Le fournisseur estimé est visible dans le composer avant l'envoi Auto.

### 14.3 Requête et historique

- [ ] Le tour source contient un bloc `image_url` et `detail: "original"`.
- [ ] Le tour suivant ne contient plus le base64 historique.
- [ ] Un retry du tour source réhydrate l'asset et le renvoie.
- [ ] Un lot de cinq images est refusé avant appel.
- [ ] Une URL distante ou un SVG est refusé.

### 14.4 Facturation

- [ ] `4096 × 3072` réserve environ 12 288 tokens image, plus texte et sortie.
- [ ] Le base64 n'est pas compté comme texte.
- [ ] Le settle utilise les `prompt_tokens` OpenAI réels.
- [ ] Refus et erreur upstream remboursent wallet, quota et cap.
- [ ] Le ledger ne contient ni nom de fichier ni payload image.

### 14.5 Mobile et réseau

- [ ] Test Android réel : capture caméra, normalisation, envoi et retry.
- [ ] Test navigateur mobile : `capture="environment"`.
- [ ] Source 200 MP de 25–30 Mio : normalisée ou refusée proprement sans crash.
- [ ] Mode avion pendant l'envoi : erreur récupérable, asset local intact.
- [ ] Proxy : corps >30 Mio → 413 avant lecture complète et avant appel OpenAI.

---

## 15. Benchmark qualité obligatoire

Comparer en aveugle le chemin actuel Claude et Terra 4K sur au moins **40
cas réels ou représentatifs**, sans données personnelles non consenties :

- 10 vues générales de façade ;
- 10 fissures/défauts avec gros plan ;
- 10 étiquettes, plaques ou petits textes ;
- 5 scènes en faible lumière ;
- 5 cas négatifs où aucun défaut ne doit être inventé.

Chaque cas possède une vérité terrain ou une grille annotée par un humain :
éléments visibles, éléments absents, texte attendu, niveau d'incertitude.

Gate d'activation Auto :

- taux d'erreur critique Terra non supérieur à Claude de plus de 2 points ;
- score global Terra au moins égal à 95 % du score Claude ;
- rappel sur petits détails supérieur ou égal à Claude ;
- taux d'hallucination sur cas négatifs non dégradé ;
- coût et latence dans les bornes §16.

Si le gate échoue, Terra vision reste accessible uniquement par sélection
manuelle pendant l'itération suivante.

---

## 16. Métriques de succès

### Indicateurs précoces — 7 jours

| Métrique | Cible |
|---|---:|
| Requêtes vision servies sans erreur | >= 98 % |
| Images envoyées respectant la borne 4096 px | 100 % |
| Fuite `euOnly` ou historique privé vers OpenAI | 0 |
| Renvoi automatique d'une image historique | 0 |
| Coût moyen d'entrée par photo | <= 0,04 $ |
| Prétraitement p95 sur la matrice Android supportée | <= 3 s |

### Indicateurs à 30 jours

| Métrique | Cible |
|---|---:|
| Utilisateurs jugeant le détail suffisant lors du feedback ciblé | >= 80 % |
| Demandes nécessitant un nouvel envoi pour manque de détail | < 15 % |
| Coût fournisseur moyen par message vision | <= 0,10 $ |
| Régressions de marge ou soldes wallet négatifs matériels | 0 |

Les seuils de coût sont des hypothèses initiales. Ils doivent être revus avec
la distribution réelle du nombre de photos par message.

---

## 17. Télémétrie autorisée

Événement agrégé `vision_request_completed` :

- provider et modèle effectifs ;
- raison de routage ;
- nombre d'images ;
- largeur/hauteur normalisées regroupées par tranche ;
- octets normalisés agrégés ;
- tokens input/output réels ;
- coût fournisseur ;
- temps de normalisation, upload, premier token et total ;
- succès ou code d'erreur allowlisté ;
- plateforme web/Android, sans identifiant matériel.

Interdits : nom de fichier, EXIF, miniature, base64, prompt, réponse, hash
réversible ou dimensions de source permettant de profiler un appareil.

---

## 18. Déploiement et rollback

### Phasage recommandé

1. **PR-A — fondation image** : pipeline canonique, métadonnées, tests, sans
   changer le routage.
2. **PR-B — OpenAI vision** : blocs multimodaux, historique one-shot, bornes
   proxy et facturation, feature désactivée.
3. **PR-C — routage et UI** : raison, overrides, traductions et benchmark.
4. **Activation** : manuel interne, 10 % Auto, 50 %, puis 100 % si les métriques
   restent dans les bornes pendant au moins 48 h par palier.

### Feature flags

- Un flag client désactive la construction multimodale et le routage Auto.
- Un killswitch serveur refuse les blocs image avant débit quota/wallet pour le
  chemin clé serveur.
- Le rollback restaure le routage des images vers Claude ; les assets 4K déjà
  persistés restent compatibles et ne nécessitent aucune migration.
- Aucun fallback cross-provider silencieux après réception upstream.

---

## 19. Dépendances et fichiers probablement concernés

- `src/services/imageCompression.ts` — remplacement par le contrat canonique.
- `src/services/secureFileStorage.ts` — stockage des dimensions/version.
- `src/types/index.ts` — métadonnées de l'asset normalisé.
- `src/components/layout/InputBar.tsx` — validation source, progression et erreurs.
- `src/services/native/camera.ts` — sortie JPEG et qualité cohérentes.
- `src/hooks/useFileAttachments.ts` — builder multimodal OpenAI one-shot.
- `src/hooks/useConversation.ts` — envoi OpenAI avec l'image courante.
- `src/services/openaiClient.ts` — types de blocs multimodaux.
- `src/services/router/types.ts` et `resolveRoute.ts` — classification et raison.
- `functions/api/ai/openai-proxy.ts` — bornes, validation et forwarding.
- `functions/api/_lib/walletBilling.ts` — estimation média dimensionnelle.
- `src/services/costTracker.ts` / tracking serveur — parité des coûts.
- locales FR/EN et suites de tests associées.

---

## 20. Questions ouvertes

### Bloquantes avant PR-B

1. **Engineering :** quelle borne de body Cloudflare est effectivement garantie
   sur le plan de production ? La borne Arty de 30 Mio doit rester inférieure.
2. **Produit/finance :** confirme-t-on le markup texte pour l'image d'entrée,
   ou souhaite-t-on un markup dédié distinct de la génération d'images ?
3. **Engineering :** le fallback `gpt-5` accepte-t-il le même bloc multimodal
   dans tous les comptes BYOK visés ? À défaut, désactiver le fallback pour les
   requêtes vision.

### Non bloquantes pour PR-A

1. **Produit :** faut-il afficher le coût estimé avant une réanalyse manuelle ?
2. **Design :** où placer l'état « optimisée en 4K » sans alourdir le composer ?
3. **Data :** quelle grille de vérité terrain utiliser pour les photos de
   chantier du benchmark ?
4. **Engineering :** faut-il convertir HEIC en P1 côté natif uniquement ou
   également dans le navigateur ?

---

## 21. Définition de terminé

La fonctionnalité est terminée lorsque :

1. tous les P0 et critères §14 sont verts ;
2. le benchmark §15 passe ;
3. la télémétrie de coût est vérifiée sur au moins un appel BYOK et un appel
   clé serveur, sans donnée photo dans les logs ;
4. les gates Europe et données privées ont été challengés par des tests
   adverses ;
5. un test réel Android couvre capture, préparation, envoi, follow-up et retry ;
6. le killswitch et le rollback vers Claude ont été répétés en Preview ;
7. la documentation utilisateur précise les limites de l'analyse visuelle.

---

## 22. Références

- OpenAI — GPT-5.6 Terra :
  <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- OpenAI — Images and vision, niveaux de détail et calcul des patches :
  <https://developers.openai.com/api/docs/guides/images-vision>
- OpenAI — tarifs API :
  <https://developers.openai.com/api/docs/pricing>
- Samsung ISOCELL HP5 — exemple de capteur 200 MP `16 384 × 12 288` :
  <https://semiconductor.samsung.com/image-sensor/mobile-image-sensor/isocell-hp5/>
