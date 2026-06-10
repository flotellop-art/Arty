# Audit frontend Arty — 10 juin 2026

Référence UX : application Claude (Anthropic). Méthode : 3 agents Fable 5 en
parallèle (UX, code, design/a11y/i18n) + contre-vérification croisée des
findings + vérification manuelle des claims critiques (file:line confirmés).

## Verdict global

L'infrastructure est bonne (tokens de thème propres, RAF throttle du streaming,
lazy loading, safe-areas, i18n outillé) mais elle n'est **pas appliquée
systématiquement** : chaque modale, chaîne et action est ré-implémentée à la
main, et la couche storage partage des objets mutables avec React. Il en
résulte 3 familles de problèmes : des **bugs cassés net**, des **frictions
quotidiennes vs l'app Claude**, et des **dettes structurelles** qui rendent le
reste fragile.

---

## A. Cassé net (HIGH — bugs avérés, vérifiés)

1. **Erreurs de login invisibles** — `LoginScreen.tsx:188` : `loginError`
   n'est rendu que dans la branche `pendingAuth`. Sur l'écran principal
   (lignes 199+), un échec OAuth/clé API est silencieusement perdu (l'erreur
   stashée en sessionStorage est drainée au mount… pour ne jamais être
   affichée). Le commentaire « BUG 22 corrigé » est faux pour ce chemin.
2. **Partage cassé de bout en bout** — `conversationExport.ts:25-31` :
   `buildShareUrl` retourne `data:application/json;base64,…` — incollable
   dans WhatsApp/mail, bloqué en navigation top-level par les navigateurs.
   `ChatTopBar.tsx:190-194` copie ce « lien » sans aucun feedback et avale
   les erreurs. L'utilisateur croit avoir partagé.
3. **Promesse EU violée par le Résumé** — `ConversationSummaryModal.tsx:91`
   appelle toujours `streamMessage` (Claude/Anthropic US) sans vérifier
   `conversation.euOnly`. La promesse « Tes données ne quitteront pas
   l'Europe » (useConversation.ts:84) est violée. + appel LLM payant relancé
   à chaque ouverture de la modale, sans cache.
4. **Suppression de conversation : sans confirmation sur desktop, impossible
   sur mobile** — `Sidebar.tsx:469-482` : `onDelete` direct, pas de
   confirmation ni undo ; le bouton est en `opacity-0 group-hover` → jamais
   visible au tactile ni au clavier.
5. **Épingle (pin) sans effet immédiat** — `useConversation.ts:544-556` mute
   `msg.pinned` en place ; `storage.getConversations()` retourne la même
   référence de tableau (storage.ts:46-65) → React bail-out + `MessageItem`
   memo → l'UI ne se met à jour qu'au remount. Cause racine : la couche
   storage et React partagent les mêmes objets mutables (voir D1).
6. **Contenu streamé rendu en double** — `useStreaming.ts:56-74` pousse
   toutes les 3 s un message `{id:'streaming'}` dans `conv.messages` ;
   `MessageList.tsx:169-191` rend tous les messages sans filtrer cet id PUIS
   la bulle live → partiel figé + bulle live simultanés.
7. **Race Stop ↔ fact-check = réponse dupliquée** — `useConversation.ts:264-331` :
   pendant l'`await factCheckContent`, le stream reste actif ; un clic Stop
   déclenche `finalize` une 1re fois, le fact-check une 2e → doublon persisté.
8. **Messages perdus dans la fenêtre de boot** — `storage.ts:99-115` :
   tant que l'historique chiffré n'est pas déchiffré, `saveConversation` est
   un no-op silencieux → un message tapé dans la 1re seconde après lancement
   disparaît sans feedback (BUG 43 géré en lecture, pas en écriture).
9. **Voice wave figée** — `InputBar.tsx:1267` utilise `animation: wave …` en
   inline, mais `wave` n'a pas d'entrée dans le bloc `animation:` de
   `tailwind.config.ts:83-92` → Tailwind n'émet jamais le `@keyframes wave`
   (vérifié) → les 9 barres micro ne bougent jamais.
10. **`BrowserBanner` sans style** — `BrowserBanner.tsx:12-21` consomme des
    variables `--arty-*` introuvables dans tout le repo (seuls les tokens
    `--theme-*` existent) → banner sans fond, spinner invisible. Idem
    `shared/editorial.tsx`.
11. **Design system « rapports » illisible en Nocturne** — `index.css:195+` :
    `.card`, `.card-cream`, `.timeline-item`, `.progress-bar`… sont
    light-only (fond blanc en dur) alors que `MarkdownRenderer.tsx:156`
    applique `report-content` à toutes les bulles → texte crème sur carte
    blanche dès que l'IA émet une `.card` en thème sombre.

