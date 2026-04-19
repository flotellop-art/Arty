import { useState } from 'react'
import type { EmailDraft } from '../../types/google'
import { Tag } from '../shared/editorial'

interface EmailComposerProps {
  draft: EmailDraft
  onConfirmSend: (draft: EmailDraft) => void
  onCancel: () => void
  isSending: boolean
}

export function EmailComposer({ draft, onConfirmSend, onCancel, isSending }: EmailComposerProps) {
  const [to, setTo] = useState(draft.to)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [confirmed, setConfirmed] = useState(false)

  const handleSend = () => {
    if (!confirmed) { setConfirmed(true); return }
    onConfirmSend({ to, subject, body, threadId: draft.threadId, inReplyTo: draft.inReplyTo })
  }

  const fieldStyle = {
    backgroundColor: 'var(--arty-card-hi)',
    color: 'var(--arty-ink)',
    border: '1px solid var(--arty-line)',
    borderRadius: 2,
  } as const

  return (
    <div
      className="overflow-hidden my-3"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}
    >
      {/* Masthead */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--arty-ink)' }}>
        <Tag accent>◈ Brouillon email</Tag>
        <button
          onClick={onCancel}
          className="text-[10px] tracking-[0.14em] uppercase font-sans font-semibold"
          style={{ color: 'var(--arty-muted)' }}
        >
          Annuler
        </button>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 space-y-2">
        <div>
          <label className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold block mb-0.5" style={{ color: 'var(--arty-muted)' }}>
            Destinataire
          </label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full text-sm font-mono px-3 py-2 focus:outline-none"
            style={fieldStyle}
          />
        </div>
        <div>
          <label className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold block mb-0.5" style={{ color: 'var(--arty-muted)' }}>
            Objet
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full text-sm font-serif italic px-3 py-2 focus:outline-none"
            style={fieldStyle}
          />
        </div>
        <div>
          <label className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold block mb-0.5" style={{ color: 'var(--arty-muted)' }}>
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full text-sm px-3 py-2 focus:outline-none resize-none leading-relaxed font-serif"
            style={fieldStyle}
          />
        </div>
      </div>

      {confirmed && (
        <div
          className="mx-4 mb-2 px-3 py-2 text-[13px] font-serif italic"
          style={{
            backgroundColor: 'var(--arty-accent-glow)',
            borderLeft: '2px solid var(--arty-accent)',
            color: 'var(--arty-ink-soft)',
            borderRadius: 2,
          }}
        >
          Confirmer l'envoi à <strong className="not-italic font-semibold" style={{ color: 'var(--arty-accent)' }}>{to}</strong> ?
        </div>
      )}

      <div className="flex gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--arty-line)' }}>
        <button
          onClick={onCancel}
          className="flex-1 py-2 text-[13px] font-serif italic"
          style={{ border: '1px solid var(--arty-line)', color: 'var(--arty-ink)', borderRadius: 2 }}
        >
          Annuler
        </button>
        <button
          onClick={handleSend}
          disabled={isSending || !to || !subject || !body}
          className="flex-1 py-2 text-[13px] font-serif italic disabled:opacity-50"
          style={{
            backgroundColor: confirmed ? 'var(--arty-accent)' : 'var(--arty-ink)',
            color: confirmed ? 'var(--arty-bg)' : 'var(--arty-bg)',
            borderRadius: 2,
          }}
        >
          {isSending ? 'Envoi…' : confirmed ? "Confirmer l'envoi →" : 'Envoyer →'}
        </button>
      </div>
    </div>
  )
}
