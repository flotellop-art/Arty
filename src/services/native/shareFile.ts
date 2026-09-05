import { Capacitor } from '@capacitor/core'
let nativeExportBusy = false

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
  opts: { title?: string; text?: string; dialogTitle?: string; assertCurrent?: () => void;
    validate?: () => Promise<void>; onEngaged?: () => void } = {},
): Promise<void> {
  const guard = () => opts.assertCurrent?.()
  const validate = async () => { guard(); await opts.validate?.(); guard() }
  guard()
  if (Capacitor.isNativePlatform()) {
    if (nativeExportBusy) throw new Error('Un export natif est déjà en cours. Fermez la feuille de partage avant de réessayer.')
    nativeExportBusy = true
    try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    guard()
    const { Share } = await import('@capacitor/share')
    guard()
    const base64 = await blobToBase64(blob)
    await validate()
    // Opaque app-owned paths only. Extension is needed by Android's MIME resolver.
    const ext = filename.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? 'bin'
    const folder = 'arty-exports-v1'
    const path = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`
    // Opportunistic TTL on the next export, not a promise of deletion while the
    // app is stopped. Never sweep arbitrary Cache files or a recipient's copy.
    let entries: Awaited<ReturnType<typeof Filesystem.readdir>>['files'] = []
    try { entries = (await Filesystem.readdir({ path: folder, directory: Directory.Cache })).files }
    catch {
      guard()
      try { await Filesystem.mkdir({ path: folder, directory: Directory.Cache, recursive: true }) } catch { /* May already exist; readdir below must succeed. */ }
      guard()
      entries = (await Filesystem.readdir({ path: folder, directory: Directory.Cache })).files
    }
    guard()
    let retained = 0
    for (const entry of entries) {
      const match = entry.name.match(/^(\d{13})-[0-9a-f-]{36}\.[a-z0-9]{1,10}$/)
      if (!match || entry.type !== 'file') continue
      if (Date.now() - Number(match[1]) < 24 * 60 * 60 * 1000) { retained++; continue }
      guard()
      try { await Filesystem.deleteFile({ path: `${folder}/${entry.name}`, directory: Directory.Cache }) } catch { retained++ }
      guard()
    }
    if (retained >= 32) throw new Error('Le cache contient déjà 32 exports récents. Réessayez après 24 heures ou libérez le cache de l’application.')
    await validate()
    let written = false, engaged = false
    try {
      written = true // Also clean up an uncertain/partial failed write at this exact path.
      const file = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true })
      await validate()
      guard(); opts.onEngaged?.(); guard()
      engaged = true
      await Share.share({ title: opts.title ?? filename, text: opts.text, url: file.uri, dialogTitle: opts.dialogTitle ?? opts.title ?? filename })
      guard()
    } finally {
      // Cancellation before handing off: delete only THIS operation's file.
      // After handoff a recipient may still be reading, so do not erase it here.
      if (written && !engaged) { try { await Filesystem.deleteFile({ path, directory: Directory.Cache }) } catch { /* OS cache cleanup/next TTL pass */ } }
    }
    return
    } finally { nativeExportBusy = false }
  }
  await validate()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  try { guard(); opts.onEngaged?.(); guard(); a.click() }
  finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
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