## B. Frictions quotidiennes vs app Claude (HIGH/MED)

- **Pas de bouton Copier** — ni sur les messages assistant
  (`AssistantBubble.tsx:105-145` : TTS + pin seulement), ni sur les blocs de
  code (`MarkdownRenderer.tsx:124-138`). L'action la plus fréquente d'un chat
  IA est absente.
- **Pas de coloration syntaxique** — aucun prism/highlight.js/shiki dans
  `package.json` (`PrismMark.tsx` est le logo). Code monochrome sur fond noir.
- **Listes numérotées cassées** — `MarkdownRenderer.tsx:85-93` : `ol` en
  `list-none`, toutes les puces rendues `●` → « étape 1, 2, 3 » perd sa
  numérotation. (`counter-reset-[item]` est une classe morte.)
- **Titres de conversations** — `useConversation.ts:230-231` : troncature
  brute à 50 chars, une seule fois ; aucun renommage manuel. Pire : la
  1re conversation et les convs EU démarrent avec un message assistant →
  la condition `length === 1` n'est jamais vraie → titre « Nouvelle
  conversation » pour toujours.
- **Erreur API sans retry** — `ConversationScreen.tsx:107-111` : bandeau
  rouge persistant, sans fermeture ni bouton Réessayer ; le retry n'existe
  que si `interrupted: true`. Pas de régénération de réponse.
- **Textarea verrouillée pendant le streaming** — `InputBar.tsx:1046`
  `disabled={isStreaming}` : impossible de composer le message suivant
  (l'app Claude le permet) ; le clavier mobile se referme à chaque envoi.
- **Boutons edit/pin invisibles sur mobile** — `UserBubble.tsx:171-194` en
  `opacity-0 group-hover` alors que le pattern corrigé
  `opacity-50 md:opacity-0` existe déjà dans la codebase
  (MessageList.tsx:58, AssistantBubble.tsx:112) mais n'a pas été propagé.
- **Fichiers > 10 MB silencieusement ignorés** — `InputBar.tsx:327`
  (`continue` sans message) ; pas de drag & drop ni de paste de fichiers
  (0 occurrence de `onDrop`/`onPaste` dans src/) ; pas de limite de nombre.
- **Pas de système de toast** — cause structurelle de la moitié des
  problèmes de feedback : `alert()` natif (Sidebar.tsx:183,
  MemoryViewer.tsx:55), share sans confirmation, erreurs avalées.
  Contre-exemple interne qui prouve la faisabilité :
  `ConversationSummaryModal.tsx:125-133` (« ✓ Copié » 1,5 s).
- **Thinking jamais affiché** — `anthropicClient.ts:299-304` : parsé,
  préservé pour l'API, jamais rendu (l'app Claude l'affiche replié).
  Tool calls en banner au-dessus du fil, pas inline.
- **Pas de conversations récentes sur la Home** — tout passe par le burger
  (l'app Claude liste les chats récents sous l'input).
- **QuestionModal : fermer = valider du partiel** — `QuestionModal.tsx:27-33,
  70-76` : Escape/✕ appellent `onComplete(answers)` au lieu d'annuler.
- **ProfileSetupModal : tap backdrop = skip définitif**
  (`ProfileSetupModal.tsx:54-56`).

NOTE auto-scroll : l'ancrage du message user en haut sans suivi forcé du
stream (`MessageList.tsx:84-91, 136-158`) est un choix délibéré conforme à
l'app Claude — **pas un défaut** (le 1er rapport le classait à tort en MED).

## C. Accessibilité / design / i18n

- **Aucun focus trap dans tout le repo** ; ~12 modales artisanales dont la
  moitié sans `role="dialog"`/`aria-modal` (SettingsModal.tsx:245,
  MemoryViewer.tsx:79, TaskPanel.tsx:32, MorningBrief.tsx:193…). Escape
  incohérent et bugué en empilement (ferme le parent sous MemoryViewer).
- **Navigation clavier impossible sur la liste des conversations** —
  `Sidebar.tsx:415-425` : `<div onClick>` non focusable, sans role.
- **Pas d'`aria-live`** sur le streaming ni les erreurs (1 seul
  `role="alert"` dans le repo). Zoom bloqué (`user-scalable=no`,
  index.html:5 — WCAG 1.4.4). Cibles < 44 px (chips 24 px, icônes 30 px).
  Aucun `focus-visible` ring sur les boutons.
- **Couleurs hors tokens** : QuestionModal (oranges Tailwind),
  OrchestratorSync (`bg-slate-800` figé), bouton Whisper
  (`bg-red-100`, InputBar.tsx:1088), scrollbar non thématisée
  (index.css:188), hover Sidebar hardcodé (Sidebar.tsx:423).
