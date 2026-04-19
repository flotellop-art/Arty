import type { GoogleUser } from '../../types/google'

interface GoogleStatusProps {
  isConnected: boolean
  user: GoogleUser | null
  onLogout: () => void
}

export function GoogleStatus({ isConnected, user, onLogout }: GoogleStatusProps) {
  if (!isConnected) {
    return (
      <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-muted)' }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--arty-muted)' }} />
        Google non connecté
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-[11px] tracking-[0.08em] font-sans font-semibold" style={{ color: 'var(--arty-accent)' }}>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: 'var(--arty-accent)', boxShadow: '0 0 8px var(--arty-accent)' }}
        />
        <span className="font-mono normal-case tracking-normal" style={{ color: 'var(--arty-ink-soft)' }}>
          {user?.email || 'Google connecté'}
        </span>
      </div>
      <button
        onClick={onLogout}
        className="text-[10px] tracking-[0.12em] uppercase font-sans font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'var(--arty-muted)' }}
      >
        Déconnecter
      </button>
    </div>
  )
}
