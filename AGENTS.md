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

## Choix des petits modèles

Avant de choisir ou de promouvoir un petit modèle dans un rôle Arty, réaliser
un test de compétence avec de vrais appels au fournisseur, sur des données
synthétiques ou publiques et les paramètres prévus pour ce rôle. Figer les
cas, réponses attendues et critères avant les appels ; conserver les réponses
brutes, le modèle réellement servi, les usages et les traces d'outils.

Évaluer notamment la provenance, les citations, dates et périmètres, calculs,
unités, abstention et permissions des outils. Une erreur majeure ne peut pas
être compensée par le prix ou la rapidité. Séparer les erreurs du modèle des
défauts du banc de test ; conserver les essais initiaux et justifier toute
campagne corrective. Ne pas déduire d'un essai direct la validation du proxy,
des droits, d'Android ou de la production. Le prix et la nouveauté seuls ne
justifient jamais une migration.
