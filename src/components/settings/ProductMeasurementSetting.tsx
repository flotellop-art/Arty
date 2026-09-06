import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { isProductMeasurementEnabled, productMeasurementAvailable, productMeasurementWithdrawalPending, setProductMeasurementEnabled, subscribeProductMeasurement } from '../../services/productMeasurement'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { PRODUCT_MEASUREMENT_RELEASED } from '../../services/productMeasurementProtocol'

const snapshot = () => `${productMeasurementAvailable()}:${isProductMeasurementEnabled()}:${productMeasurementWithdrawalPending()}`
export function ProductMeasurementSetting() {
  return PRODUCT_MEASUREMENT_RELEASED ? <PublishedProductMeasurementSetting /> : null
}
function PublishedProductMeasurementSetting() {
  const { t } = useTranslation(), state = useSyncExternalStore(subscribeProductMeasurement, snapshot)
  const [available, enabled, withdrawalPending] = state.split(':').map(value => value === 'true')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => onLocalDataInvalidated(() => setError(null)), [])
  return <section aria-labelledby="product-measurement-title" className="space-y-2 border-t border-theme-line pt-4">
    <div className="flex items-center justify-between gap-4">
      <h3 id="product-measurement-title" className="font-display text-base text-theme-ink">{t('productMeasurement.title')}</h3>
      <button type="button" role="switch" aria-checked={enabled} aria-labelledby="product-measurement-title"
        aria-describedby="product-measurement-help product-measurement-auth product-measurement-withdrawal" disabled={!available || withdrawalPending}
        className="shrink-0 rounded-full border border-theme-line px-3 py-2 text-sm text-theme-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => {
          setError(null)
          try { setProductMeasurementEnabled(!enabled) }
          catch { setError(enabled ? 'productMeasurement.withdrawError' : 'productMeasurement.enableError') }
        }}>{t(enabled ? 'productMeasurement.on' : 'productMeasurement.off')}</button>
    </div>
    <p id="product-measurement-help" className="text-sm text-theme-muted">{t('productMeasurement.help')}</p>
    <p id="product-measurement-auth" className="text-xs text-theme-muted">{t('productMeasurement.auth')}</p>
    <p id="product-measurement-withdrawal" className="text-xs text-theme-muted">{t('productMeasurement.withdrawal')}</p>
    {!available && <p className="text-sm text-theme-muted">{t('productMeasurement.unavailable')}</p>}
    {(withdrawalPending || error) && <p role="alert" className="text-sm text-red-500">{t(withdrawalPending ? 'productMeasurement.withdrawError' : error!)}</p>}
    {withdrawalPending && available && <button type="button" className="rounded border border-theme-line px-3 py-2 text-sm text-theme-ink" onClick={() => {
      try { setProductMeasurementEnabled(false); setError(null) }
      catch { setError('productMeasurement.withdrawError') }
    }}>{t('productMeasurement.retryWithdrawal')}</button>}
  </section>
}
