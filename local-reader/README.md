# Lecteur local Arty — PC, version 0.1

Ce lecteur récupère le titre et le texte du post Reddit **déjà affiché dans votre navigateur**, après votre clic. Il utilise le moteur de Chrome ou Edge, avec un extracteur et une interface propres à Arty. Il ne recrée pas le moteur Chromium.

## Installer une fois

1. Décompressez `arty-local-reader.zip` dans un dossier que vous conserverez.
2. Dans Chrome, ouvrez `chrome://extensions` ; dans Edge, `edge://extensions`.
3. Activez **Mode développeur**, puis **Charger l’extension non empaquetée**.
4. Choisissez le dossier qui contient `manifest.json`.
5. Épinglez **Lecteur local Arty** dans les extensions du navigateur.

## Lire et utiliser dans Arty

1. Ouvrez le post Reddit et attendez que son texte s’affiche.
2. Cliquez sur l’extension, puis **Lire le post de cet onglet**.
3. Vérifiez le titre et le texte dans l’aperçu. Cliquez sur **Enregistrer le fichier pour Arty**.
4. Dans Arty, ajoutez le fichier `reddit-<identifiant>.txt` avec le bouton **+**.
5. Copiez la demande proposée par le lecteur et cliquez vous-même sur **Envoyer**.

Demande proposée : « Résume la publication contenue dans le fichier joint. Appuie-toi sur le texte joint et distingue le témoignage de son auteur des faits établis. »

Joignez le fichier plutôt que le seul lien : Arty dispose ainsi du texte lu localement et n’a pas à obtenir de nouveau ce post par son lecteur distant. L’analyse dans Arty utilise ensuite ses fournisseurs et ses règles habituels ; elle nécessite une session Arty valide.

## Périmètre et données

- Premier lot : posts texte sur `reddit.com` et `www.reddit.com`, sur PC. Pas Android, pas tous les sites, pas les interfaces `old.reddit.com`.
- Le lecteur lit le texte rendu dans la page, sans faire défiler l’écran. Il refuse un corps absent, masqué par les styles contrôlés ou flouté ; il ne déverrouille pas les pages de connexion ou de sécurité. Il ne certifie pas que chaque ligne est visible à l’écran : un texte peut être hors de la fenêtre ou coupé par son conteneur.
- Il prend uniquement le titre et le corps textuel du post correspondant à l’URL. Les commentaires, images, vidéos et barres latérales sont exclus. Les posts supprimés ou sans texte sont refusés.
- Le texte est celui que Reddit affiche, éventuellement traduit. La traduction et la connexion Reddit ne sont pas certifiées par le lecteur.
- Limites : titre de 1 000 caractères et corps de 100 000 caractères. Au-delà, refus explicite, sans troncature silencieuse.
- Permissions : `activeTab` et `scripting`. Lecture ponctuelle de l’onglet choisi après un clic ; aucun cookie, historique ou mot de passe extrait. Pas de serveur, suivi, stockage permanent dans l’extension ou envoi automatique à l’IA.
- Fermer le popup efface son aperçu. Le fichier exporté reste dans vos téléchargements jusqu’à ce que vous le supprimiez. Il contient le texte du post et son URL, sans paramètres ni fragment.
- Le fichier est une capture locale modifiable, pas une preuve certifiée des affirmations de l’auteur.

## Validation

Les tests du dossier vérifient l’extraction et les refus, la sélection du cadre principal, la navigation concurrente et la lecture UTF-8 du fichier par les builders Arty. Une lecture sur le vrai DOM Reddit valide l’extracteur seulement : elle ne prouve pas à elle seule l’installation, les permissions ni le téléchargement dans Chrome/Edge.

Depuis la racine du dépôt : `npx vitest run local-reader --maxWorkers=1`.
Pour empaqueter : `node scripts/package-local-reader.mjs <chemin-du-zip>`.
