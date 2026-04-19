import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface WelcomeSlidesProps {
  onComplete: () => void
}

interface SlideDef {
  emoji: string
  title: string
  desc: string
}

export function WelcomeSlides({ onComplete }: WelcomeSlidesProps) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(0)

  // Les slides viennent du JSON i18n (tableau) — `returnObjects` pour récupérer
  // la structure complète.
  const slides = t('onboarding.slides', { returnObjects: true }) as SlideDef[]
  const isLast = current === slides.length - 1
  const slide = slides[current]!

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
    <div className="min-h-[100dvh] bg-theme-bg flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-6">
        {/* Emoji */}
        <span className="text-6xl">{slide.emoji}</span>

        {/* Title */}
        <h1 className="font-display text-2xl font-bold text-theme-ink">
          {slide.title}
        </h1>

        {/* Description */}
        <p className="text-sm text-theme-muted leading-relaxed">
          {slide.desc}
        </p>

        {/* Dots */}
        <div className="flex gap-2">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === current ? 'bg-theme-accent' : 'bg-theme-ink/10'
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="w-full flex flex-col gap-2 mt-2">
          <button
            onClick={handleNext}
            className="w-full py-3 rounded-xl bg-theme-ink text-theme-bg font-medium text-sm hover:opacity-90 transition-colors"
          >
            {isLast ? t('onboarding.start') : t('onboarding.next')}
          </button>

          {!isLast && (
            <button
              onClick={handleSkip}
              className="w-full py-2 text-xs text-theme-muted/70 hover:text-theme-ink/70 transition-colors"
            >
              {t('onboarding.skip')}
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
