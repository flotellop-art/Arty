import type { CSSProperties, ReactNode } from 'react'

/**
 * Primitives partagées par les écrans refondus Arty v2 (Ember / Nocturne).
 * Chaque primitive s'appuie sur les CSS vars (`--arty-*`) et flippe
 * automatiquement entre jour et nuit.
 */

interface TagProps {
  children: ReactNode
  accent?: boolean
  className?: string
}

/** Petit caplock éditorial (« ◈ QUELQUE CHOSE »). */
export function Tag({ children, accent, className = '' }: TagProps) {
  return (
    <span
      className={`font-sans text-[10px] font-semibold tracking-[0.18em] uppercase ${className}`}
      style={{ color: accent ? 'var(--arty-accent)' : 'var(--arty-muted)' }}
    >
      {children}
    </span>
  )
}

/** Double filet à l'encre — séparateur de masthead éditorial Ember. */
export function Rule({ double = true, className = '' }: { double?: boolean; className?: string }) {
  if (!double) {
    return <div className={className} style={{ height: 1, backgroundColor: 'var(--arty-ink)', opacity: 0.9 }} />
  }
  return (
    <div className={className}>
      <div style={{ height: 2, backgroundColor: 'var(--arty-ink)' }} />
      <div style={{ height: 1, backgroundColor: 'var(--arty-ink)', marginTop: 3 }} />
    </div>
  )
}

/** Filet pointillé subtil entre rangées. */
export function DotLine({ className = '' }: { className?: string }) {
  return <div className={className} style={{ height: 1, borderTop: '1px dotted var(--arty-line)' }} />
}

/** Halo radial ambré pour Nocturne — invisible en Ember (glow quasi transparent). */
export function Glow({
  size = 200,
  top,
  left,
  right,
  bottom,
  className = '',
}: {
  size?: number
  top?: number | string
  left?: number | string
  right?: number | string
  bottom?: number | string
  className?: string
}) {
  const style: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'radial-gradient(circle, var(--arty-accent-glow) 0%, transparent 70%)',
    pointerEvents: 'none',
    top,
    left,
    right,
    bottom,
  }
  return <div className={className} style={style} aria-hidden />
}

/** Drop cap éditorial Ember — grosse lettre serif ambrée en début d'article. */
export function DropCap({ children }: { children: string }) {
  return (
    <span
      aria-hidden={false}
      style={{
        float: 'left',
        fontFamily: 'Fraunces, Lora, Georgia, serif',
        fontSize: 54,
        lineHeight: 0.85,
        color: 'var(--arty-accent)',
        marginRight: 8,
        marginTop: 4,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  )
}

/** Masthead type "journal" — tag gauche + tag droit + règle double en dessous. */
export function Masthead({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div>{left}</div>
        <div>{right}</div>
      </div>
      <Rule className="mx-5" />
    </div>
  )
}
