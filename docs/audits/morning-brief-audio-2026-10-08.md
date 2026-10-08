# Brief vocal : correction du lecteur, 8 octobre 2026

## Défaut et correction

Après une réponse TTS réussie, `setAudioUrl(url)` provoquait un rendu React.
Le nettoyage de l'ancien effet dépendant de cette URL lisait la ref mutable
du lecteur et arrêtait le nouvel audio en vidant sa source. Le même cycle
pouvait aussi provoquer une erreur après une fin normale de lecture.

L'audio et son URL sont désormais possédés par des refs, libérés à l'arrêt,
à la fin, à l'erreur, à l'invalidation du compte et au démontage. La ref est
détachée avant les événements provoqués par ce nettoyage. Les événements et
rejets tardifs d'un ancien lecteur ne modifient plus le lecteur actif.
L'admission synchrone évite deux générations lors de clics rapides avant
la résolution du token. Une réponse tardive après changement de compte
conserve le message demandant de rouvrir le brief.

La voix utilise OpenAI `tts-1`. Ce défaut préexistait à la migration Haïku :
aucun changement du service vocal, de son authentification ou de ses quotas
n'a été nécessaire. La capture seule ne permet pas d'exclure un autre
incident réseau, serveur ou média sur le téléphone.

## Validation du correctif

- Deux contre-revues indépendantes, en lecture seule : lecteur/Android et
  backend/admission. Les objections de concurrence et d'invalidation ont
  été intégrées.
- Avant correction : 6 échecs et 2 succès sur les 8 premiers tests du lecteur,
  notamment la source vide immédiatement après la réponse audio réussie.
- Après correction : 21 tests ciblés passent, dont 16 tests du composant,
  les contrôles de contexte agenda et le coût TTS. Couverture de première
  lecture, StrictMode, pause/reprise, fin, ancien lecteur, fermeture,
  démontage, compte invalide, réponse tardive, erreur média, rejets de
  lecture, erreurs HTTP et double clic.
- Chromium avec le véritable `HTMLAudioElement` et un WAV synthétique de
  quatre secondes : ancien composant, source effacée ; nouveau composant,
  décodage et progression du temps, pause/reprise, fin naturelle sans erreur,
  une seule requête et une seule révocation d'URL. Les limites service sont
  simulées : aucun appel fournisseur ni donnée personnelle.
- Aucun appareil ADB accessible au moment de cette validation. Lecture MP3
  réelle et confirmation sur le téléphone non établies par ces tests.

Les traces locales sont conservées dans `.playwright-mcp/brief-audio-*`
(ignoré par Git). Version de livraison : **1.0.113**, Android **114**.
