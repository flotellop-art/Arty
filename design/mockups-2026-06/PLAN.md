# Plan de migration design — PRs séparées

> Document de référence pour implémenter les maquettes de ce dossier.
> Produit après analyse du code par 2 agents (plan d'architecture Opus +
> cartographie des dépendances Sonnet). Chaque PR est petite, shippable
> indépendamment, et laisse l'app 100 % fonctionnelle.

## Ordre d'implémentation

```
A0 → A1 → F → B → C → D → E → G
```

Dépendances dures : B et D dépendent de A1 · G dépend de B et E (donc en dernier).
F est indépendante (remontée tôt = valeur "transparence" livrée vite).
C et E sont les plus risquées → flag/garde-fou obligatoire, jamais en lot.

## Constats de code qui dimensionnent le plan

- **Désynchro modèle Home/Chat** : `setSelectedModel()` (`modelSelector.ts:29-31`)
  écrit dans le scopedStorage **sans dispatcher d'événement** — violation du
  pattern BUG 54. Le style, lui, dispatche déjà `style-changed`
  (`TopBar.tsx:48`, `ChatTopBar.tsx:127`). `model-changed` n'existe pas.
- **Aucun test ne couvre les composants UI** (TopBar, ChatTopBar, InputBar,
  Sidebar, SettingsModal). Seul risque indirect : `aiRouter.test.ts` mocke
  `getSelectedModel` — ne pas changer sa signature. Le vrai filet est la
  vérif visuelle APK + PWA (cohérent BUG 45/46/59).
- **Aucune infra responsive desktop** : zéro breakpoint `lg:`/`md:` dans le
  layout ; la Sidebar est un overlay `fixed -translate-x-full` (`Sidebar.tsx:236`).
- **Switcher de conversations à moitié câblé** : `App.tsx:680-681` passe déjà
  `conversations` + `onSelectConv` à `ConversationScreen`, qui ne les
  déstructure pas (`ConversationScreen.tsx:43-63`).
- **Fact-check** : `FactCheckResult` n'a pas de champ `status` — les états
  vivent dans des magic strings **load-bearing** (`'Vérification en cours…'`
  est un skip-guard à `factChecker.ts:479` ; `includes('indisponible')` à
  `FactCheckBadge.tsx:37`). L'état pending n'est jamais rendu.
- **`SettingsModal` instancié à 3 endroits** (TopBar + 2× Sidebar) — à
  centraliser avant la sidebar persistante.
- **2 bugs dormants découverts** (à corriger au passage, PR D et C) :
  - `arty-open-api-keys` dispatché par `upgrade.tsx:108` n'a **aucun
    listener** → bouton « Configurer mes clés API » silencieusement cassé.
  - `HomeScreen.tsx:227` monte `<InputBar>` sans `onStop` → si un stream
    tourne en arrière-plan, le bouton Stop affiché est un no-op.

---

## PR A0 — Tokens contraste + focus-visible (CSS pur)

**Risque : minimal. Aucun flag.**

