# Play Store & abonnements — étude de faisabilité (3 juillet 2026)

**Question de Florent** : « Est-ce qu'Arty a une place sur le Play Store, et ai-je
une chance d'avoir des abonnements ? »

**Méthode (RÈGLE 7)** : 2 agents Sonnet en parallèle (audit readiness code +
recherche marché web, ce dernier ayant fan-out 5 sous-recherches sourcées), croisés
avec les audits internes existants (`competitive-audit-2026-06.md`, `vigie-eco-2026-06.md`,
`PLAY-STORE-SUBMISSION.md`, `BEFORE-PUBLISHING.md`). Sources web consultées le 3 juillet 2026.

---

## Verdict en 3 phrases

1. **Oui, la place existe** : personne ne combine multi-modèles + Gmail/Drive/Calendar
   en lecture-écriture + privacy EU sous 20 $/mois — mais c'est une **niche étroite**,
   attaquée frontalement par Gemini (gratuit, préinstallé, et « Gemini Spark » depuis
   mai 2026 couvre nativement « gère mes mails/mon agenda »).
2. **Oui, des abonnés sont possibles, mais à échelle side-project la 1re année** :
   scénario réaliste **20-100 abonnés** (≈ 2 400-6 000 € brut/an) SI la distribution
   organique fonctionne ; la médiane du marché est bien plus dure (quelques dizaines
   d'€/mois).
3. **Le vrai mur n'est pas le Play Store, c'est la vérification OAuth Google**
   (scopes restreints Gmail/Drive) : sans elle, cap **100 utilisateurs à vie** et
   tokens qui expirent tous les 7 jours — quel que soit le canal de distribution
   (Play Store OU PWA). Le Play Store ajoute ses propres blocages (paiements,
   bouton signalement IA, test fermé) mais ils sont tous surmontables.

---

## 1. La place sur le Play Store — analyse concurrentielle

### Ce qui joue pour Arty (confirmé par 2 sources indépendantes : audit interne 12 juin + recherche web 3 juillet)

- **Aucun agrégateur multi-modèles n'a d'intégrations Google sérieuses** (Mammouth,
  Poe, Merlin, Abacus, Monica, T3 Chat : zéro Gmail/Drive/Calendar).
- Les outils d'email/calendar agentiques (Lindy, Reclaim — racheté par Dropbox en
  2026, Arahi) sont des produits **B2B/web à 20-50 $/mois**, pas des apps Android
  grand public à 10 €.
- Le segment discount souffre d'un **déficit de confiance structurel** (Mammouth
  Trustpilot 2,6/5, quotas opaques, downgrades silencieux) — la stratégie confiance
  d'Arty (P0.6/P0.7/P0.10, toutes livrées) attaque exactement ça.
- Pricing 9,99 € TTC validé (fourchette psychologique 8-10 $).
- Spécificité Play Store : **31 % des annulations sur Play sont des échecs de
  facturation involontaires** (vs 14 % App Store) — un checkout web l'évite.

### Ce qui joue contre

- **Gemini Spark (annoncé I/O, 19 mai 2026)** : assistant agentique 24/7 avec
  intégration Gmail native, gratuit, préinstallé sur Android. Le cœur du pitch
  d'Arty est couvert par l'OS lui-même. La riposte d'Arty : « Claude et Mistral
  sur TES données Google » + EU-only + limites lisibles — réelle, mais à marteler.
- La niche est peut-être vide en partie **parce que** le mur OAuth/CASA en barre
  l'entrée aux indés ET que Gemini en réduit la valeur. Les deux à la fois,
  probablement.

## 2. Chances d'avoir des abonnés — chiffres de référence

Source : RevenueCat *State of Subscription Apps* 2025 & 2026 (115 000+ apps).

