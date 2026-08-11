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
| `calendar.events.owned` | Sensible | Lire les prochains événements pour l'Agenda et le brief proactif ; créer, modifier ou supprimer seulement sur demande | non |

Avant publication, vérifier dans Google Cloud Console que la section « Data
Access » contient **exactement** ces quatre scopes. Retirer explicitement tout
ancien scope Gmail, Drive complet, Contacts ou Sheets du projet OAuth public,
puis révoquer les anciens grants de test afin de refaire un consentement propre.

### Décision de lancement — deux questions à ne jamais confondre

Ce dossier a longtemps traité « quels scopes Google demande-t-on ? » et « à
quelles données Arty accède-t-il ? » comme une seule et même question. Elles
étaient équivalentes tant que le seul chemin vers une boîte mail passait par
l'API Gmail. **L'accès IMAP natif du 9 août 2026 a rompu cette équivalence** :
Arty lit désormais des boîtes mail *sans* aucun scope Google. Les deux
questions sont donc séparées ci-dessous, et toute fonctionnalité future qui
touchera des données sensibles hors API Google (SMS, fichiers locaux…) devra
être décrite dans le second bloc, pas dans le premier.

#### a. Scopes Google demandés (périmètre de la vérification OAuth et de CASA)

Le client public web et Android ne demande **aucun scope Gmail** : ni
`gmail.readonly`, ni `gmail.modify`, ni `gmail.send`, ni `gmail.compose`.
Aucun outil d'Arty n'utilise l'API Gmail pour chercher, ouvrir, envoyer,
modifier ou supprimer un message.

Des routes Gmail ou un add-on expérimental peuvent rester présents dans le
projet Cloudflare isolé. Ils ne sont ni appelés ni exposés par l'application
publique, restent désactivés par défaut et n'ajoutent aucun scope au projet
OAuth du client public.

**Conséquence CASA :** le projet OAuth du client public ne demande aucun scope
restreint. Le lancement décrit dans ce dossier ne déclenche donc pas d'audit
CASA. Toute réintroduction d'un accès à la boîte Gmail **via l'API Google**
(y compris un « Se connecter avec Google » qui simplifierait l'ajout d'une
boîte Gmail en IMAP, lequel exigerait le scope restreint
`https://mail.google.com/`) devra faire l'objet d'une nouvelle analyse de
scopes, d'une nouvelle validation de sécurité et d'une mise à jour de ce
dossier avant publication.

#### b. Accès aux boîtes mail par IMAP natif (hors périmètre OAuth, depuis le 9 août 2026)

L'application Android propose une fonctionnalité **séparée et indépendante de
Google** : un client IMAP natif en LECTURE SEULE (`MailImapPlugin.java`).
L'utilisateur peut connecter volontairement une boîte (Free, **Gmail via un
mot de passe d'application**, Yahoo, iCloud, ou tout serveur IMAP) depuis
Réglages → Boîtes mail. Une fois une boîte connectée :

- l'assistant dispose de quatre outils en lecture seule : lister les comptes,
  lister les messages récents, rechercher, lire un message ;
- le mot de passe d'application est chiffré par une clé Android Keystore non
  extractible, conservé sur l'appareil, et n'est jamais transmis à un serveur
  Arty ;
- la connexion IMAP TLS (port 993) part directement du téléphone vers le
  serveur choisi par l'utilisateur ; aucun identifiant ne transite par
  Cloudflare ;
- le contenu d'un message lu est transmis à **Anthropic (Claude) uniquement** —
  les outils mail ne sont injectés que dans la branche Claude de
  `useConversation.ts`, jamais vers Gemini, OpenAI ou Mistral ;
- les pièces jointes ne sont jamais récupérées : seul le corps texte ou HTML
  en ligne quitte l'appareil.

Cette fonctionnalité n'utilise aucun scope Google, aucun jeton OAuth et aucune
API Google. Elle est donc hors du périmètre de la vérification OAuth et ne
déclenche pas CASA. Mais elle change la réponse à la question « Arty peut-il
lire une boîte Gmail ? », qui est désormais **oui, si l'utilisateur la connecte
volontairement**. Aucune communication à Google — texte de justification OAuth,
formulaire Sécurité des données, fiche Play — ne doit affirmer qu'Arty n'accède
pas à la boîte mail de l'utilisateur.

