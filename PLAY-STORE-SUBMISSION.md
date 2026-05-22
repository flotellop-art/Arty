# Dossier de soumission Play Store / vérification OAuth

Contenu prêt à copier-coller dans les formulaires Google (OAuth consent
verification + Play Console Data Safety). Complète `BEFORE-PUBLISHING.md`
(checklist technique). Ce fichier = la **paperasse de soumission**.

---

## 1. Accès Google (OAuth) — scopes & vérification

### Scopes demandés

Source : `src/services/googleAuth.ts` (constante `SCOPES`).

| Scope | Classification Google | Fonctionnalité Arty | Audit CASA ? |
|---|---|---|---|
| `userinfo.email`, `userinfo.profile` | Basique | Identifier l'utilisateur à la connexion | non |
| `gmail.send` | Sensible | Envoyer un mail validé par l'utilisateur | non |
| `gmail.readonly` | **Restreint** | Lire/résumer les mails, lire les pièces jointes | **OUI** |
| `gmail.modify` | **Restreint** | Archiver, corbeille, étoiler, étiqueter | **OUI** |
| `drive` (complet) | **Restreint** | Parcourir, lire, créer, modifier, supprimer, partager les fichiers Drive | **OUI** |
| `calendar`, `calendar.events` | Sensible | Lire et créer des événements | non |
| `contacts` | Sensible | Adresser mails/événements aux bons contacts | non |

### ⚠️ Décision à prendre : audit CASA

**Vérifié dans le code** (`functions/api/gmail/action.ts`, `functions/api/drive/action.ts`) : les 3 scopes restreints sont **réellement utilisés** par des fonctionnalités existantes :
- `gmail.readonly` → lecture des mails (cœur de l'assistant mail).
- `gmail.modify` → archiver / corbeille / étoiler / étiqueter.
- `drive` complet → `list` (parcourir TOUT le Drive), lire/exporter n'importe quel fichier, créer/modifier/supprimer/renommer/déplacer/partager/copier.

Donc **on ne peut PAS simplement "rétrécir" ces scopes sans supprimer des fonctionnalités** :
- `drive.file` (non restreint) ne voit QUE les fichiers créés par Arty → casse le « parcours / lis mon Drive ».
- Il n'existe pas de scope Gmail "lecture" non restreint → lire les mails impose `gmail.readonly` (restreint).

**Conséquence** : publier en grand public avec ces fonctionnalités impose la vérification Google la plus lourde, dont un **audit de sécurité annuel par un labo agréé (CASA)** — payant (souvent plusieurs centaines à quelques milliers de $/an) et long.

**Trois options** (décision produit) :
- **A — Tout garder** : on assume la vérification + CASA. Coût + délai, mais Arty garde toutes ses capacités Gmail/Drive.
- **B — v1 sans Gmail-lecture ni Drive-parcours** : on retire `gmail.readonly`, `gmail.modify`, `drive` pour la v1. On garde `gmail.send`/compose, `calendar`, `contacts` (tous sensibles → **pas de CASA**). Lancement plus rapide, moins de features. On rajoute le reste en v2 une fois le CASA fait.
- **C — Hybride** : garder la lecture Gmail (CASA Gmail) mais passer Drive en `drive.file` (perd le parcours Drive, mais réduit la surface).

> Statut : **EN ATTENTE de décision Florent.** Tant que non tranché, on ne touche pas à `SCOPES`.

### Justifications par scope (texte EN à coller dans la vérification OAuth)

- **gmail.readonly** — "Arty reads the user's emails only when the user explicitly asks (e.g. 'summarize my unread emails', 'what did X say'). Email content is sent to AI providers solely to generate the requested summary or answer, never stored server-side beyond the request, never used for ads or sold."
- **gmail.send** — "Arty sends emails only that the user has explicitly reviewed and approved within the app."
- **gmail.modify** — "Arty archives, trashes, stars or labels a specific email only on the user's explicit request."
- **drive** — "Arty lists, reads and manages the user's Drive files only on explicit user request (e.g. 'open my budget spreadsheet'). No background access; no bulk scanning."
- **calendar / calendar.events** — "Arty reads and creates calendar events on the user's request."
- **contacts** — "Arty reads contacts to correctly address emails and calendar invitations the user asks to create."

---

## 2. Formulaire « Sécurité des données » (Play Console)

- **Données collectées** :
  - Adresse email (via connexion Google).
  - Contenu utilisateur : messages, pièces jointes, et — selon les fonctionnalités utilisées — contenu de mails/agenda.
  - Position (uniquement si l'utilisateur active la localisation).
- **Données partagées avec des tiers ?** **OUI** — le contenu utilisateur est transmis aux fournisseurs d'IA (Anthropic, OpenAI, Google, Mistral) **uniquement pour traiter la demande**. Pas de publicité, pas de revente, pas de courtage de données.
- **Chiffrement en transit** : OUI (HTTPS uniquement).
- **Chiffrement au repos** : OUI (AES-256, Web Crypto API).
- **L'utilisateur peut-il demander la suppression ?** OUI (bouton déconnexion + effacement local).
- **Données requises ou optionnelles** : email requis (auth) ; le reste dépend des fonctionnalités utilisées.

---

## 3. Politique de confidentialité

Google exige une **page web publique** de politique de confidentialité (même si l'app ne monétise pas les données). À héberger (ex : `tryarty.com/privacy`).

> TODO : confirmer si `tryarty.com` a déjà une page privacy. Sinon, demander à Claude le texte (peut être rédigé à partir des points de la section 2 + le modèle de chiffrement).

---

## 4. Bloqueurs restants vers la publication

Voir `BEFORE-PUBLISHING.md` pour la checklist technique. Les longs délais externes :
- **Beta fermée 14 jours, 12 testeurs** (règle Google 2026) — horloge la plus longue, à lancer ASAP.
- **Vérification OAuth** (+ CASA si option A/C retenue) — délai de plusieurs semaines.
- Compte Play Developer (25 $), fiche store, politique de confidentialité hébergée.

Tests unitaires : **227/227 verts** (bloqueur §9 levé). Sourcemaps off, permissions natives OK (cf. checklist).
