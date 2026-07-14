# Dossier de vérification OAuth Google — Arty

**Date :** 24 mai 2026
**Statut : ARCHIVÉ / SUPERSEDED le 13 juillet 2026. Ne pas utiliser pour configurer Google Cloud.**
**App :** Arty — assistant IA, PWA `tryarty.com` + Android (Capacitor). iOS = PWA.
**Éditeur :** Florent Pollet, personne physique, 884 chemin de la Prairie, 38270 Beaufort, France — flotellop@gmail.com.

> Les justifications « EN » ci-dessous sont prêtes à coller telles quelles dans Google Cloud
> Console (Google attend de l'anglais). Le reste du document est en français pour le pilotage interne.

> ⚠️ Ce dossier décrit l'ancienne architecture avec accès Gmail/Drive et ne
> correspond plus au produit public. La source active est désormais
> [`PLAY-STORE-SUBMISSION.md`](../PLAY-STORE-SUBMISSION.md) : le client demande
> uniquement `openid`, `userinfo.email`, `userinfo.profile` et `calendar.events`.
> Aucun scope Gmail ou Drive restreint ne doit être ajouté au projet OAuth
> public. Le contenu ci-dessous est conservé uniquement comme historique.

---

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
