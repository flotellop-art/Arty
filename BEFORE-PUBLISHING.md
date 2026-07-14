# AVANT DE PUBLIER SUR LE PLAY STORE

Checklist de securite et de conformite a passer imperativement avant de
soumettre un APK/AAB sur le Play Store (ou un IPA sur App Store Connect).
CLAUDE.md a autorite absolue sur cette liste : si une case n'est pas cochee,
**ne PAS publier**.

## 1. Stockage local et limites du chiffrement applicatif

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
- [x] Compte sans BYOK : `initCrypto('server-provided')` derive une cle depuis
      une valeur publique integree au client et un sel local. Le blob est bien
      en AES-256-GCM, mais cette cle n'est ni secrete ni liee au materiel : ne
      jamais la presenter comme une protection contre un attaquant ayant le
      code et le stockage local.
- [x] Cles BYOK : stockees localement sans chiffrement applicatif supplementaire ;
      ce comportement est declare explicitement dans les politiques FR/EN.

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
- [x] Tous les clients encore connectes a Google (`anthropicClient`,
      `geminiClient`, `mistralClient`, `driveClient`, `calendarClient`,
      `contactsClient`)
      passent par `getValidAccessToken()` qui refresh automatiquement.
- [x] L'application publique web et Android ne demande aucun scope Gmail,
      n'expose aucun outil de lecture/envoi Gmail et ne pretend pas acceder a
      la boite mail. Un email n'est traite que si l'utilisateur colle, joint
      ou partage lui-meme son contenu.
- [ ] Google Cloud Console > Data Access contient exactement `openid`,
      `userinfo.email`, `userinfo.profile`, `calendar.events` ; supprimer les anciens
      scopes Gmail/Drive/Contacts/Sheets et révoquer les grants de test.

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
- [x] INTERNET, CAMERA, RECORD_AUDIO (BUG 44) et POST_NOTIFICATIONS présentes.
- [x] Aucun accès large aux photos ou au stockage : Photo Picker / SAF couvrent
      les sélections ponctuelles sans READ_MEDIA_IMAGES, READ_EXTERNAL_STORAGE
      ni READ_MEDIA_VISUAL_USER_SELECTED (politique Google Play 2025+).
- [x] Permissions sur-déclarées retirées : READ_MEDIA_IMAGES,
      READ_MEDIA_VISUAL_USER_SELECTED, READ_MEDIA_AUDIO, READ_MEDIA_VIDEO,
      READ_EXTERNAL_STORAGE et WRITE_EXTERNAL_STORAGE.
- [x] MODIFY_AUDIO_SETTINGS RETABLIE (commit d1d4968) apres test APK KO
      le 5 juillet 2026 : requise par getUserMedia en WebView Capacitor
      (pipeline WebRTC configure AudioManager) — sans elle le micro est
      refuse MEME avec RECORD_AUDIO accordee (NotReadableError).
      Ne PAS la retirer a nouveau. Commentaire d'usage dans le manifest.

### iOS (`ios/App/App/Info.plist`)
- [x] `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
      `NSPhotoLibraryAddUsageDescription`, `NSMicrophoneUsageDescription`,
      `NSLocationWhenInUseUsageDescription` remplis (verifie audit
      3 juillet 2026 — BUG 34 satisfait).

## 9. Tests et TypeScript verts

```bash
npm ci                  # dependances exactement conformes au lockfile
npm run verify          # app + Functions types, couverture et build
```

Ne JAMAIS publier avec des erreurs TypeScript (BUG 13) : le build echoue
silencieusement sur Cloudflare.

## 10. Compilation APK / AAB

```bash
npm ci
npm run verify
npx cap sync
npm run no-casa:android-check
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
  - Le formulaire Data Safety ne demande pas de déclaration « chiffrement au repos » :
    ne pas inventer ce champ ni transposer la protection AES locale dans la réponse
    « chiffrement en transit ».
  - Donnees supprimables sur demande : OUI (bouton "deconnexion + effacement").
- Paiements Android : les cartes et checkouts restent masques par `canPurchase`
  et les fonctions d'ouverture sont des no-op sur natif. Pour un abonne existant,
  conserver l'acces a l'annulation via `https://tryarty.lemonsqueezy.com/billing`.
- [x] Dans Lemon Squeezy > Design > Customer Portal, changements de
      produit/variant et de quantite desactives puis configuration publiee le
      14 juillet 2026. Annulation et suspension restent actives.
- [ ] Attendre l'activation du magasin Lemon Squeezy : tant que la demande est
      en examen, `https://tryarty.lemonsqueezy.com/billing` repond « Ce magasin
      n'a pas ete active » et ne constitue pas encore un parcours d'annulation.
- [ ] Apres activation, verifier avec un abonne live que le portail natif ne
      propose que gestion, pause et annulation. Tout lien permettant un nouvel
      achat ou upgrade exige d'abord l'inscription au programme Google Play
      applicable et son integration API.
- Profil OAuth public limite a `openid`, `userinfo.email`, `userinfo.profile`
  et `calendar.events`. Aucun scope Gmail, `calendar` complet ni `drive` complet dans l'APK/AAB public ;
  verifier les exigences de marque et de consentement Google applicables au
  calendrier avant soumission.
- Migration beta uniquement : poser `GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL` (date ISO
  courte, maximum 7 jours) dans Cloudflare AVANT le deploiement afin que l'APK
  1.0.80 puisse encore renouveler son grant `calendar`. Ne jamais ouvrir cette
  compatibilite sans date valide. La retirer avant la RC publique, apres mise a
  jour des 12 testeurs et 72 h sans usage legacy.

## 13. App Store (iOS)

En plus des points 1-12 :
- [x] Info.plist avec descriptions privacy completes (cf. BUG 34).
- [x] Plugins Capacitor Browser et Geolocation inclus dans le package Swift.
- [ ] Implementer et valider `GoogleSignInNative` sur iOS avant toute diffusion :
      le plugin applicatif existe actuellement cote Android uniquement.
- [ ] Build signe avec un certificat Distribution.
- [ ] Revoir si une feature utilise une API Apple restricted (ex: ATT).
