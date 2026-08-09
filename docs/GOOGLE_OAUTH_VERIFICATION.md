# Dossier de vérification OAuth Google — Arty

**Dernière mise à jour :** 9 août 2026
**Statut : ACTIF.** Remplace la version du 24 mai 2026, archivée en annexe.
**Éditeur :** POLLET FLORENT, entrepreneur individuel, SIREN 887 679 611, Rue des Sièges, 30120 Bréau-Mars, France — support@tryarty.com
**Projet Google Cloud :** n° 794968525529

> **Ce qui a changé.** La version précédente décrivait une architecture avec
> scopes Gmail et Drive, et concluait à un audit CASA. Elle est obsolète :
> depuis la Phase 0 (13 juillet 2026), le client public ne demande plus que
> quatre périmètres, dont un seul est sensible. **Il n'y a plus de CASA à
> prévoir** (analyse du 9 août 2026, cf. RÈGLE 8 de `CLAUDE.md`). Ne pas
> suivre l'annexe historique pour configurer Google Cloud.

---

## 1. Le problème à résoudre : l'avertissement « application non vérifiée »

L'avertissement a **deux causes distinctes**, qui ne se corrigent pas de la
même façon. Identifier laquelle s'applique AVANT d'agir :

| Cause | Symptôme | Correction |
|---|---|---|
| Écran de consentement en statut **« Test »** | Seuls les comptes inscrits comme testeurs peuvent se connecter (100 max), avertissement affiché | Passer en **« Production »** dans la console |
| Statut Production mais **vérification non approuvée** | Tout le monde peut tenter, avertissement affiché, **plafond de 100 utilisateurs** | Soumettre la vérification (§3) |

Le plafond de 100 utilisateurs est le vrai obstacle de lancement — bien avant
toute question d'audit.

## 2. Périmètres réellement demandés (vérifié dans le code)

Source de vérité : `functions/api/_lib/publicGoogleScopes.ts`, gelée par
`npm run no-casa:check`.

| Périmètre | Classification | Conséquence |
|---|---|---|
| `openid` | Élémentaire | Aucune revue |
| `userinfo.email` | Élémentaire | Aucune revue |
| `userinfo.profile` | Élémentaire | Aucune revue |
| `calendar.events` | **Sensible** | Vérification requise — **pas de CASA** |

Un seul périmètre déclenche la vérification. C'est le prix de la
fonctionnalité Agenda, et de rien d'autre.

## 3. Prérequis publics — état vérifié le 9 août 2026

- [x] Page d'accueil : `https://tryarty.com`
- [x] Politique de confidentialité : `/privacy` et `/privacy/en`
- [x] Conditions d'utilisation : `/terms` et `/terms/en`
- [x] Mentions légales : `/legal-notice` et `/legal-notice/en` (SIREN présent)
- [x] Section « Google API Limited Use » dans la politique (PRIVACY.md §5)
- [ ] **Domaine `tryarty.com` vérifié dans Google Search Console** — doit
      l'être par le compte Google **propriétaire du projet Cloud**, sinon la
      soumission est refusée sans explication utile
- [ ] **Logo** téléversé sur l'écran de consentement (déclenche la
      vérification de marque, quelques jours ouvrés)
- [ ] **Domaines autorisés** renseignés : `tryarty.com`
- [ ] **Statut de publication** basculé en « Production »

Les quatre cases non cochées sont les seules choses qui restent à faire, et
aucune ne se fait depuis le dépôt.

## 4. Justification à coller telle quelle (Google attend de l'anglais)

**calendar.events**

> Arty reads and creates calendar events only when the user requests an
> agenda-related action, using the event-only scope instead of full calendar
> access. This OAuth request is limited to Calendar: Arty does not request any
> Gmail API scope and does not use Google Sign-In or any Google API to read
> Gmail. Separately, and independently of this OAuth flow, the Android app
> offers an optional IMAP mail client: if a user chooses to connect a mailbox —
> which may be a Gmail account secured with an app password, or any other IMAP
> provider — the device connects directly to that mail server in read-only
> mode. No Google API, OAuth token, or Arty server is involved in that
> connection, and message content is shared only with Arty's AI provider
> (Anthropic) to answer the user's request. Outside of this separate,
> user-initiated feature, email content is processed only when the user
> manually pastes, attaches, or shares it with the assistant.

