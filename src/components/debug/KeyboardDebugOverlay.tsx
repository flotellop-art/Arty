import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * Debug overlay temporaire pour diagnostiquer le bug clavier Android.
 * Affiche en temps réel toutes les valeurs de viewport pour identifier
 * laquelle est wrong sur le device de l'utilisateur.
 *
 * À supprimer une fois le bug fixé définitivement.
 */
export function KeyboardDebugOverlay() {
  const [snapshot, setSnapshot] = useState({
    viewportH: '',
    kbHeight: '',
    visualVPHeight: 0,
    visualVPOffsetTop: 0,
    innerHeight: 0,
    clientHeight: 0,
    dpr: 0,
    has: false,
    eventCount: 0,
  })

  useEffect(() => {
    let count = 0

    const refresh = () => {
      count += 1
      const root = document.documentElement
      const vv = window.visualViewport
      setSnapshot({
        viewportH: root.style.getPropertyValue('--viewport-h') || '(unset)',
        kbHeight: root.style.getPropertyValue('--kb-height') || '(unset)',
        visualVPHeight: Math.round(vv?.height ?? 0),
        visualVPOffsetTop: Math.round(vv?.offsetTop ?? 0),
        innerHeight: window.innerHeight,
        clientHeight: root.clientHeight,
        dpr: window.devicePixelRatio,
        has: !!vv,
        eventCount: count,
      })
    }

    refresh()
    const id = setInterval(refresh, 500)
    window.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
    }
  }, [])

  if (!Capacitor.isNativePlatform()) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 99999,
        background: 'rgba(255, 0, 0, 0.85)',
        color: 'white',
        font: '10px/1.3 monospace',
        padding: '4px 6px',
        pointerEvents: 'none',
        maxWidth: '60vw',
        whiteSpace: 'pre',
      }}
    >
      {`--viewport-h: ${snapshot.viewportH}
--kb-height:  ${snapshot.kbHeight}
vv.height:    ${snapshot.visualVPHeight}
vv.offsetTop: ${snapshot.visualVPOffsetTop}
innerHeight:  ${snapshot.innerHeight}
clientHeight: ${snapshot.clientHeight}
DPR:          ${snapshot.dpr}
has VV:       ${snapshot.has}
ticks:        ${snapshot.eventCount}`}
    </div>
  )
}