| Métrique | Valeur | Implication pour Arty |
|---|---|---|
| Conversion hard paywall (essai + CB) | 10,7 % médiane (J+35) | Non applicable : Arty = essai sans CB |
| Conversion freemium (sans CB) | **2,1 % médiane** | Tabler sur **1-3 % installs→payants** |
| Revenu/install à J+60 | 0,38 $ (freemium) | 1 000 installs ≈ 380 $ |
| Nouvelle app, top 5 % | ~8 880 $/mois après 1 an | L'exception, pas la règle |
| Nouvelle app, quartile bas | ≤ 19 $/mois | Écart de 400× — hyper-concentration |
| Apps IA : LTV 12 mois | **+41 %** vs autres catégories | Les gens paient plus facilement pour l'IA |
| Apps IA : rétention 12 mois | **−36 %** (plans mensuels) | …mais churnent bien plus vite |
| Abonnés annuels qui annulent dans l'année | 72 % (2026) | Le churn est LE problème de la catégorie |

**Scénario réaliste 1re année, indé sans budget marketing** : 1 000-5 000 installs
organiques × 1-3 % ≈ **20-100 abonnés** ≈ 2 400-6 000 € brut/an, avant churn,
commission (~10 %) et coûts API. Économie unitaire saine par ailleurs (vigie éco :
marge brute projetée 76-78 % sur profil médian).

**L'antidote au churn IA existe déjà dans Arty** : mémoire auto + intégrations
Google = switching cost. C'est exactement ce que RevenueCat identifie comme
contre-mesure — c'est l'atout à mettre au centre.

**État réel au 3 juillet 2026** : 2 utilisateurs, 0 abonné payant (vigie éco).
Aucune hypothèse commerciale n'est encore validée par un seul paiement réel.

## 3. Les blocages, par ordre d'importance

### Blocage n°1 — Vérification OAuth Google (indépendant du Play Store)

- Sans vérification : **cap 100 utilisateurs à vie** + consentements qui expirent
  **tous les 7 jours** en mode Testing. Inexploitable au-delà de la beta.
- Scopes d'Arty : `gmail.readonly`, `gmail.modify`, `drive` = **restricted** →
  vérification lourde + **audit CASA annuel**. `gmail.send` = sensitive (pas de
  CASA). Calendar = jamais restricted.
- Coût réel 2026 : **~540 $/an** (CASA Tier 2, TAC Security) + **1,5 à 3 mois** de
  process, renouvelable chaque année. Piège : `gmail.readonly` + gros volume peut
  basculer en Tier 3 (**4 500-8 000 $**) — témoignage Orbis (fév. 2026) : choisir
  `gmail.modify` plutôt que `readonly` les a maintenus en Tier 2.
- La décision « Option B v1 allégée » (PLAY-STORE-SUBMISSION.md) évite CASA mais
  **ampute le différenciateur n°1** (lecture mails + Drive). À re-trancher avec
  les données de la beta.

### Blocage n°2 — Paiements dans l'APK

- **En l'état : motif de rejet quasi certain.** `src/screens/upgrade.tsx` +
  `src/services/checkout.ts` ouvrent le checkout Lemon Squeezy/Creem dans l'APK
  sans Play Billing ni inscription à un programme alternatif.
- **Bonne nouvelle (post-30 juin 2026, accord Epic + DMA)** : le « billing choice
  program » permet en EEA/UK/US de vendre via son propre PSP (Lemon Squeezy/Creem)
  avec **~10 % de commission flat sur les abonnements** (nouveau barème unifié ;
  le +5 % de billing fee ne s'applique qu'au Play Billing de Google). Conditions :
  inscription Play Console, intégration API (Billing Library 8.3+, deadline
  migration 31 août 2026), écran d'avertissement Google, reporting des
  transactions sous 24 h, **entité business enregistrée** (pas de particulier).
- Aucun cas documenté de suspension pour usage CORRECT des programmes officiels ;
  le risque réel = le hors-piste sans inscription.
- **IDs Creem encore en mode TEST** dans `functions/api/checkout/creem.ts:33-35`
  (TODO go-live connu, non traité).

### Blocage n°3 — Policies Play Store spécifiques IA

- **Bouton de signalement in-app du contenu généré par IA : OBLIGATOIRE** (policy
  AI-Generated Content) — absent d'Arty aujourd'hui. ~1-2 jours de dev.
- Data Safety form : déclarer le partage des messages avec Anthropic/OpenAI/
  Google/Mistral comme « partage avec des tiers ».
