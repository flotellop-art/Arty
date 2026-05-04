import { memo } from 'react'

// Petit badge "Arty écrit..." affiché EN DESSOUS de la bulle streaming
// (tant que le streaming dure). Différent de TypingIndicator qui ne sert
// qu'au tout début, avant le premier token. Ici l'utilisateur voit que la
// génération continue même s'il a scrollé en arrière pour relire.
export const StreamingIndicator = memo(function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 ml-9 mt-1 mb-4 text-xs text-theme-muted">
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-1" />
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-2" />
        <span className="w-1.5 h-1.5 rounded-full bg-theme-accent typing-dot-3" />
      </span>
      <span className="font-sans uppercase tracking-kicker">Arty écrit…</span>
    </div>
  )
})
