# CDC — Visibilité du modèle : « prouver le modèle a posteriori » (5 juillet 2026)

**Source** : audit `model-visibility-audit-2026-07-05.md` (findings F-1 à F-16).
**Méthode** : squelette challengé par un agent Opus dédié (RÈGLE 7) — ses corrections
sont intégrées (découpage C-A, plomberie C-B, périmètre réel du routage Auto,
réponses aux questions ouvertes).

## Reframe directeur

La demande « savoir quel modèle exactement j'utilise » se traite dans cet ordre :

1. **Exactitude** — le signal affiché doit refléter ce que le serveur a SERVI,
   pas ce que le client a demandé. Un label faux est pire que pas de label.
2. **Persistance** — l'attribution doit survivre au reload : par message, pas
   par session.
3. **Lisibilité** — par défaut en langage capacité (« Recherche web · 🇺🇸 »),
   nom technique précis à la demande. Jamais de jargon imposé, jamais de
   cadrage anxiogène (« version cheap »).

La visibilité PRÉ-envoi en Auto reste volontairement vague (« Arty choisit ») :
le routeur décide au send — toute prédiction affichée serait un mensonge. La
confiance vient de la divulgation post-hoc (pratique validée par le marché :
ChatGPT/Perplexity révèlent le modèle résolu après coup ; l'attribution par
message est devenue table stakes 2026 ; c'est précisément l'opacité qui vaut à
Mammouth ses plaintes « modèles dégradés »).

---

## Décisions préalables — ✅ TOUTES TRANCHÉES par Florent le 5 juillet 2026

- **D1 — Auto sans BYOK = 100 % Claude (F-14)** → **TROU PRODUIT, À CORRIGER**.
  Chantier SÉPARÉ (hors de ce CDC) : activer le routage multi-provider en Auto
  pour les comptes serveur. Argument coût retenu : Gemini 2.5 Flash
  ($0,30/$2,50) est ~10× moins cher que Sonnet — router les questions
  factuelles dessus RÉDUIT le coût par abonné tout en donnant la recherche web
  temps réel ; la carte pricing vend déjà « 80 Gemini Pro + 100 GPT-5 ».
  Tracké comme item P1.9 du plan d'action concurrentiel. En attendant, les
  textes du CDC (C-C/C-D) restent factuels sur le comportement COURANT.
- **D2 — Dé-silencier le swap trial (F-1)** → **OUI, SUPPRESSION À LA SOURCE**
  (C-E complet) : le client apprend le plan `trial` et demande directement
  Haiku — plus rien à cacher, l'UI dit vrai par construction. Le swap serveur
  (`proxy.ts:131-148`) reste comme filet de défense jamais déclenché. Cette
  décision ANNULE l'intention codée « sans exposer d'erreur visible »
  (`proxy.ts:131-134`) — accord explicite acté ici.
- **D3 — Partage public** → **MODÈLE PAR MESSAGE EXCLU du payload public**
  (cohérent tags « privé par design », `types/index.ts:71`) ;
  INCLUS dans les exports privés (Markdown/PDF/JSON). Pas de footer agrégé
  pour l'instant. ⚠️ Nuance relevée par la revue C-A (agent Sonnet) :
  `usedModels` au niveau FAMILLE figure déjà dans le payload public
  (`buildSharePayload`, `shareClient.ts:34-48`) — pré-existant, affiché par
  SharedConversationView. À trancher en PR 2 (implémentation D3) : soit on
  l'assume (granularité provider seulement, pas par message), soit on
  l'exclut aussi. Le per-message `Message.model` reste exclu quoi qu'il en
  soit.
- **D4 — CapReachedModal (F-11)** → **ACTION EXPLICITE, pas de downgrade auto** :
  le bouton devient « Passer sur Mistral (EU) » (`setSelectedModel('mistral')`,
  non capé, visible, réversible) + texte vrai (pack / reset le {date} /
  changer de modèle manuellement).
