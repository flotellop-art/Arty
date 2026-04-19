/**
 * Arty mark — Prism (deux triangles asymétriques rencontrant un apex).
 * La moitié gauche est plus transparente, évoquant la réfraction.
 * Le nom historique « StarIcon » est conservé pour la compat.
 *
 * Specs (handoff README) :
 *   apex (32,6) · base droite (58,54) · base gauche (6,54) · seam (32,40)
 *   opacité gauche 0.55 · outline stroke = max(1.4, size/16)
 *
 * Animations (via classes CSS .prism-animate + .prism-active) :
 *   idle   — chaque moitié respire horizontalement ±2px + rotation ±2deg, 3.4s
 *   active — même chose 1.2s + drop-shadow amber glow
 */

interface StarIconProps {
  size?: number
  className?: string
  /** Couleur de la marque — défaut : --arty-accent (ember jour / amber nuit). */
  color?: string
  /** Mode outline vs filled. Par défaut : filled. */
  outline?: boolean
  /** Animer la marque (idle breathing). */
  animated?: boolean
  /** État listening — accélère l'animation + ajoute un halo ambré. */
  active?: boolean
}

export function StarIcon({
  size = 24,
  className = '',
  color = 'var(--arty-accent)',
  outline = false,
  animated = false,
  active = false,
}: StarIconProps) {
  const sw = Math.max(1.4, size / 16)
  const classes = [
    className,
    animated ? 'prism-animate' : '',
    animated && active ? 'prism-active' : '',
  ].filter(Boolean).join(' ')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={classes}
      style={{ display: 'block' }}
    >
      {outline ? (
        <>
          <path className="prism-right" d="M32 6 L58 54 L32 40 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
          <path className="prism-left"  d="M32 6 L6 54 L32 40 Z"  fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" opacity="0.55" />
        </>
      ) : (
        <>
          <path className="prism-right" d="M32 6 L58 54 L32 40 Z" fill={color} />
          <path className="prism-left"  d="M32 6 L6 54 L32 40 Z"  fill={color} opacity="0.55" />
        </>
      )}
    </svg>
  )
}
