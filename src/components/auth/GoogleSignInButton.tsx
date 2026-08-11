interface GoogleSignInButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

/**
 * Bouton OAuth aligné sur les règles publiques « Sign in with Google » :
 * G multicolore inchangé, fond blanc, bord #747775 et libellé explicite.
 * Les messages promotionnels restent hors du bouton pour ne pas diluer
 * l'action d'authentification présentée à l'utilisateur et au reviewer.
 */
export function GoogleSignInButton({ label, onClick, disabled = false }: GoogleSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center rounded-[4px] border border-[#747775] bg-white px-3 text-[#1f1f1f] transition-colors hover:bg-[#f8fafd] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ fontFamily: '"Google Sans", Roboto, Arial, sans-serif' }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
        <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.99-.15-1.17z" />
        <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z" />
        <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z" />
        <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.29.44 3.13 1.21l2.27-2.27A7.8 7.8 0 008.98 0 8 8 0 001.83 5.41L4.5 7.48a4.77 4.77 0 014.48-3.9z" />
      </svg>
      <span className="ml-2.5 flex-1 text-center text-sm font-medium leading-5">{label}</span>
    </button>
  )
}
