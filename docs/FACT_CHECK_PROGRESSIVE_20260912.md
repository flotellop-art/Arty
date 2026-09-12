# Vérification progressive et reprise documentaire — 12 septembre 2026

Lorsqu'une réponse contient un fait sans preuve exploitable, le contrôle peut maintenant chercher d'autres pages et relire uniquement les affirmations non résolues. Il conserve les documents initiaux, les indices des affirmations et les preuves déjà acceptées. Une contradiction, un rejet ou l'indisponibilité du contradicteur sensible ne sont pas effacés par une nouvelle recherche.

La découverte retourne seulement des URL structurées du fournisseur. Une URL, un extrait de recherche ou une réponse affirmative du modèle ne valent pas preuve : les pages sont relues et les extraits exacts sont contrôlés. Les échecs de rattachement d'une citation et de contexte ont un libellé explicite. La consigne d'extraction demande aussi les faits paraissant exacts ; une liste vide n'est plus présentée comme une certification globale.

## Budgets

- Un travail client dure au maximum 240 secondes, avec quatre lots séquentiels de 6 000 caractères au maximum. Les paragraphes sont conservés lorsque possible ; la limite de quatre lots peut donc couvrir moins de 24 000 caractères.
- Le contexte complet jusqu'à 24 000 caractères accompagne chaque lot, y compris les contrôles sensibles. Au-delà, le résultat reste partiel et aucune correction n'est appliquée automatiquement.
- Chaque palier reçoit le temps restant, plafonné côté serveur à 70 ou 125 secondes. Une seule reprise est réservée avant le premier palier profond du travail, même si sa réponse se perd. Elle peut ne pas être exécutée si le délai restant ou les quotas sont insuffisants.
- Une reprise comporte au maximum une recherche directe, deux nouvelles lectures de pages et une revue ciblée, suivie du contradicteur si une correction sensible devient soutenue. Les plafonds quotidiens existants restent inchangés et chaque étape payante est admise avant exécution.

Les réponses courtes gardent le parcours Haiku puis, si nécessaire, Sonnet. Le droit de reprise déjà réservé ne se réarme pas au lot suivant. Il ne s'agit pas d'une admission serveur idempotente entre requêtes arbitraires : les quotas serveur bornent ces dernières.

## Progression et intégrité

Le badge distingue les parties traitées, les affirmations identifiées et celles qui ont des preuves contrôlées. « Analyse terminée » signifie que le parcours prévu a fini ; cela ne transforme pas une affirmation incertaine en fait confirmé. La détection des affirmations reste une tâche de modèle et peut omettre un point. Dix affirmations dans un lot signalent toujours une couverture potentiellement limitée.

Les caractères des lots sont comptés sans recouvrement. Les résultats de lots terminés sont conservés lorsqu'un lot suivant échoue. Le badge, la sauvegarde et la synchronisation valident les mêmes compteurs. Les archives ne relancent pas de travail payant.

Une réponse est verrouillée par propriétaire, conversation et message. Les écritures intermédiaires gardent le même checkedAt ; les changements de texte, de question, de compte ou de confidentialité arrêtent les appels suivants et empêchent une écriture périmée. Cela ne garantit pas l'annulation immédiate d'un appel fournisseur déjà envoyé. Les corrections sont appliquées une seule fois sur le texte intégral inchangé, avec les protections existantes pour citations, Markdown et recopie exacte.

La vérification documentaire d'une réponse parlant d'une vidéo ne certifie pas à elle seule l'exhaustivité ou la fidélité mot à mot de sa transcription audiovisuelle.

## Validation avant livraison

226 tests ciblés passent sur 14 fichiers, ainsi que le typecheck client et Functions. Deux revues indépendantes ont challengé le code ; leurs objections sur le verrou par message et la reprise après perte de réponse ont été corrigées et testées.

Cas couverts : preuve récupérée depuis une nouvelle page, indices non consécutifs et anciens documents conservés, recherche sans page exploitable, contradiction inchangée, correctif sensible récupéré mais refusé par le contradicteur, contexte multi-lots, citation traversant deux lots, arrêt au budget, perte d'une réponse profonde, deux messages concurrents, couverture partielle et aller-retour sauvegarde/synchronisation.

Les reçus de CI, de déploiement, de signature Android et les tests réels sont conservés dans le rapport de livraison local. Les simulations valident les décisions de contrôle ; elles ne mesurent pas la justesse générale des modèles.

Un essai réel a révélé des citations recomposées avec des points de suspension. Les documents sont maintenant présentés en passages numérotés : le modèle sélectionne les passages et le serveur extrait leur texte exact. Tous les passages restent visibles pour examiner les négations et contradictions. Les anciens extraits restent acceptés uniquement lorsqu'ils sont exacts et uniques. Sur le cas public Eiffel, la reprise a finalement obtenu une preuve acceptée en 19,838 secondes (sources initiales préchargées ; découverte et nouvelles lectures réseau réelles). Cette observation isolée ne constitue pas une précision générale ni un délai garanti.
