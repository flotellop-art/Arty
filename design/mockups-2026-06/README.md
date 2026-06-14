# Maquettes de refonte ergonomique — juin 2026

Maquettes HTML statiques (aucune dépendance build — ouvrir dans un navigateur,
les polices sont vendorées dans `fonts/`). Les PNG sont les rendus de référence
(desktop 1440×900, mobile 390×844).

Issues d'un double audit (cartographie UI + audit ergonomique) du front actuel.
L'identité visuelle Ember/Nocturne est conservée à l'identique : Fraunces italique,
double filet, guillemets français sur les bulles utilisateur, prisme, kickers mono.

## Problèmes adressés (constatés dans le code actuel)

| Problème | Où dans le code actuel | Réponse maquette |
|---|---|---|
| ChatTopBar de 3-4 rangées (~130-160px) avant le 1er message | `ChatTopBar.tsx` | Header **1 ligne** : ← + titre + pilule modèle + « ⋯ » (maquettes 1-2) |
| TopBar et ChatTopBar dupliquent style/modèle et se désynchronisent (`TopBar.tsx:22` fige `getSelectedModel()`) | `TopBar.tsx`, `ChatTopBar.tsx` | **Un seul** sélecteur, dans le bottom sheet « ⋯ » (maquette 3) — source de vérité unique |
| Changer de conversation depuis le chat = 3 taps (back → home → sidebar) | `ConversationScreen.tsx` | Titre de conversation **tappable** (▾) → switcher direct ; desktop : sidebar persistante (maquette 1) |
| Pas de layout desktop — drawer overlay qui ferme tout le contexte | `Sidebar.tsx` (`w-80`, overlay) | **Sidebar persistante** desktop avec recherche ⌘K, sections Aujourd'hui/Hier (maquette 1) |
| Coûts / Comparateur / Templates cachés derrière Settings + CustomEvents | `App.tsx:300-317` | Entrées de **navigation directe** en bas de sidebar (maquette 1) |
| CostIndicator + streak + Pro + thème + settings = 5 éléments dans le header accueil | `TopBar.tsx:93-107` | Header accueil **3 zones** (☰ / wordmark / ⚙) ; coût et streak déplacés dans le pied de sidebar (maquettes 1, 4) |
| InputBar : 11 états empilables sans hiérarchie | `InputBar.tsx:852-1177` | **Slot contextuel unique** au-dessus de l'input (priorité erreur > enregistrement > calendrier > chips) ; chips en **scroll horizontal** sans wrap (maquettes 1-2) |
| Hold 600ms = Whisper non découvrable + 2 boutons micro | `InputBar.tsx:62-64` | Un seul micro, anneau pointillé + hint « tap = dictée · maintenir = Whisper » (maquette 2) |
| Stop visible uniquement dans l'InputBar (perdu au scroll) | `InputBar.tsx:1140` | Bouton **Stop flottant** ancré au fil de messages (maquette 2) |
| Cibles tactiles ~32px sur les actions de bulle | `AssistantBubble.tsx:117-180` | Actions **44px** en rangée visible sous le message (maquette 2) |
| Fact-check : « indisponible » indistinguable de « vérifié » | `FactCheckBadge.tsx:46` | 4 états visuellement distincts : ◌ pending gris / ✓ vert / ⚠ ambre / ✕ pointillé neutre (maquettes 1-2) |
| « Dernier appel : X » en 10px dans le header | `ChatTopBar.tsx:363-386` | Tag modèle + coût + « pourquoi ? » **sous chaque bulle IA** (maquette 1) et rappel dans le sheet (maquette 3) |
| Modale EU/US bloquante à chaque changement de modèle | `ChatTopBar.tsx:477-508` | Note EU **inline non bloquante** dans le sélecteur, descriptions par modèle (maquette 3) |
| Muted Ember #8F6B4D < 4.5:1 en petit corps | `index.css:19` | Maquettes Ember en muted **#7A5A3C** (~4.6:1) |

## Fichiers

1. `01-desktop-chat-ember.html` — chat desktop, sidebar persistante + header unifié + méta par message.
2. `02-mobile-chat-ember.html` — chat mobile, header 1 ligne, Stop flottant, actions 44px, chips scrollables.
3. `03-mobile-sheet-nocturne.html` — bottom sheet « ⋯ » : modèle (unique) + style + actions de conversation.
4. `04-mobile-home-nocturne.html` — accueil allégé : header 3 zones, brief, agenda, intentions, « Reprendre ».
5. `04b-mobile-home-ember.html` — le même accueil en Ember (jour), pour valider la déclinaison des deux thèmes.

Ces maquettes sont des **propositions de design**, pas du code applicatif :
rien dans `src/` n'est modifié.
