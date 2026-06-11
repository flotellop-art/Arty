// Badge affiché sous une réponse assistant après que le fact-checker l'a
// vérifiée. Discret par défaut (✓ vert si tout vérifié), expandable si
// claims uncertain ou wrong détectés.
//
// Cliquable → expand pour voir les claims un par un avec leur verdict
// et l'explication du fact-checker.
//
// BUG 59 — le badge expose 4 états VISUELLEMENT distincts :
//   pending             ◌ gris pulsé « Vérification… »
//   success-empty       ✓ vert « Aucun claim risqué »
//   success-with-claims ✏️/❌/⚠️ + compteurs (expandable)
//   failed              ❓ pilule pointillée neutre (≠ d'un succès)
// Sans ça l'utilisateur ne distingue pas « pas activé » / « activé mais
// cassé » / « vérifié et clean ». Le pending affichait même à tort
// « ✓ Aucun claim risqué » (claims vides + confidence high du placeholder).

import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FactCheckResult } from '../../types'

interface Props {
  result: FactCheckResult
}

type FactCheckStatus = NonNullable<FactCheckResult['status']>

// Rétro-compat : les résultats persistés (conversations chiffrées) avant
// l'ajout du champ status n'en ont pas — on dérive l'état des magic
// strings historiques du modelLabel. Ces strings restent posées par
// factChecker.ts (le skip-guard de runFactCheckOnLatest compare
// 'Vérification en cours…') : ne pas les supprimer côté service.
function deriveStatus(result: FactCheckResult): FactCheckStatus {
  if (result.status) return result.status
  if (result.modelLabel === 'Vérification en cours…') return 'pending'
  if (result.modelLabel?.includes('indisponible')) return 'failed'
  return result.claims.some((c) => c.verdict !== 'verified')
    ? 'success-with-claims'
    : 'success-empty'
}

const VERDICT_STYLE: Record<string, string> = {
  verified: 'text-emerald-700 dark:text-emerald-400',
  uncertain: 'text-amber-700 dark:text-amber-400',
  wrong: 'text-red-700 dark:text-red-400',
}

const VERDICT_ICON: Record<string, string> = {
  verified: '✓',
  uncertain: '⚠️',
  wrong: '❌',
}

