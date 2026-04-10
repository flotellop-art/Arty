# AVANT DE PUBLIER SUR LE PLAY STORE

## 1. Activer le chiffrement des données
- Le code est prêt dans `src/services/crypto.ts`
- Le formulaire est prêt dans `src/components/settings/ApiKeySetup.tsx`
- Le hook est prêt dans `src/hooks/useApiKeys.ts`
- Il faut : brancher ApiKeySetup dans App.tsx, chiffrer les tokens Google en arrière-plan (même méthode que storage.ts)

## 2. Compiler l'APK
- Installer Android Studio sur le PC
- `npm run build && npx cap sync && npx cap open android`
- Build > Generate Signed APK

## 3. Beta test obligatoire (règle Google 2026)
- 12 testeurs minimum pendant 14 jours
- Créer un test fermé sur Google Play Console

## 4. Publier
- Compte Google Play Developer (25$ une fois)
- Remplir la fiche (screenshots, description)
- Soumettre pour review (3-7 jours)
