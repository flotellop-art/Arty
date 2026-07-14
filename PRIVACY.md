# Politique de confidentialité — Arty

**Dernière mise à jour :** 14 juillet 2026

**Éditeur :** Florent Pollet, personne physique, domicilié 884 chemin de la Prairie, 38270 Beaufort, France. Aucune entreprise n'est immatriculée à ce jour ; un SIREN sera ajouté à cette politique dès l'enregistrement de l'activité, prévu avant le lancement public et les premiers paiements.
**Contact :** flotellop@gmail.com

Arty est un assistant IA personnel (application mobile Android et application web `tryarty.com`). La présente politique explique quelles données personnelles nous traitons, à quelles fins, sur quelles bases légales, à qui nous les transmettons, combien de temps nous les conservons, et quels sont vos droits.

## 1. Responsable de traitement

Le responsable de traitement au sens du RGPD est Florent Pollet, personne physique (coordonnées ci-dessus). Aucun délégué à la protection des données (DPO) n'est désigné, car l'activité ne remplit pas les critères de l'article 37 RGPD.

## 2. Données que nous traitons

| Catégorie | Données | Source |
|---|---|---|
| Identité de connexion | Email, nom complet, photo de profil | Connexion Google (OAuth) |
| Contenu utilisateur | Messages, fichiers et pièces jointes envoyés à l'assistant, y compris le contenu d'un email que vous collez, joignez ou partagez manuellement ; mémoire structurée, conversations partagées et signalements que vous soumettez volontairement | Vous |
| Données Google Workspace | Lecture et création d'événements (Calendar), uniquement lorsque vous utilisez une fonction d'agenda. L'application publique n'accède pas à votre boîte Gmail | Votre compte Google, sur votre demande explicite |
| Localisation | Position géographique approximative | Capteur GPS de votre appareil, uniquement si activé |
| Données de paiement | Email du compte, offre ou pack choisi, identifiants et statut de transaction ; Arty ne reçoit aucune coordonnée bancaire | Vous + Lemon Squeezy ou Creem |
| Inscription waitlist | Email (pré-lancement uniquement) | Formulaire Tally |

Nous ne traçons pas votre navigation à des fins publicitaires et n'utilisons aucun profilage commercial.

Arty ne recherche, ne lit, ne modifie et n'envoie aucun message dans votre boîte Gmail. Si vous demandez de résumer un email ou de préparer une réponse, son contenu n'est traité que si vous le collez, le joignez ou le partagez vous-même avec l'assistant.

## 3. Finalités et bases légales

| Finalité | Base légale (RGPD article 6) |
|---|---|
| Authentification et fourniture du service (compte, conversations, IA, connecteurs Google) | Exécution du contrat — vos conditions d'utilisation |
| Réponses géolocalisées | Consentement explicite (vous activez la localisation) |
| Paiements (abonnement Pro et packs de crédits prépayés) | Exécution du contrat + obligation légale comptable |
| Lutte contre la fraude et sécurité du service (logs techniques, kill-switch chiffrement) | Intérêt légitime |
| Communication pré-lancement (waitlist) | Consentement (inscription volontaire au formulaire) |

## 4. Partage avec des tiers (sous-traitants au sens RGPD article 28)

Vos données sont transmises, **uniquement pour les finalités ci-dessus**, aux prestataires suivants :

