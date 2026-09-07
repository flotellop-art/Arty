import { useEffect, useState, useCallback, useRef, useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchWalletBalance,
  microToCredits,
  getWalletSnapshot,
  onWalletBalanceChanged,
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
  const [showDetails, setShowDetails] = useState(false)
  const detailId = useId()
  const serial = useRef(0), alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!alive.current) return
    const id = ++serial.current, context = captureBillingContext()
    if (!context.isCurrent()) return
    await fetchWalletBalance()
    if (alive.current && id === serial.current && context.isCurrent() && id === serial.current) setData(getWalletSnapshot())
  }, [])

  useEffect(() => {
    alive.current = true
    const invalidate = () => { serial.current += 1; setData(null); setShowDetails(false) }
    const offGrant = onBillingContextInvalidated(invalidate), offOwner = onLocalDataInvalidated(invalidate)
    const offBalance = onWalletBalanceChanged(() => {
      if (alive.current) setData(getWalletSnapshot())
    })
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
      alive.current = false; serial.current += 1; offGrant(); offOwner(); offBalance()
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

  if (data.reversalPending) return (
    <div className="relative text-[11px]" onKeyDown={event => { if (event.key === 'Escape') setShowDetails(false) }}>
      <button type="button" className="cursor-pointer rounded-md px-2 py-1 font-semibold text-red-500 focus-visible:outline"
        onClick={() => setShowDetails(value => !value)} aria-expanded={showDetails} aria-controls={detailId}
        aria-label={`${t('wallet.badgeAria')}: ${t('wallet.reversalBadge')}`}>
        {t('wallet.reversalBadge')}
      </button>
      <div id={detailId} hidden={!showDetails} className="absolute right-0 top-full z-[60] mt-2 w-72 max-w-[85vw] rounded-lg border border-theme-border bg-theme-surface p-3 text-sm text-theme-ink shadow-lg">
        <p>{t('wallet.reversalDetail', { balance: microToCredits(data.balanceMicro), reserved: microToCredits(data.reservedMicro) })}</p>
        <button type="button" onClick={() => void refresh()} className="mt-2 rounded-md border border-theme-border px-3 py-2 focus-visible:outline">
          {t('wallet.refresh')}
        </button>
      </div>
    </div>
  )

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
