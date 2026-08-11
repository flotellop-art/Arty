import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('auth/onboarding scroll shell — petits viewports Android', () => {
  it('borne le scroll au viewport visible et conserve clavier + safe-area', () => {
    const css = read('src/index.css')
    expect(css).toMatch(/\.auth-viewport-scroll\s*\{[\s\S]*height:\s*var\(--viewport-h,\s*100dvh\)/)
    expect(css).toMatch(/\.auth-viewport-scroll\s*\{[\s\S]*overflow-y:\s*auto/)
    expect(css).toMatch(/safe-area-inset-top/)
    expect(css).toMatch(/safe-area-inset-bottom/)
    expect(css).toMatch(/\.keyboard-aware\s*\{[\s\S]*max\([\s\S]*--keyboard-height[\s\S]*--keyboard-aware-base-bottom/)
  })

  it('centre seulement si le contenu tient et garde le CTA onboarding scrollable', () => {
    const onboarding = read('src/components/onboarding/OnboardingChoice.tsx')
    expect(onboarding).toContain('auth-viewport-scroll keyboard-aware')
    expect(onboarding).toContain('my-auto w-full max-w-md')
    expect(onboarding).toContain('<GoogleSignInButton')
  })

  it('applique le même shell aux deux branches de LoginScreen', () => {
    const login = read('src/components/auth/LoginScreen.tsx')
    expect(login.match(/auth-viewport-scroll keyboard-aware/g)).toHaveLength(2)
    expect(login.match(/my-auto w-full max-w-md/g)).toHaveLength(2)
  })
})