| Prestataire | Rôle | Localisation | Garantie |
|---|---|---|---|
| Cloudflare | Hébergement Workers, Pages, KV (proxy API, stockage clés non sensibles, distribution du site) | UE + monde (CDN) | Standard Contractual Clauses (SCC), DPA Cloudflare |
| Anthropic (Claude) | Génération de réponses IA | États-Unis | SCC + EU-US Data Privacy Framework |
| OpenAI | Génération de réponses IA (selon le modèle choisi) | États-Unis | SCC + EU-US Data Privacy Framework |
| Google (Gemini + Workspace) | Génération de réponses IA + fonctions Calendar explicitement demandées ; aucun connecteur Gmail dans l'application publique | UE + États-Unis | SCC + EU-US Data Privacy Framework |
| Mistral AI | Génération de réponses IA | France (UE) | Hébergement UE direct |
| Lemon Squeezy | Traitement des paiements abonnement Pro | États-Unis | SCC + EU-US Data Privacy Framework, gestion PCI-DSS |
| Creem | Merchant of Record et page de paiement hébergée pour les packs de crédits. Arty lui transmet l'email Google vérifié du compte, le produit/pack choisi, un identifiant de requête aléatoire et l'URL de retour. Les coordonnées bancaires sont saisies directement chez Creem et ne sont pas reçues par Arty. | Estonie (UE) | RGPD, DPA Creem ; SCC pour ses sous-traitants hors EEE |
| Resend | Envoi d'emails transactionnels (notifications, récap) | UE | DPA Resend |
| Tally | Formulaire de waitlist (pré-lancement) | UE | DPA Tally |

**Aucun partage à des fins publicitaires. Aucune revente. Aucun courtage de données.**

Pour obtenir une copie des SCC signées avec un prestataire, contactez `flotellop@gmail.com`.

## 5. Conformité Google API (Limited Use)

L'utilisation par Arty des données reçues des API Google, et leur transfert vers toute autre application, respectent la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris les exigences **Limited Use** :

- l'accès à vos données Google se fait uniquement pour vous fournir les fonctionnalités que vous demandez ;
- nous n'utilisons pas ces données à des fins publicitaires ;
- nous ne les vendons pas ;
- nous ne les utilisons pas pour entraîner des modèles d'IA généralistes ;
- aucun humain n'accède à ces données, sauf accord explicite de votre part, pour des raisons de sécurité documentées, ou si la loi l'exige.

## 6. Sécurité

- **Données locales protégées par l'application** : vos conversations, vos pièces jointes (IndexedDB), vos rapports générés et vos jetons OAuth Google sont stockés localement sous forme chiffrée AES-256-GCM via la Web Crypto API. En mode BYOK, la clé est dérivée localement de votre clé API personnelle. Pour un compte sans BYOK, elle est dérivée d'une valeur intégrée à l'application et d'un sel stocké localement : les données sont chiffrées sur le disque, mais la clé n'est ni secrète ni liée au matériel. Ce mécanisme ne protège donc pas contre un attaquant qui accède à la fois au code de l'application et au stockage local.
- **Clés API personnelles (BYOK)** : elles sont stockées localement dans l'espace applicatif de votre appareil, sans chiffrement applicatif supplémentaire. Elles transitent par le proxy API Cloudflare d'Arty uniquement pour relayer vos requêtes vers l'API du fournisseur ; elles ne sont ni stockées ni journalisées par Arty côté serveur.
- **Chiffrement en transit** : toutes les communications utilisent HTTPS (TLS 1.2+).
- **Traitements côté serveur** : les jetons Google et les clés BYOK sont traités en transit pour authentifier ou relayer la requête, sans être persistés ni journalisés par Arty. Les données persistées sont limitées aux identités et sessions email, à la mémoire structurée explicitement enregistrée, aux conversations partagées et signalements soumis volontairement, aux données de facturation/wallet ainsi qu'aux quotas et compteurs techniques, selon les durées du §8.
- **Clés API serveur** : jamais exposées dans l'application cliente. Stockées en secrets Cloudflare Workers.

## 7. Stockage local sur votre appareil

Pour fonctionner, l'application conserve localement les données suivantes. Lorsque vous demandez une fonctionnalité, le contenu nécessaire, les jetons Google et/ou les clés BYOK peuvent transiter par les endpoints Cloudflare d'Arty et les prestataires concernés, comme décrit aux §4 et §6. Arty ne persiste pas côté serveur le contenu courant des conversations, les pièces jointes, les jetons Google ni les clés BYOK, sauf conversation partagée ou signalement que vous soumettez volontairement.