Sans boîte connectée, résumer un e-mail exige toujours que l'utilisateur
**colle, joigne ou partage manuellement** son contenu. Arty peut rédiger un
texte d'e-mail, mais ne peut l'envoyer depuis aucune boîte : la lecture seule
est garantie côté natif (`Folder.READ_ONLY`, fermeture sans purge).

### Justification du scope sensible (texte EN pour la vérification OAuth)

- **calendar.events.owned** — "After the user connects Google, Arty reads upcoming events from the user's primary calendar to display the in-app Agenda. For paid and VIP accounts, the proactive brief is enabled by default and may read those events automatically; the user can disable it in Settings. Arty creates, updates, or deletes an event only when the user explicitly requests that action, and deletion requires an additional in-app confirmation. We request `calendar.events.owned` because Arty never accesses calendars the user does not own; the broader `calendar.events` and `calendar` scopes are unnecessary. When Arty prepares a proactive brief or interprets or performs an agenda request, the event title, time, location, and the user's instructions may be sent to Anthropic Claude through Arty's Cloudflare proxy. Arty does not store that information server-side beyond request processing. Under Anthropic's standard API policy, inputs and outputs are deleted within 30 days, subject to its documented legal and abuse-prevention exceptions, and are not used to train generative models unless the customer explicitly opts in. This OAuth request is limited to Calendar: Arty does not request any Gmail API scope and does not use Google Sign-In or any Google API to read Gmail. Separately, and independently of this OAuth flow, the Android app offers an optional IMAP mail client: if a user chooses to connect a mailbox — which may be a Gmail account secured with an app password, or any other IMAP provider — the device connects directly to that mail server in read-only mode. No Google API, OAuth token, or Arty server is involved in that connection, and message content is shared only with Arty's AI provider (Anthropic) to answer the user's request. Outside of this separate, user-initiated feature, email content is processed only when the user manually pastes, attaches, or shares it with the assistant."

> Ce texte doit rester cohérent avec la politique de confidentialité publique,
> qui décrit elle aussi l'accès IMAP optionnel. Un évaluateur Google croise les
> deux : une contradiction entre eux se lit comme une dissimulation, pas comme
> une nuance technique.

---

## 2. Formulaire « Sécurité des données » (Play Console)