- **i18n « FAITE » dans CLAUDE.md mais ~15 composants entiers en FR
  hardcodé** : SettingsGuide, FactCheckBadge, MemoryViewer(+History),
  ApiKeySetup/ApiKeysModal, CalendarView, EmailCard (dates relatives),
  DriveFileCard, GoogleStatus, OAuthCallback, templates.tsx + data/templates,
  ErrorBoundary, PlanBadge, getModelExplanation (ChatTopBar.tsx:47-68),
  bannière budget (App.tsx:336-345), AssistantBubble (« ⏳ En cours... »).
  + aria-labels FR dans des composants traduits. UI mi-FR/mi-EN pour un
  utilisateur anglophone.
- **Mobile** : pas de `-webkit-tap-highlight-color` ni `overscroll-behavior`
  (flash gris à chaque tap, pull-to-refresh accidentel) ; inputs 12-14 px ;
  hauteurs de modales en `vh` brut hors SettingsModal (contenu sous clavier).

## D. Dettes structurelles du code (causes racines)

1. **Storage mutable partagé avec React** — `storage.ts:46-65, 99-115` :
   `getConversations()` retourne la référence du cache, `saveConversation`
   mute en place → toute la classe « l'UI s'affiche par accident » (pin
   cassé, rappels invisibles, fragilité au refactor). Fix : copies
   immuables ou versionnage.
2. **Identités instables** — `useStreaming.ts:318-346` (et useGmail/useDrive)
   retournent un objet neuf à chaque render → tous les `useCallback` de
   `useConversation` (deps `streaming`) sont recréés → les `memo` de
   `MessageItem`/Sidebar sont court-circuités → toutes les bulles re-rendent
   à ~60 fps pendant le streaming. Le commentaire CRIT-7/CRIT-8 croit le
   problème réglé ; il ne l'est qu'à moitié (seul le memo de
   MarkdownRenderer tient).
3. **`sendMessage` sans try/catch global** — `useConversation.ts:125-499` :
   tout throw après `startStream` (ex. `atob` non catché,
   useFileAttachments.ts:56) laisse un stream fantôme → textarea bloquée
   sur Stop définitivement.
4. **Deep link OAuth** — `App.tsx:688-702` : listener `appUrlOpen` sans
   cleanup ; effet `[deepLinkCode, auth]` avec `auth` instable →
   double `exchangeCode` d'un code déjà consommé.
5. **ErrorBoundary unique autour de MessageList** — un crash dans Sidebar,
   InputBar (1 422 lignes) ou un screen lazy = écran blanc total.
6. **Divers MED** : `usePlanStatus` dupliqué (2 fetches par event + refetch
   à chaque switch de conv via `key=`), comparateur sans throttle et
   O(n²) (`useMultiProviderChat.ts:126-142`), lectures one-shot au mount
   jamais resynchronisées (InputBar.tsx:788-805), bus d'events `window`
   comme RPC inter-hooks (~10 canaux non typés), conv supprimée pendant un
   envoi ressuscitée par `unshift`, code mort (useLocalStorage,
   usePWAInstall), pas de virtualisation de MessageList.

Ce qui est BIEN (ne pas « réparer ») : bundle (lazy, manualChunks, pas de
lib de highlight inutile), RAF throttle du streaming, cleanups d'effets
globalement rigoureux, `useProactiveBrief` exemplaire, `prefers-reduced-motion`
géré, safe-areas/`--viewport-h` bien pensés, discipline tokens très bonne
hors exceptions listées.

---

## Top 10 priorisé (croisement des 3 rapports)

1. Erreurs de login invisibles (LoginScreen) — bloque l'entrée du produit.
2. Storage immuable côté React — corrige pin, rappels, et toute la classe
   « render par accident » ; prérequis de fiabilité.
3. Suppression : confirmation + visible sur mobile (Sidebar).
4. Promesse EU violée par le Résumé (ConversationSummaryModal).
5. Partage : remplacer le `data:` URI (export fichier via Web Share API ?)
   + feedback.
6. Système de toast + retry inline sur erreur API + filtre `id==='streaming'`
   + verrou double-finalize.
7. Copier (messages + blocs de code) + coloration syntaxique + fix listes
   numérotées (MarkdownRenderer).
8. Primitive `<Modal>` partagée (portal, focus trap, Escape empilable,
   `role="dialog"`, hauteur `min(90vh, var(--viewport-h))`) et migration
   des ~12 modales.
9. Stabiliser les identités des hooks (mémoïser les retours) pour restaurer
   les memo pendant le streaming.
10. Finir réellement l'i18n (15 fichiers + aria-labels) avec une règle ESLint
    `no-literal-string` ; fixes 10 min au passage : keyframe `wave`,
    variables `--arty-*`, thématiser `.card` en Nocturne.
