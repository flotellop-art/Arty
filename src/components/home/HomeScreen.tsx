import { AnimatedStar } from './AnimatedStar'
import { SuggestionCard } from './SuggestionCard'
import { TopBar } from '../layout/TopBar'
import { InputBar } from '../layout/InputBar'

const SUGGESTIONS = [
  'Générer un devis client',
  'Répondre à un email',
  'Analyser mes factures',
]

interface HomeScreenProps {
  onMenuToggle: () => void
  onSend: (text: string) => void
  isStreaming: boolean
}

export function HomeScreen({ onMenuToggle, onSend, isStreaming }: HomeScreenProps) {
  return (
    <div className="flex flex-col h-full">
      <TopBar onMenuToggle={onMenuToggle} onHistoryToggle={onMenuToggle} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-4 gap-6">
        <AnimatedStar />

        <h1 className="font-serif text-2xl md:text-3xl font-semibold text-bubble-user text-center leading-snug">
          Comment puis-je vous aider aujourd'hui ?
        </h1>

        <div className="w-full max-w-md flex flex-col gap-3">
          {SUGGESTIONS.map((text) => (
            <SuggestionCard
              key={text}
              text={text}
              onClick={() => onSend(text)}
            />
          ))}
        </div>
      </div>

      <InputBar onSend={onSend} isStreaming={isStreaming} />
    </div>
  )
}
