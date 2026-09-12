# Fact-checking : équilibre entre délai et preuves

Le parcours conserve la première passe Haiku et l'escalade Auto existantes. Les appels Sonnet de vérification et de lecture documentaire utilisent désormais une réflexion adaptative avec effort moyen explicite. La recherche web est directe, limitée à trois recherches par requête. Le contradicteur Sonnet indépendant pour les corrections sensibles conserve un effort élevé.

Les limites restent en place : échéance commune de 70 secondes pour Haiku ou 125 pour le contrôle approfondi, limites de corps fournisseur, quotas de fond, lecture de sources, extrait exact, contexte et contestation indépendante des corrections sensibles. Une exception du secours Anthropic permet maintenant d'atteindre Gemini sans réinitialiser l'échéance.

Les préambules de recherche sont séparés du dernier bloc de verdict JSON strict. Les champs de correction sont ignorés pour `verified` et `uncertain`, conformément au contrat partagé ; les corrections `wrong` invalides, sorties tronquées et nombres de claims ne sont pas réparés artificiellement. Le statut de fin du fournisseur reste indépendant du nettoyage de forme.

## Validation

- 147 tests ciblés passent avec le typecheck client et Functions, dont double timeout puis Gemini, échéance épuisée, sources directes, limite de taille, sortie incomplète, bloc final tronqué, champs vides et contestation indépendante conservée.
- Deux revues indépendantes en lecture seule ont challengé le code et les mesures. Leurs objections sur le délai, les limites de taille, les contrôles sensibles et la normalisation ont été examinées.
- Une première sonde de cinq réponses publiques a révélé des incompatibilités de forme. Elle ne constitue pas une validation de qualité. Une seconde vague borne le bloc sources à 8 000 caractères comme le serveur et exécute le vrai vérificateur documentaire sur les pages capturées par Linkup, avec une revue Sonnet réelle.

| Cas de la seconde vague | Résultat | Génération et revue |
| --- | --- | ---: |
| Hauteur Eiffel 2022 erronée | Correction proposée juste ; extrait refusé, donc correction bloquée | 9,529 s |
| Hauteur Eiffel 2000 correcte | Valeur historique préservée ; preuve acceptée | 6,136 s |
| Vitesse de la lumière, unité erronée | Correction juste ; preuve acceptée | 6,725 s |
| Vitesse de la lumière, approximation correcte | Approximation préservée ; preuve acceptée | 6,969 s |
| Page officielle contradictoire sur 1949 | Ambiguïté conservée ; aucune accusation injustifiée contre Jamy | 12,868 s |

Les huit extraits acceptés ont été recoupés avec les pages figées et leurs empreintes. Aucun faux correctif observé sur ces cinq cas ; quatre dossiers ont des preuves acceptées. Le cinquième reste volontairement partiel. Ces durées excluent Haiku, l'admission, le téléphone et les lectures réseau de pages déjà figées. Une observation par cas n'établit pas une précision générale ou un délai garanti. La production peut sélectionner d'autres pages parmi les sources découvertes.

Les tests de protocole couvrent le refus d'une correction sensible sans contradicteur accepté ; cette campagne publique n'évalue pas la compétence réelle sur des conseils médicaux, juridiques ou financiers. Une omission totale de claims peut encore arrêter la première passe ; cette limite préexistante n'est pas présentée comme résolue.

Sources publiques du corpus : [tour Eiffel](https://www.toureiffel.paris/fr/actualites/histoire-et-culture/de-300-330-metres-lhistoire-de-la-taille-de-la-tour), [BIPM](https://www.bipm.org/en/si-base-units/metre). Les résultats locaux détaillés sont conservés dans `artifacts/balanced-quality-results.jsonl` et `artifacts/balanced-quality-sources.json`, hors publication.
