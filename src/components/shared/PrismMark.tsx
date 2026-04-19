/**
 * PrismMark — Arty brand mark.
 *
 * Two triangles meeting at a shared seam at (32, 40) in a 64×64 viewBox.
 * The left half is rendered at 0.55 opacity (refraction metaphor).
 *
 * Geometry comes verbatim from `design_handoff_arty/shared.jsx` (Star).
 *   apex:        (32, 6)
 *   base right:  (58, 54)
 *   base left:   (6, 54)
 *   seam:        (32, 40) — 5/8 down
 *
 * Use `fill` for solid (logo, splash, listening). Outline for app bars
 * and small UI; stroke width auto-scales with size.
 *
 * `active` toggles the listening animation: same idle motion at 1.2s
 * cycle plus an amber drop-shadow glow.
 */

import { memo } from 'react'
import { clsx } from 'clsx'

interface PrismMarkProps {
  size?: number
  /** CSS color (defaults to currentColor so it inherits text color) */
  color?: string
  /** Solid fill if true, outline if false. Default: false (outline) */
  fill?: boolean
  /** Drives breathing animation. Idle = 3.4s, active = 1.2s + glow */
  active?: boolean
  /** Suppress all motion (e.g. inside lists, prefers-reduced-motion) */
  static?: boolean
  className?: string
  title?: string
}

function PrismMarkInner({
  size = 24,
  color = 'currentColor',
  fill = false,
  active = false,
  static: isStatic = false,
  className,
  title,
}: PrismMarkProps) {
  const strokeWidth = Math.max(1.4, size / 16)
  const leftAnim = isStatic
    ? undefined
    : active
      ? 'animate-prism-left-active'
      : 'animate-prism-left'
  const rightAnim = isStatic
    ? undefined
    : active
      ? 'animate-prism-right-active'
      : 'animate-prism-right'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      className={clsx('block', className)}
      style={
        active
          ? { filter: 'drop-shadow(0 0 8px rgba(245,154,75,0.4))' }
          : undefined
      }
    >
      {fill ? (
        <>
          <path
            d="M32 6 L58 54 L32 40 Z"
            fill={color}
            className={rightAnim}
            style={{ transformOrigin: '32px 40px' }}
          />
          <path
            d="M32 6 L6 54 L32 40 Z"
            fill={color}
            opacity="0.55"
            className={leftAnim}
            style={{ transformOrigin: '32px 40px' }}
          />
        </>
      ) : (
        <>
          <path
            d="M32 6 L58 54 L32 40 Z"
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            className={rightAnim}
            style={{ transformOrigin: '32px 40px' }}
          />
          <path
            d="M32 6 L6 54 L32 40 Z"
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            opacity="0.55"
            className={leftAnim}
            style={{ transformOrigin: '32px 40px' }}
          />
        </>
      )}
    </svg>
  )
}

export const PrismMark = memo(PrismMarkInner)

/**
 * Wordmark — Prism mark + "arty" in Fraunces italic.
 * Used in the top bar and login screen.
 */
interface ArtyWordmarkProps {
  size?: number
  color?: string
  className?: string
}

export const ArtyWordmark = memo(function ArtyWordmark({
  size = 22,
  color = 'currentColor',
  className,
}: ArtyWordmarkProps) {
  return (
    <span
      className={clsx('inline-flex items-center gap-2', className)}
      style={{ color }}
    >
      <PrismMark size={size} color={color} fill />
      <span
        className="font-display italic"
        style={{
          fontSize: Math.round(size * 1.18),
          fontWeight: 400,
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        arty
      </span>
    </span>
  )
})
