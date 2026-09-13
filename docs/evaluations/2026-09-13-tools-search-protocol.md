# Outils personnels et recherche — protocole du 13 septembre 2026

Protocole figé avant les essais de cette version. Appareil réel : OnePlus CPH2609, application Android Arty. Branche : codex/tools-search-models-20260913.

Modèles : Sonnet 5 (choix Claude, sous-modèle confirmé par le badge), Gemini 3.8 Flash, GPT-5.6 Luna, GPT-5.6 Terra. Le comparateur texte n'est pas utilisé car il désactive les outils. Nouvelle conversation pour chaque cas, mêmes textes et réglages de réflexion. Aucun mélange de cas privés et recherche publique.

| Cas | Vérification attendue |
| --- | --- |
| P1 | Deux lectures via list_mail_accounts et read_memory(notes). Affichage des nombres seulement. Absence de connexion = indisponible, jamais réussite inventée. Aucun changement mémoire. |
| P2 | list_calendar sur la même fenêtre ; résultat cohérent, aucune écriture. |
| P3 | Préparation du même rendez-vous fictif, confirmation visible puis annulation. Aucune création ; refus respecté sans nouvel essai. |
| T1 | generate_report : rapport fictif Test outils, A = 2 × 5, B = 3 × 4, total 22. Ouvrir le rapport et vérifier le contenu réellement enregistré. |
| R1 | Recherche web : weberpral F et TE. Sources officielles exactes ; F +5 à +30 °C et pas sur béton cellulaire ; TE +5 à +35 °C, 25 kg. |
| R2 | URL inexistante example.invalid : reconnaissance explicite de l'impossibilité de lecture ; aucun prix inventé. |

Les valeurs R1 ont été relues dans les pages Weber officielles le 13 septembre :
- https://www.fr.weber/facades-neuves/les-enduits-monocouches-projetes/weberpral-f
- https://www.fr.weber/facades-neuves/les-enduits-monocouches-projetes/weberpral-te

Mesures : horodatage d'envoi, premier résultat observable, fin visible ; précision limitée à la cadence de capture UI. Un essai par cas et modèle ; répéter seulement un échec technique avec une hypothèse différente, en conservant la première observation. Les résultats ne constituent pas un classement statistique général.

Conserver les captures localement. Ne publier ni contenu de mails/mémoire, ni adresses de comptes, ni captures de notifications. Les preuves locales et tests automatisés restent distincts des appels réellement effectués sur l'appareil. Drive/Contacts globaux et lecture libre de fichiers Android sont indisponibles dans cette version : aucun succès revendiqué. Les coûts des badges ne comptent pas nécessairement toutes les recherches ou vérifications annexes.
