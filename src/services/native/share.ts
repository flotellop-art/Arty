import { Share } from '@capacitor/share'
import { isNative } from './platform'

/**
 * Share text, URL or file via the native share sheet.
 */
export async function shareContent(options: {
  title?: string
  text?: string
  url?: string
  dialogTitle?: string
}): Promise<boolean> {
  // Use native Share API on both native and web (Web Share API)
  try {
    if (isNative) {
      await Share.share({
        title: options.title,
        text: options.text,
        url: options.url,
        dialogTitle: options.dialogTitle || 'Partager via',
      })
      return true
    }

    // Web fallback
    if (navigator.share) {
      await navigator.share({
        title: options.title,
        text: options.text,
        url: options.url,
      })
      return true
    }

    // Last fallback: copy to clipboard
    const content = options.url || options.text || ''
    await navigator.clipboard.writeText(content)
    return true
  } catch (err) {
    // User cancelled share — not an error
    if ((err as Error)?.name === 'AbortError') return false
    console.warn('shareContent failed:', err)
    return false
  }
}
