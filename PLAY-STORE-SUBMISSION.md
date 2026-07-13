# Dossier de soumission Play Store / vérification OAuth

Contenu prêt à copier-coller dans les formulaires Google (OAuth consent
verification + Play Console Data Safety). Complète `BEFORE-PUBLISHING.md`
(checklist technique). Ce fichier = la **paperasse de soumission**.

---

## 1. Accès Google (OAuth) — scopes & vérification

### Profil demandé par l'application publique

Source : `src/services/googleAuth.ts` (`PUBLIC_GOOGLE_SCOPES`).

| Scope | Classification Google | Fonctionnalité Arty | Audit CASA ? |
|---|---|---|---|
| `openid` | Basique | Authentifier la session | non |
| `userinfo.email`, `userinfo.profile` | Basique | Identifier l'utilisateur à la connexion | non |
| `calendar` | Sensible | Lire et créer des événements à la demande de l'utilisateur | non |

Avant publication, vérifier dans Google Cloud Console que la section « Data
Access » contient **exactement** ces quatre scopes. Retirer explicitement tout
ancien scope Gmail, Drive complet, Contacts ou Sheets du projet OAuth public,
puis révoquer les anciens grants de test afin de refaire un consentement propre.

### Décision de lancement : aucun accès Gmail dans l'application

Le client public web et Android ne demande **aucun scope Gmail** : ni
`gmail.readonly`, ni `gmail.modify`, ni `gmail.send`, ni `gmail.compose`.
Il n'expose aucun outil permettant de chercher, ouvrir, envoyer, modifier ou
supprimer un message dans une boîte Gmail.

Pour résumer un email, en extraire des informations ou préparer une réponse,
l'utilisateur doit **coller, joindre ou partager manuellement** le contenu avec
Arty. Ce contenu est alors traité comme tout autre message ou pièce jointe
fourni volontairement. Arty peut rédiger un texte d'email, mais ne peut pas
l'envoyer depuis la boîte de l'utilisateur.

Des routes Gmail ou un add-on expérimental peuvent rester présents dans le
projet Cloudflare isolé. Ils ne sont ni appelés ni exposés par l'application
publique, restent désactivés par défaut et n'ajoutent aucun scope au projet
OAuth du client public.

**Conséquence CASA :** le projet OAuth du client public ne demande aucun scope
restreint. Le lancement décrit dans ce dossier ne déclenche donc pas d'audit
CASA. Toute réintroduction future d'un accès direct à la boîte Gmail devra faire
l'objet d'une nouvelle analyse de scopes, d'une nouvelle validation de sécurité
et d'une mise à jour de ce dossier avant publication.

### Justification du scope sensible (texte EN pour la vérification OAuth)

- **calendar** — "Arty reads and creates calendar events only when the user requests an agenda-related action. Arty does not access the user's Gmail mailbox. Email content is processed only when the user manually pastes, attaches, or shares it with the assistant."

---

## 2. Formulaire « Sécurité des données » (Play Console)

- **Données collectées** :
  - Adresse email (via connexion Google).
  - Contenu utilisateur : messages et pièces jointes, y compris le contenu d'un email uniquement si l'utilisateur le colle, le joint ou le partage manuellement.
  - Données d'agenda, uniquement lorsque l'utilisateur utilise une fonctionnalité Calendar.
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
- **Vérification de la marque OAuth et du scope Calendar**, selon les exigences Google applicables — prévoir le délai de revue ; aucun CASA n'est prévu pour ce profil public.
- Compte Play Developer (25 $), fiche store, politique de confidentialité hébergée.

Les tests, le typecheck et le build doivent être verts via `npm run verify` avant chaque soumission. Sourcemaps off, permissions natives OK (cf. checklist).
