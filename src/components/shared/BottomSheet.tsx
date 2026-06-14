import { useEffect, useRef, type ReactNode } from 'react'

// Bottom sheet générique (PR B du plan design/mockups-2026-06/PLAN.md).
// Choix a11y documenté : pas de `inert` sur le reste de l'app — il n'existe
// aucun précédent "inert sur la racine" dans ce repo, et rendre l'InputBar
// inerte pendant un stream rendrait le bouton Stop inatteignable (audit PR B,
// risque critique). À la place : role=dialog + aria-modal + focus déplacé
// dans le sheet à l'ouverture et restauré au déclencheur à la fermeture +
// Escape + tap backdrop. Un seul tap sur le backdrop rend tout l'écran
// interactif à nouveau.

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Contenu additionnel à droite du titre (ex. PlanBadge). */
  titleAside?: ReactNode
  children: ReactNode
}

export function BottomSheet({ open, onClose, title, titleAside, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Élément focusé avant l'ouverture (le bouton déclencheur) — restauré à la
  // fermeture pour que la navigation clavier ne soit pas perdue.
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop — tap = fermer (couche la plus haute d'abord) */}
      <div
        className="absolute inset-0 bg-theme-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 bg-theme-surface border border-theme-border border-b-0 rounded-t-[22px] shadow-[0_-16px_48px_rgba(0,0,0,0.25)] outline-none max-h-[85dvh] flex flex-col"
        style={{ animation: 'sheet-up 0.22s ease-out' }}
      >
        {/* Poignée */}
        <div className="pt-2.5 pb-3 shrink-0" aria-hidden="true">
          <div className="w-[38px] h-1 rounded-full bg-theme-ink/20 mx-auto" />
        </div>
        {(title || titleAside) && (
          <div className="flex items-center justify-between px-5 pb-3 shrink-0">
            {title && (
              <h2 className="font-display italic text-[17px] text-theme-ink leading-tight">
                {title}
              </h2>
            )}
            {titleAside}
          </div>
        )}
        <div
          className="overflow-y-auto px-5"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
