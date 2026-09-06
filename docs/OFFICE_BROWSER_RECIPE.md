# Office — recette navigateur du 6 septembre 2026

Statut : recette locale sur candidat PR #479 ; pas un test de production,
de `main.tsx`, de Microsoft Office ni d'un téléphone physique.

## Périmètre réellement exécuté

Chrome installé, contextes vierges isolés FR 1280 px/Claude et EN 390 px/Mistral
Europe. Vrai App/router/composeur, gestion des pièces jointes, extraction,
clients fournisseurs, hooks de streaming, crypto, IndexedDB, historique et
worker d'export. Initialisation locale du compte synthétique et d'un fil vide
(marqué EU pour le second passage) ; réponses HTTP SSE synthétiques seulement.
Aucune identité Google, clé, document ou rendez-vous réel.

Les originaux synthétiques sont ceux de
`src/__tests__/helpers/office-producer-fixtures.json`, produits indépendamment
par python-docx 1.2.0 et openpyxl 3.1.5. Téléversement via le vrai input fichier,
pas insertion des pièces jointes directement dans le modèle de conversation.

## Résultats acquis

- Premier envoi de DOCX + XLSX : paragraphes, tableau Word, accents, caractères
  japonais/emoji, feuilles nommées, cellules A2/B2/B3 et feuille masquée présents
  dans le payload exact du client. Formule sans cache déclarée non calculée.
- Historique chiffré relu au redémarrage du harnais : aucune requête automatique.
  Suivi sans nouvelle pièce puis régénération explicite : mêmes textes extraits
  et fournisseur inchangé. Comparaison des textes, pas du placement du marqueur
  de cache Anthropic qui change normalement avec la longueur du fil.
- Références historiques sans `data` ; aucun base64 des originaux retrouvé
  dans les valeurs de localStorage. Pas d'outil ajouté au payload, de requête
  secondaire ni de requête de mesure ; aucune erreur JavaScript.
- Stop au clic, avec Entrée et avec Espace sur le bouton focalisé : fragment
  conservé avec `interrupted=true`, fin de l'état occupé, nouvelle tentative
  explicite réussie, tentative tardive de l'ancien SSE sans écrasement.
- Exports DOCX et XLSX depuis la dernière réponse : aperçu effectivement ouvert,
  accord demandé, vrai événement téléchargement attendu et octets sauvegardés.
  Relecture indépendante avec python-docx/openpyxl + inspection ZIP/XML : vrai
  tableau éditable, accents conservés, `0012`, grand identifiant, téléphone,
  `=HYPERLINK(...)` et `@SUM(A1)` stockés comme textes, aucun contenu actif,
  formule ou relation externe embarquée. Pas une attestation de rendu Office.
- Sur bureau : fichier DOCX corrompu → erreur précise visible, texte du
  composeur conservé, aucune requête fournisseur supplémentaire.
- Aucun débordement horizontal du document à 390 px. Les tableaux longs du
  chat restent dans leur conteneur à défilement ; l'export peut défiler
  verticalement. La version initiale de l'export reste volontairement en
  français, y compris dans l'interface EN (périmètre W05 déjà documenté).

Reçus console : FR `2026-09-06T16:49:20.904Z`, EN
`2026-09-06T16:49:28.471Z`. Harnais et captures de travail ignorés dans
`.playwright-mcp/office-{boot.ts,ui.tsx,browser.mjs,download-check.py,html}`,
`office-chat-*`, `office-export-*` et `office-downloads-*`. Le harnais refuse
toute origine autre que `http://127.0.0.1:5180` ; trafic externe bloqué.

## Défaut détecté avant fusion et prévention

Le bouton Stop passait son événement React à `stopStreaming(targetId?: string)`.
L'objet était pris pour une clé du registre : aucun arrêt. Défaut présent dans
`36d432d` avant ce lot. Deux contre-revues indépendantes confirment la cause.
Correction limitée à la frontière DOM : `onClick={() => onStop?.()}` ; l'arrêt
explicite par ID du comparateur n'est pas modifié.

`InputBar.stopStreaming.test.tsx` monte le vrai bouton et le vrai hook avec le
callback directement fourni par App. Les deux variantes default/hero échouent
sur l'annulation avant la correction et réussissent après : abort unique,
partiel sauvegardé, flux voisin intact, callbacks tardifs ignorés. Deux tests
additionnels gardent le callback facultatif. Les recettes ci-dessus attestent
également les activations clavier dans Chrome, pas un faux clic keyDown jsdom.

## Limites restantes

La préparation du compte/boot est synthétique ; le sélecteur natif Android,
le partage Capacitor, le fonctionnement sur un appareil physique, le rendu
Microsoft Office et les fournisseurs réels ne sont pas attestés. Les tests
unitaires des formats anciens/chiffrés/limites et de l'isolation ne sont pas
requalifiés en recettes navigateur supplémentaires. W01/W05 restent partiels
sur ces validations terrain ; cette recette ferme seulement leur lacune Web
locale décrite ici.
