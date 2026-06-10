import { useEffect, useState } from 'react'
import type { ToastDetail } from '../../services/toast'

const TOAST_DURATION_MS = 3500

/**
 * Affiche les toasts émis via toast() (services/toast.ts). Monté une seule
 * fois à la racine de App — fonctionne donc aussi sur l'écran de login.
 * Positionné au-dessus de l'InputBar (84px) pour ne pas masquer le CTA.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastDetail[]>([])

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail
      if (!detail?.message) return
      // Max 3 toasts empilés — les plus anciens sortent.
      setToasts((prev) => [...prev.slice(-2), detail])
      timers.push(
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== detail.id))
        }, TOAST_DURATION_MS)
      )
    }
    window.addEventListener('arty-toast', onToast)
    return () => {
      window.removeEventListener('arty-toast', onToast)
      timers.forEach(clearTimeout)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 px-4 w-full max-w-sm pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-fade-in max-w-full break-words ${
            t.type === 'error'
              ? 'bg-red-600 text-white'
              : t.type === 'success'
                ? 'bg-theme-accent text-theme-bg'
                : 'bg-theme-ink text-theme-bg'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
