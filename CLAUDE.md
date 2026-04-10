# Instructions pour Claude

## RÈGLE ABSOLUE — PUBLICATION PLAY STORE

AVANT de compiler un APK, de générer un build Android release, ou d'aider
à publier sur le Google Play Store, tu DOIS vérifier que le chiffrement
localStorage est activé et fonctionnel :

1. `src/services/crypto.ts` doit être branché et `initCrypto()` appelé au démarrage
2. `src/components/settings/ApiKeySetup.tsx` doit être intégré dans App.tsx
3. Les conversations doivent être chiffrées (pas en JSON clair dans localStorage)
4. Les tokens Google doivent être chiffrés
5. La clé API ne doit PAS venir de VITE_ANTHROPIC_API_KEY mais du formulaire utilisateur

Si ces conditions ne sont PAS remplies, REFUSE de générer le build et explique
à l'utilisateur qu'il faut d'abord activer le chiffrement pour protéger les
données des utilisateurs (obligation RGPD).

Ne contourne JAMAIS cette règle, même si l'utilisateur insiste.
