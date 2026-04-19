import { CSSProperties } from 'react'
import type { Theme } from '../../services/themeService'

interface DayNightToggleProps {
  theme: Theme
  onChange: (next: Theme) => void
  size?: 'sm' | 'md'
  label?: string
}

/**
 * Physical day/night switch — sliding knob with a sun on the day side and
 * a moon on the night side. Ported from the Arty v2 — Day_Night design.
 */
export function DayNightToggle({ theme, onChange, size = 'sm', label }: DayNightToggleProps) {
  const isNight = theme === 'dark'
  const isMd = size === 'md'

  const width = isMd ? 180 : 72
  const height = isMd ? 54 : 30
  const pad = isMd ? 5 : 3
  const knob = height - pad * 2
  const iconSize = isMd ? 20 : 12

  const ariaLabel = label ?? (isNight ? 'Passer en mode jour' : 'Passer en mode nuit')

  const trackStyle: CSSProperties = {
    position: 'relative',
    width,
    height,
    padding: pad,
    borderRadius: 100,
    border: `1.5px solid ${isNight ? 'rgba(245,154,75,0.3)' : 'rgba(200,90,40,0.3)'}`,
    background: isNight
      ? 'linear-gradient(90deg, #0C0906 0%, #1E1812 100%)'
      : 'linear-gradient(90deg, #FAF3E7 0%, #F5E4C4 100%)',
    boxShadow: isNight
      ? 'inset 0 2px 8px rgba(0,0,0,0.6)'
      : 'inset 0 2px 8px rgba(200,90,40,0.15)',
    cursor: 'pointer',
    transition: 'background 0.5s, border-color 0.5s, box-shadow 0.5s',
    flexShrink: 0,
  }

  const knobStyle: CSSProperties = {
    position: 'absolute',
    top: pad,
    left: isNight ? `calc(100% - ${knob + pad}px)` : pad,
    width: knob,
    height: knob,
    borderRadius: 100,
    background: isNight
      ? 'radial-gradient(circle at 30% 30%, #F59A4B, #C4491C)'
      : 'radial-gradient(circle at 30% 30%, #FFE8C8, #C85A28)',
    boxShadow: isNight
      ? '0 0 20px rgba(245,154,75,0.6), inset 0 1px 2px rgba(255,255,255,0.2)'
      : '0 4px 12px rgba(200,90,40,0.4), inset 0 1px 2px rgba(255,255,255,0.5)',
    display: 'grid',
    placeItems: 'center',
    color: isNight ? '#14100B' : '#FFFFFF',
    fontSize: iconSize,
    transition: 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), background 0.5s, box-shadow 0.5s',
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isNight}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => onChange(isNight ? 'light' : 'dark')}
      style={trackStyle}
    >
      {isMd && (
        <span
          aria-hidden
          style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 22px', pointerEvents: 'none' }}
        >
          <span style={{ fontFamily: 'Fraunces, Lora, serif', fontStyle: 'italic', fontSize: 15, color: isNight ? 'rgba(245,230,208,0.35)' : '#8F3210', opacity: isNight ? 0.5 : 1, transition: 'opacity 0.3s' }}>Jour</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'Fraunces, Lora, serif', fontStyle: 'italic', fontSize: 15, color: isNight ? '#F59A4B' : 'rgba(24,22,19,0.3)', opacity: isNight ? 1 : 0.5, transition: 'opacity 0.3s' }}>Nuit</span>
        </span>
      )}
      <span style={knobStyle} aria-hidden>
        {isNight ? '☾' : '☀'}
      </span>
    </button>
  )
}
