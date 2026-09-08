# Instructions des agents

## Challenge contradictoire obligatoire

Pour toute tâche non triviale qui touche au code, à l'architecture, à la
sécurité, au routage, à la facturation, aux données ou au déploiement :

1. lancer au moins deux agents indépendants en lecture seule avant de finaliser
   l'implémentation ;
2. leur demander explicitement de challenger le diagnostic, de chercher les
   hypothèses fausses, régressions et cas limites, et de citer les fichiers et
   lignes concernés ;
3. leur confier des angles différents et utiles (par exemple correction du
   code, sécurité, produit, mobile ou stratégie de tests) ;
4. ne pas leur déléguer de modification de fichiers, sauf demande explicite de
   l'utilisateur ;
5. examiner leurs objections avant de coder ou de conclure, puis intégrer les
   retours pertinents ou expliquer pourquoi ils sont écartés.

Les réponses informatives, changements purement éditoriaux et corrections
triviales sont exemptés. Dès qu'un doute existe sur le caractère trivial d'une
tâche, appliquer le challenge contradictoire.

## Prévenir les boucles de travail autonome

Pour les procédures récurrentes, automatisations fragiles ou échecs répétés,
consulter le skill `fiabiliser-procedures`. Ne pas le charger pour une demande
simple sans difficulté.

### Mission et critère de fin

- Travailler sur un seul résultat vérifiable à la fois, avec un périmètre et
  un critère de fin explicites. Un objectif général comme « améliorer Arty »
  doit être découpé en missions finies, sans déclarer l'objectif global atteint
  lorsqu'un seul lot est terminé.
- Consigner les défauts découverts hors périmètre pour une mission ultérieure,
  sauf s'ils empêchent directement le résultat en cours. Ne pas ouvrir de
  nouveau chantier pour contourner l'attente d'une validation externe.
- Respecter les limites de temps ou de consommation fixées par l'utilisateur.
  Ne pas confondre une limite inscrite dans un texte avec une limite technique
  effectivement configurée dans l'application.

### Reprise et preuve de progrès

- Une demande déjà satisfaite reste satisfaite. Une continuation automatique
  n'est pas une nouvelle demande utilisateur : ne pas refaire un plan, un bilan
  ou une explication déjà fournis sans demande nouvelle ou changement matériel.
- Conserver un seul point de reprise courant pour la mission : dossier et
  branche, candidat exact, résultat attendu, changements depuis la dernière
  reprise, validations acquises, blocage éventuel et prochaine action utile.
  Référencer les preuves existantes plutôt que recopier tout l'historique.
- À chaque reprise, distinguer progrès concret, attente vérifiée et absence
  de progrès. Une reformulation, une relecture identique ou une nouvelle
  contre-revue sans changement ne constituent pas un progrès.
- Chaque nouvel essai doit exploiter une observation nouvelle ou tester une
  hypothèse différente. Après deux tentatives successives sans information
  nouvelle sur le même blocage, arrêter les essais sur ce point et présenter
  le blocage ainsi que la décision nécessaire. Ne pas poursuivre des tâches
  périphériques uniquement pour maintenir l'activité.

### Validations proportionnées et intégration

- Identifier la branche de livraison et le candidat exact avant une campagne
  complète. Éviter de mélanger des lots indépendants non publiés dans une
  branche dont l'extraction imposerait ensuite de refaire toutes les validations.
- Conserver les validations acquises pour le candidat testé. Répéter un contrôle
  seulement si un changement peut affecter son résultat, si le résultat précédent
  est inexploitable ou si une nouvelle observation le justifie ; préciser pourquoi.
- Ne pas relancer une campagne encore active. Conserver les réglages d'exécution
  déjà nécessaires à sa fiabilité, notamment la concurrence des tests. Un échec
  d'infrastructure n'est ni une preuve de défaut du produit ni un test réussi.
- Les deux contre-revues obligatoires restent applicables aux changements non
  triviaux. Ne pas les répéter pour chaque bilan ou modification documentaire
  sans changement matériel. Ces règles ne dispensent pas des contrôles requis
  pour livrer le candidat exact ni des vérifications financières et de sécurité.

### Fin de mission et arrêt demandé

- À la fin, fournir un bilan court : résultat obtenu, validations, éléments non
  livrés et intervention éventuellement nécessaire. Ne pas recréer le plan général.
- Sur demande d'arrêt, interrompre proprement le travail et les sous-agents
  contrôlés, préserver les changements et ne pas terminer un nouveau lot avant
  de s'arrêter. Ne reprendre que sur nouvelle instruction explicite de l'utilisateur.
- Distinguer arrêt du travail et pause technique de l'objectif automatique.
  Vérifier la pause lorsqu'un outil autorisé la permet ; sinon signaler la limite
  et l'intervention nécessaire. Ne pas prétendre que les relances sont désactivées
  sans preuve et ne pas marquer un objectif incomplet comme atteint pour les arrêter.
