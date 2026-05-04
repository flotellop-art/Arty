---
description: Audit sécurité complet d'Arty (3 agents parallèles + rapport priorisé)
---

# Audit sécurité Arty

Tu es responsable en chef de la sécurité d'Arty (CLAUDE.md règle absolue).
Lance un audit COMPLET de la codebase et produit un rapport priorisé
(CRIT / HIGH / MED / LOW) avec actions concrètes.

## Procédure

### 1. Lis le contexte d'abord
- `/home/user/Arty/CLAUDE.md` — règles 1-7 + tous les BUGs documentés (1 à 47+)
- En particulier la section "TODO Sécurité — prochain audit" qui liste ce
  qui était connu au précédent audit. Vérifie si c'est encore pertinent ou
  déjà traité.

### 2. Spawn 3 Explore agents EN PARALLÈLE (un seul message, 3 tool calls)

**Agent 1 — Backend endpoints** (`functions/api/`)
- Checklist RÈGLE 6 (auth, autz, abuse infra, leak, CSRF) sur CHAQUE endpoint
- IDOR, injection (SQL/NoSQL/command), validation regex sur IDs (BUG 32)
- Pas de clé dans URL (BUG 7), pas de header vide (BUG 18)
- CORS strict (BUG 9, 19), origin obligatoire (BUG 42 CRIT-3)
- Premium cap atomique, license expirée, plan_type validé
- Tokeninfo vs userinfo pour vérification token Google

**Agent 2 — Crypto + auth Google**
- Côté serveur : `functions/api/auth/{token,refresh}.ts`, `_lib/checkAllowedUser.ts`
- Côté client : `crypto.ts`, `scopedStorage.ts`, `googleAuth.ts`,
  `activeApiKey.ts`, `useAuth.ts`, `useGoogleAuth.ts`
- Plugin natif : `android/app/src/main/java/.../GoogleSignInPlugin.java`
- KDF (PBKDF2 itérations), AES-GCM IV unique, vault BYOK, migration plain
- OAuth state/PKCE, scopes minimaux (BUG 15), redirect_uri whitelist
- Switch account ordering (BUG 6), logout complet (BUG 41)
- Self-test crypto avant wipe (BUG 47), refresh non agressif (BUG 47)

**Agent 3 — Frontend + Capacitor**
- XSS markdown (BUG 20), `dangerouslySetInnerHTML`, sanitization
- Boutons d'action `data-action` — parsing safe ?
- Pas de `VITE_*_API_KEY` payante côté client (RÈGLE 1)
- AndroidManifest permissions (BUG 33, 44), exported activities, intent filters
- iOS Info.plist privacy descriptions (BUG 34)
- Service Worker conditionnel (BUG 45), cache strategy
- Source maps off en prod (RÈGLE 4)

Brief chaque agent : "Ne modifie RIEN. Produit un rapport structuré max
1500 mots avec sévérité, fichier:ligne, impact, fix suggéré. Si tu trouves
un meilleur angle d'attaque que ma checklist, dis-le."

### 3. Consolide les findings
- Dédup entre agents
- Vérifie les claims sur le terrain (relire le code, faire un grep) avant
  de présenter — éviter les faux positifs
- Distingue : CRIT actif / HIGH actif / MED / LOW / faux positif / déjà mitigé
- Pour le legacy code (anciens dossiers `api/` Vercel par ex.) : confirmer
  qu'il n'est pas déployé avant de classer en HIGH/CRIT

### 4. Produit le rapport final
Format :
```
# 🔒 Audit sécurité Arty — <date>

## ✅ Ce qui va bien
[liste courte]

## 🔴 CRIT actifs
[avec fix immédiat]

## 🟠 HIGH actifs
[priorité semaine]

## 🟡 MED
[priorité sprint]

## 🟢 LOW
[avant publication Play Store]

## Faux positifs / déjà mitigé
[ce que les agents ont flaggé mais qui est OK]

## Plan d'action
[priorité 1-2-3 avec effort estimé]
```

### 5. Mets à jour CLAUDE.md
- Section "TODO Sécurité — prochain audit" : retire ce qui a été corrigé
  depuis le dernier audit, ajoute les nouveaux HIGH/MED non-fixés cette fois
- Note la date du dernier audit en haut de la section

### 6. Demande au user ce qu'il veut traiter
Présente le plan d'action et demande lesquels faire maintenant vs plus tard.
**Ne code rien sans validation explicite.**

## Périodicité recommandée
- **Avant chaque release Play Store** (obligatoire — RÈGLE 4)
- **Mensuel** (routine de maintenance)
- **Après tout refactor majeur** sur auth, crypto, ou endpoints serveur
- **Après tout incident sécurité** (BUG 42 = exemple historique)

## Contexte historique
- BUG 42 (avril 2026) : 4 CRITs trouvées en audit live → fix urgence PR #11
- Audit 4 mai 2026 : `api/` legacy supprimé (PR #127), state CSRF + logout
  cleanup (PR #128). 88% confiance sur la chaîne auth.