> ⚠️ Ce texte doit rester identique à celui de `PLAY-STORE-SUBMISSION.md` et
> cohérent avec la politique de confidentialité publique. Un évaluateur croise
> les trois : une contradiction s'y lit comme une dissimulation, pas comme une
> nuance technique. Le test `privacyClaims.test.ts` garde cette cohérence.

## 5. Vidéo de démonstration

Non listée sur YouTube, 3 à 5 minutes, sans coupure sur les parties
sensibles. Doit montrer, dans cet ordre :

1. la page d'accueil `tryarty.com` (établit que le domaine est bien le vôtre) ;
2. le clic sur « Se connecter avec Google » ;
3. **l'écran de consentement Google en entier**, avec la barre d'adresse
   lisible : Google exige de voir le `client_id` dans l'URL et la liste exacte
   des permissions demandées ;
4. l'usage réel de la permission : demander un événement à l'assistant, le
   voir apparaître dans l'agenda, en créer un avec la confirmation ;
5. l'accès à la politique de confidentialité depuis l'application ;
6. la déconnexion et la révocation de l'accès.

Ne PAS filmer la fonctionnalité Boîtes mail : elle n'utilise aucun périmètre
Google et n'entre pas dans le champ de cette vérification. La mentionner dans
la justification écrite suffit, et c'est déjà fait au §4.

## 6. Délai, coût, et ce qui n'est PAS requis

- **Coût : zéro.** Google ne facture pas la vérification d'un périmètre sensible.
- **Vérification de marque** (logo, nom, domaine) : quelques jours ouvrés.
- **Vérification du périmètre sensible** : de quelques jours à quelques
  semaines, avec des allers-retours possibles sur la vidéo ou la justification.
- **CASA : NON REQUIS.** Aucun périmètre restreint n'est demandé. Si un
  interlocuteur vous parle d'audit de sécurité, c'est qu'il raisonne sur
  l'ancienne architecture.

## 7. L'alternative, si la vérification bloque

Le seul périmètre qui la déclenche est `calendar.events`. Le retirer ramène
l'application aux périmètres élémentaires : **plus d'avertissement, plus de
plafond, aucune vérification à passer**. C'est un arbitrage produit —
l'Agenda contre le délai de vérification — et non une contrainte technique.
Les fonctionnalités Boîtes mail, IA et localisation n'en dépendent pas.

## 8. Ce qu'il ne faut jamais faire en configurant la console

Ajouter un périmètre directement dans la console, sans passer par le dépôt.
C'est le seul point de toute la chaîne sans protection technique : trois
clics, aucun commit, aucune alerte, et le garde-fou `no-casa:check` n'y voit
rien. Un périmètre restreint ajouté là déclenche CASA immédiatement.
Voir **RÈGLE 8** de `CLAUDE.md` pour la liste des interdits.

---

## 9. Articulation avec le test fermé du Play Store

> Analyse du 9 août 2026 (7 agents, chaque conclusion contre-expertisée,
> sources officielles chargées le jour même). Les points marqués « non
> confirmé » le sont volontairement : ne pas les présenter comme acquis.

### 9.1 Deux régimes indépendants, mais couplés en pratique

Le test fermé du Play Store et la vérification OAuth sont instruits par deux
équipes Google différentes, dans deux consoles différentes ; aucune page
officielle de l'un ne cite l'autre. Réunir les testeurs ne lève **ni**
l'avertissement, **ni** le plafond d'utilisateurs. Contre-intuitif et vérifié :
une fiche Play Store n'est même pas acceptée comme page d'accueil valide pour
la vérification OAuth.

