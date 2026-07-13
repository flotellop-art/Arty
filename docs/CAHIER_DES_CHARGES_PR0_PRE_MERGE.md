# Cahier des charges — Gate pré-merge de PR-0 (#338)

**Date :** 13 juillet 2026<br>
**Objet :** conditions à remplir avant le merge de la PR #338 (« PR-0 : profil OAuth public — renommages, tombstones 410, scanner sémantique, inspections Android »)<br>
**Particularité :** le merge de cette PR n'est PAS un merge ordinaire — `main` est auto-déployé par Cloudflare Pages, donc **merger = couper les quatre connecteurs Google en production** (tombstones actifs par défaut, décision I2 « coupure immédiate »). Ce document sépare ce qui relève du code (fait/à faire), des validations, et des opérations du jour J.

---

## 1. État à la rédaction (vérifié)

| Élément | État | Preuve |
|---|---|---|
| CI complète sur le premier HEAD (`a219a8b`) | ✅ verte (4/4 : verify-app avec `no-casa:check`, verify-android avec les 2 inspections, growth-orchestrator, Pages) | run 29274468841 |
| Tombstone 410 en conditions réelles | ✅ vérifié live sur le preview de branche : `POST /api/gmail/action` et `/api/drive/action` → `HTTP 410 {"error":"Gone"}` | curl du 13 juillet, Origin `https://tryarty.com` |
| Suite locale | ✅ 1103 tests / 108 fichiers, double typecheck, build, scanner | `npm run verify` |
| Allowlist Android stricte (I4) | ✅ GELÉE — 13 permissions (8 source + 5 injectées par les dépendances), testée nominal + cas adverse | commit « gel de l'allowlist » |
| Variable d'échappement documentée | ✅ `functions/env.d.ts` + `.env.example` | idem |

## 2. Reste à faire — CODE (dans la PR, avant merge)

- [ ] **CI verte sur le HEAD final** (le commit du gel d'allowlist relance verify-android : l'inspection doit repasser avec la liste stricte — c'est le test réel du gel).
- [ ] **Relecture du diff par agent** (RÈGLE 7) : le PLAN a été challengé par deux agents avant codage ; une passe de review du **diff final** (Opus) reste due — bugs, oublis, cohérence avec le CDC Phase 1. Les findings bloquants sont corrigés dans la PR avant merge.
- [ ] Toute correction issue de la relecture → re-CI verte.

## 3. Validations — avant merge

- [ ] **Verdict du décideur sur la PR #338** (comme pour le CDC : relecture + GO écrit). Points d'attention suggérés : le helper `tombstone.ts` (410 avant auth, défaut ON), la variable d'échappement, le gel des 13 permissions, la décision I6 (Sheets gaté), le mapping I4 des « 3 inspections ».
- [ ] **Confirmation du moment du merge** : merger = couper la prod (voir §4). Le GO doit inclure le « quand », pas seulement le « quoi ».

## 4. Opérations JOUR J — coordination de la coupure

Le merge déclenche l'auto-déploiement de `main` → les quatre connecteurs répondent 410 en production. Pour éviter une fenêtre incohérente (client prod qui affiche encore les outils Gmail/Drive → échecs 410 avec message générique), l'ordre recommandé :

1. [ ] **AVANT le merge — flip client web** : poser `VITE_GMAIL_NO_CASA_PHASE0=true` dans l'environnement **Production** de Cloudflare Pages. Ainsi le build déclenché par le merge part directement avec le client public (outils Gmail/Drive/Contacts/Sheets retirés de l'UI, hand-off Gmail actif) — client et serveur basculent dans le MÊME déploiement.
2. [ ] **Merger la PR #338** (squash, comme #336/#337).
3. [ ] **Vérifier en prod** (~5 min après) : `tryarty.com` → le client ne montre plus les outils des connecteurs ; `POST /api/gmail/action` → 410 ; Calendar fonctionne toujours (il n'est PAS tombstoné) ; géoloc/caméra/micro intacts (leçon F-2 : tester feature par feature après tout changement de config).
4. [ ] **Android** : lancer un build avec `ARTY_GMAIL_NO_CASA_PHASE0=true` et le distribuer (Firebase App Distribution). D'ici là, l'APK existant affichera des outils qui échouent en 410 — fenêtre assumée, à garder courte.
5. [ ] **Prévenir la bêta** (Mégane & co) : Gmail, Drive, Contacts et Sheets disparaissent d'Arty à partir du jour J ; Drive revient au fil des PRs B0→B3 (fichiers connectés via le Picker) ; Calendar reste. Message court à envoyer AVANT la coupure.
6. [ ] **Rollback documenté et compris** : poser `LEGACY_GOOGLE_CONNECTORS_ENABLED=true` (env Production) **puis « Retry deployment »** (~2 min, sans revert de code). ⚠️ Sur Cloudflare Pages, une variable ne s'applique qu'au déploiement suivant — le « Retry » fait partie du geste. Optionnel mais recommandé : **répéter le rollback une fois sur l'environnement Preview** avant le jour J (poser la var en Preview + retry + vérifier que les connecteurs répondent à nouveau normalement, puis la retirer).

## 5. Critères de merge (synthèse — tous cochés = GO merge)

1. [ ] CI verte sur le HEAD final de la PR.
2. [ ] Relecture agent du diff faite, findings bloquants corrigés.
3. [ ] Verdict GO du décideur sur la PR, incluant le moment de la coupure.
4. [ ] `VITE_GMAIL_NO_CASA_PHASE0=true` posé en Production (flip simultané) — ou décision explicite d'assumer la fenêtre incohérente.
5. [ ] Bêta prévenue.
6. [ ] Rollback compris (var + Retry deployment) — idéalement répété une fois en Preview.

## 6. Hors périmètre de ce gate (rappels)

- **PR-A1** (compilateur discriminé, triggers, system prompt, hygiène blocklist complète) démarre APRÈS le merge de PR-0 — ordre D29 : PR-0 → A1 → A2 → B0 → …
- Le **renommage des variables externes** (`VITE_GMAIL_NO_CASA_PHASE0` → nom définitif) reste une étape ops séparée (I7), PAS un prérequis de merge.
- L'inspection **AAB** vit dans le workflow release manuel — elle ne conditionne pas ce merge (I4).
- Aucun nouveau scope, aucun changement Gmail/Drive fonctionnel dans cette PR — c'est de la fondation.
