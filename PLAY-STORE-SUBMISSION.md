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

### ✅ Décision prise : Option B — v1 allégée (pas de CASA)

Pour le **lancement public**, on retire les 3 scopes restreints (`gmail.readonly`,
`gmail.modify`, `drive`). Scopes v1 conservés (tous **sensibles ou basiques →
pas de CASA**) :
- `gmail.send` (+ `gmail.compose` si on garde la création de brouillons),
- `calendar`, `calendar.events`,
- `contacts`,
- `userinfo.email`, `userinfo.profile`.

Fonctionnalités **retirées de la v1** : lecture/résumé des mails, archive/
corbeille/étoile/label, parcours et gestion du Drive. À réintroduire en v2
une fois la vérification + CASA passés.

> **Nuance calendrier** : pendant la **beta fermée (< 100 utilisateurs)**, Google
> n'exige ni vérification ni CASA → on peut garder TOUTES les fonctions pendant
> la beta. Le retrait des scopes restreints + le masquage des features associées
> ne doit être effectif que **pour le lancement public**. Donc pas d'urgence ;
> on prépare la version allégée en parallèle de la beta.

> **Implémentation** (frontend, zone Gemini) : éditer `SCOPES` dans
> `src/services/googleAuth.ts`, masquer l'UI Gmail-lecture/gestion + Drive, et
> retirer les tool definitions IA correspondantes pour ne pas laisser de boutons
> qui renvoient 403. Le tout dans une seule PR (pas de fenêtre prod cassée).
> Revue sécu par Claude (changement de scopes).

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
