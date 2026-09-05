// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fr from '../../i18n/locales/fr.json'
import en from '../../i18n/locales/en.json'

describe('offre publique alignée sur les droits existants', () => {
  it.each([fr, en])('annonce Haiku dans tout le parcours essai sans élargir les modèles', (locale) => {
    const strings = [locale.onboardingChoice.trial.subtitle,
      locale.trial.banner.remaining_one, locale.trial.banner.remaining_other]
    for (const copy of strings) {
      expect(copy).toContain('Claude Haiku')
      expect(copy).not.toMatch(/Flash|Medium|GPT/)
    }
    expect(locale.landing.faq.a1).toMatch(/30.*Claude Haiku/)
    expect(locale.chat.upgradeModal.body).not.toMatch(/Mistral \(5|upgrade to Pro|passe à Pro/)
    expect(locale.chat.upgradeModal.body).not.toMatch(/après l'essai|after the trial/)
    expect(locale.chat.upgradeModal.bodyNative).not.toMatch(/après l'essai|after the trial/)
    expect(locale.chat.upgradeModal.bodyNative).not.toMatch(/Subscription|abonnement|credits|crédits/)
  })

  it.each([fr, en])('ne promet ni clé BYOK chiffrée ni licence requise, explique le proxy', (locale) => {
    const faq = locale.landing.faq.a2
    expect(faq).toMatch(/HTTPS/)
    expect(faq).toMatch(/proxy/)
    expect(faq).toMatch(/sans chiffrement applicatif|without additional application-level encryption/)
    expect(faq).not.toMatch(/ne quitte jamais|never leaves|access every model|tous les modèles/)
    expect(locale.landing.faq.a3).not.toMatch(/pas par les serveurs|not Arty's servers/)
    expect(locale.upgrade.byokDescription).not.toMatch(/Tous les modèles|All models/)
    expect(locale.advisor.nativeByokNote).not.toMatch(/€|pack|crédits|credits|subscription|abonnement/)
    expect(locale.advisor.recommend_byok).not.toMatch(/payback|paid back|rentabilis|39/)
    expect(locale.advisor.estimateNote).toMatch(/0[,.]92/)
  })

  it('annonce la même offre sur la landing publicité, dont Open Graph', () => {
    const lp = readFileSync('public/lp/essai/index.html', 'utf8')
    expect(lp).not.toMatch(/GPT-5 mini|Gemini Flash|Mistral Medium/)
    expect(lp).toMatch(/og:description[^>]*30 messages offerts avec Claude Haiku/)
    expect(lp).toMatch(/30 messages offerts avec Claude Haiku — sans carte bancaire/)
  })
})
