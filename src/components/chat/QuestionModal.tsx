import { useState, useCallback } from 'react'

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
      <div
        className="w-full max-w-lg bg-white rounded-t-2xl shadow-xl px-5 pt-5 pb-8 animate-slide-up"
        style={{ maxHeight: '80vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-gray-400 font-medium">
            {currentIndex + 1} sur {total}
          </span>
          <button
            onClick={() => onComplete(answers)}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 rounded-full mb-5">
          <div
            className="h-1 bg-orange-400 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
          />
        </div>

        {/* Question */}
        <h3 className="text-lg font-semibold text-gray-800 mb-5">{current.question}</h3>

        {/* Options */}
        {current.options && current.options.length > 0 && (
          <div className="space-y-2 mb-4">
            {current.options.map((option, i) => (
              <button
                key={i}
                onClick={() => handleSelect(option)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-colors text-left"
              >
                <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500">
                  {i + 1}
                </span>
                <span className="text-gray-700">{option}</span>
              </button>
            ))}
          </div>
        )}

        {/* Free text input */}
        {(current.allow_free_text !== false) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFreeText()}
              placeholder="Saisissez votre propre réponse…"
              className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-orange-300"
            />
            <button
              onClick={handleFreeText}
              disabled={!freeText.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-orange-100 text-orange-500 disabled:opacity-30"
            >
              ↑
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
