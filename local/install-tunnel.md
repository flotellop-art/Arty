# Installation du Tunnel Cloudflare + Computer Use

## 1. Installer cloudflared sur Windows

1. Telecharger `cloudflared` : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Telecharger le fichier `.msi` pour Windows
3. Double-cliquer pour installer
4. Verifier l'installation :
   ```cmd
   cloudflared --version
   ```

## 2. Se connecter a Cloudflare

```cmd
cloudflared tunnel login
```

Un navigateur s'ouvre — connecte-toi avec ton compte Cloudflare.

## 3. Creer le tunnel

```cmd
cloudflared tunnel create facades-pollet
```

Note l'ID du tunnel affiche (ex: `abc123-def456-...`).

## 4. Configurer le tunnel

Creer le fichier `%USERPROFILE%\.cloudflared\config.yml` :

```yaml
tunnel: facades-pollet
credentials-file: C:\Users\VOTRE_NOM\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: facades-pollet.VOTRE-DOMAINE.com
    service: http://localhost:3003
  - service: http_status:404
```

OU, pour utiliser un sous-domaine Cloudflare gratuit (sans domaine perso) :

```cmd
cloudflared tunnel route dns facades-pollet facades-pollet.VOTRE-DOMAINE.com
```

## 5. Tester le tunnel

```cmd
cloudflared tunnel run facades-pollet
```

Depuis un autre appareil, tester :
```
curl https://facades-pollet.VOTRE-DOMAINE.com/health
```

Reponse attendue : `{"status":"ok","uptime":...}`

## 6. Installer comme service Windows (demarrage automatique)

```cmd
cloudflared service install
```

Le tunnel demarre maintenant automatiquement au lancement de Windows.

## 7. Installer les dependances du serveur local

```cmd
cd local
npm install
```

## 8. Configurer le token secret

Creer une variable d'environnement Windows :
```cmd
setx TUNNEL_SECRET "votre-token-secret-ici"
```

Ce meme token doit etre ajoute dans Cloudflare Pages (Settings > Environment variables) :
- `TUNNEL_SECRET` = le meme token

## 9. Lancer tous les services

Double-cliquer sur `start-all.bat` ou executer :
```cmd
start-all.bat
```

## 10. Ajouter les variables dans Cloudflare Pages

| Variable | Valeur |
|----------|--------|
| `TUNNEL_URL` | `https://facades-pollet.VOTRE-DOMAINE.com` |
| `TUNNEL_SECRET` | le token secret genere a l'etape 8 |

## Verification

1. Lancer `start-all.bat` sur le PC
2. Depuis le telephone, ouvrir l'app Arty
3. Taper "Ouvre Excel sur mon PC"
4. Un screenshot du PC devrait apparaitre dans le chat
