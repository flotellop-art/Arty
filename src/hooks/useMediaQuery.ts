import { useState, useEffect } from 'react'

// Hook media-query minimal pour la bascule desktop (PR E). Utilise
// matchMedia avec l'événement DISCRET `change` (jamais de polling sur
// innerWidth) : ne re-render qu'au franchissement du breakpoint, pas à
// chaque frame de resize — préserve le memo(Sidebar). SSR/initial-safe :
// si matchMedia est absent (très vieux WebView, tests sans jsdom matchMedia),
// retombe sur false (= comportement mobile actuel, le défaut sûr).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