- **localStorage** : préférences (langue, onboarding, plan), identifiant d'appareil non personnel, hash de votre email pour la reconnexion, clés API personnelles BYOK sans chiffrement applicatif, conversations, rapports générés et jetons OAuth Google chiffrés, état trial.
- **sessionStorage** : état OAuth Google (protection CSRF), messages d'erreur transitoires.
- **IndexedDB** : pièces jointes (images, PDFs) chiffrées AES-256.

Ces stockages sont **strictement nécessaires au service** au sens de l'article 82 de la loi Informatique et Libertés (transposition de la directive ePrivacy) — leur consentement n'est donc pas requis.

Nous n'utilisons **aucun cookie** de tracking ni d'analyse. Le chargement des polices d'écriture peut entraîner des requêtes vers `fonts.googleapis.com` (Google Fonts), susceptibles de poser un cookie tiers de session lié à Google ; nous prévoyons de basculer en auto-hébergement de ces polices avant le lancement public.

## 8. Conservation des données

| Catégorie | Durée |
|---|---|
| Identités et sessions email, mémoire structurée, conversations partagées et signalements | Tant que votre compte est actif. Ces données sont supprimées lors de votre demande de suppression (au plus tard sous 30 jours). |
| Conversations, pièces jointes et rapports | Stockés uniquement sur votre appareil et chiffrés selon le modèle et les limites décrits au §6. Une simple déconnexion les conserve pour votre prochaine connexion. Supprimer une conversation efface ses pièces jointes ; supprimer le compte efface l'ensemble de ces données. |
| Données de paiement | 10 ans (obligation légale comptable, article L123-22 Code de commerce). |
| Compteurs techniques minimaux d’usage, de quota et d’anti-abus | Conservés pendant la durée strictement nécessaire à la sécurité, à la prévention des abus et à l’intégrité de la facturation. Ils ne contiennent pas le contenu de vos échanges. |
| Logs techniques serveur (Cloudflare Workers, anti-abus) | 12 mois maximum. |
| Email waitlist (pré-lancement) | Jusqu'au lancement de l'application + 12 mois ou désinscription, selon la première éventualité. |
| Contenu transmis aux fournisseurs d'IA | Non conservé sur nos serveurs au-delà du traitement de la requête. Conservation chez le fournisseur selon sa propre politique (Anthropic 30 jours, OpenAI 30 jours, Google variable, Mistral 30 jours). |

## 9. Vos droits (RGPD)

Vous disposez des droits suivants sur vos données personnelles :

- **Accès** : obtenir copie de vos données.
- **Rectification** : corriger des données inexactes.
- **Suppression** ("droit à l'oubli") : supprimer vos données.
- **Limitation** : restreindre temporairement le traitement.
- **Opposition** : refuser un traitement fondé sur l'intérêt légitime.
- **Portabilité** : récupérer vos données dans un format structuré.
- **Retrait du consentement** : à tout moment, sans effet rétroactif.

Pour exercer vos droits : `flotellop@gmail.com`. Réponse sous 30 jours maximum.

**Droit de réclamation** : si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la CNIL : [www.cnil.fr/fr/plaintes](https://www.cnil.fr/fr/plaintes).

## 10. Mineurs

Arty n'est pas destiné aux personnes de moins de 16 ans en France ni de moins de 13 ans dans les juridictions appliquant COPPA (États-Unis). Si vous découvrez qu'un mineur a créé un compte, écrivez-nous à `flotellop@gmail.com` et le compte sera supprimé.

## 11. Modifications de cette politique

Cette politique peut évoluer. Toute modification substantielle vous sera notifiée par email au moins **30 jours avant son entrée en vigueur**. La date de dernière mise à jour figure en tête de page. La version archivée des politiques précédentes est disponible sur demande à `flotellop@gmail.com`.
