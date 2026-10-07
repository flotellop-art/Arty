import { createContext } from 'react'

export interface LocalReportNavigation {
  path: string
  canNavigate: () => boolean
}
export const LocalReportNavigationContext = createContext<
  ((href: string) => LocalReportNavigation | null) | null
>(null)