- `src/index.css:19` : `--theme-muted` Ember `143 107 77` (#8F6B4D, ~3.2:1)
  → `122 90 60` (#7A5A3C, ~4.6:1). **Ember uniquement** — le muted Nocturne
  est déjà conforme sur fond sombre.
- Ajouter une règle globale `:focus-visible` (ring accent) — il n'en existe
  aucune aujourd'hui ; plusieurs champs font `focus:outline-none` sans
  remplacement (`InputBar.tsx:1079`, `SettingsModal.tsx:438`).

Vigilance : l'audit a11y de mai a déjà retiré 56 opacités sur `text-theme-muted`
(CLAUDE.md) — assombrir le token réassombrit tout le texte secondaire ;
vérifier visuellement placeholders et hovers (« rendu trop dur » à monitorer).

Vérif : `npx tsc --noEmit` (no-op attendu) + passes visuelles Ember/Nocturne.

## PR A1 — Réactivité du modèle sélectionné (fix BUG 54 sur le modèle)

**Risque : faible. Aucun flag (additif).**

- `modelSelector.ts` : `setSelectedModel()` dispatche
  `CustomEvent('model-changed', { detail: model })` en try/catch (tolérer
  l'absence de `window` en test — exigence BUG 54).
- Créer un hook `useSelectedModel()` (état + écoute `model-changed`) — il
  sera réutilisé par B, D et G. `TopBar` et `ChatTopBar` migrent dessus.
- Le listener ne re-`setSelectedModel` jamais (boucle). Le warning EU/US et
  le lock Pro de `ChatTopBar.handleModelChange` (`:131-160`) gardent leur
  logique : l'événement ne sert qu'à la synchro d'affichage.
- Ajouter `modelSelector.test.ts` (l'event est bien dispatché).

Vérif : `tsc` + changer le modèle dans le chat → retour Home → pilule à jour.

## PR F — Fact-check 4 états (BUG 59)

**Risque : modéré. Pas de flag (le fact-check a déjà un mode off).**

- `types/index.ts` : champ **optionnel**
  `status?: 'pending' | 'success-empty' | 'success-with-claims' | 'failed'`
  sur `FactCheckResult` (optionnel = rétro-compat des conversations chiffrées
  déjà stockées ; fallback = dériver du `modelLabel` comme aujourd'hui).
- `factChecker.ts` : renseigner `status` aux 3 points de pose (~`:500`
  pending, ~`:530` failed, ~`:572` success) **sans supprimer** les magic
  strings load-bearing.
- `FactCheckBadge.tsx` : 4 rendus distincts — ◌ gris « vérification… »
  (pending, jamais rendu aujourd'hui), ✓ vert, ⚠ ambre, ✕ pointillé neutre.
  Ne pas re-cacher le badge à 0 claim (exigence BUG 59). Libellés via `t()`
  FR/EN — le composant a encore des chaînes FR en dur à migrer.

Vérif : `tsc` + vérif visuelle des 4 états sur APK et PWA.

## PR B — BottomSheet + sheet « ⋯ » + ChatTopBar 1 ligne

**Risque : moyen. Flag killswitch `arty-chat-sheet-v2` (pattern
`arty-conv-encryption-disabled`).**

- Créer `shared/BottomSheet.tsx` : `role="dialog"` + `aria-modal`, backdrop,
  `inert` sur le reste (pattern `Sidebar.tsx:161-164`), focus restauré au
  déclencheur, `env(safe-area-inset-bottom)`.
- Créer `chat/ChatOptionsSheet.tsx` : sélecteur modèle (via `useSelectedModel`)
  + styles + actions Résumé/Export/Partager + note EU + « pourquoi ce modèle ».
- `ChatTopBar.tsx` : réduit à 1 ligne (back + kicker + titre + pilule modèle
  + « ⋯ »). Le double filet éditorial est conservé (identité visuelle).
  `handleShare` (Web Share natif + fallback clipboard) et les exports migrent
  tels quels dans le sheet.

**Arbitrage sécurité (RÈGLE 5.3, tranché)** : la maquette proposait une note
EU/US purement informative. Décision : **confirmation bloquante la première
fois** qu'une conversation contenant des données EU bascule vers un modèle US
(consentement explicite exigé par la RÈGLE 5.3 / BUG 8), note inline pour les
bascules suivantes de la même conversation. Le flag `euOnly` reste verrouillant.

## PR C — InputBar : slot contextuel unique + chips horizontales + calendrier en sheet

**Risque : le plus élevé du plan (1455 lignes, BUG 44/46, Whisper). Flag
`arty-inputbar-v2`, gardé 1-2 cycles de beta Firebase.**

- Slot unique au-dessus de l'input, priorité **erreur > enregistrement >
  calendrier > chips** — nuance : une erreur ne masque jamais l'indicateur
  d'enregistrement en cours (le feedback micro hot doit rester visible,
  sinon leak micro non perçu).
- Chips quick-actions : `flex-wrap` → `overflow-x-auto` sans wrap.
- `CalendarMiniForm` → `BottomSheet` (réutilise PR B).
- Hint visuel « tap = dictée · maintenir = Whisper » + anneau pointillé.
  **Purement visuel** : ne pas toucher la mécanique hold/`HOLD_THRESHOLD_MS`
  ni `useSpeechRecognition`/`useSingleShot` (contraintes BUG 46), ni
  démonter les refs `MediaRecorder` pendant un enregistrement.
- Corriger au passage : `HomeScreen` sans `onStop` (no-op silencieux).

Vérif terrain APK obligatoire : tap dictée, hold Whisper, fichiers, date
détectée → sheet, chips sans wrap. + `vitest run` (useStreaming en aval).

## PR D — Navigation : switcher de conversations + entrées sidebar directes

**Risque : faible-moyen. Pas de flag (remplacement atomique event→callback).**

- `ConversationScreen.tsx` : déstructurer `conversations`/`onSelectConv`
  (déjà passés) → titre tappable (▾) dans `ChatTopBar` ouvrant un
  `BottomSheet` listant les conversations.
- `Sidebar.tsx` : entrées Coûts/Comparateur en bas, sur le modèle du callback
  `onOpenTemplates` existant (`App.tsx:247`).
- Supprimer les listeners `arty-open-upgrade/compare/costs` (`App.tsx:300-317`)
  et les dispatchs (`SettingsModal.tsx:526,547,624`) → callbacks de navigation
  en props. **Grep préalable** : vérifier qu'aucun service ne dispatche
  `arty-open-upgrade` (flux 403 abonnement) avant de retirer le listener.
  Ne PAS toucher aux événements de synchro de store (`cost-updated`,
  `model-changed`…) — famille distincte, imposée par BUG 54.
- Corriger le bug orphelin `arty-open-api-keys` (`upgrade.tsx:108`).

## PR E — Layout desktop : sidebar persistante ≥ 1024 px

**Risque : élevé (layout racine). Avant-dernière, jamais en lot. Garde-fou :
< 1024 px doit rester strictement identique (le natif ne voit aucun changement).**

- `Sidebar.tsx` : `lg:static lg:translate-x-0` ; backdrop et `inert`
  uniquement en mode overlay (< 1024 px) — `inert` doit être `false` en
  permanence en mode persistant.
- `App.tsx` : `<main>` en flex avec la sidebar ; hamburger masqué en `lg:`.
- Recherche conversations + raccourci ⌘K (desktop only).
- Centraliser `SettingsModal` (3 instances aujourd'hui) à cette occasion.
- Ne pas casser : `memo(Sidebar)` + callbacks stabilisés (perf streaming),
  `--viewport-h` (scroll interne du chat).

Vérif aux 3 largeurs : 390 (identique à avant), 768, 1440. APK inchangé.

## PR G — Home allégé : header 3 zones, coût/streak en sidebar

**Risque : moyen (premier écran vu). Flag `arty-home-v2`. Dernière PR.**

- `TopBar.tsx` : 3 zones (☰ / wordmark / ⚙). `CostIndicator`, `StreakBadge`,
  badge Pro, toggle thème et chips style/modèle retirés du header.
- `Sidebar.tsx` (pied) : accueille CostIndicator + StreakBadge + toggle thème.
  Leurs abonnements (`cost-updated`, `arty-streak-updated`) sont internes —
  seul le point de montage change ; vérifier le refresh live (BUG 54/60).
- Modèle/style accessibles via le sheet (cohérent avec B).

---

## Garde-fous transverses (toutes les PRs)

- `npx tsc --noEmit` avant **chaque** push (BUG 13 — une erreur TS bloque le
  déploiement Cloudflare en silence) + `vitest run`.
- `saveConversation()` reste synchrone (BUG 16).
- Aucune PR ne touche `functions/` → RÈGLE 6 non déclenchée ; si un appel
  serveur apparaît, audit sécu obligatoire.
- Tout nouveau libellé passe par `t()` FR/EN (migration i18n de mai = acquis).
- Tout conteneur ancré (sheet, Stop flottant, sidebar) respecte
  `env(safe-area-inset-*)`.
- Flags killswitch en localStorage, testables sans rebuild.
- Le Stop flottant s'ajoute **en plus** du Stop morphant de l'InputBar le
  temps de la transition — on ne remplace pas la CTA morphing d'un coup.