Le couplage est ailleurs, et il est décisif : Google refuse l'accès à la
production pour **engagement insuffisant** des testeurs, et son formulaire
demande si les testeurs ont utilisé toutes les fonctionnalités comme le ferait
un utilisateur réel. Or, tant que l'OAuth n'est pas vérifié, chaque testeur
traverse un écran annonçant une application « non sécurisée ». Ceux qui
reculent là ne laissent aucune trace : le compteur Play affiche le bon nombre
de testeurs, tout paraît conforme, et le dossier est refusé sur un critère
illisible depuis la console.

**Conséquence sur l'ordre des opérations : la vérification OAuth passe AVANT
le lancement du chronomètre des 14 jours.** Par nécessité, pas par confort.

### 9.2 Chiffres vérifiés (pages officielles, 9 août 2026)

- **12 testeurs, 14 jours consécutifs**, pour les comptes développeur
  **personnels créés après le 13 novembre 2023**. Un compte antérieur n'est
  pas soumis à l'exigence — **à vérifier en premier**, cela peut retirer
  quatorze jours du calendrier.
- Le test **INTERNE ne compte pas** : il faut une piste de test **fermé**.
  La distribution Firebase App Distribution ne compte pas non plus.
- **Plafond de 100 utilisateurs OAuth** : cumul sur toute la vie du projet, ni
  réinitialisable ni ajustable. Il **court déjà** — il n'est pas déclenché par
  le passage en production. Retirer une adresse ne libère aucune place (aucune
  source officielle ne l'étaye).
- En statut **« Testing »** uniquement : jetons de rafraîchissement expirés à
  **7 jours** dès qu'un périmètre sort du triplet openid/e-mail/profil.
  `calendar.events` en sort. **Sans objet pour Arty, qui est en Production.**
- Instruction : jusqu'à **10 jours** pour la vérification d'un périmètre
  sensible ; environ 7 jours pour la revue d'accès production.
- Une application à usage personnel sous 100 utilisateurs peut fonctionner
  sans vérification : la bêta actuelle n'est **pas** en infraction. L'urgence
  est pratique, pas réglementaire.

### 9.3 Le piège technique : SHA-1 de la clé de signature Play

La signature d'application Play **resigne l'APK avec une clé différente** de
la clé d'envoi. Si l'empreinte SHA-1 de la clé **de signature Play** n'est pas
ajoutée au client OAuth Android, la connexion Google native fonctionne dans le
build Firebase et **échoue dans le build téléchargé depuis le Store** — même
code, comportement différent, indiagnosticable depuis le dépôt.

Empreinte à récupérer dans Play Console → Release → Configuration → Intégrité
de l'application. À ajouter **en plus** de la clé d'envoi, pas à la place.

Zone déjà coûteuse historiquement (BUG 21, 26, 27, 51) : à traiter avant la
première publication, pas après le premier rapport de bug.

### 9.4 Trois listes de testeurs à ne pas confondre

Firebase App Distribution (retour terrain, aucune valeur réglementaire) ;
piste de test fermé Play (l'exigence 12/14) ; utilisateurs de test de l'écran
de consentement OAuth (sans objet en Production). Une même personne peut être
dans l'une sans être dans les autres. Limites : 2 000 testeurs par liste et
50 listes par piste Play ; 500 par projet Firebase.

### 9.5 Points NON confirmés — ne pas présenter comme acquis

- La date du passage de 20 à 12 testeurs (souvent citée au 11 décembre 2024) :
  les deux contre-expertises se contredisent, aucune annonce officielle
  retrouvée.
- L'exemption des comptes **organisation** de l'exigence 12/14 : déduction,
  écrite nulle part, et contredite par plusieurs fils du forum officiel.
- L'effet d'une désinstallation sans désinscription sur la continuité des
  14 jours : non documenté.
- La mesure automatique d'un « temps d'engagement » par Google : introuvable
  sur les pages officielles, provient uniquement de sites vendant des services
  de testeurs.
- Le libellé exact du message affiché au 101ᵉ utilisateur : non confirmé sur
  une seconde source — risque de ne pas reconnaître le blocage le jour venu.
- **Vérification développeur Android** (régime distinct, conditionne
  l'installabilité) : première vague au 30 septembre 2026 pour Brésil,
  Indonésie, Singapour, Thaïlande ; mondial annoncé « 2027 et au-delà ». La
  France n'est pas concernée cette année. Les deux contre-expertises se
  contredisent sur l'inclusion de Firebase App Distribution dans ce périmètre.

---


# ANNEXE — version archivée du 24 mai 2026

> ⚠️ **Ne pas suivre.** Conservé pour mémoire : décrit l'architecture
> Gmail/Drive abandonnée en Phase 0, et une analyse CASA sans objet depuis.
> Les corrections de coût du 6 juillet 2026 (§6) restent instructives si un
> périmètre restreint devait un jour être envisagé.

## 1. Scopes réellement demandés

Constante `SCOPES` dans `src/services/googleAuth.ts` (vérifié) :

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/contacts
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

Endpoints serveur correspondants : `functions/api/gmail`, `drive`, `calendar`, `contacts`, `sheets`, `auth/token`, `auth/refresh`.

---

## 2. Classification Google

| Scope | Usage Arty | Classification | Enjeu |
|---|---|---|---|
| `userinfo.email` / `userinfo.profile` | Identifier l'utilisateur | Sensitive standard | Faible |
| `gmail.readonly` | Lire/synthétiser des e-mails à la demande | **Restricted** | Élevé |
| `gmail.send` | Envoyer un e-mail après confirmation | **Restricted** | Élevé |
| `gmail.modify` | Marquer lu, classer, corbeille sur instruction | **Restricted** | Élevé |
| `drive` (complet) | Lire/exploiter des documents | **Restricted + trop large** | Critique |
| `calendar` + `calendar.events` | Lire/gérer des événements | Sensitive (doublon) | Moyen |
| `contacts` | Identifier des destinataires | Sensitive/Restricted | Moyen |

**Conséquence :** Arty relève du cas le plus lourd (Restricted Gmail + Drive) → **audit sécurité externe CASA très probablement requis** (voir §6).

---

## 3. À corriger AVANT de soumettre (réduction de scopes)

Ces corrections réduisent fortement le coût et le délai de vérification, et abaissent le risque RGPD (cf. `docs/DPIA.md`).

1. **`drive` → `drive.readonly` ou `drive.file`.** Le scope complet est rarement justifiable. `drive.file` (fichiers créés/ouverts par l'app) suffit si Arty ne fait pas d'inventaire global du Drive.
2. **Calendar : garder un seul scope.** `calendar.events` suffit pour lire/créer/modifier des événements ; supprimer `calendar` (accès agenda complet).
3. **`gmail.modify` :** ne le conserver que si le classement/corbeille est indispensable au MVP. Sinon, démarrer sans.
4. **`contacts` :** justifier précisément (autocomplétion de destinataires) ou différer.
5. **Sheets :** le code expose `functions/api/sheets/append.ts` **sans scope Sheets déclaré** dans la constante OAuth → soit retirer le code mort, soit ajouter le scope et le justifier. Ne pas laisser de fonctionnalité non déclarée.

> Décision attendue du fondateur : quel jeu de scopes pour le MVP ? (voir Plan B au §7.)

---

## 4. Prérequis publics (la plupart sont déjà en place)

- [x] Page d'accueil : `https://tryarty.com`.
- [x] Politique de confidentialité publique : `https://tryarty.com/privacy` (+ EN `/privacy/en`) — déjà en ligne, avec la section **Google API Limited Use** (PRIVACY.md §5).
- [ ] CGU/CGV publiques : `https://tryarty.com/terms` — **à publier** (gabarit dans la livraison `legal/04`, à figer après décision pricing).
- [ ] Mentions légales : `https://tryarty.com/legal-notice` — **à publier** (ajouter le SIREN dès enregistrement).
- [ ] Domaine `tryarty.com` vérifié dans Google Search Console.
- [ ] Écran de consentement OAuth (External) renseigné avec ces mêmes URLs + logo + scopes exacts.

---

## 5. Procédure de soumission

1. **Google Cloud Console** → projet Arty → APIs & Services → OAuth consent screen (type **External**).
2. Renseigner nom, email support, logo, domaines autorisés, liens privacy/terms.
3. Déclarer les scopes **exactement** comme la constante (après réduction §3).
4. Comptes de test pendant la phase non vérifiée.
5. **Justification par scope** (UI visible + action déclenchée par l'utilisateur + pourquoi un scope plus petit ne suffit pas + capture d'écran).
6. **Vidéo démo** (non listée, 3–7 min) : accueil → connexion Google → écran de consentement → lecture Gmail → envoi Gmail **avec confirmation** → Drive/Calendar/Contacts si conservés → déconnexion/révocation dans Arty → accès à la politique de confidentialité depuis l'app.
7. **Submit for verification** + pièces jointes (URLs, vidéo, justifications, comptes de test, politique de suppression des données, mention « données Google non utilisées pour entraîner des modèles »).

---

## 6. Security Assessment / CASA

Pour les Restricted Scopes, Google exige généralement un audit externe annuel via un labo agréé **CASA**.
- Niveau probable : **Tier 2** (nouvelle terminologie officielle : **AL1** « Developer Tested, Lab Reviewed » — le développeur exécute un scan DAST, le labo valide preuves + questionnaire SAQ, sans accès au code).
- ~~Coût indicatif : 15 000 – 30 000 USD selon périmètre.~~ **CORRIGÉ le 6 juillet 2026 (recherche 2 agents, sources primaires + témoignages)** : cette estimation était **fausse d'un facteur 10-30×**, probablement alimentée par du contenu SEO synthétique (fils de forum incohérents, listicles Medium sans labo nommé — identifiés et écartés). Coût réel Tier 2/AL1 : **~540-855 USD/an** via TAC Security, le labo désigné « Google Recommended/Preferred » avec tarif négocié par Google. Aucun témoignage vérifié de première main au-dessus de 3 600 $ pour un Tier 2. Le 15-30 k$ correspond à un **Tier 3/AL2** (pentest complet, labos enterprise type Bishop Fox/NCC) — non requis sauf si l'ADA classe l'app « high risk » ou si on vise le badge Google Workspace Marketplace ; un solo-founder à faible base utilisateurs relève normalement du Tier 2.
- Délai réel constaté : vérification de marque 2-3 j ouvrés ; vérification restricted scopes « several weeks » côté Google ; côté labo, cas Orbis (scopes quasi identiques à Arty) : ~2 j ouvrés de turnaround, allers-retours typiques = headers manquants (CORP/CSP), corrigés en jours.
- Renouvellement : annuel (confirmé multi-sources) — budgéter en récurrent ; les plans TAC « Premium » (855 $, revalidations illimitées) neutralisent le coût des re-scans.

**Short-list labos (page officielle ADA appdefensealliance.dev/casa/casa-assessors, MAJ 26 juin 2026 — liste GELÉE, onboarding de nouveaux labos en pause)** :

| Labo | Tier 2 / AL1 | Notes |
|---|---|---|
| **TAC Security** (casa.tacsecurity.com) | **675 $** Basic (2 cycles revalidation) / **855 $** Premium (illimité) ; tarif négocié Google cité à ~540 $/an | ✅ choix n°1 — labo « préféré » de Google, cas réel Orbis (gmail.modify + calendar + contacts) passé pour 540 $ en ~2 j |
| Leviathan Security | 3 000-6 000 $ (AL1, selon délai de démarrage) | alternative premium, prix publiés |
| Prescient, NetSentries, NCC, Bishop Fox, DEKRA, KPMG, Orange CD | ~1 000-1 500 $+ estimés, devis sur demande | enterprise, sans intérêt à notre échelle |

**Faits de périmètre qui changent la facture (vérifiés sur support.google.com/cloud/answer/13464325)** :
- **Calendar et Contacts ne sont PAS des scopes « restricted »** (sensitive seulement) → ils ne déclenchent pas CASA. Le doc initial (§2) les surclassait.
- **`gmail.send` seul est « sensitive »**, pas restricted. Ce sont **`gmail.readonly`/`gmail.modify` et `drive`/`drive.readonly`** qui déclenchent CASA.
- **`drive.file` n'est pas restricted** → la migration `drive` → `drive.file` (déjà recommandée au §3) sort Drive du périmètre CASA. Surface minimale restante : Gmail readonly/modify.
- Le tier est fixé par **Google/l'ADA, pas par le développeur** (sensibilité des données, volume d'utilisateurs, profil de risque) ; réévaluation annuelle possible.
- L'ancien chemin d'auto-scan gratuit (portail PwC) est **officiellement déprécié** — ne pas suivre les tutos antérieurs à 2024.
- Google ne facture rien ; 100 % du coût est chez le labo.

**Conséquence stratégique (6 juillet 2026)** : le « péage CASA » n'est PAS un mur à 15-30 k$ — c'est **~600-900 €/an**, moins cher qu'un mois de budget marketing test. Le différenciateur Gmail/Drive est défendable à coût dérisoire ; la vraie dépense reste le temps de dossier (scopes §3, vidéo démo, justifications §7). Prochaine étape inchangée : trancher les scopes MVP (§3), puis devis TAC Security.

**Atouts d'Arty à mettre en avant à l'audit :** contenu chiffré côté appareil (AES-256-GCM), serveur ne stockant que email + jeton OAuth, clés serveur en secrets Cloudflare, `verifyGoogleUser` + whitelist, CSP, HMAC webhook. Documenter ces points avec `docs/DPIA.md`.

---

## 7. Justifications prêtes à coller (EN)

**gmail.readonly**
> Arty reads the user's Gmail messages only when the user explicitly asks to search, summarize, or extract information from their inbox. The content is used solely to produce the requested answer in the app, is never sold, never used for advertising, and never used to train AI models. A narrower scope is insufficient because summarization/search requires reading full message bodies the user selects.

**gmail.send**
> Arty composes and sends an email on the user's behalf only after the user explicitly confirms the draft in the UI. Send-only access is required to deliver this user-initiated action; no narrower scope provides sending capability.

**gmail.modify**
> Arty marks messages as read, applies labels, or moves messages to trash only on explicit user instruction (e.g. "archive this thread"). Required only if inbox-management features ship in the MVP; otherwise this scope is removed.

**drive (or drive.file)**
> Arty accesses Drive to let the user search, read, and use their documents inside AI answers, on explicit request. We are migrating from the full `drive` scope to `drive.file` so that Arty only accesses files the user opens or creates with Arty.

**calendar.events**
> Arty reads and creates calendar events to help the user plan tasks and meetings. Event creation/modification requires explicit user confirmation. We use `calendar.events` rather than full `calendar` to limit access to events only.

**contacts**
> Arty uses contacts to autocomplete recipients and add context when the user asks to email or schedule with someone. Limited to user-initiated actions.

**userinfo.email / userinfo.profile**
> Used to authenticate the user and personalize the interface (name, avatar). No other use.

---

## 8. Checklist J1

- [ ] Décider le jeu de scopes MVP (§3) et l'appliquer dans `googleAuth.ts`.
- [ ] Publier CGU + mentions légales (figer le pricing au préalable).
- [ ] Vérifier `tryarty.com` dans Search Console.
- [ ] Finaliser l'écran de consentement OAuth.
- [ ] Créer un compte Google de test propre.
- [ ] Enregistrer la vidéo démo couvrant chaque permission demandée.
- [ ] Soumettre la vérification OAuth.
- [ ] Demander 2–3 devis CASA Tier 2 (commencer par TAC Security — voir short-list §6, corrigée le 6 juillet 2026).

---

## 9. Plan B si refus ou coût CASA incompatible

- **B1 — MVP sans connecteurs** : garder uniquement `userinfo.email` + `userinfo.profile`. Lancement rapide, mais perte du différenciateur Google.
- **B2 — Google lecture minimale** : `gmail.readonly` + `drive.file` seulement ; pas de send/modify/contacts au départ.
- **B3 — Import manuel** : l'utilisateur colle volontairement ses contenus, sans OAuth Google (évite la vérification Restricted).
- **B4 — B2B/Workspace** : intégrations contrôlées côté admin Workspace (déplace la conformité vers contrats/DPA clients).
