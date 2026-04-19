/**
 * Arty mark — Prism (deux triangles asymétriques rencontrant un apex).
 * La moitié gauche est plus transparente, évoquant la réfraction.
 * Le nom historique « StarIcon » est conservé pour la compat.
 */

interface StarIconProps {
  size?: number
  className?: string
  /** Couleur de la marque — défaut : --arty-accent (ember jour / amber nuit). */
  color?: string
  /** Mode outline vs filled. Par défaut : filled. */
  outline?: boolean
}

export function StarIcon({ size = 24, className = '', color = 'var(--arty-accent)', outline = false }: StarIconProps) {
  const sw = Math.max(1.4, size / 16)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block' }}
    >
      {outline ? (
        <>
          <path d="M32 6 L58 54 L32 40 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M32 6 L6 54 L32 40 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" opacity="0.55" />
        </>
      ) : (
        <>
          <path d="M32 6 L58 54 L32 40 Z" fill={color} />
          <path d="M32 6 L6 54 L32 40 Z" fill={color} opacity="0.55" />
        </>
      )}
    </svg>
  )
}
