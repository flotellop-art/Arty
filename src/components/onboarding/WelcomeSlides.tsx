import { useState } from 'react'

interface WelcomeSlidesProps {
  onComplete: () => void
}

const SLIDES = [
  {
    emoji: '✨',
    title: 'Salut, moi c\'est Arty',
    desc: 'Ton assistant IA personnel. Pose-moi n\'importe quelle question, je suis là pour t\'aider.',
  },
  {
    emoji: '📸',
    title: 'Parle-moi comme tu veux',
    desc: 'Par texte, par photo, par vocal ou en scannant un document. Je m\'adapte à toi.',
  },
  {
    emoji: '📧',
    title: 'Connecte tes outils',
    desc: 'Gmail, Drive, Calendar — connecte ton compte Google et je pourrai lire tes mails, accéder à tes fichiers et gérer ton agenda.',
  },
  {
    emoji: '🎛️',
    title: 'Personnalise les réponses',
    desc: 'Change le ton (concis, détaillé, formel...) et le modèle IA (Claude, Mistral, Gemini) à tout moment en haut de l\'écran. Appuie sur ? pour en savoir plus.',
  },
]

export function WelcomeSlides({ onComplete }: WelcomeSlidesProps) {
  const [current, setCurrent] = useState(0)

  const isLast = current === SLIDES.length - 1
  const slide = SLIDES[current]!

  const handleNext = () => {
    if (isLast) {
      localStorage.setItem('arty-onboarding-done', '1')
      onComplete()
    } else {
      setCurrent(current + 1)
    }
  }

  const handleSkip = () => {
    localStorage.setItem('arty-onboarding-done', '1')
    onComplete()
  }

  return (
    <div className="min-h-[100dvh] bg-cream flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-6">
        {/* Emoji */}
        <span className="text-6xl">{slide.emoji}</span>

        {/* Title */}
        <h1 className="font-serif text-2xl font-bold text-bubble-user">
          {slide.title}
        </h1>

        {/* Description */}
        <p className="text-sm text-gray-500 leading-relaxed">
          {slide.desc}
        </p>

        {/* Dots */}
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === current ? 'bg-accent' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-2 mt-2">
          <button
            onClick={handleNext}
            className="w-full py-3 rounded-xl bg-bubble-user text-cream font-medium text-sm hover:bg-gray-700 transition-colors"
          >
            {isLast ? 'C\'est parti !' : 'Suivant'}
          </button>

          {!isLast && (
            <button
              onClick={handleSkip}
              className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Passer
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function isOnboardingDone(): boolean {
  return localStorage.getItem('arty-onboarding-done') === '1'
}
