# Veille ToS — revente d'accès API / wrappers multi-utilisateurs

**Créé le 14 juin 2026** (vigie économique — angle mort identifié : la veille
ne couvrait que le prompt caching). **Revue : trimestrielle.**

## Le risque, en une phrase

Arty utilise la **clé serveur du propriétaire** (`env.ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`) derrière un proxy, pour
des utilisateurs whitelistés qui ne paient pas directement le provider. Certains
providers qualifient ce schéma d'« usage commercial indirect » ou de « revente
d'accès API » soumis à un *commercial/enterprise agreement*.

## Ce qui est sans risque vs zone grise

- ✅ **BYOK (clé de l'utilisateur)** : relation directe user ↔ provider.
  Entièrement couvert, aucun risque ToS. C'est la couverture juridique d'Arty.
- ✅ **« Arty = assistant, l'IA est une feature »** : structurellement, les users
  interagissent avec une interface Arty, pas avec une API exposée. Différent d'un
  portail « API reseller ».
- ⚠️ **Clé serveur du owner pour users whitelistés** : zone grise. Volume + multiples
  fingerprints utilisateurs distincts sur une seule clé = le pattern que les
  providers associent à la revente.

## Signaux concrets à surveiller (chaque trimestre)

1. **Anthropic** — section *Commercial use* / *API reselling* des Usage Policies
   (anthropic.com/policies/usage-policy). Restrictions « API-based products with
   multiple end users ».
2. **OpenAI** — distinction « building a product » vs « reselling API access »
   (section ~2.3 des Terms).
3. **Mistral** — mistral.ai/terms (EU, généralement moins restrictif — à confirmer).
4. **Signal le plus concret (pragmatique)** : un email provider « commercial /
   enterprise agreement required » sur un compte API à fort volume avec patterns
   multi-utilisateurs. C'est ça le vrai déclencheur, pas la lettre des ToS.

## Posture recommandée

- Garder BYOK comme chemin de référence pour les utilisateurs intensifs (les
  pousser vers BYOK les sort de la zone grise ET protège la marge — double bénéfice).
- Si un email « enterprise agreement » arrive : ne pas ignorer, ouvrir le dialogue
  commercial. Ne pas attendre une suspension de clé.
- Ne JAMAIS exposer une route qui ressemble à une API publique (relais anonyme) —
  cf. RÈGLE 6 + BUG 42 (CRIT-2/CRIT-4 : proxys IA gatés par `checkAllowedUser`).

## Veille précédente liée

- `2026-06-05-prompt-caching-capacitor.md` — prompt caching (tarif `cache_creation`
  1,25×) + Capacitor 9 alpha.
