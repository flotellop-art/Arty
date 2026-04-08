import { useState } from 'react'
import type { EmailDraft } from '../../types/google'

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
    if (!confirmed) {
      setConfirmed(true)
      return
    }
    onConfirmSend({ to, subject, body, threadId: draft.threadId, inReplyTo: draft.inReplyTo })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden my-2">
      {/* Header */}
      <div className="bg-accent/5 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-serif font-semibold text-bubble-user text-sm">
          Brouillon email
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Annuler
        </button>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 space-y-2">
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Destinataire</label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full text-sm text-bubble-user bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Objet</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full text-sm text-bubble-user bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-0.5">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full text-sm text-bubble-user bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 focus:outline-none focus:border-accent resize-none leading-relaxed"
          />
        </div>
      </div>

      {/* Confirmation warning */}
      {confirmed && (
        <div className="mx-4 mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Confirmez-vous l'envoi de cet email à <strong>{to}</strong> ?
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Annuler
        </button>
        <button
          onClick={handleSend}
          disabled={isSending || !to || !subject || !body}
          className={`flex-1 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
            confirmed
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-accent hover:bg-accent/90'
          }`}
        >
          {isSending
            ? 'Envoi...'
            : confirmed
              ? 'Confirmer l\'envoi'
              : 'Envoyer'}
        </button>
      </div>
    </div>
  )
}
