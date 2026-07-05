# Audit — Visibilité du modèle IA pour l'utilisateur (5 juillet 2026)

**Demande** (Florent) : « améliorer la visibilité pour les utilisateurs pour savoir
quel modèle exactement ils utilisent ».

**Méthode** (RÈGLE 7) : 4 agents de cartographie en parallèle (pipeline de sélection,
surfaces UI, persistance/appels annexes — Sonnet ; angle produit/confiance — Opus),
puis contre-vérification adversariale de chaque affirmation par 2 agents Sonnet
(consigne : réfuter) + 1 agent Opus en challenge du cahier des charges. Les findings
ci-dessous ont TOUS été re-vérifiés en lecture directe du code (file:line exacts au
commit `892a50d`). CDC associé : `model-visibility-audit-2026-07-05-cdc.md`.

---

## Verdict en une phrase

L'infrastructure de visibilité existe (event `arty-model-used` → « Dernier appel :
X » + drapeau région + « Pourquoi ce modèle ? ») mais elle **déclare l'intention du
client au lieu de confirmer ce que le serveur a réellement servi**, elle est
**éphémère** (rien n'est persisté par message), **muette pour un provider entier**
(OpenAI), **polluée par les appels d'arrière-plan**, et plusieurs textes affichés
sont **factuellement faux**. Le reframe retenu (validé par l'agent produit Opus) :
le vrai besoin n'est pas « afficher le nom du modèle partout », c'est **« pouvoir
prouver a posteriori quel modèle a répondu »** — exactitude d'abord, persistance
ensuite, lisibilité enfin.

## Ce qui existe déjà (et qui est bien)

- `dispatchModelUsed()` / event `arty-model-used` (`src/services/modelLabels.ts:29`)
  dispatché par les clients Claude/Gemini/Mistral → « Dernier appel : {modèle} »
  dans ChatTopBar (`ChatTopBar.tsx:452`) et ChatOptionsSheet (`:158`), avec
  drapeau région 🇪🇺/🇺🇸 (`getModelRegion`, mapping statique — conforme RÈGLE 6)
  et explication générique « Pourquoi ce modèle ? » (`getModelExplanationKey`).
- Écran Coûts ventilé **par modèle exact** depuis D1 (`quota_model`, BUG 60 —
  serveur = source de vérité).
- PlanBadge + quotas par bucket (P0.6), cap explicite via CapReachedModal (P0.7).
- Le fact-check affiche son propre `modelLabel` (feature distincte, correct).
- BYOK : jamais de substitution serveur (`proxy.ts:49`, gate `!isByok`) — un
  utilisateur BYOK reçoit toujours exactement le modèle demandé.

---

## Findings

### Exactitude — le signal affiché peut mentir

**F-1 (HIGH) — Substitution serveur silencieuse en essai, jamais signalée au client.**
`functions/api/ai/proxy.ts:131-148` : pour un plan `trial`, tout modèle non autorisé
est réécrit vers `claude-haiku-4-5-20251001` dans le body — le commentaire du code
dit lui-même « override silencieux ». Même logique Mistral → `mistral-medium-latest`
(`mistral-proxy.ts:99-110`). Aucun header/champ ne signale la substitution au client.
Or le client a déjà affiché le modèle **demandé** (Sonnet par défaut,
`aiRouter.ts:360`). Ampleur contre-vérifiée :
- **Essai par email : mensonge PERMANENT.** `usePlanStatus.refresh()` fait un return
  anticipé sans token Google (`usePlanStatus.ts:74-78`) → `arty-plan-cache` (seul
  point d'écriture : `usePlanStatus.ts:89`) reste `null` pour toujours →
  `selectClaudeSubModel` (`aiRouter.ts:339-345`, ne teste que `=== 'free'`) demande
  Sonnet → le serveur sert Haiku → l'UI affiche « Claude Sonnet 5 » à chaque message.
- **Essai Google : fenêtre courte.** `normalizePlan` (`subscription/status.ts:93-96`)
  normalise `trial` → `'free'` ; dès le premier fetch réussi, le client se verrouille
  Haiku lui-même (`creditsCoverPremium()` false pendant l'essai,
  `walletClient.ts:62-66`). Divergence bornée à ~1 aller-retour réseau.
- Effet secondaire : `recordUsage(ANTHROPIC_MODEL, …)` (`anthropicClient.ts:716-720`)
  enregistre le coût local sous **Sonnet** alors que Haiku a servi. Le serveur D1,
  lui, est exact (`proxy.ts:144` réassigne `modelName` AVANT `recordUsage` ligne 260).
- ⚠️ Le silence est une **décision produit codée** (commentaire `proxy.ts:131-134` :
  « sans exposer d'erreur visible au client ») — la dé-silencier demande un accord
  explicite (voir CDC, décision D2).
- Contredit frontalement « jamais de bascule silencieuse » (boussole stratégique).

**F-2 (HIGH) — La boucle « demandé → servi » n'est JAMAIS refermée, pour aucun provider.**
`dispatchModelUsed` est toujours appelé AVANT le fetch, avec le modèle calculé côté
client. Aucun client ne relit le modèle confirmé par la réponse :
- `anthropicClient.ts:316-325` (parser SSE `message_start`) extrait `usage` mais
  ignore `message.model` — qui contient pourtant la vérité (y compris le swap F-1).
- `mistralClient.ts` (streamOnce) ne lit jamais `parsed.model` du flux
  OpenAI-compatible qu'il reçoit.
- `openaiClient.ts:213` lit correctement `parsed.model` (`usedModel`)… mais ne s'en
  sert que pour `recordUsage` (:224), jamais pour l'UI.
Architecture : l'affichage est une déclaration d'intention, pas une confirmation.
Toute substitution/fallback présent ou futur est structurellement invisible.

**F-3 (HIGH) — openaiClient ne dispatche JAMAIS `arty-model-used` : badge muet ou mensonger pour tout appel ChatGPT.**
Zéro occurrence de `dispatchModelUsed` dans `openaiClient.ts` (les 3 autres clients
l'appellent). Conséquences : si ChatGPT répond en premier, aucun badge n'apparaît ;
si un autre modèle a répondu avant, le badge reste FIGÉ sur l'ancien — y compris le
drapeau 🇪🇺 de Mistral alors que la donnée part chez OpenAI (US). Le fallback interne
`gpt-5.5` → `gpt-5` (`openaiClient.ts:96-116`, signalé par `model_not_supported` du
proxy) est lui aussi invisible, alors que le client CONNAÎT le modèle servi.

**F-4 (HIGH) — Le badge « Dernier appel » est un état global non scopé, pollué par les appels d'arrière-plan.**
Le listener de ChatTopBar (`ChatTopBar.tsx:98-118`) accepte tout event sans filtre
de conversation ni de source. Vecteurs de pollution contre-vérifiés :
- **Brief proactif** : `useProactiveBrief.ts:158` force `claude-haiku-4-5-20251001`
  via `streamMessage` → dispatch (`anthropicClient.ts:641`). Déclenché au mount
  (+1800 ms) et au retour foreground — gaté par settings + intervalle ~3 h + pré-check
  Gmail/Calendar, donc quelques fois/jour, pas systématique. Scénario réel : en pleine
  conversation Mistral 🇪🇺, retour d'arrière-plan → le badge passe à
  « Claude Haiku 4.5 » 🇺🇸 sans aucun message envoyé.
- **Résumé de conversation** : `ConversationSummaryModal.tsx:97` appelle
  `streamMessage`/`streamMistralMessage` (dispatch) — monté SOUS ChatTopBar.
- **Comparateur** : pas de pollution pendant `/compare` (ChatTopBar démonté), MAIS
  aucun `cancel()` des streams au unmount (`SideBySideChat.tsx`,
  `useMultiProviderChat.ts`) → streams orphelins qui dispatchent après le retour
  dans une conversation.
- (Le fact-checker et le compresseur ne dispatchent PAS — fetch bruts. Corrigé de
  l'hypothèse initiale par la contre-vérification.)

**F-5 (MED) — Mode hybride : `usedModels` n'enregistre que `'gemini'` alors que Claude rédige la réponse.**
`useConversation.ts:466` (`provider === 'hybrid' ? 'gemini' : provider`) — persisté
avant même l'appel. Or la synthèse affichée est écrite par Claude
(`useConversation.ts:576+`). Impact : export Markdown/PDF (« Modèles utilisés :
gemini », `conversationExport.ts:131,212`), partage public (`shareClient.ts:48`),
point Sidebar (`Sidebar.tsx:534`) — tous attribuent à Gemini un texte écrit par
Claude. Pendant le stream, le badge live dit pourtant Claude (dernier dispatch) :
le live et le persisté se contredisent.

**F-6 (MED) — Double dispatch Gemini : l'indicateur « réflexion approfondie » s'éteint avant le premier token.**
`geminiClient.ts:234` dispatche avec `reflecting: thinkingBudget >= 2048`, puis
`:285` re-dispatche SANS le champ dès `response.ok` (avant le premier token).
`StreamingIndicator.tsx:20-26` fait `setReflecting(!!detail?.reflecting)` sur chaque
event → l'état repasse à false mécaniquement. L'intention documentée du composant
(« sans ce signal, la réflexion est 100 % imperceptible ») est annulée. Anthropic et
Mistral n'ont qu'un seul dispatch (vérifié) — bug spécifique Gemini.

### Persistance — rien ne survit

**F-7 (HIGH, structurel) — Aucune attribution de modèle par message.**
`Message` (`src/types/index.ts:43-52`) n'a ni `model` ni `provider`.
`useStreaming.finalize()` (`useStreaming.ts:91-106`) persiste
`{id, role, content, timestamp, interrupted?}` — rien d'autre. `MessageList`/
`AssistantBubble`/`AssistantAvatar` : zéro notion de modèle (logo identique pour
Haiku, Opus, Gemini ou GPT). Seul survivant : `Conversation.usedModels`, au niveau
**famille** uniquement (impossible de distinguer une réponse Haiku d'une réponse
Opus), append-only, dédupliqué. Après un reload ou en relisant l'historique d'une
conversation multi-modèles : aveugle total. C'est LE trou principal — tout
l'affichage temps réel actuel s'évapore à la fermeture de la session.

**F-8 (LOW) — Sidebar et exports affichent le slug brut, et le « modèle dominant » est le premier historique.**
`Sidebar.tsx:534` prend `usedModels[0]` (premier provider jamais utilisé, pas le
plus récent/fréquent) et le rend brut (`:620-624` — « OPENAI » au lieu de
« ChatGPT »). Idem exports (`conversationExport.ts:131,212`).

### Lisibilité — la surface par défaut et les textes

**F-9 (MED) — La refonte v2 (défaut mobile) a enterré le nom du modèle résolu dans le sheet « ⋯ ».**
Pilule v2 : « Auto » + drapeau région du dernier appel (`ChatTopBar.tsx:288-296`) —
le NOM résolu (« Claude Sonnet 5 ») n'est visible qu'en ouvrant ChatOptionsSheet
(`:158`). L'ancien header legacy (killswitch) l'affichait inline
(`ChatTopBar.tsx:443-469`). La surface la plus utilisée a la visibilité la plus
faible — améliorer la visibilité commence par RESTAURER ce que la refonte a caché.

**F-10 (MED) — Textes d'explication factuellement faux.**
- `chat.modelExplain.haiku` (`fr.json:231`) : « Modèle gratuit (10/jour) » — faux
  pour un abonné payant routé sur Haiku par `isShortTrivial` (`aiRouter.ts:350-353`) :
  Haiku n'est pas dans `PREMIUM_BUCKET_CAPS`, donc illimité pour lui.
- `chat.optionsSheet.modelDesc.openai` (`fr.json:214`) : « Sélection manuelle
  uniquement » — faux dès qu'une clé OpenAI BYOK existe : `detectOpenAIIntent` route
  en mode Auto (`aiRouter.ts:394`), vers les US, sans la confirmation EU→US pourtant
  exigée pour un switch manuel (`ChatTopBar.tsx:150-156`). Incohérence de garde.

**F-11 (MED) — CapReachedModal : le bouton « Continuer avec les modèles standards » ne fait RIEN.**
Les deux boutons non-achat font uniquement `close()` (`CapReachedModal.tsx:98-105`).
Aucun mécanisme de downgrade n'existe : `monthlyCap` n'est lu par aucun code de
routage — un renvoi en Auto re-sélectionnera le même modèle premium capé → nouveau
429 immédiat. Le texte (`quota.capReachedHint`) promet une action que le code ne
réalise pas.

**F-12 (MED) — Labels statiques qui driftent : un label faux est pire que pas de label.**
`formatModelName` (`modelLabels.ts:43-80`) : « Mistral Medium 3.5 » hardcodé pour
TOUT id `mistral-*` (y compris l'alias mouvant `mistral-medium-latest` — au prochain
bump Mistral, le label mentira) ; `gemini-2.5-flash` et `gemini-3.5-flash` →
indistinctement « Gemini Flash » (la bascule éco P1.4 est invisible) ; versions GPT
hardcodées. Un seul test existe (`modelLabels.test.ts`) : rien sur `getModelRegion`,
`getModelExplanationKey`, ni sur « les 4 clients dispatchent » (ce qui aurait attrapé
F-3 en CI).

**F-13 (MED) — Les refus explicites des proxys n'atteignent jamais l'utilisateur.**
Les clients ne parsent le body d'erreur QUE pour `premium_cap_reached`
(`openaiClient.ts:160-172`, `geminiClient.ts:266-280`). Le message serveur clair
(« Les modèles premium ne sont pas disponibles en essai gratuit »,
`trialModelRestrictedResponse`) devient « Erreur OpenAI (403) » générique. Les proxys
qui refusent proprement (OpenAI, Gemini) produisent donc une UX aussi opaque que
ceux qui substituent en silence (Anthropic, Mistral).

### Prémisse produit — découverte du challenge Opus, contre-vérifiée

**F-14 (HIGH, produit) — En mode Auto, un compte Google SANS BYOK n'est JAMAIS routé vers Gemini/Mistral/OpenAI : Auto = toujours Claude.**
Sans clés BYOK, `_geminiKey`/`_mistralKey`/`_openaiKey` restent null
(`activeApiKey.ts` ; `App.tsx:884-887` et `LoginScreen.tsx:318` ne posent que
`anthropicKey: 'server-provided'`). Or TOUS les chemins Auto d'`aiRouter.ts` sont
gatés sur ces clés (`:390` YouTube→Gemini, `:394` intent OpenAI, `:398` hybride,
`:409` trivial→Mistral, `:416` défaut→Gemini). Le « routage intelligent » documenté
en tête d'`aiRouter.ts` (« Gemini par défaut, google_search, données 2026 ») n'existe
donc **que pour les utilisateurs BYOK**. Un abonné serveur en Auto est servi à 100 %
par Claude (avec sous-routage Haiku/Sonnet/Opus) ; il n'atteint GPT-5/Gemini que par
sélection MANUELLE — alors que la carte pricing vend « 150 Sonnet/Opus + 100 GPT-5 +
80 Gemini Pro ». Intentionnel (coût/qualité) ou trou produit latent ? **Décision
Florent requise** (CDC, décision D1) — l'issue conditionne les textes de visibilité
(« Arty choisit le meilleur modèle » décrit un comportement que la majorité n'a pas).

### Adjacent — transparence des limites (même promesse produit)

**F-15 (MED) — Le fact-checker consomme le cap premium Sonnet en silence : 150/mois ≈ 75 vrais échanges.**
Mode `auto` (défaut pour tout plan ≠ free) = `claude-sonnet-5`
(`factChecker.ts:192-196`), TOUJOURS via la clé serveur (aucun `x-api-key` BYOK dans
les headers, `:208-213`) → `enforceDailyQuota` + `checkPremiumCap` bucket
`claude-sonnet` (`proxy.ts:191-212`, `checkPremiumCap.ts:33-38,78-79`). Chaque
réponse > 80 chars vérifiée consomme 1 unité du cap, quel que soit le provider ayant
répondu → **~2 unités par échange réel**. Rien ne l'attribue dans l'écran quotas.
Le compresseur de contexte (`conversationCompressor.ts:205`, Sonnet, non-BYOK) est
dans le même cas, mais rare (seuil 80 k tokens). Le pattern correct existe déjà :
`memory-extract` (endpoint dédié hors cap + rate-limit propre) — son commentaire
avertit d'ailleurs de ne pas reproduire le piège… reproduit ici. (À la marge : le
fact-check en 429 n'est PAS silencieux — badge `failed` visible.)

**F-16 (LOW) — `TRIAL_ALLOWED_MODELS` partiellement obsolète.**
La liste exige `mistral-small` alors que le swap trial cible `mistral-medium-latest`
(la cible échouerait elle-même le test — décision « Small déprécié » assumée en
commentaire) ; `gpt-5-mini` est listé mais aucun chemin client ne l'envoie
(`DEFAULT_MODEL='gpt-5.5'`) → ChatGPT de facto indisponible en essai, avec erreur
générique (F-13).

---

## Synthèse des responsabilités

| Couche | État |
|---|---|
| Serveur (proxys) | Substitue (Anthropic/Mistral trial) ou refuse (OpenAI/Gemini) sans signal exploitable côté UI ; D1 `quota_model` exact |
| Clients IA | Dispatchent l'intention pré-fetch ; ne relisent jamais le modèle confirmé ; OpenAI ne dispatche pas du tout |
| Event `arty-model-used` | Global, non scopé conversation, sans flag background |
| Persistance | Rien par message ; `usedModels` = famille, faux en hybride |
| UI | Nom résolu enterré dans le sheet (v2) ; textes explicatifs faux (Haiku 10/j, OpenAI manuel) ; bouton cap no-op |
| Tests | `formatModelName` seulement ; rien sur le dispatch des 4 clients ni la région |

## Priorisation recommandée

1. **Exactitude** (F-1..F-6) — un signal faux est pire que pas de signal.
2. **Persistance par message** (F-7) — le vrai manque structurel derrière la demande.
3. **Lisibilité** (F-9, F-10, F-11, F-12, F-13) — restaurer + dire vrai.
4. **Décisions produit** (F-14, D1-D5 du CDC) — conditionnent les textes.
5. **Adjacent quotas** (F-15) — même promesse « limites lisibles », chantier séparable.

Le découpage en chantiers, les décisions à arbitrer, les garde-fous de régression
(BUG 16/52/54/61, RÈGLE 6, CORS expose-headers) et le plan de tests sont dans le
CDC : `docs/audits/model-visibility-audit-2026-07-05-cdc.md`.
