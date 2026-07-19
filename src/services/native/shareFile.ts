import { Capacitor } from '@capacitor/core'

// Livraison d'un fichier généré à l'utilisateur — helper partagé (extrait de
// conversationExport.ts, 3e site d'usage avec l'export GPX).
//
// ⚠️ Sur natif, NE PAS utiliser writeLocalFile/Directory.Documents pour un
// fichier destiné à l'utilisateur : sur Android 11+ le scoped storage rend
// Documents/ privé à l'app — le fichier serait invisible pour Komoot, Files ou
// toute autre app (résultat fantôme). Le chemin correct est Cache + share
// sheet système : l'utilisateur choisit la destination (« Ouvrir avec… »),
// l'infra FileProvider est déjà déclarée (android/.../xml/file_paths.xml).
export async function downloadOrShareFile(
  blob: Blob,
  filename: string,
  opts: { title?: string; text?: string; dialogTitle?: string } = {},
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const base64 = await blobToBase64(blob)

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    })

    await Share.share({
      title: opts.title ?? filename,
      text: opts.text,
      url: written.uri,
      dialogTitle: opts.dialogTitle ?? opts.title ?? filename,
    })
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}
