import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag, Rule, Glow } from '../shared/editorial'
import { StarIcon } from '../shared/StarIcon'

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
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden"
      style={{ backgroundColor: 'var(--arty-bg)', color: 'var(--arty-ink)' }}
    >
      <Glow size={260} top={-60} right={-80} />
      <Glow size={200} bottom={-40} left={-60} />

      <div className="relative w-full max-w-sm flex flex-col text-left">
        {/* Masthead */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <StarIcon size={20} />
            <span className="font-display italic text-[22px]">arty</span>
          </div>
          <Tag>Chapitre {current + 1} / {slides.length}</Tag>
        </div>
        <Rule />

        {/* Slide */}
        <div className="pt-10 pb-8">
          <div
            className="w-14 h-14 rounded-full grid place-items-center text-3xl mb-5"
            style={{
              backgroundColor: 'var(--arty-accent-glow)',
              border: '1px solid var(--arty-accent)',
            }}
          >
            {slide.emoji}
          </div>
          <h1 className="font-display text-[32px] leading-[1.04] font-light tracking-[-0.025em]">
            {slide.title}<span style={{ color: 'var(--arty-accent)' }}>.</span>
          </h1>
          <p className="font-serif italic text-[15px] leading-[1.55] mt-3" style={{ color: 'var(--arty-muted)' }}>
            {slide.desc}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-2 mb-6">
          {slides.map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 transition-colors"
              style={{
                backgroundColor: i <= current ? 'var(--arty-accent)' : 'var(--arty-line)',
                borderRadius: 1,
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <button
          onClick={handleNext}
          className="w-full py-3.5 font-display italic text-[16px] font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--arty-ink)', color: 'var(--arty-bg)', borderRadius: 2, letterSpacing: '0.02em' }}
        >
          {isLast ? t('onboarding.start') : t('onboarding.next')} →
        </button>
        {!isLast && (
          <button
            onClick={handleSkip}
            className="w-full py-2 mt-2 text-[11px] tracking-[0.14em] uppercase font-sans font-semibold"
            style={{ color: 'var(--arty-muted)' }}
          >
            {t('onboarding.skip')}
          </button>
        )}
      </div>
    </div>
  )
}

export function isOnboardingDone(): boolean {
  return localStorage.getItem('arty-onboarding-done') === '1'
}
