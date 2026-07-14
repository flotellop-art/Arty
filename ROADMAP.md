# Roadmap Arty — idées post-lancement

Idées validées techniquement mais **hors scope v1**. Consignées ici pour ne pas
les perdre ; à reprendre **après** la publication Play Store. Ne PAS implémenter
avant le lancement (ça compromettrait la v1).

---

## Décision de lancement Android — 14 juillet 2026

- Le client public web et Android est lancé sans Gmail, Drive, Contacts ni
  Sheets. Il conserve uniquement le profil Google minimal et
  `calendar.events` avec re-consentement explicite.
- Drive revient après le lancement avec le scope borné `drive.file` et le
  Google Picker, sans rouvrir l'accès complet au Drive.
- Une éventuelle bêta Gmail/Drive utilisera un client OAuth séparé et ne
  retardera pas la bêta Play publique.
- Coût stratégique accepté : la bêta Play ne valide pas le différenciateur
  Gmail/Drive auprès des moins de 100 testeurs. Cette hypothèse devra être
  testée séparément, puis re-décidée à partir des retours et du coût réel de
  vérification/CASA — elle ne doit pas revenir par inertie dans le client public.

---

## v2 — "Arty-Flex" : agrégateur IA souverain (flexibilité Mammouth + sécurité Arty)

### Vision

Combiner la flexibilité d'un agrégateur (large choix de modèles, comparaison,
génération d'images, agents persos) avec la sécurité d'Arty (BYOK, chiffrement
local, proxy serveur). Le client (PWA/Capacitor) porte l'intelligence ; le
serveur reste un relais.

### Déjà en place (à réutiliser, NE PAS reconstruire)

- **BYOK multi-fournisseurs** : `anthropicClient`, `geminiClient`, `mistralClient`,
  `openaiClient` acceptent déjà une clé perso (headers `x-api-key` / `x-openai-key`).
  Ces clés sont actuellement stockées localement sans chiffrement applicatif.
- **Chiffrement local** : `crypto.ts` (AES-256 Web Crypto) + `scopedStorage.ts`
  protègent notamment conversations et jetons Google, avec la limite documentée
  de la clé publique `server-provided` pour les comptes sans BYOK.
- **Proxys relais** : `functions/api/ai/*` relaient sans stocker le contenu.
- **Sélecteur de modèle + routage auto** : `aiRouter.ts`, `modelSelector.ts`.

→ ~60 % de la vision existe déjà.

### Travail neuf (v2)

1. **Override de routage manuel** (le plus petit, presque déjà là) : forcer un
   modèle à la volée depuis `InputBar`/`ChatTopBar`. Candidat possible même tôt.
2. **Comparateur côte à côte** : split-screen, même prompt envoyé à 2 modèles en
   parallèle. Gère 2 flux + coût ×2.
3. **Génération d'images** : nouveau proxy + UI. **FLUX / Stable Diffusion via
   Replicate ou fal** — PAS Midjourney (aucune API publique).
4. **Agents personnalisés** : builder + prompts système stockés en local chiffré.

### Garde-fous de sécurité (corrections des erreurs de la proposition initiale)

Ces points sont des **contraintes dures**, pas des options :

- **Ne PAS dire "Zero-Knowledge".** Le proxy Cloudflare voit la requête en clair
  (il relaie, ce n'est pas du chiffrement de bout en bout). Formulation honnête :
  **"pas de stockage serveur du contenu"**. Sur-vendre = risque juridique.
- **Tous les appels fournisseurs passent par le proxy Cloudflare.** Le navigateur
  ne peut PAS appeler l'API Anthropic en direct (CORS bloqué — CLAUDE.md BUG 30).
  Donc l'argument "si Arty est down, le client appelle en direct" est faux : on
  proxy toujours. Idem Replicate/fal (CORS + exposition de clé) → proxy obligatoire.
- **Le proxy image suit la RÈGLE 3** : clé serveur sans préfixe `VITE_`,
  `checkAllowedUser()`, jamais de clé payante côté client. BYOK accepté via header.
- **Ne jamais présenter les clés BYOK comme chiffrées aujourd'hui.** Avant d'en
  faire une promesse produit, implémenter un stockage natif protégé par le
  système (Keystore/Keychain) et un équivalent web dont le modèle de menace est
  documenté, puis migrer les clés existantes sans perte.

### Note économique (argument produit valable)

Pay-as-you-go en BYOK direct chez les fournisseurs = souvent 5-10× moins cher
qu'un abonnement agrégateur fixe pour un usage normal. Argument de positionnement
légitime.

### Pré-requis avant d'attaquer

La v1 doit être publiée. Et certaines features (lecture Gmail, Drive) dépendent
de la décision scopes/CASA (voir `PLAY-STORE-SUBMISSION.md`).