- **Données collectées** :
  - Adresse email (via connexion Google).
  - Contenu utilisateur : messages et pièces jointes, y compris le contenu d'un email si l'utilisateur le colle, le joint ou le partage manuellement.
  - **Messages → E-mails** (catégorie officielle Play : objet, expéditeur, destinataires et corps du message) — **uniquement si l'utilisateur connecte volontairement une boîte IMAP**. Voir le détail ci-dessous.
  - Données d'agenda, uniquement lorsque l'utilisateur utilise une fonctionnalité Calendar.
  - Position (uniquement si l'utilisateur active la localisation).
- **Détail de la catégorie « Messages → E-mails »** :
  - *Collectées* : **OUI**. Le contenu quitte l'appareil dès que l'assistant lit un message via l'un des quatre outils mail.
  - *Partagées* : **OUI**, avec Anthropic (Claude) et lui seul, pour produire la réponse. L'exemption « traitement éphémère » ne s'applique pas : elle suppose l'absence de tiers dans la boucle, or Anthropic est un tiers doté de sa propre politique de rétention.
  - *Finalité* : fonctionnement de l'application uniquement. Aucune publicité, aucune analyse comportementale, aucun profilage.
  - *Requises ou optionnelles* : **optionnelles**. L'application fonctionne intégralement sans aucune boîte connectée.
  - *Non collecté* : le mot de passe d'application ne quitte jamais l'appareil vers un serveur Arty (chiffré par le Keystore Android, transmis uniquement au serveur IMAP choisi par l'utilisateur, comme le ferait tout client de messagerie). Les pièces jointes des e-mails ne sont jamais récupérées.
- **Données partagées avec des tiers ?** **OUI** — le contenu utilisateur est transmis aux fournisseurs d'IA (Anthropic, OpenAI, Google, Mistral) **uniquement pour traiter la demande**. Pas de publicité, pas de revente, pas de courtage de données. Le contenu des e-mails fait exception dans le sens le plus restrictif : il ne part **que** chez Anthropic, garanti par le point d'injection unique des outils mail.
- **Chiffrement en transit** : OUI. HTTPS pour les échanges avec les serveurs Arty et les fournisseurs d'IA ; IMAPS/TLS sur le port 993 pour la liaison téléphone ↔ serveur de messagerie, qui n'est pas du HTTPS.
- Le formulaire Data Safety ne demande pas de déclaration « chiffrement au repos ». Ne pas ajouter ce champ : la protection locale AES et ses limites sont décrites dans la politique de confidentialité, séparément de la réponse « chiffrement en transit ».
- **L'utilisateur peut-il demander la suppression ?** OUI. La suppression de compte efface les données serveur (mémoire, quotas), les données locales, et **purge les boîtes mail connectées de l'appareil** — y compris le mot de passe chiffré. Un compte mail peut aussi être retiré isolément depuis Réglages → Boîtes mail.
- **Données requises ou optionnelles** : email requis (authentification) ; tout le reste dépend des fonctionnalités utilisées, et la catégorie « Messages → E-mails » est strictement optionnelle.

---

## 3. Politique de confidentialité

Google exige une **page web publique** de politique de confidentialité (même si l'app ne monétise pas les données).

- Français : `https://tryarty.com/privacy`
- Anglais : `https://tryarty.com/privacy/en`
- Garder `PRIVACY.md`, `PRIVACY-EN.md` et ces deux copies HTML synchronisés à chaque modification.

### Abonnements existants dans l'application Android

L'application Android ne montre aucune offre ni bouton d'achat : `canPurchase`
est faux sur natif et les fonctions de checkout échouent fermées. Un abonné
existant conserve toutefois un lien vers le portail client Arty
(`https://tryarty.lemonsqueezy.com/billing`) afin de pouvoir gérer ou annuler
son abonnement, comme l'exige la politique Google Play sur les abonnements.

Avant soumission, désactiver dans la configuration du Customer Portal Lemon
Squeezy tous les changements de produit/variant, puis vérifier avec un compte
abonné que le portail ne propose aucun achat ou upgrade. Si Arty veut proposer
ultérieurement un lien externe d'upgrade, il faudra d'abord s'inscrire au
programme Google Play applicable (External Offers/External Content Links selon
la région) et intégrer ses API ; le simple lien web n'est pas suffisant.

État au 14 juillet 2026 : changements de produit/variant et de quantité
désactivés, annulation et suspension conservées, configuration publiée. Le
magasin reste toutefois en attente d'activation par Lemon Squeezy et son URL
publique `/billing` est encore interdite. L'activation du magasin et un test
avec un abonné live restent donc des gates de soumission, pas des gates de merge.

Sources officielles vérifiées le 14 juillet 2026 :

- [Politique Google Play — abonnements et annulation](https://support.google.com/googleplay/android-developer/answer/9900533?hl=en)
- [Programme External Offers — EEE](https://support.google.com/googleplay/android-developer/answer/14372887?hl=en)
- [Programme External Content Links — États-Unis](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en)
- [Lemon Squeezy — Customer Portal](https://docs.lemonsqueezy.com/help/online-store/customer-portal)

---

## 4. Bloqueurs restants vers la publication

Voir `BEFORE-PUBLISHING.md` pour la checklist technique. Les longs délais externes :
- **Beta fermée 14 jours, 12 testeurs** (règle Google 2026) — horloge la plus longue, à lancer ASAP.
- **Vérification de la marque OAuth et du scope Calendar**, selon les exigences Google applicables — prévoir le délai de revue ; aucun CASA n'est prévu pour ce profil public.
- Compte Play Developer (25 $), fiche store, politique de confidentialité hébergée.

Les tests, le typecheck et le build doivent être verts via `npm run verify` avant chaque soumission. Sourcemaps off, permissions natives OK (cf. checklist).