export const FactCheckBadge = memo(function FactCheckBadge({ result }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const status = deriveStatus(result)

  const wrongCount = result.claims.filter((c) => c.verdict === 'wrong').length
  const uncertainCount = result.claims.filter((c) => c.verdict === 'uncertain').length
  const verifiedCount = result.claims.filter((c) => c.verdict === 'verified').length
  const corrected = result.appliedCorrections || 0

  const plural = (count: number, oneKey: string, manyKey: string) =>
    t(count > 1 ? manyKey : oneKey, { count })

  const summary = (() => {
    switch (status) {
      case 'pending':
        return `◌ ${t('chat.factCheck.pending')}`
      case 'failed':
        return `❓ ${t('chat.factCheck.unavailable')}`
      case 'success-empty':
        return verifiedCount > 0
          ? `✓ ${plural(verifiedCount, 'chat.factCheck.verifiedOne', 'chat.factCheck.verifiedMany')}`
          : `✓ ${t('chat.factCheck.noRisky')}`
      case 'success-with-claims': {
        if (corrected > 0) {
          const rest = uncertainCount > 0
            ? ` · ${t('chat.factCheck.toVerifySuffix', { count: uncertainCount })}`
            : ''
          return `✏️ ${plural(corrected, 'chat.factCheck.correctionOne', 'chat.factCheck.correctionMany')}${rest}`
        }
        if (wrongCount > 0) {
          const rest = uncertainCount > 0
            ? ` · ${t('chat.factCheck.toVerifySuffix', { count: uncertainCount })}`
            : ''
          return `❌ ${plural(wrongCount, 'chat.factCheck.errorOne', 'chat.factCheck.errorMany')}${rest}`
        }
        return `⚠️ ${plural(uncertainCount, 'chat.factCheck.toVerifyOne', 'chat.factCheck.toVerifyMany')}`
      }
    }
  })()

  // Chaque état a son traitement visuel propre — pas seulement une couleur
  // de texte : pending pulse, failed = pilule pointillée neutre.
  const summaryClass = (() => {
    switch (status) {
      case 'pending':
        return 'text-theme-muted animate-pulse'
      case 'failed':
        return 'text-theme-muted border border-dashed border-theme-border rounded-full px-2 py-0.5'
      case 'success-empty':
        return 'text-emerald-700 dark:text-emerald-400'
      case 'success-with-claims':
        return corrected > 0
          ? 'text-blue-700 dark:text-blue-400'
          : wrongCount > 0 || result.overallConfidence === 'low'
            ? 'text-red-700 dark:text-red-400'
            : 'text-amber-700 dark:text-amber-400'
    }
  })()

  // Toujours afficher le badge quand le fact-check a tourné — même si
  // 0 claim risqué. Permet à l'utilisateur de voir que la vérif est
  // active. Sinon impossible de distinguer "fact-check pas activé" de
  // "fact-check activé mais rien à signaler".

  return (
    <div className="mt-2 text-xs font-sans">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity ${summaryClass}`}
        title={t('chat.factCheck.verifiedBy', { model: result.modelLabel })}
        aria-expanded={expanded}
      >
        <span>{summary}</span>
        <span className="opacity-60 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-theme-border space-y-2">
          {status !== 'pending' && (
            <p className="text-[10px] uppercase tracking-kicker text-theme-muted">
              {t('chat.factCheck.verifiedBy', { model: result.modelLabel })}
              {corrected > 0 && (
                <span className="ml-2 text-blue-700 dark:text-blue-400 normal-case tracking-normal">
                  · {plural(corrected, 'chat.factCheck.correctionOne', 'chat.factCheck.correctionMany')}{' '}
                  {t('chat.factCheck.correctionsInResponse')}
                </span>
              )}
            </p>
          )}
          {status === 'pending' ? (
            <p className="text-theme-muted italic">{t('chat.factCheck.pendingDetail')}</p>
          ) : status === 'failed' ? (
            <p className="text-theme-muted italic">{t('chat.factCheck.unavailableDetail')}</p>
          ) : result.claims.length === 0 ? (
            <p className="text-theme-muted italic">{t('chat.factCheck.noRiskyDetail')}</p>
          ) : (
            result.claims.map((c, i) => {
              const hasCorrection = c.verdict === 'wrong' && !!c.originalText && !!c.correction
              // `applied` = la substitution a RÉELLEMENT eu lieu dans la
              // réponse. Rétro-compat : résultats persistés avant ce champ
              // (undefined) traités comme appliqués, sinon on dégraderait
              // rétroactivement les diffs des anciennes conversations.
              const wasCorrected = hasCorrection && c.applied !== false
              return (
                <div key={i} className="text-theme-ink/80">
                  <div className={`flex items-start gap-1.5 ${VERDICT_STYLE[c.verdict] || ''}`}>
                    <span className="shrink-0 mt-px">{wasCorrected ? '✏️' : VERDICT_ICON[c.verdict] || '•'}</span>
                    <span className="font-medium">{c.claim}</span>
                  </div>
                  {wasCorrected && (
                    <div className="ml-5 mt-1 space-y-0.5">
                      <p className="text-red-700 dark:text-red-400 line-through">
                        {c.originalText}
                      </p>
                      <p className="text-emerald-700 dark:text-emerald-400">
                        → {c.correction}
                      </p>
                    </div>
                  )}
                  {hasCorrection && !wasCorrected && (
                    <div className="ml-5 mt-1 space-y-0.5">
                      <p className="text-emerald-700 dark:text-emerald-400">
                        → {t('chat.factCheck.correctValue')} {c.correction}
                      </p>
                      <p className="text-theme-muted italic text-[10px]">
                        {t('chat.factCheck.notAppliedHint')}
                      </p>
                    </div>
                  )}
                  {c.explanation && (
                    <p className="ml-5 mt-0.5 text-theme-muted">{c.explanation}</p>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
})
