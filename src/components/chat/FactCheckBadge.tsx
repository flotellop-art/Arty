// Badge affiché sous une réponse assistant après que le fact-checker l'a
// vérifiée. Discret par défaut (✓ vert si tout vérifié), expandable si
// claims uncertain ou wrong détectés.
//
// Cliquable → expand pour voir les claims un par un avec leur verdict
// et l'explication du fact-checker.

import { memo, useState } from 'react'
import type { FactCheckResult } from '../../types'

interface Props {
  result: FactCheckResult
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
  const [expanded, setExpanded] = useState(false)

  // Bug remonté (screenshot 13 mai 2026) : quand factCheckResponse retourne
  // null (timeout, 401, parse fail), factChecker.ts crée un placeholder
  // avec modelLabel='⚠ Fact-check indisponible' + claims=[] + confidence=
  // 'medium'. Le badge affichait alors "⚠️ 0 points à vérifier" + "Aucun
  // claim factuel risqué identifié" — totalement contradictoire avec
  // "INDISPONIBLE". Maintenant : détecter explicitement et afficher un
  // état "indisponible" cohérent sans mentir sur les claims.
  const isUnavailable = result.modelLabel?.includes('indisponible')

  const wrongCount = result.claims.filter((c) => c.verdict === 'wrong').length
  const uncertainCount = result.claims.filter((c) => c.verdict === 'uncertain').length
  const verifiedCount = result.claims.filter((c) => c.verdict === 'verified').length
  const totalRisky = wrongCount + uncertainCount
  const corrected = result.appliedCorrections || 0

  const summary = (() => {
    if (isUnavailable) return '❓ Fact-check indisponible'
    if (corrected > 0) {
      const rest = uncertainCount > 0 ? ` · ${uncertainCount} à vérifier` : ''
      return `✏️ ${corrected} ${corrected > 1 ? 'corrections appliquées' : 'correction appliquée'}${rest}`
    }
    if (result.overallConfidence === 'high' && totalRisky === 0) {
      return verifiedCount > 0
        ? `✓ ${verifiedCount} ${verifiedCount > 1 ? 'claims vérifiés' : 'claim vérifié'}`
        : `✓ Aucun claim risqué`
    }
    if (wrongCount > 0) {
      return `❌ ${wrongCount} ${wrongCount > 1 ? 'erreurs détectées' : 'erreur détectée'}${uncertainCount > 0 ? ` · ${uncertainCount} à vérifier` : ''}`
    }
    if (uncertainCount === 0) return '✓ Aucun claim risqué'
    return `⚠️ ${uncertainCount} ${uncertainCount > 1 ? 'points à vérifier' : 'point à vérifier'}`
  })()

  const summaryColor = isUnavailable
    ? 'text-theme-muted'
    : corrected > 0
      ? 'text-blue-700 dark:text-blue-400'
      : result.overallConfidence === 'low'
      ? 'text-red-700 dark:text-red-400'
      : result.overallConfidence === 'medium'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-emerald-700 dark:text-emerald-400'

  // Toujours afficher le badge quand le fact-check a tourné — même si
  // 0 claim risqué. Permet à l'utilisateur de voir que la vérif est
  // active. Sinon impossible de distinguer "fact-check pas activé" de
  // "fact-check activé mais rien à signaler".

  return (
    <div className="mt-2 text-xs font-sans">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity ${summaryColor}`}
        title={`Fact-check par ${result.modelLabel}`}
      >
        <span>{summary}</span>
        <span className="opacity-60 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-theme-border space-y-2">
          <p className="text-[10px] uppercase tracking-kicker text-theme-muted">
            Vérifié par {result.modelLabel}
            {corrected > 0 && (
              <span className="ml-2 text-blue-700 dark:text-blue-400">
                · {corrected} correction{corrected > 1 ? 's' : ''} appliquée{corrected > 1 ? 's' : ''} dans la réponse
              </span>
            )}
          </p>
          {isUnavailable ? (
            <p className="text-theme-muted italic">
              La vérification factuelle n'a pas pu aboutir (timeout, surcharge ou réseau).
              La réponse ci-dessus n'a pas été vérifiée — relis-la avec un œil critique.
            </p>
          ) : result.claims.length === 0 ? (
            <p className="text-theme-muted italic">Aucun claim factuel risqué identifié.</p>
          ) : (
            result.claims.map((c, i) => {
              const wasCorrected = c.verdict === 'wrong' && c.originalText && c.correction
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
