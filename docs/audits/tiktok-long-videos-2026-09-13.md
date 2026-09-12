# TikTok : extension à dix minutes — Arty 1.0.104

## Déclencheur et résultat

Le lien partagé `https://vm.tiktok.com/ZN8jShEjq/` annonce 274 secondes et
32 614 135 octets lors de la mesure publique du 13 septembre, depuis le PC.
Il dépassait donc les deux limites précédentes : 180 secondes et 24 Mio.

Le parcours accepte désormais jusqu'à 600 secondes et 128 Mio lorsque la
longueur du média est fournie. Le fichier entier est transmis à Gemini Files,
sans réduction de qualité ni découpage silencieux. La durée du fichier traité
doit respecter le plafond et correspondre à celle annoncée, à deux secondes près.

## Contraintes conservées

- Transfert avec backpressure, validation MP4 et comptage exact jusqu'à EOF.
  `FixedLengthStream` assure un Content-Length effectif sous workerd.
- En l'absence de longueur exploitable, le fallback bufferisé reste limité à
  24 Mio. Le plafond de 128 Mio ne doit jamais lui être appliqué.
- Délais : préparation 90 s, serveur 180 s, client 195 s. L'attente des en-têtes
  de génération est bornée à 80 s ; l'inactivité et le délai global s'appliquent
  ensuite. Un APK ancien garde ses délais précédents.
- Les erreurs de source arrêtent aussi l'upload. Aucun retry après un envoi
  ambigu. La suppression du fichier Google possédé reste enregistrée avant
  création. Stop ignore tout résultat tardif ; il ne garantit pas l'annulation
  d'un calcul déjà engagé chez un fournisseur.
- Réservation wallet minimale de 256 000 tokens d'entrée, définie par le serveur,
  plus 8 192 tokens de sortie, au tarif conservateur Gemini 3.5. C'est une
  estimation de réserve, pas le coût effectivement débité. Règlement sur usage
  réel, règles d'essai, quotas et restrictions de modèles conservés.
- Observation à une image/seconde et résumé borné à 2 400 mots. Cela ne prouve
  ni une transcription exhaustive, ni la détection de chaque texte fugitif,
  ni la véracité des affirmations. Le fact-check reste une étape distincte.

## Validation avant publication

- Tests workerd consommant réellement le flux : 274 s, plafond 600 s,
  32 614 135 octets synthétiques, deux transferts de 128 Mio simultanés,
  en-tête MP4 fragmenté, EOF incorrect, source interrompue, refus Google,
  durée incohérente, arrêt après démarrage avec réponse tardive.
- Les en-têtes mensongers sont injectés après le pont HTTP du banc de test :
  sinon le transport tronque ou attend lui-même avant que le lecteur voie EOF.
- D1 et handler réel : minimum serveur impossible à minorer par le client,
  réserve sans débit, manque de crédits avant récupération, remboursement
  après échec de préparation, valeurs de politique invalides refusées.
- Types, build web, lint/tests/build Android vérifiés localement. Les résultats
  CI, identité APK et observations réelles sont consignés dans les reçus locaux
  de livraison. Les fixtures de taille ne sont pas une analyse de la vidéo réelle.

Deux challenges indépendants en lecture seule ont été examinés : mémoire,
streaming, annulation et délais ; admission, tarification et règlement. Les
objections sur FixedLengthStream, la préservation de l'erreur de pompage et le
test d'arrêt pendant transfert ont été intégrées.

## Références techniques consultées le 13 septembre 2026

- [Cloudflare : Content-Length et FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/request/#set-the-content-length-header)
- [Cloudflare : mémoire par isolate](https://developers.cloudflare.com/workers/platform/limits/)
- [Google : traitement et échantillonnage vidéo](https://ai.google.dev/gemini-api/docs/video-understanding)

Supprimer la durée demanderait un traitement persistant avec progression et une
admission liée au volume réellement analysé. La présente extension n'annonce
pas un traitement illimité.