- Nouvelle policy Contacts (15 avril 2026) : privilégier le Contact Picker — à
  vérifier vs le scope `contacts` actuel.
- Compte développeur : 25 $ one-time + vérification d'identité. Le programme
  « Android Developer Verification » (sept. 2026) ne touche pas la France en
  première vague.

### Blocage n°4 — Délais incompressibles

- Test fermé **12 testeurs / 14 jours consécutifs** (compte perso créé après
  nov. 2023) + revue production ≤ 7 jours → **4 à 6 semaines** de bout en bout,
  hors CASA. Pendant la beta fermée (< 100 users), TOUTES les features peuvent
  rester (pas de vérification exigée) — c'est la fenêtre pour valider la
  willingness-to-pay avec le produit complet.

## 4. Chemin recommandé

1. **Maintenant — beta fermée Play Console avec le produit COMPLET** (Gmail lecture
   + Drive inclus : autorisé < 100 users sans vérification). C'est l'horloge la
   plus longue ET le seul moyen de valider qu'un humain paie. Objectif : premiers
   abonnés réels parmi les testeurs.
2. **Avant la soumission publique** (parallélisable) : bouton signalement IA,
   IDs Creem live, inscription au billing choice program (nécessite l'entité
   business — vérifier le statut : micro-entreprise/société), Data Safety form,
   fiche store, page privacy sur tryarty.com.
3. **Décision CASA différée et pilotée par les données** : si la beta montre que
   la lecture Gmail/Drive est ce qui fait payer → budgéter ~540 $/an + 2 mois
   (viser Tier 2, stratégie de scopes à la Orbis). Sinon → v1 allégée assumée,
   avec pitch recentré (envoi de mails + agenda + multi-modèles + EU).
4. **La distribution est le goulot n°2** : les multiplicateurs sont déjà livrés
   (partage public P1.5, i18n EN P1.6) ; l'angle presse/Reddit qui peut sortir
   de la médiane = « souveraineté EU / Claude et Mistral sur tes données Google ».
   iOS (P2.1) reste le plafond de verre à moyen terme.

**Espérance honnête** : année 1 = side-project qui couvre ses coûts d'API avec
20-100 abonnés fidèles si la distribution organique prend. Pas un revenu principal
sans (a) franchir le mur CASA et (b) un canal de distribution au-delà de l'organique.

---

## Sources principales

- Interne : `docs/audits/competitive-audit-2026-06.md` (12 juin), `docs/audits/vigie-eco-2026-06.md`
  (14 juin), `PLAY-STORE-SUBMISSION.md`, `BEFORE-PUBLISHING.md`, audit code du 3 juillet (agent RÈGLE 7).
- RevenueCat State of Subscription Apps 2025 & 2026 (revenuecat.com/state-of-subscription-apps).
- Google : AI-Generated Content policy (support.google.com/googleplay/android-developer/answer/14094294),
  App testing requirements (answer/14151465), Data Safety (answer/10787469),
  Restricted scope verification (developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
  OAuth Verification FAQ (support.google.com/cloud/answer/13463817),
  Manage App Audience / cap 100 users (support.google.com/cloud/answer/15549945),
  External offers EEA (answer/16505463, answer/14372887), User choice billing (answer/13821247),
  Lower service fees (answer/16954621).
- Android Developers Blog : « A new era for choice and openness » (4 mars 2026),
  « Expanded billing choice » (juin 2026). TechCrunch : accord Epic/Google (4 mars 2026),
  Gemini Spark (19 mai 2026). DeepStrike (CASA 2025, MàJ mai 2026), SwitchLabs (pricing CASA),
  Orbis (fév. 2026), DEV.to rem4ik4ever (jan. 2025), forum Google Developers (nov. 2025).
- Commission européenne : preliminary findings Alphabet DMA (19 mars 2025) ;
  CJUE 2 juillet 2026 (amende Android 4,1 Md€ confirmée, hors DMA).

*Caveat : barèmes de commission en transition (ancien barème EEA 2024 « 5-10 % + 7-17 % »
vs barème unifié post-30 juin 2026 « 10 % flat abonnements ») — vérifier la grille
exacte dans Play Console au moment de l'inscription au programme.*
