import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchWalletBalance,
  microToCredits,
  type WalletBalance,
} from '../../services/walletClient'
import { captureBillingContext, onBillingContextInvalidated } from '../../services/billingContext'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'

// 1 crédit AFFICHÉ = 1 cent US : la conversion µ$ ↔ crédits vit dans walletClient
// (microToCredits) — une seule source pour toutes les surfaces (P1.7).
// Sous ce seuil de crédits, on passe le badge en orange (puis rouge à 0).
const LOW_CREDITS = 50
// Refresh : l'event 'cost-updated' (BUG 54) fire après chaque message → couvre
// l'essentiel ; l'interval ne sert qu'au sync multi-device. (Même logique que CostIndicator.)
const REFRESH_MS = 5 * 60_000

export function WalletBadge() {
  const { t } = useTranslation()
  const [data, setData] = useState<WalletBalance | null>(null)
  const serial = useRef(0), alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!alive.current) return
    const id = ++serial.current, context = captureBillingContext()
    if (!context.isCurrent()) return
    const bal = await fetchWalletBalance()
    if (alive.current && id === serial.current && context.isCurrent() && id === serial.current) setData(bal)
  }, [])

  useEffect(() => {
    alive.current = true
    const invalidate = () => { serial.current += 1; setData(null) }
    const offGrant = onBillingContextInvalidated(invalidate), offOwner = onLocalDataInvalidated(invalidate)
    void refresh()
    const interval = window.setInterval(refresh, REFRESH_MS)
    const onRefreshEvent = () => {
      refresh()
    }
    // 'cost-updated' (BUG 54) après chaque message ; 'wallet-updated' après un
    // achat de crédits (retour de checkout Creem) pour màj instantanée du solde.
    window.addEventListener('cost-updated', onRefreshEvent)
    window.addEventListener('wallet-updated', onRefreshEvent)
    window.addEventListener('google-storage-ready', onRefreshEvent)
    return () => {
      alive.current = false; serial.current += 1; offGrant(); offOwner()
      window.clearInterval(interval)
      window.removeEventListener('cost-updated', onRefreshEvent)
      window.removeEventListener('wallet-updated', onRefreshEvent)
      window.removeEventListener('google-storage-ready', onRefreshEvent)
    }
  }, [refresh])

  // Affiché uniquement pour les utilisateurs qui ont un wallet (crédits achetés).
  if (!data || !data.hasWallet) return null

  const credits = microToCredits(data.availableMicro)
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
