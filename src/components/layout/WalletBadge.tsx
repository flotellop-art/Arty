import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchWalletBalance, type WalletBalance } from '../../services/walletClient'

// 1 crédit AFFICHÉ = 1 cent US (10 000 micro-USD). C'est un choix de PRÉSENTATION
// (à régler avec le mapping prix/crédits) — le backend reste en micro-USD.
const MICRO_PER_CREDIT = 10_000
// Sous ce seuil de crédits, on passe le badge en orange (puis rouge à 0).
const LOW_CREDITS = 50
// Refresh : l'event 'cost-updated' (BUG 54) fire après chaque message → couvre
// l'essentiel ; l'interval ne sert qu'au sync multi-device. (Même logique que CostIndicator.)
const REFRESH_MS = 5 * 60_000

export function WalletBadge() {
  const { t } = useTranslation()
  const [data, setData] = useState<WalletBalance | null>(null)

  const refresh = useCallback(async () => {
    const bal = await fetchWalletBalance()
    if (bal) setData(bal)
  }, [])

  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, REFRESH_MS)
    const onCostEvent = () => {
      refresh()
    }
    window.addEventListener('cost-updated', onCostEvent)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('cost-updated', onCostEvent)
    }
  }, [refresh])

  // Affiché uniquement pour les utilisateurs qui ont un wallet (crédits achetés).
  if (!data || !data.hasWallet) return null

  const credits = Math.max(0, Math.floor(data.availableMicro / MICRO_PER_CREDIT))
  const color =
    credits <= 0 ? 'text-red-500' : credits <= LOW_CREDITS ? 'text-yellow-600' : 'text-green-600'

  return (
    <span
      className={`px-2 py-1 text-[11px] font-mono font-semibold rounded-md ${color}`}
      title={t('wallet.badgeTitle')}
      aria-label={t('wallet.badgeAria')}
    >
      {t('wallet.badge', { credits })}
    </span>
  )
}
