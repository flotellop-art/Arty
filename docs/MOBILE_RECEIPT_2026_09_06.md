# Recette téléphone réel — 6 septembre 2026

Autorisation explicite : téléphone branché pour vérifier l'app mobile.
Contrôle de 17:28 à 17:34 UTC par ADB standard sur `com.arty.app`, sans
réinstallation, désinstallation, effacement, nouveau consentement OAuth
ni changement de réglage Android.

## Artefact testé

- Téléphone CPH2609, appareil USB autorisé, pas un émulateur.
- Package `com.arty.app`, version 1.0.99, code 100.
- Mise à jour affichée : 6 septembre à 13:36:31, horloge appareil.
- APK installé copié en lecture seule : 4 355 881 octets, SHA-256
  `25bee301b28fc8472014d95b50d7dfca89eb84d64e366558fd411ec0bee533ee`.
- Empreinte différente de la livraison #479 (`441cbbae…`) : le même numéro de
  version ne prouve pas sa présence. Commit exact/signature non attestés ici.

## Constats et limites

1. Ouverture Arty, menu latéral, paramètres, fermeture, défilement et ouverture
   d'une conversation : réussis par interaction sur le téléphone.
2. Options de conversation : **VIP** affiché ; Auto/Claude/Mistral/Gemini/ChatGPT
   présents. Cela atteste l'affichage sur cet APK, pas chaque routage ou quota.
3. Envoi tactile de « Test technique Arty. Sans outil ni donnee personnelle,
   reponds exactement: TEST MOBILE OK. » ; réponse complète **TEST MOBILE OK.**,
   sans erreur d'authentification affichée. Clavier et envoi fonctionnels.
4. Footer « Recherche Web · US » observé : sans trace réseau, il ne prouve ni
   recherche Web, ni modèle exact, ni coût.

La conversation de test est conservée (titre automatique « Test technique… »).
Aucun agenda/contact/mail consulté intentionnellement, aucun outil demandé.
Cela ne prouve pas l'absence de requêtes secondaires internes : le transport
du téléphone n'a pas été inspecté. Captures et APK privés sous
`.playwright-mcp/arty-mobile-*`, ignorés de Git ; ne pas publier ces images.

Cette recette ne valide pas le correctif Offres/VIP en cours, un achat,
renouvellement/crédit, Office natif, restauration/synchronisation ou comparateur
complet. Après livraison, identifier l'APK exact, conserver les données puis
retester statut, arrière-plan/premier plan, scroll/retour et courte réponse.
Ne pas révoquer le compte réel pour une simulation : tester ces courses isolément.
