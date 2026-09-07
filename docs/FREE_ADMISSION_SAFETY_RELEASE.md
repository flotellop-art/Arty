# Admission gratuite vérifiée — lot candidat du 7 septembre 2026

Statut : **local, non livré**. Base publique `db6249d` (#490), branche
`codex/trial-admission-safety-20260907`. Aucune migration, donnée personnelle,
clé, configuration fournisseur ou identité d'autorisation modifiée.

Ce lot contribue à [FREE_TRIAL_ABUSE_CDC.md](FREE_TRIAL_ABUSE_CDC.md).
**Il ne ferme ni le multi-compte/VPN ni le budget global de dépense.**
Les critères de ce CDC restent obligatoires pour terminer l'objectif.

## Changement observable

Arty ne lance plus d'appel IA financé par l'essai si le droit ou son compteur
ne peut pas être confirmé. Réponse 503 `admission_unavailable`, non cachable,
reprise proposée après 30 secondes ; ce délai est une indication, pas une
promesse de rétablissement. Pas de faux essai épuisé, de reconnexion imposée,
de compteur restant inventé ou de bascule sur les crédits achetés.

Les quatre clients texte traduisent le refus en français/anglais, sans
rejouer automatiquement cet appel (y compris le repli recherche Mistral).
Les autres erreurs fournisseur conservent leurs politiques de retry existantes.

## Portée technique

- Google et OTP : compteurs et identités toujours disjoints. Une panne de
  lecture des droits n'est plus une preuve d'éligibilité Free ; une panne de
  session n'est pas une identité invalide. VIP whitelist et BYOK restent
  séparés. Seul le wrapper historique d'affichage peut conserver un repli Free.
- Essai : UPSERT atomique, entier entre 0 et 30 exigé avant mutation, résultat
  confirmé exigé avant autorisation. Compteur corrompu inchangé et refusé,
  y compris lors d'une compensation. Aucun replay SQL aveugle.
- Deadline de l'incrément : 250 ms. Si l'enregistrement `waitUntil` réussit,
  refus à cette deadline et compensation du seul débit tardif prouvé. Sans
  `waitUntil`, attente de l'issue réelle avant toute admission ; si son
  enregistrement échoue, attente de la compensation avant le refus.
  Ni l'authentification, ni
  la création des tables, ni toutes les lectures ne sont bornées par 250 ms.
- Free Haiku, TTS, outils web/URL/géographie et extraction de mémoire : les
  admissions subventionnées refusent aussi une panne/latence/corruption.
  Leurs quotas journaliers comptent les **tentatives** : une écriture tardive
  peut rester comptée sans fournisseur. Ce n'est pas un débit de crédits et
  ce n'est pas la politique remboursable des 30 messages d'essai.
- Images : lecture du plan sans consommer un message pour une modalité
  interdite à l'essai. Whisper/Voxtral : droits illisibles deviennent 503.
- Primitives wallet et quotas payants inchangées. L'indisponibilité n'est
  jamais incluse dans `trial_expired` et ne possède pas `trialDebited`.

## Recette locale

Deux contre-revues indépendantes, en lecture seule, avant et après le code.
Objections intégrées : droits avant wallet/Free, sessions OTP, images sans
débit, cinq consommateurs, remboursements sans réparation des compteurs,
annulation vision, services annexes et repli Mistral.

Preuves déjà obtenues, sans fournisseur réel ni écriture financière distante :

- Test initial des pannes : 9 échecs reproduits, puis 9 réussites.
- Essai D1 réel : corruption non mutée, première unité, deux requêtes sur
  la dernière unité, namespaces séparés. Horloge simulée : 249/250 ms,
  succès/refus/erreur tardifs, compensation unique, contexte fermé.
- Première matrice texte corrigée : 107 tests réussis avec identité/proxys
  et régressions vision existantes. Fixtures utilisent les modèles autorisés
  réels, sans changer le catalogue pour faire passer les tests.
- Services annexes sur D1 réel : 14 tests erreur/écriture lente réussis.
- Corruption entre débit et compensation : 8 canaris réussis, deux tables.
- Vision croisée quota/annulation : 4 canaris réussis ; zéro fournisseur avant
  et après refus, autre débit préservé, un remboursement, permis réutilisable.
  Le faux fournisseur lit réellement le flux envoyé. Aucun délai métier élargi.
- Lot de six suites de régression : 85 tests réussis, incluant clients
  FR/EN et conservation des retries des véritables pannes fournisseur.

Première exécution complète locale `npm run verify` : types et contrôles Google
réussis ; 5 175 tests réussis, trois échecs dans `audValidation.test.ts`, un test
préexistant ignoré (700,65 s pour les tests). Les trois fixtures attendaient
encore Free lorsque D1 était absente. Elles utilisent désormais une base lisible
vide pour confirmer Free ; quatre canaris supplémentaires imposent le refus
avec une audience valide mais sans D1. Les audiences étrangères restent refusées
avant toute lecture de droits. Recontrôle ciblé : **38/38 tests réussis**.
Les assertions des 14 cas annexes tardifs, renforcées après le début de la suite
complète, ont aussi été exécutées séparément avec succès.

Cette première exécution n'est **pas** un `verify` réussi : elle s'est arrêtée
avant la compilation et le contrôle du worker Office. La preuve complète sur
l'état final sera exigée en CI Node 22 avant fusion. Pas encore de
CI/preview/déploiement ou recette téléphone de ce lot.

Recontrôle local séparé après correction des fixtures : `npm run typecheck`,
`npm run build` et `node scripts/check-office-export-worker.mjs` réussis. Le
worker compilé est exécuté en VM isolée et régénère les exports synthétiques ;
cela ne vaut pas une inspection visuelle ou un test Office natif.

## Porte de livraison et retour arrière

- [ ] CI Node 22 `npm run verify` : types, tests et couverture, compilation,
  worker Office. L'exécution locale initiale utilisait Node 24.14.1 et
  `VITEST_MAX_WORKERS=2` pour borner les connexions Miniflare sur Windows ;
  son résultat partiel ne remplace pas cette porte de fusion.
- [x] Deux contre-revues indépendantes du code et examen de leurs objections.
- [x] Aucun schéma, secret, catalogue, tarif ou indicateur d'activation modifié.
- [ ] Branche publique issue directement de `db6249d`, diff autorisé uniquement,
  CI et preview conformes avant fusion normale ; pas d'exception administrateur.
- [ ] Production : SHA publié relié au déploiement, version publique/immuable
  identique, refus anonyme et absence de régression des garde-fous existants.
- [ ] Observation de 15 minutes après production. Les sondes publiques ne
  remplacent pas une mesure globale des erreurs ni une recette compte réel.

En cas de nouvelle panne d'accès confirmée pour un droit valide, de dépense
malgré refus, de double compensation ou de différence de version entre domaines,
suspendre la clôture et diagnostiquer immédiatement. Le précédent déploiement
`58b73683-a4b2-4f10-a964-5859a34e6cc2` (#490, `db6249d`) est la référence de
retour arrière sans migration. Ce retour rétablirait aussi l'ancienne politique
d'admission permissive sur panne : ne pas le présenter comme une protection
anti-abus et ne pas supprimer de compteurs pour rétablir le service.

[Documentation Cloudflare : livraisons Git et previews](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).

## Limites non résolues

Compensation best-effort, pas de journal durable garantissant une restitution
après crash. Pas de preuve d'unicité humaine, de protection effective contre
plusieurs nouveaux comptes, de plafond financier global ni de budgets
fournisseur actifs. Aucun nouveau signal personnel collecté, aucune interdiction
générale des VPN, aucun changement du nombre de messages offerts.
