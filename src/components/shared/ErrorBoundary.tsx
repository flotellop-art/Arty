import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  // Fallback affiché en cas de crash. Si fonction, reçoit (error, reset).
  // Sinon, fallback statique. Sans, message générique.
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  // Hook pour log externe (Sentry, console serveur). Pas appelé en dev.
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

/**
 * ErrorBoundary React standard. Attrape les erreurs runtime des composants
 * enfants (render, lifecycle, constructor) et affiche un fallback au lieu
 * de cracher toute l'application. Ne couvre PAS : event handlers async,
 * code dans setTimeout/setInterval, server-side rendering, erreurs déclenchées
 * dans la boundary elle-même.
 *
 * Utilisé autour de MessageList pour qu'un contenu IA malformé (markdown
 * cassé, JSON dans un tool result, etc.) ne plante pas tout le chat.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) {
      try { this.props.onError(error, info) } catch { /* swallow logger errors */ }
    }
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info)
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const fallback = this.props.fallback
    if (typeof fallback === 'function') {
      return fallback(error, this.reset)
    }
    if (fallback !== undefined) {
      return fallback
    }

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="font-display text-lg text-theme-ink mb-2">
          Quelque chose s'est cassé
        </h2>
        <p className="text-sm text-theme-muted mb-4 max-w-sm">
          Le composant a planté. Tu peux réessayer ou recharger la page.
        </p>
        <button
          onClick={this.reset}
          className="px-4 py-2 rounded-lg bg-theme-accent text-theme-bg text-sm font-semibold hover:opacity-90"
        >
          Réessayer
        </button>
      </div>
    )
  }
}
