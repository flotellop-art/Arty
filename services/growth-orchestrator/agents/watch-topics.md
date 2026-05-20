# Liste des sujets surveillés par le watcher `research`

Ce fichier est lu chaque vendredi par l'agent de veille **Recherche docs &
tutos** (`watcher-research.md`). Il y produit une entry par sujet sous le
format défini dans son system prompt.

Édité **par PR Git**, jamais directement dans le memory store Anthropic. L'agent
ne modifie PAS ce fichier — il le lit en read-only depuis le repo monté à
`/workspace/arty/services/growth-orchestrator/agents/watch-topics.md`.

## Sujets actifs

- **prompt caching Anthropic** : nouveautés sur `cache_control`, bonnes pratiques de placement des breakpoints, ratio de cache hit observable, modèles supportés.
- **tool use parallèle Claude** : `disable_parallel_tool_use`, schémas qui marchent bien, patterns pour orchestrer plusieurs tools en 1 turn.
- **memory store best practices** : layout de dossiers, taille max par fichier, performances de lecture, conventions de versioning.
- **Capacitor 8 → 9 migration** : breaking changes, deprecations, plugins impactés (notamment `@codetrix-studio/capacitor-google-auth` actuellement en RC).
- **Cloudflare Workers AI** : nouveaux modèles disponibles, pricing, compatibilité avec les proxys actuels d'Arty (alternative possible aux proxys Pages Functions).
- **Standard Webhooks spec** : évolutions de la spec, librairies utilitaires, breaking changes des implémentations Anthropic/Lemon Squeezy.
- **Cloudflare Workers limits** : CPU time, subrequests, KV consistency, bursts — toute évolution qui touche notre architecture (Worker Paid, 5 min CPU).
- **Discord rate limits & API v10 → v11** : changements de schéma interaction, nouvelles features bot, deprecations.
- **Tally pagination & webhooks** : passer du polling actuel (1ʳᵉ page de 50 submissions) à un webhook push quand disponible.
- **Lemon Squeezy webhook validation** : patterns canoniques pour vérifier la signature HMAC, gestion des retries, structures d'événements.

## Comment ajouter un sujet

1. Ouvrir une PR sur le repo `flotellop-art/Arty`.
2. Ajouter une ligne au format `- **<sujet>** : <focus exact en 1 ligne>`.
3. Merger. Le prochain cycle vendredi le prendra en compte.

## Comment retirer un sujet

Même process : PR qui supprime la ligne. L'agent arrêtera de le couvrir au
cycle suivant. L'historique reste dans le memory store
(`/mnt/memory/arty/watch/research/journal/*`).
