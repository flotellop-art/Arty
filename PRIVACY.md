# Politique de confidentialité — Arty

> **BROUILLON** à relire (idéalement par un juriste) avant publication. À héberger
> sur une page web publique (ex : `https://tryarty.com/privacy`) — obligatoire pour
> la vérification OAuth Google et la fiche Play Store. Une version anglaise sera
> nécessaire pour les relecteurs Google et la fiche EN.

**Dernière mise à jour :** _(à dater à la publication)_
**Éditeur :** Florent Tellop — _(raison sociale / adresse à compléter)_
**Contact :** flotellop@gmail.com

## 1. Qui sommes-nous

Arty est un assistant IA personnel (application mobile et web). La présente
politique explique quelles données nous traitons, pourquoi, et vos droits.

## 2. Données traitées

- **Identité de connexion** : votre adresse e-mail et votre nom, via la connexion
  Google (OAuth). Nécessaire pour vous authentifier.
- **Contenu que vous fournissez** : vos messages, fichiers et pièces jointes
  envoyés à l'assistant.
- **Données Google Workspace que vous autorisez** : selon les fonctionnalités que
  vous utilisez et les autorisations que vous accordez — envoi d'e-mails (Gmail),
  lecture et création d'événements (Agenda), accès à vos contacts. L'accès se fait
  **uniquement sur votre demande explicite** dans l'application.
- **Position** : uniquement si vous activez la localisation, pour les réponses
  géolocalisées. Désactivable à tout moment.
- **Données de paiement** : gérées par notre prestataire Lemon Squeezy ; nous ne
  stockons pas vos coordonnées bancaires.

Nous ne traçons pas votre navigation à des fins publicitaires et n'utilisons pas
de profilage commercial.

## 3. Comment nous utilisons ces données

- Fournir le service (répondre, résumer, rédiger, gérer agenda/contacts/e-mails
  sur votre demande).
- Pour générer les réponses, votre contenu est transmis à des **fournisseurs de
  modèles d'IA** (voir section 4), strictement pour traiter votre requête.

## 4. Partage avec des tiers

Votre contenu peut être transmis, **uniquement pour traiter votre demande**, à :
- **Fournisseurs d'IA** : Anthropic, OpenAI, Google, Mistral (selon le modèle
  choisi ou le routage).
- **Cloudflare** : hébergement et relais technique des requêtes.
- **Lemon Squeezy** : traitement des paiements.

Nous ne **vendons pas** vos données et ne les partageons pas à des fins
publicitaires.

## 5. Conformité Google API (Limited Use)

L'utilisation par Arty des données reçues des API Google, et leur transfert vers
toute autre application, respectent la
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
y compris les exigences **Limited Use**. En particulier :
- l'accès à vos données Google se fait uniquement pour vous fournir les
  fonctionnalités que vous demandez ;
- nous n'utilisons pas ces données à des fins publicitaires ;
- nous ne les vendons pas ;
- nous ne les utilisons pas pour entraîner des modèles d'IA généralistes ;
- l'accès humain à ces données est interdit, sauf accord explicite de votre part,
  pour des raisons de sécurité, ou si la loi l'exige.

## 6. Sécurité

- **Chiffrement au repos** : vos conversations et vos clés API personnelles (BYOK)
  sont chiffrées en AES-256 (Web Crypto API) sur votre appareil.
- **Chiffrement en transit** : toutes les communications passent par HTTPS.
- Les clés API serveur ne sont jamais exposées dans l'application.

## 7. Conservation et suppression

- Le contenu transmis aux fournisseurs d'IA n'est pas conservé sur nos serveurs
  au-delà du traitement de la requête.
- Vous pouvez supprimer vos données à tout moment via la **déconnexion +
  effacement** dans l'application (efface les données locales et révoque l'accès).

## 8. Vos droits

Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, de
suppression et de portabilité. Contact : flotellop@gmail.com.

## 9. Mineurs

Arty n'est pas destiné aux personnes de moins de 16 ans.

## 10. Modifications

Cette politique peut évoluer ; la date de dernière mise à jour figure en tête.
