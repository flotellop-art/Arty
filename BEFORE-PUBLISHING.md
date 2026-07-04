# AVANT DE PUBLIER SUR LE PLAY STORE

Checklist de securite et de conformite a passer imperativement avant de
soumettre un APK/AAB sur le Play Store (ou un IPA sur App Store Connect).
CLAUDE.md a autorite absolue sur cette liste : si une case n'est pas cochee,
**ne PAS publier**.

## 1. Chiffrement AES-256 actif

- [x] `src/services/crypto.ts` implemente AES-256-GCM via Web Crypto API
      (PBKDF2 v2 = 600 000 iterations — OWASP 2023+ ; migration lazy v1
      (100k) → v2 versionnee, sel 16 bytes genere au premier demarrage).
- [x] `initCrypto(apiKey)` appele au boot dans `src/App.tsx` (useEffect) **et**
      dans `src/hooks/useAuth.ts` au login/switch.
- [x] `bootstrapGoogleStorage()` execute apres `initCrypto()` : migre les
      legacy tokens Google plain-JSON vers `google-tokens-enc` chiffre.
- [x] Conversations chiffrees via `secureSetJSON` dans `scopedStorage.ts`
      (sauf cles a lecture synchrone obligatoire — voir BUG 1 de CLAUDE.md).
- [x] Tokens Google : chiffres dans localStorage, cache en memoire apres
      decryption pour conserver la lecture synchrone via `getStoredTokens()`.

## 2. Aucune cle API payante cote client

- [x] Aucun `VITE_ANTHROPIC_API_KEY`, `VITE_GEMINI_API_KEY`,
      `VITE_MISTRAL_API_KEY`, `VITE_OPENAI_API_KEY` dans `.env`
      ou dans le code navigateur.
- [x] Les cles serveur (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
      `MISTRAL_API_KEY`, `OPENAI_API_KEY`, `BFL_API_KEY`) sont uniquement
      dans les variables Cloudflare Pages (sans prefixe `VITE_`).
      Note : `GOOGLE_VISION_API_KEY` est de la config MORTE (BUG 14/15) —
      a retirer du dashboard, pas a configurer.
- [x] `src/services/activeApiKey.ts` ne contient aucun fallback
      `import.meta.env.VITE_*_API_KEY`.

Verifier :
```bash
grep -r "VITE_.*API_KEY" src/
grep -r "import.meta.env.VITE_.*_API_KEY" src/
```
Aucune occurrence ne doit ressortir.

## 3. Whitelist emails `ALLOWED_EMAILS`

- [ ] Variable `ALLOWED_EMAILS` configuree sur Cloudflare Pages
      (liste d'emails separes par des virgules).
- [x] `checkAllowedUser()` appele dans **tous** les proxys IA
      (`functions/api/ai/*.ts`) avant d'utiliser une cle serveur.
- [x] `checkAllowedUser()` verifie le token Google via
      `https://www.googleapis.com/oauth2/v2/userinfo` (pas de confiance
      aveugle sur un header email).
- [x] Utilisateurs hors whitelist → obliges d'utiliser leur propre cle BYOK.

Note (MAJ 3 juillet 2026 — audit F-18) : il n'y a PLUS de « bloc commente a
reactiver ». `checkAllowedUser()` implemente un vrai systeme de plans :
VIP (`ALLOWED_EMAILS`) / subscription / pro (=BYOK, pas de cle serveur) /
trial / free (quota journalier Haiku). La checklist consiste a verifier que
`ALLOWED_EMAILS` est bien configuree sur Cloudflare et que les plans payants
sont actifs, pas a decommenter du code.

## 4. `getValidAccessToken()` partout pour `x-google-token`

- [x] Aucun client AI n'utilise `getStoredTokens()` brut pour le header
      `x-google-token` (voir BUG 23 de CLAUDE.md).
- [x] Tous les clients (`anthropicClient`, `geminiClient`, `mistralClient`,
      `gmailClient`, `driveClient`, `calendarClient`, `contactsClient`)
      passent par `getValidAccessToken()` qui refresh automatiquement.

## 5. Sourcemaps desactives

- [x] `vite.config.ts` → `build.sourcemap = false`.
- [ ] Verifier apres `npm run build` : aucun fichier `.map` dans `dist/`.

```bash
find dist -name "*.map"
# ne doit rien retourner
```

## 6. Sanitisation markdown

- [x] `src/components/shared/MarkdownRenderer.tsx` utilise `rehype-sanitize`.
- [x] Pas de `dangerouslySetInnerHTML` ailleurs.

## 7. CORS/CSRF durci

- [x] `functions/api/_middleware.ts` : origins de production + `capacitor://localhost`
      + `https://localhost` uniquement. Pas de `http://localhost*` en prod.

## 8. Permissions natives

### Android (`android/app/src/main/AndroidManifest.xml`)
- [x] INTERNET, CAMERA, RECORD_AUDIO (BUG 44), READ_MEDIA_IMAGES,
      POST_NOTIFICATIONS presentes (verifie audit 3 juillet 2026).
- [x] READ_EXTERNAL_STORAGE (Android <= 12) / READ_MEDIA_IMAGES (Android 13+).
- [ ] Retirer les permissions SUR-declarees avant publication :
      READ_MEDIA_AUDIO, READ_MEDIA_VIDEO, MODIFY_AUDIO_SETTINGS
      (audit F-28 — exige un test APK reel apres retrait).

### iOS (`ios/App/App/Info.plist`)
- [x] `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
      `NSPhotoLibraryAddUsageDescription`, `NSMicrophoneUsageDescription`,
      `NSLocationWhenInUseUsageDescription` remplis (verifie audit
      3 juillet 2026 — BUG 34 satisfait).

## 9. Tests et TypeScript verts

```bash
npx tsc --noEmit        # 0 erreur
npx vitest run          # 100% passing
npm run build           # pas d'erreur, sourcemaps off
```

Ne JAMAIS publier avec des erreurs TypeScript (BUG 13) : le build echoue
silencieusement sur Cloudflare.

## 10. Compilation APK / AAB

```bash
npm run build
npx cap sync
npx cap open android
```

Dans Android Studio :
- Build > Generate Signed Bundle / APK
- Utiliser la keystore release (JAMAIS la debug keystore sur le Play Store)

## 11. Beta test obligatoire (regle Google 2026)

- 12 testeurs minimum pendant 14 jours consecutifs.
- Creer un "Internal testing" puis un "Closed testing" dans Google Play Console.
- Chaque testeur doit confirmer avoir installe et utilise l'app.

## 12. Publication

- Compte Google Play Developer (25 $ une fois).
- Fiche magasin : icone 512x512, screenshots, description EN + FR.
- Politique de confidentialite hebergee (obligatoire, meme si l'app ne collecte rien).
- Formulaire de declaration de donnees (Data safety) rempli :
  - Donnees collectees : email (Google OAuth), contenu utilisateur.
  - Chiffrement en transit : OUI (HTTPS only).
  - Chiffrement au repos : OUI (AES-256 Web Crypto).
  - Donnees supprimables sur demande : OUI (bouton "deconnexion + effacement").
- Scopes Google verifies par l'OAuth brand verification (obligatoire pour
  `gmail.send`, `drive`, `calendar` au-dela de 100 utilisateurs).

## 13. App Store (iOS)

En plus des points 1-12 :
- [ ] Info.plist avec descriptions privacy completes (cf. BUG 34).
- [ ] Build signe avec un certificat Distribution.
- [ ] Revoir si une feature utilise une API Apple restricted (ex: ATT).
