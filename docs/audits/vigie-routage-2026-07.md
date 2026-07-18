# Vigie C2 — routage multi-provider post-PR #334 (18 juillet 2026)

**Référence** : CDC `veille-modeles-2026-07-cdc.md` (C2 volet 1 — le prérequis
« vigie coût/qualité » de la décision D1/P1.9, jamais fait avant).
**Méthode** : requêtes directes sur la D1 de prod `arty-db` (jurisdiction EU)
via l'API Cloudflare, table `quota_model` (source de vérité coûts, BUG 60).
Fenêtre principale : depuis le 12/07 (merge de la PR #334). Recoupement :
historique complet depuis avril.

---

## ⚠️ Limite structurelle : échantillon pré-lancement

**2 utilisateurs distincts, 13 appels, ~1,37 $ de coût** sur la fenêtre
post-#334 ; **2 abonnements `active`** en base. Comme la vigie éco du 14 juin
(« n=2, pré-lancement »), AUCUNE conclusion statistique n'est valide — cette
vigie établit les FAITS QUALITATIFS (le routage fonctionne-t-il ? quel modèle
sert réellement ?) et le protocole à rejouer à >40 utilisateurs actifs/30 j.

## (a) Répartition post-#334 (12/07 → 18/07)

| Modèle | Appels | Tokens in/out | Coût |
|---|---|---|---|
| claude-sonnet-5 | 3 | 142 834 / 11 215 | $1.2621 |
| claude-haiku-4-5 | 4 | 54 738 / 5 021 | $0.0890 |
| gemini-2.5-flash (pré-C1) | 3 | 39 825 / 810 | $0.0140 |
| mistral-small-2603 | 3 | 25 348 / 26 | $0.0038 |

**Verdict qualitatif : le routage multi-provider sur clé serveur FONCTIONNE
en prod** — Gemini et Mistral reçoivent bien du trafic Auto (le « plus jamais
100 % Claude » de la PR #334 est observé en vrai, pas seulement en test).
Le gros du coût vient d'un appel Sonnet à très gros contexte (~143K tokens
in — cohérent avec le pattern cold-cache/contexte lourd déjà vu en vigie éco).

## (b) Marge par abonné

Sans objet statistiquement (2 abonnés, usage de test). Ordre de grandeur brut :
~1,37 $ de coût API sur 6 jours TOUS usages confondus vs 2 × 9,99 €/mois de
revenu — aucun signal d'alerte, aucune conclusion. À rejouer avec volume.

## (c) Split gpt-5.5 vs gpt-5 — VÉRIF D-A : ✅ CONFIRMÉE, C3 EST GO

Historique complet : `gpt-5` = **10 appels, TOUS le 24/04/2026** (une seule
journée — session de test au lancement du provider, avant éligibilité 5.5) ;
`gpt-5.5` = 5 appels étalés du 25/04 au 04/07 = **le modèle réellement servi
depuis**. `gpt-5-mini` = 7 appels le 24/04 uniquement (même session de test).

**Conclusion D-A** : le chemin dominant est bien `gpt-5.5` ($5/$30) — le
fallback `gpt-5` est un événement d'un jour, pas un chemin vivant. Le swap
vers `gpt-5.6-terra` ($2.5/$15) **divise le coût par 2** comme établi en
review. Condition de Florent (« GO après vérif D1 ») remplie → **C3 part**.

## (d) Part Gemini + estimation grounding (angle mort C11)

Post-#334 : Gemini = 3 appels / 13 (~23 % des appels Auto), $0.0140 de
tokens. **Borne haute grounding : 3 × $14/1000 = $0.042 — soit 3× le coût
tokens.** Démonstration par les chiffres réels de l'angle mort C11 : le poste
potentiellement dominant du chemin Gemini est INVISIBLE en D1. (En pratique
sur cette fenêtre : quota gratuit 5000 prompts/mois famille 3.x → coût réel
probablement 0 — mais la télémétrie ne peut pas le PROUVER.) Toute décision
de downgrade éco (3.1-flash-lite) attendra C11.

## (e) Contrôle BUG 12 (données privées → Claude)

**Non vérifiable depuis D1** : `quota_model` ne stocke aucun contenu de
requête (par design — privacy). Les 3 appels Gemini post-#334 ne peuvent pas
être audités a posteriori sur ce critère. Contrôles existants : le garde
`PRIVATE_DATA_TRIGGERS → claude` est testé unitairement
(`availability.test.ts`, `resolveRoute`) et n'a pas bougé depuis #334.
Vérification terrain possible : test manuel (« résume mes mails » en Auto →
badge modèle doit afficher Claude). À inclure dans le protocole de re-vigie.

## Faits annexes relevés dans les données

- `whisper-1` : 25 appels historiques — TOUTE la transcription est tracée
  sous ce nom (le finding C4 est visible dans les données réelles).
- `tts-1` : **zéro ligne historique** — l'angle mort C9 (corrigé PR #357)
  confirmé : le TTS n'a jamais rien tracé avant le 18/07.
- `gemini-3-flash-preview` : 1 appel le 23/04 — explique l'alias de coût
  historique conservé en C6.
- `claude-sonnet-4-6` : $22.70 / 60 appels (avril→5 juillet) = l'essentiel
  du coût all-time (~$27.7) — antérieur à la migration Sonnet 5.

## Décisions éclairées par cette vigie

| Décision | Verdict |
|---|---|
| **D-A (bucket GPT-5 / C3)** | ✅ Vérif faite : dominant = gpt-5.5 → Terra −50 %, cap 100 inchangé, **C3 GO** |
| **D-C (trial multi-provider)** | Échantillon insuffisant pour chiffrer un coût d'essai → **statu quo maintenu**, re-décider à la re-vigie (>40 users actifs/30 j, seuil vigie éco) |
| **Downgrade éco Gemini (3.1-flash-lite)** | Bloqué sur C11 (traçage grounding) + test live google_search — pas de données pour trancher aujourd'hui |

**Protocole de re-vigie** (à rejouer à >40 users actifs/30 j) : les 5 requêtes
de ce rapport + le test manuel BUG 12 + (post-C11) le coût grounding réel.
Classer par `cost_usd_micro`, jamais par `count` (piège VIP documenté).

*Vigie exécutée le 18 juillet 2026 (session CDC veille modèles). D1 interrogée
en lecture seule.*