- **D5 — Fact-check & compresseur (F-15)** → **COMPTEUR SÉPARÉ + HAIKU D'ABORD** :
  quota de fond dédié et borné (pattern `memory-extract` — hors du cap premium
  utilisateur, avec son propre plafond modeste protégeant la clé owner,
  RÈGLE 6) ; le mode `auto` vérifie avec Haiku et n'escalade vers
  Sonnet+web_search que sur claims risqués ; l'écran quotas affiche
  « dont X vérifications auto » (convs non-EU uniquement, fact-check désactivé
  en euOnly).

---

## Chantiers

### C-A (P0) — Exactitude du signal

**A1. Refermer la boucle « demandé → servi » dans les 4 clients.**
- `anthropicClient` : lire `message_start.message.model` dans le parser SSE
  (aujourd'hui seul `usage` est extrait, `anthropicClient.ts:316-325`) ;
  si ≠ modèle demandé → re-dispatch correctif + utiliser cette valeur pour
  `recordUsage` (fix F-6 coûts locaux). ⚠️ BUG 52 : ne RIEN filtrer d'autre dans
  le parser — lecture additive uniquement.
- `mistralClient` : lire `parsed.model` du flux SSE (déjà présent dans le format).
- `openaiClient` : dispatcher ENFIN `arty-model-used` — avec `usedModel` confirmé
  (`openaiClient.ts:213`), ce qui couvre gratuitement le fallback 5.5→5 (F-3).
- `geminiClient` : l'API ne renvoie pas le modèle → conserver la valeur client
  (seul provider en déclaration d'intention, documenté).
- **PAS de header `x-arty-model-served` en v1** (gold-plating : la seule
  substitution réelle est le swap Anthropic trial, déjà couvert par
  `message_start.model` ; et C-E la supprime à la source). Si un jour ajouté :
  OBLIGATOIREMENT l'ajouter à `Access-Control-Expose-Headers`
  (`_middleware.ts:105`, qui n'expose que `x-trial-remaining`) sinon ça marche en
  web same-origin et échoue silencieusement sur APK Capacitor (piège classique).
- Le re-dispatch correctif doit être idempotent et scopé (voir A2) — sinon il
  réintroduit la pollution qu'on corrige.

**A2. Scoper l'event `arty-model-used`.**
- `ModelUsedEvent` += `{ scope: 'conversation' | 'background', conversationId?: string }`.
- ChatTopBar/StreamingIndicator n'acceptent que
  `scope === 'conversation' && conversationId === conversation active`.
- Émetteurs background à marquer : brief proactif (`useProactiveBrief.ts:158`),
  résumé (`ConversationSummaryModal.tsx:97` — peut afficher son modèle dans SA
  modale), comparateur. NB (contre-vérifié) : fact-checker et compresseur ne
  dispatchent PAS — ils relèvent de C-F, pas d'ici.
- Fix connexe comparateur : `cancel()` des streams au unmount de
  `SideBySideChat`/`useMultiProviderChat` (streams orphelins = le vrai vecteur).

**A3. Fix double dispatch Gemini** (`geminiClient.ts:285` re-dispatche sans
`reflecting` → écrase l'indicateur, F-6) : supprimer le 2ᵉ dispatch ou y
reporter le flag.

**A4. `usedModels` hybride = les deux providers** (`useConversation.ts:466` :
enregistrer `'gemini'` ET `'claude'`). ⚠️ Vérifier l'impact sur la garde EU/US
`hadMistral` (`ChatTopBar.tsx:150`) et sur `branchConversation` qui copie
`usedModels` (BUG 8) — additif mais à tester.

**Critères d'acceptation C-A** : test de parité « chaque client IA dispatche
`arty-model-used` exactement une fois par appel conversation » (aurait attrapé
F-3 en CI) ; test « swap simulé → badge corrigé » ; test « event background d'une
autre conversation n'écrase pas le badge » ; test reflecting Gemini.

### C-B (P0) — Persistance par message

- `Message.model?: string` (+ `provider?: string`) — champ OPTIONNEL, pattern
  additif de `tags` : transparent au déchiffrement, AUCUNE migration, jamais de
  wipe (BUG 61).
- **Plomberie (correction du challenge Opus — point critique)** : le modèle est
  capturé PAR STREAM, pas via le cache global. `finalize()`
  (`useStreaming.ts:91-106`) est appelé sans contexte modèle, et
  `getLastModelUsed()` est un cache global falsifiable par un appel de fond ou un
  stream concurrent (`MAX_CONCURRENT_STREAMS = 3`). → ajouter un callback
  `onModel(modelId)` à la signature des clients (ou l'event scopé conversationId
  de A2) qui écrit dans le `StreamState` du `targetId` ; `finalize()` lit le
  StreamState. **INTERDIT** de lire `getLastModelUsed()` au finalize.
- Écriture SYNCHRONE pendant le stream : `finalize`/`saveConversation` restent
  synchrones (BUG 16) — le champ est déjà en mémoire au moment du finalize.
- Hybride : `Message.model` = le modèle de RÉDACTION (Claude), la recherche
  Gemini étant portée par l'attribution composée (C-C) et `usedModels` (A4).
- Partage public : champ EXCLU du payload (D3) ; exports privés : INCLUS.
- `retryMessage`/branches : le nouveau message porte le modèle du nouvel appel.

**Critères d'acceptation C-B** : après reload, chaque bulle assistant récente
connaît son modèle ; 2 streams concurrents → chacun le bon modèle ; conversation
antérieure sans champ → rendu inchangé (pas de « Inconnu » agressif).

### C-C (P0) — Lisibilité sur la surface par défaut

- **Footer discret par bulle assistant** (UNE surface primaire) : par défaut
  capacité + région (« Recherche web · 🇺🇸 », « Europe · 🇪🇺 », « Analyse &
  fichiers · 🇺🇸 ») ; tap → nom précis + explication
  (« Claude Sonnet 5 · États-Unis · Pourquoi ce modèle ? » — réutilise
  `getModelExplanationKey`/`getModelRegion`). Rendu uniquement si
  `Message.model` présent (pas de rétro-invention).
- **StreamingIndicator** : afficher le nom résolu du stream COURANT (même canal
  scopé que C-B — pas `getLastModelUsed()`).
- **Pilule v2** : reste « Auto » + drapeau (pré-envoi honnêtement vague, D1) ;
  le footer par message restaure ce que la v2 avait enterré (F-9).
- i18n FR/EN complet ; formulation capacité, jamais de jugement de valeur.

### C-D (P1) — Vérité des textes et des labels

- `chat.modelExplain.haiku` : retirer « (10/jour) » ou conditionner au plan free.
- `chat.optionsSheet.modelDesc.openai` + `modelExplain.openai` : formulation
  conditionnelle honnête (« si tu as configuré ta clé OpenAI, Arty peut y router
  quand tu mentionnes ChatGPT ») — l'auto-routing n'existe pas sans BYOK (F-14).
- **Garde EU→US alignée** — ⏸️ DIFFÉRÉE (implémentation PR 3, 5 juillet) :
  l'analyse d'implémentation montre qu'une conv non-euOnly ayant touché
  Mistral route DÉJÀ chaque message suivant vers Claude/Gemini (US) en Auto —
  le trou n'est pas spécifique à l'intent OpenAI, c'est TOUT le routage Auto.
  Une modale par message serait inutilisable ; le design propre est un
  acquittement UNE FOIS par conversation (flag persistant type
  `conv.euUsAcknowledged`) — mini-chantier UX dédié, à cadrer séparément
  plutôt que bâclé ici. L'intent explicite « utilise ChatGPT » reste sans
  modale (consentement par le message lui-même). En attendant, les convs
  euOnly restent verrouillées Mistral en amont (inchangé).
- **CapReachedModal** (D4) : action explicite « Passer sur Mistral (EU) » +
  texte vrai. Supprimer la promesse fantôme de `capReachedHint`.
- **formatModelName anti-drift** : dériver la version de l'ID quand elle y est ;
  distinguer `gemini-2.5`/`gemini-3.5` ; ne plus hardcoder « 3.5 » pour
  `mistral-medium-latest` (alias mouvant → label sans version plutôt que version
  fausse). Étendre le **test de parité** (pattern F-1 toolConfirmation) : tout ID
  routable (clients + cibles de swap serveur, dont `claude-haiku-4-5-20251001`)
  DOIT avoir label + `getModelRegion` + entrée pricing — CI rouge sinon.
- **Erreurs proxys parlantes** (F-13) : parser `trial_model_restricted` (et
  siblings) dans les clients → message i18n clair (« Ce modèle n'est pas dispo
  en essai — l'essai utilise Haiku/Flash/Medium »), au lieu de « Erreur X (403) ».

### C-E (P1) — Trial honnête (dépend de D2)

- Exposer le plan `trial` au client : `subscription/status.ts` distingue
  `trial` (aujourd'hui normalisé `free`) OU le flux trial email pose
  `arty-plan-cache` — pour que `selectClaudeSubModel` demande DIRECTEMENT Haiku
  (`aiRouter.ts:339-345` étendu à `'trial'`). Le swap serveur devient un filet
  jamais déclenché au lieu d'un mensonge permanent (essai email, F-1).
- Microcopy : « Essai gratuit : réponses via Claude Haiku » (TrialIntro/badge) —
  cohérent P0.10 (transparence des limites, sans jargon anxiogène).
- Garder le swap serveur comme défense en profondeur (ne pas le retirer).
- Nettoyer `TRIAL_ALLOWED_MODELS` (F-16) au passage (mistral small → medium).

### C-F (P1) — Quotas des appels de fond attribués (dépend de D5)

- Fact-checker : quota de fond dédié borné (miroir `memory-extract` : endpoint ou
  flag serveur, plafond modeste, coût tracké séparément) — SORT du cap premium
  utilisateur, SANS ouvrir un chemin clé-serveur non plafonné (RÈGLE 6).
  Interim : `auto` = Haiku d'abord, escalade Sonnet si claims risqués.
- Compresseur : ⏸️ RÉSIDUEL DOCUMENTÉ (implémentation PR 5, 6 juillet) — non
  migré vers l'endpoint de fond : son entrée est l'historique COMPLET
  (~80 k tokens), incompatible avec le pattern « payload tronqué côté
  serveur » de fact-check/memory-extract (tronquer casserait le résumé).
  Exposition bornée : déclenchement rare (seuil 80 k), 1 appel par
  compression, BYOK non concerné (clé user). À migrer si la vigie éco
  montre un poids réel (endpoint dédié à payload large + cap 5/jour).
- Écran quotas : ligne d'attribution « dont X vérifications automatiques »
  (convs non-EU uniquement).
- Test de non-régression : « aucun appel de fond ne consomme le bucket premium »
  (le commentaire d'avertissement de `memory-extract` n'a pas suffi — 3 récidives).

### Suivi résiduel C-E (revue PR 4, 5 juillet) — Comparateur en essai

Le verrou Haiku (C-E) ne couvre que le chat principal. Le COMPARATEUR
(`/compare`) contourne tout : `options.model` prime sur `selectClaudeSubModel`
(`anthropicClient.ts`), le panneau par défaut est `claude-sonnet-5`
(`providerCatalog.ts`), et ses events sont `background:true` → la correction
de badge `confirmed` (C-A) est filtrée. Un compte d'essai qui ouvre le
Comparateur reçoit donc du Haiku sous un en-tête « Claude Sonnet 5 », sans
signal, avec un coût estimé sur le modèle demandé. À traiter (chantier court
dédié) : gating de plan sur l'écran Comparateur (ou panneaux par défaut
adaptés au plan) + affichage du `servedModel` dans les panneaux (les events
background portent déjà le modèle confirmé — il suffit que le Comparateur les
écoute pour SES panneaux). Le compresseur de contexte (Sonnet hardcodé, swap
possible en trial >80k tokens) relève de C-F/PR 5.

### C-G (P2) — Finitions

- Ledger par message sur demande : tap sur le footer C-C → « ~X crédits ·
  Claude Sonnet 5 » (post-stream uniquement, settle asynchrone — cadrage P1.7 ;
  masquer le coût fournisseur pour les users wallet).
- Sidebar/exports : labels produit (« ChatGPT » pas « OPENAI »),
  `dominantModel` = plus récent plutôt que premier historique (F-8).
- Distinction 2.5/3.5 Gemini dans le badge research : sans objet tant que
  `geminiResearch` ne dispatche pas (priorité basse, noté par le challenge).

---

## Anti-objectifs (à NE PAS faire)

- ❌ Prédire le modèle AVANT l'envoi en mode Auto (mensonge structurel).
- ❌ Étiqueter les appels de fond (mémoire, compression, fact-check) comme « ton
  modèle » — un seul modèle compte : celui qui a écrit la réponse affichée.
  (Le fact-check garde son propre badge : feature distincte.)
- ❌ Exposer les triggers/regex du routeur (gaming + confusion + secret
  commercial). Rester au niveau rôle/capacité.
- ❌ Cadrage anxiogène : « réponse rapide », jamais « modèle économique/dégradé ».
- ❌ Multiplier les surfaces : UNE surface primaire (footer message), le reste en
  drill-down. Pas de fiche technique par bulle.
- ❌ Downgrade automatique silencieux au cap (D4).
- ❌ Réutiliser `Message.model` pour du routage (attribution ≠ configuration).

## Garde-fous de régression (rappels bugs documentés)

- BUG 16 : `saveConversation`/`finalize` restent SYNCHRONES — le modèle est
  capturé pendant le stream, pas résolu en async au finalize.
- BUG 52 : le parser SSE Anthropic pousse TOUS les blocs — la lecture de
  `message_start.model` est additive, aucun filtrage.
- BUG 54 : toute nouvelle écriture partagée dispatch son CustomEvent ; les vues
  écoutent (pas de useMemo figé).
- BUG 61 : champ optionnel, cast nu, JAMAIS de wipe sur échec de déchiffrement.
- BUG 8 : `branchConversation` copie `usedModels` — vérifier avec A4.
- RÈGLE 6 : région = mapping statique de présentation (jamais dérivée d'une URL
  d'infra) ; pas de nouveau chemin clé-serveur non plafonné (C-F).
- CORS : tout nouveau header proxy → `Access-Control-Expose-Headers`, test APK.

## Séquencement proposé (PRs)

| PR | Contenu | Statut |
|---|---|---|
| 1 | C-A complet + tests de parité dispatch | ✅ Mergé (#321, 5 juil.) |
| 2 | C-B (Message.model + plomberie StreamState) + C-C (footer + streaming) | ✅ Mergé (#322, 5 juil.) |
| 3 | C-D (textes, labels anti-drift, CapReachedModal, erreurs parlantes) | ✅ Mergé (#323, 6 juil.) |
| 4 | C-E (trial honnête) | ✅ Mergé (#325, 6 juil.) |
| 5 | C-F (quotas de fond — endpoint /api/ai/fact-check) | ✅ Mergé (#327, 6 juil.) |
| 6+ | C-G (P2) | ⏳ Ouvert |

Chaque PR : `npx tsc --noEmit` (BUG 13) + suite de tests + vérif visuelle
Playwright mobile (pattern P2.2) pour les PRs UI (2, 3).

Décisions D1-D5 tranchées le 5 juillet 2026 (voir section ci-dessus) → toutes
les PRs du séquencement sont débloquées. Le chantier D1 (routage Auto
multi-provider serveur) est un chantier SÉPARÉ, tracké en P1.9 du plan
d'action concurrentiel — ne pas le mélanger aux PRs de ce CDC.

## Critère de succès global

Un utilisateur peut, pour N'IMPORTE QUELLE réponse de son historique (y compris
après reload/changement d'appareil pour les messages postérieurs au déploiement) :
1. voir en un coup d'œil la capacité + région qui l'a servie ;
2. obtenir en un tap le nom exact du modèle **réellement servi** (pas demandé) ;
3. et aucun signal affiché ne peut être contredit par les données serveur (D1).
