import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { generatedImageIds } from '../../services/generatedImages'
import { captureGeneratedImageView, readGeneratedImage } from '../../services/generatedImageFiles'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { PROJECT_ERASURE_FENCE_KEY } from '../../services/userSession'
import { downloadOrShareFile } from '../../services/native/shareFile'
import { isCryptoReady } from '../../services/crypto'
import { getActiveUserId, getActiveSessionEpoch, getSessionProjectFence } from '../../services/userSession'

type Loaded = Awaited<ReturnType<typeof readGeneratedImage>> & { url: string; fileId: string }
function ImageCard({ fileId, index }: { fileId: string; index: number }) {
  const { t } = useTranslation()
  const element = useRef<HTMLDivElement>(null)
  const [assertView] = useState(() => captureGeneratedImageView())
  const abortRead = useRef<() => void>(() => {})
  const [visible, setVisible] = useState(false)
  const [invalidated, setInvalidated] = useState(false)
  const [failed, setFailed] = useState(false)
  const [deliveryError, setDeliveryError] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    const invalidate = () => { abortRead.current(); setLoaded(null); setInvalidated(true) }
    const unsubscribe = onLocalDataInvalidated(invalidate)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PROJECT_ERASURE_FENCE_KEY || event.key === 'arty-known-sessions' || event.key === 'arty-active-session') invalidate()
    }
    window.addEventListener('storage', onStorage)
    try { assertView() } catch { invalidate() }
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage) }
  }, [assertView])
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: '160px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || invalidated) { setLoaded(null); return }
    const controller = new AbortController()
    let url: string | null = null
    const revoke = () => { if (url) { URL.revokeObjectURL(url); url = null } }
    abortRead.current = () => { controller.abort(); revoke() }
    setFailed(false); setLoaded(null)
    void readGeneratedImage(fileId, controller.signal, assertView).then(result => {
      result.assertCurrent()
      url = URL.createObjectURL(result.blob)
      setLoaded({ ...result, url, fileId })
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); revoke() }
  }, [fileId, visible, invalidated, assertView])

  const current = visible && !invalidated && loaded?.fileId === fileId ? loaded : null
  const save = async () => {
    if (!current) return
    setDeliveryError(false)
    try {
      current.assertCurrent()
      await downloadOrShareFile(current.blob, current.filename, { title: t('image.galleryTitle'), assertCurrent: current.assertCurrent, validate: current.validate })
    } catch { setDeliveryError(true) }
  }
  return <div ref={element} className="my-3 max-w-sm rounded-xl border border-theme-border p-3">
    <div className="mb-2 text-xs text-theme-muted">{t('image.galleryItem', { number: index + 1 })}</div>
    {invalidated || failed ? <p role="status" className="text-xs">{t('image.galleryUnavailable')}</p> : current ?
      <img src={current.url} alt={t('image.galleryItem', { number: index + 1 })} className="w-full rounded-lg" onError={() => { abortRead.current(); setLoaded(null); setFailed(true) }} /> :
      visible ? <div role="status" className="aspect-square animate-pulse bg-theme-surface rounded-lg"><span className="sr-only">{t('image.galleryLoading')}</span></div> :
        <button className="min-h-11 text-theme-accent-text text-sm" onClick={() => setVisible(true)}>{t('image.galleryLoad')}</button>}
    {current && !failed && <button className="mt-2 min-h-11 rounded-lg border border-theme-border px-3 py-2 text-sm" onClick={() => void save()}>{t('image.gallerySave')}</button>}
    {deliveryError && <p role="alert" className="text-xs">{t('image.galleryDeliveryError')}</p>}
  </div>
}

/** Private messages only. Never accept Markdown/public content as file authority. */
export function GeneratedImageGallery({ images }: { images: readonly string[] }) {
  const { t } = useTranslation()
  // A crash-safety plaintext history can appear before crypto boot completes.
  // Defer the FIRST scope capture only; an invalidated card never reacquires it.
  const [opening] = useState(() => ({ owner: getActiveUserId(), epoch: getActiveSessionEpoch(), fence: getSessionProjectFence() }))
  const [ready, setReady] = useState(isCryptoReady)
  useEffect(() => {
    if (ready) return
    const onReady = () => {
      if (opening.owner === getActiveUserId() && opening.epoch === getActiveSessionEpoch() &&
        opening.fence === (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial') && isCryptoReady()) setReady(true)
    }
    window.addEventListener('conversations-storage-ready', onReady)
    onReady()
    return () => window.removeEventListener('conversations-storage-ready', onReady)
  }, [opening, ready])
  const ids = generatedImageIds(images)
  if (!ids.length) return null
  return <section aria-label={t('image.galleryTitle')}>
    <h4 className="mt-3 text-xs font-semibold">{t('image.galleryTitle')}</h4>
    {ready ? ids.map((id, index) => <ImageCard key={id} fileId={id} index={index} />) : <p role="status" className="text-xs">{t('image.galleryLoading')}</p>}
    <p className="text-xs text-theme-muted">{t('image.galleryStored')}</p>
  </section>
}
