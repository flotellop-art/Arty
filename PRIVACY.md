# Politique de confidentialité — Arty

**Dernière mise à jour :** 22 mai 2026

**Éditeur :** Florent Pollet, personne physique, domicilié 884 chemin de la Prairie, 38270 Beaufort, France. Aucune entreprise n'est immatriculée à ce jour ; un SIREN sera ajouté à cette politique dès l'enregistrement de l'activité, prévu avant le lancement public et les premiers paiements.
**Contact :** flotellop@gmail.com

Arty est un assistant IA personnel (application mobile Android et application web `tryarty.com`). La présente politique explique quelles données personnelles nous traitons, à quelles fins, sur quelles bases légales, à qui nous les transmettons, combien de temps nous les conservons, et quels sont vos droits.

## 1. Responsable de traitement

Le responsable de traitement au sens du RGPD est Florent Pollet, personne physique (coordonnées ci-dessus). Aucun délégué à la protection des données (DPO) n'est désigné, car l'activité ne remplit pas les critères de l'article 37 RGPD.

## 2. Données que nous traitons

| Catégorie | Données | Source |
|---|---|---|
| Identité de connexion | Email, nom complet, photo de profil | Connexion Google (OAuth) |
| Contenu utilisateur | Messages, fichiers et pièces jointes envoyés à l'assistant | Vous |
| Données Google Workspace | Selon les fonctionnalités utilisées : envoi d'emails (Gmail), lecture et création d'événements (Calendar), contacts (Contacts) | Vos comptes Google, sur votre demande explicite |
| Localisation | Position géographique approximative | Capteur GPS de votre appareil, uniquement si activé |
| Données de paiement | Email + transaction, sans coordonnées bancaires | Vous + Lemon Squeezy |
| Inscription waitlist | Email (pré-lancement uniquement) | Formulaire Tally |

Nous ne traçons pas votre navigation à des fins publicitaires et n'utilisons aucun profilage commercial.

## 3. Finalités et bases légales

| Finalité | Base légale (RGPD article 6) |
|---|---|
| Authentification et fourniture du service (compte, conversations, IA, connecteurs Google) | Exécution du contrat — vos conditions d'utilisation |
| Réponses géolocalisées | Consentement explicite (vous activez la localisation) |
| Paiements (abonnement Pro) | Exécution du contrat + obligation légale comptable |
| Lutte contre la fraude et sécurité du service (logs techniques, kill-switch chiffrement) | Intérêt légitime |
| Communication pré-lancement (waitlist) | Consentement (inscription volontaire au formulaire) |

## 4. Partage avec des tiers (sous-traitants au sens RGPD article 28)

Vos données sont transmises, **uniquement pour les finalités ci-dessus**, aux prestataires suivants :

| Prestataire | Rôle | Localisation | Garantie |
|---|---|---|---|
| Cloudflare | Hébergement Workers, Pages, KV (proxy API, stockage clés non sensibles, distribution du site) | UE + monde (CDN) | Standard Contractual Clauses (SCC), DPA Cloudflare |
| Anthropic (Claude) | Génération de réponses IA | États-Unis | SCC + EU-US Data Privacy Framework |
| OpenAI | Génération de réponses IA (selon le modèle choisi) | États-Unis | SCC + EU-US Data Privacy Framework |
| Google (Gemini + Workspace) | Génération de réponses IA + connecteurs Gmail/Calendar/Contacts | UE + États-Unis | SCC + EU-US Data Privacy Framework |
| Mistral AI | Génération de réponses IA | France (UE) | Hébergement UE direct |
| Lemon Squeezy (Stripe) | Traitement des paiements abonnement Pro | États-Unis | SCC + EU-US Data Privacy Framework, gestion PCI-DSS |
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

- **Chiffrement au repos sur l'appareil** : vos conversations et vos pièces jointes (IndexedDB) sont chiffrées en AES-256-GCM via la Web Crypto API. La clé de chiffrement est dérivée localement et ne quitte jamais votre appareil.
- **Clés API personnelles (BYOK)** : stockées uniquement sur votre appareil (stockage local protégé par l'isolation du système). Elles transitent par nos serveurs uniquement pour relayer vos requêtes vers l'API du fournisseur, sans jamais y être stockées ni journalisées.
- **Chiffrement en transit** : toutes les communications utilisent HTTPS (TLS 1.2+).
- **Serveur** : nous ne stockons côté serveur que l'email d'authentification et le jeton OAuth Google nécessaire à la fourniture du service. Les conversations, pièces jointes et clés API ne sont jamais stockées sur nos serveurs.
- **Clés API serveur** : jamais exposées dans l'application cliente. Stockées en secrets Cloudflare Workers.

## 7. Stockage local sur votre appareil

Pour fonctionner, l'application stocke localement (sur votre appareil, jamais stocké côté serveur) :

- **localStorage** : préférences (langue, onboarding, plan), identifiant d'appareil non personnel, hash de votre email pour la reconnexion, clés API personnelles BYOK, état trial.
- **sessionStorage** : état OAuth Google (protection CSRF), messages d'erreur transitoires.
- **IndexedDB** : pièces jointes (images, PDFs) chiffrées AES-256.

Ces stockages sont **strictement nécessaires au service** au sens de l'article 82 de la loi Informatique et Libertés (transposition de la directive ePrivacy) — leur consentement n'est donc pas requis.

Nous n'utilisons **aucun cookie** de tracking ni d'analyse. Le chargement des polices d'écriture peut entraîner des requêtes vers `fonts.googleapis.com` (Google Fonts), susceptibles de poser un cookie tiers de session lié à Google ; nous prévoyons de basculer en auto-hébergement de ces polices avant le lancement public.

## 8. Conservation des données

| Catégorie | Durée |
|---|---|
| Compte (email + jeton OAuth) | Tant que votre compte est actif. Suppression sous 30 jours après votre demande de suppression. |
| Conversations et pièces jointes | Stockées uniquement sur votre appareil. Effacées par "déconnexion + effacement" dans l'application. |
| Données de paiement | 10 ans (obligation légale comptable, article L123-22 Code de commerce). |
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
