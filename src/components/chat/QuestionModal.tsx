import { useState, useCallback } from 'react'
import { Tag, Rule } from '../shared/editorial'

export interface Question {
  question: string
  options?: string[]
  allow_free_text?: boolean
}

interface QuestionModalProps {
  questions: Question[]
  onComplete: (answers: string[]) => void
}

export function QuestionModal({ questions, onComplete }: QuestionModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')

  const current = questions[currentIndex]
  const total = questions.length

  const handleSelect = useCallback(
    (value: string) => {
      const newAnswers = [...answers, value]
      if (currentIndex + 1 < total) {
        setAnswers(newAnswers)
        setCurrentIndex(currentIndex + 1)
        setFreeText('')
      } else {
        onComplete(newAnswers)
      }
    },
    [answers, currentIndex, total, onComplete]
  )

  const handleFreeText = useCallback(() => {
    if (!freeText.trim()) return
    handleSelect(freeText.trim())
  }, [freeText, handleSelect])

  if (!current) return null

  const progress = ((currentIndex + 1) / total) * 100

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="w-full max-w-lg animate-slide-up"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          border: '1px solid var(--arty-line)',
          borderBottom: 'none',
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          padding: '20px 20px 32px',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 -20px 40px rgba(0,0,0,0.25)',
        }}
      >
        {/* Masthead */}
        <div className="flex items-center justify-between mb-2">
          <Tag>
            Question {currentIndex + 1} / {total}
          </Tag>
          <button
            onClick={() => onComplete(answers)}
            className="w-7 h-7 flex items-center justify-center text-[16px]"
            style={{ color: 'var(--arty-muted)' }}
          >
            ✕
          </button>
        </div>
        <Rule />

        {/* Progress bar */}
        <div className="h-px mt-4 mb-5 relative" style={{ backgroundColor: 'var(--arty-line)' }}>
          <div
            className="absolute inset-y-0 left-0 transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: 'var(--arty-accent)', height: 2, top: -0.5 }}
          />
        </div>

        {/* Question */}
        <h3 className="font-display text-[22px] leading-[1.2] font-light tracking-[-0.015em] mb-5">
          {current.question}
          <span style={{ color: 'var(--arty-accent)' }}> ?</span>
        </h3>

        {/* Options */}
        {current.options && current.options.length > 0 && (
          <div className="space-y-2 mb-4">
            {current.options.map((option, i) => (
              <button
                key={i}
                onClick={() => handleSelect(option)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{
                  backgroundColor: 'var(--arty-card)',
                  border: '1px solid var(--arty-line)',
                  borderRadius: 2,
                  color: 'var(--arty-ink)',
                }}
              >
                <span
                  className="w-6 h-6 flex-shrink-0 flex items-center justify-center font-mono text-[11px] font-semibold"
                  style={{ backgroundColor: 'var(--arty-accent-glow)', color: 'var(--arty-accent)', borderRadius: 2 }}
                >
                  {i + 1}
                </span>
                <span className="font-serif italic text-[14px]">« {option} »</span>
              </button>
            ))}
          </div>
        )}

        {/* Free text input */}
        {(current.allow_free_text !== false) && (
          <div
            className="flex items-center gap-2 mt-3 pt-3"
            style={{ borderTop: '1px solid var(--arty-line)' }}
          >
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFreeText()}
              placeholder="… ou ta propre réponse"
              className="flex-1 px-3 py-2.5 text-[14px] focus:outline-none font-serif italic"
              style={{
                backgroundColor: 'var(--arty-card)',
                border: '1px solid var(--arty-line)',
                color: 'var(--arty-ink)',
                borderRadius: 2,
              }}
            />
            <button
              onClick={handleFreeText}
              disabled={!freeText.trim()}
              className="w-10 h-10 flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--arty-ink)', color: 'var(--arty-bg)', borderRadius: 2 }}
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
