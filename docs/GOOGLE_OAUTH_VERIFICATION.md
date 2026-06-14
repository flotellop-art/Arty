# Dossier de vérification OAuth Google — Arty

**Date :** 24 mai 2026
**Statut :** Document de préparation interne (à remettre au prestataire/au labo CASA et à reporter dans Google Cloud Console).
**App :** Arty — assistant IA, PWA `tryarty.com` + Android (Capacitor). iOS = PWA.
**Éditeur :** Florent Pollet, personne physique, 884 chemin de la Prairie, 38270 Beaufort, France — flotellop@gmail.com.

> Les justifications « EN » ci-dessous sont prêtes à coller telles quelles dans Google Cloud
> Console (Google attend de l'anglais). Le reste du document est en français pour le pilotage interne.

---

## 1. Scopes réellement demandés

> **MAJ 14 juin 2026** — Scopes réduits (décision Florent « on ne bride pas le
> différenciateur, mais on minimise tout le reste »). `drive` (total) →
> `drive.readonly` + `drive.file` ; `calendar` (doublon) supprimé. Appliqué dans
> les 3 sites de déclaration : `src/services/googleAuth.ts`, `src/main.tsx`,
> `android/.../GoogleSignInPlugin.java` (les trois DOIVENT rester alignés).

Constante `SCOPES` dans `src/services/googleAuth.ts` (vérifié) :

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/contacts
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

Endpoints serveur correspondants : `functions/api/gmail`, `drive`, `calendar`, `contacts`, `sheets`, `auth/token`, `auth/refresh`.

---

## 2. Classification Google

> Classifications vérifiées le 14 juin 2026 sur la liste officielle Google
> (support.google.com/cloud/answer/13464325 + sensitive-scope-verification).
> Corrige deux erreurs de classification antérieures : `gmail.send` est
> **sensitive** (pas restricted) et `calendar.events`/`contacts` sont
> **sensitive** (pas restricted). Seuls les scopes **restricted** déclenchent
> le CASA.

| Scope | Usage Arty | Classification | Enjeu |
|---|---|---|---|
| `userinfo.email` / `userinfo.profile` | Identifier l'utilisateur | Non-sensitive | Faible |
| `gmail.readonly` | Lire/synthétiser des e-mails à la demande | **Restricted** | Élevé |
| `gmail.send` | Envoyer un e-mail après confirmation | Sensitive | Moyen |
| `gmail.modify` | Marquer lu, classer, corbeille sur instruction | **Restricted** | Élevé |
| `drive.readonly` | Lire/chercher des documents dans tout le Drive | **Restricted** | Élevé |
| `drive.file` | Créer/gérer UNIQUEMENT les fichiers d'Arty | Non-sensitive | Faible |
| `calendar.events` | Lire/gérer des événements | Sensitive | Moyen |
| `contacts` | Identifier des destinataires (lecture + écriture) | Sensitive | Moyen |

**Conséquence :** trois scopes restricted subsistent (`gmail.readonly`,
`gmail.modify`, `drive.readonly`) → **CASA requis** (voir §6). La réduction de
scopes ne change PAS le palier (binaire : 1 restricted = Tier 3, et
`gmail.readonly` est non négociable), mais elle allège le dossier, l'écran de
consentement et la surface d'audit.

---

## 3. Réduction de scopes — FAITE (14 juin 2026)

Décision Florent : **garder le différenciateur (lecture Gmail) et faire le CASA**,
mais **minimiser tout le reste**. Appliqué :

1. **`drive` (total) → `drive.readonly` + `drive.file`.** ✅ FAIT. Arty lit/cherche
   dans TOUT le Drive (`drive.readonly`) mais ne crée/modifie/supprime/partage QUE
   ses propres fichiers (`drive.file`) — jamais les fichiers préexistants de
   l'utilisateur. Descriptions des outils Drive d'écriture alignées
   (`src/services/tools/driveTools.ts`).
2. **Calendar : `calendar` supprimé, `calendar.events` conservé.** ✅ FAIT. Doublon :
   le code ne touche que les événements du calendrier `primary`.
3. **`gmail.modify` : conservé.** Utilisé (archiver/étoiler/labels/corbeille). Le
   retirer ne changerait pas le palier CASA (déjà Tier 3 via `gmail.readonly`) et
   couperait des fonctions → gardé.
4. **`contacts` : conservé.** Utilisé en lecture **et** écriture (Arty crée/modifie
   des contacts — `functions/api/contacts/action.ts`) → `contacts.readonly`
   casserait ces fonctions.
5. **Sheets :** `functions/api/sheets/append.ts` ne fait que **créer** des tableurs
   et **ajouter** des lignes → couvert par `drive.file` (fichiers créés par l'app),
   plus besoin du scope `drive` complet ni d'un scope `spreadsheets` dédié.

> **Anti-objectif acté :** ne PAS retirer les scopes restricted pour la v1
> (l'ancien « Plan B1/B2 » §9 est écarté — on assume le CASA, voir §6).

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

Pour les Restricted Scopes, Google exige un audit externe annuel via un labo agréé **CASA**.

> **MAJ 14 juin 2026 — correction de l'estimation de coût.** L'ancien « 15 000 –
> 30 000 USD » correspond à un **Tier 3 chez un labo enterprise** (Bishop Fox,
> Leviathan…) ou à de vieux devis pré-2023, **pas** au cas réaliste. Chiffres
> actuels sourcés (assesseurs agréés Google) :
> - Le **tier est assigné par Google** au cas par cas, pas par une grille fixe.
>   `gmail.readonly`/`drive.readonly` peuvent donner **Tier 2 ou Tier 3** selon le
>   profil de risque de l'app (nb d'utilisateurs). On ne le saura qu'en lançant la
>   vérification dans la Cloud Console.
> - **Tier 2** (validation labo) : **~540 – 900 USD/an** (TAC Security, partenaire
>   Google ; retours indés Orbis/dev.to confirment) ; 1 200 – 6 000 USD chez
>   d'autres labos.
> - **Tier 3** (pentest complet) : **~4 500 USD/an** (TAC) à 8 000 USD.
> - **Renouvellement annuel obligatoire** (réévaluation tous les 12 mois).
> - **Délai** : 1–3 semaines (TAC) à 3–8 semaines selon labo.
> - Le **self-scan autonome est déprécié** (2024-25) : la validation par un labo
>   agréé est obligatoire, mais on peut faire le scan soi-même (DAST/OWASP ZAP)
>   pour rester sur le tarif bas.
> - ⚠️ La **réduction de scopes ne fait pas baisser le palier** (binaire) — elle
>   allège le dossier de justification et la surface d'audit, pas la facture.
>
> **Action J1 inchangée : demander 2–3 devis pour avoir le chiffre ferme Arty.**

**Atouts d'Arty à mettre en avant à l'audit :** contenu chiffré côté appareil (AES-256-GCM), serveur ne stockant que email + jeton OAuth, clés serveur en secrets Cloudflare, `verifyGoogleUser` + whitelist, CSP, HMAC webhook. Documenter ces points avec `docs/DPIA.md`.

---

## 7. Justifications prêtes à coller (EN)

**gmail.readonly**
> Arty reads the user's Gmail messages only when the user explicitly asks to search, summarize, or extract information from their inbox. The content is used solely to produce the requested answer in the app, is never sold, never used for advertising, and never used to train AI models. A narrower scope is insufficient because summarization/search requires reading full message bodies the user selects.

**gmail.send**
> Arty composes and sends an email on the user's behalf only after the user explicitly confirms the draft in the UI. Send-only access is required to deliver this user-initiated action; no narrower scope provides sending capability.

**gmail.modify**
> Arty marks messages as read, applies labels, or moves messages to trash only on explicit user instruction (e.g. "archive this thread"). Required only if inbox-management features ship in the MVP; otherwise this scope is removed.

**drive.readonly**
> Arty reads and searches the user's Drive files only when the user explicitly asks to find, read, or use a document inside an AI answer. Read-only access is required because the user expects Arty to locate and use their existing documents; Arty never modifies, deletes, or shares the user's existing files.

**drive.file**
> Arty uses `drive.file` to create and manage only the files it generates for the user (e.g. a document or spreadsheet Arty produces on request). This per-file scope guarantees Arty cannot touch any pre-existing file the user did not create through Arty.

**calendar.events**
> Arty reads and creates calendar events to help the user plan tasks and meetings. Event creation/modification requires explicit user confirmation. We use `calendar.events` rather than full `calendar` to limit access to events only.

**contacts**
> Arty uses contacts to autocomplete recipients and add context when the user asks to email or schedule with someone. Limited to user-initiated actions.

**userinfo.email / userinfo.profile**
> Used to authenticate the user and personalize the interface (name, avatar). No other use.

---

## 8. Checklist J1

- [x] Décider le jeu de scopes MVP (§3) et l'appliquer dans `googleAuth.ts`. **FAIT 14 juin 2026** (drive→readonly+file, calendar→events ; appliqué aux 3 sites de déclaration).
- [ ] Publier CGU + mentions légales (figer le pricing au préalable).
- [ ] Vérifier `tryarty.com` dans Search Console.
- [ ] Finaliser l'écran de consentement OAuth.
- [ ] Créer un compte Google de test propre.
- [ ] Enregistrer la vidéo démo couvrant chaque permission demandée.
- [ ] Soumettre la vérification OAuth.
- [ ] Demander 2–3 devis CASA Tier 2.

---

## 9. Plan B si refus ou coût CASA incompatible

> **MAJ 14 juin 2026 — B1/B2 écartés par décision Florent (« on ne bride pas »).**
> Le différenciateur (lecture Gmail/Drive) est conservé et on assume le CASA
> (§6). B1/B2 ne restent qu'en filet de secours si le CASA était refusé ou
> financièrement impossible — pas comme stratégie de lancement.

- **B1 — MVP sans connecteurs** : garder uniquement `userinfo.email` + `userinfo.profile`. Lancement rapide, mais perte du différenciateur Google.
- **B2 — Google lecture minimale** : `gmail.readonly` + `drive.file` seulement ; pas de send/modify/contacts au départ.
- **B3 — Import manuel** : l'utilisateur colle volontairement ses contenus, sans OAuth Google (évite la vérification Restricted).
- **B4 — B2B/Workspace** : intégrations contrôlées côté admin Workspace (déplace la conformité vers contrats/DPA clients).
