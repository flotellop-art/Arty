import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../types'
import { prepareOfficeExport, type OfficeExportSession } from '../../services/officeExport/session'
import type { ExportDocument, ExportFormat } from '../../services/officeExport/types'
import { BottomSheet } from '../shared/BottomSheet'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'

export function OfficeExportModal({ conversation, messageId, onClose }: { conversation: Conversation; messageId?: string; onClose(): void }) {
  const { t } = useTranslation()
  const initial = useRef({ conversation, messageId })
  const [identity] = useState(() => ({ owner: getActiveUserId(), epoch: getActiveSessionEpoch() }))
  const session = useRef<OfficeExportSession | null>(null)
  const controller = useRef<AbortController | null>(null)
  const closed = useRef(false)
  const [document, setDocument] = useState<ExportDocument | null>(null)
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [selected, setSelected] = useState<string[]>([])
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [engaged, setEngaged] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const close = useCallback(() => { closed.current = true; controller.current?.abort(); session.current?.dispose(); onClose() }, [onClose])
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; closed.current = false
    void prepareOfficeExport(initial.current.conversation, initial.current.messageId, abort.signal, () => {
      if (!abort.signal.aborted) { setDocument(null); setAgreed(false); setError('Aperçu annulé : session ou contenu modifié. Fermez cette fenêtre puis recommencez.') }
    }).then(value => {
      if (abort.signal.aborted) { value.dispose(); return }
      session.current = value; setDocument(value.document)
      setSelected(value.document.messages.flatMap(m => m.blocks.filter(b => b.kind === 'table').map(b => b.id)))
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Export impossible.') })
    return () => { abort.abort(); session.current?.dispose() }
  }, [])
  const tables = document?.messages.flatMap(m => m.blocks.filter(b => b.kind === 'table')) ?? []
  const wordTooWide = tables.some(t => t.rows[0]!.length > 8)
  const interrupted = document?.messages.some(m => m.interrupted)
  const deliver = async () => {
    if (!session.current || busy || !agreed) return
    setBusy(true); setError(''); setEngaged(false)
    try {
      await session.current.deliver({ format, tableIds: selected }, () => { if (!closed.current) setEngaged(true) })
      if (!closed.current) { setDone(true); setAgreed(false) }
    } catch (e) { if (!closed.current) setError(e instanceof Error ? e.message : 'Export impossible.') }
    finally { if (!closed.current) setBusy(false) }
  }
  if (identity.owner !== getActiveUserId() || identity.epoch !== getActiveSessionEpoch() || initial.current.conversation.id !== conversation.id) return null
  return <BottomSheet open onClose={close} title={messageId ? 'Exporter cette réponse' : 'Exporter les échanges du fil'}>
    <div className="space-y-4 text-sm text-theme-ink max-w-3xl mx-auto pb-3">
      <p>Fichier modifiable dans Word ou Excel, sans nouvelle génération IA. La génération reste locale ; une application de partage choisie peut ensuite envoyer le fichier à son propre service. Les fragments de réponse en cours sont exclus.</p>
      {conversation.comparison && <p role="note">{t('compare.context.exportNotice')}</p>}
      {!document && !error && <p role="status">Préparation de l’aperçu local…</p>}
      {document && <>
        <p>{document.messages.length} message(s), {document.chars.toLocaleString('fr-FR')} caractères, {tables.length} tableau(x) reconnu(s).</p>
        <p>Non incorporés : {document.omissions.images} image(s), {document.omissions.html} bloc(s) HTML, {document.omissions.unsupported} autre(s) élément(s), {document.omissions.attachments} pièce(s) jointe(s). Les sources sont les références conservées dans chaque message, sans relecture des documents.</p>
        {interrupted && <p role="note" className="text-amber-700 dark:text-amber-400">Attention : cet export contient une réponse interrompue, potentiellement incomplète.</p>}
        <fieldset disabled={busy || done} className="flex flex-wrap gap-4">
          <legend className="sr-only">Format du fichier</legend>
          <label><input type="radio" name="office-format" checked={format === 'docx'} onChange={() => { setFormat('docx'); setAgreed(false) }} /> Word (.docx)</label>
          <label><input type="radio" name="office-format" checked={format === 'xlsx'} onChange={() => { setFormat('xlsx'); setAgreed(false) }} /> Excel (.xlsx)</label>
        </fieldset>
        {format === 'docx' && wordTooWide && <p role="alert">Un tableau dépasse les 8 colonnes prévues pour Word. Choisissez Excel ou simplifiez le tableau.</p>}
        {format === 'xlsx' && <>
          <p>Un tableau sélectionné par feuille. Toutes les cellules restent du texte : zéros, dates et expressions conservés littéralement, sans formule ni conversion numérique automatique. Convertissez les nombres dans Excel si nécessaire.</p>
          {!tables.length && <p role="status">Aucun tableau Markdown reconnu. Les tableaux HTML et ceux dans un bloc de code ne sont pas exportés en Excel.</p>}
          <fieldset disabled={busy || done} className="space-y-2">
            <legend>Tableaux à exporter</legend>
            {tables.map((table, i) => <label key={table.id} className="block rounded border border-theme-border p-2 break-words">
              <input type="checkbox" checked={selected.includes(table.id)} onChange={e => { setSelected(old => e.target.checked ? [...old, table.id] : old.filter(id => id !== table.id)); setAgreed(false) }} /> Tableau {i + 1} — message {table.message} : {table.rows.length} lignes × {table.rows[0]!.length} colonnes
              <span className="block text-theme-muted">{table.rows[0]!.join(' | ')}</span>
            </label>)}
          </fieldset>
        </>}
        <details className="border border-theme-border rounded p-3">
          <summary className="cursor-pointer">{format === 'xlsx' ? 'Relire les tableaux sélectionnés et leurs références' : 'Relire le contenu et les références'}</summary>
          <div className="max-h-64 overflow-auto space-y-3 mt-3">
            {document.messages.map((m, i) => format === 'xlsx' && !m.blocks.some(b => b.kind === 'table' && selected.includes(b.id)) ? null : <section key={m.id}>
              <h3 className="font-semibold">Message {i + 1} — {m.role === 'user' ? 'Vous' : 'Arty'}{m.interrupted ? ' (interrompu)' : ''}</h3>
              {m.model && <p>Modèle indiqué dans l’historique : {m.model}</p>}
              {m.outputNotice && <p role="note" className="font-medium">{m.outputNotice}</p>}
              <pre className="whitespace-pre-wrap break-words font-sans">{m.blocks.filter(b => format === 'docx' || (b.kind === 'table' && selected.includes(b.id))).map(b => b.kind === 'table' ? b.rows.map(r => r.join(' | ')).join('\n') : b.runs.map(r => r.text).join('')).join('\n\n')}</pre>
              {m.sources.map((s, j) => <p key={j} className="text-xs break-words mt-1">{s}</p>)}
            </section>)}
          </div>
        </details>
        <p className="text-xs text-theme-muted">Limites : 50 messages, 200 000 caractères, 32 tableaux, 10 000 cellules, 8 192 caractères par cellule. Le fichier exporté n’est pas chiffré. {Capacitor.isNativePlatform() && 'Une copie est placée dans le cache de l’application. Nettoyage après 24 h lors d’un prochain export, au maximum 32 copies récentes ; les copies chez les destinataires ne sont pas effacées.'}</p>
        <label className="flex gap-2 items-start"><input type="checkbox" checked={agreed} disabled={busy || done} onChange={e => setAgreed(e.target.checked)} /><span>J’ai vérifié le périmètre et les exclusions{interrupted ? ', y compris la réponse interrompue' : ''}, et je souhaite exporter ce contenu.</span></label>
      </>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {engaged && <p role="status">{Capacitor.isNativePlatform() ? 'Transmission à la feuille de partage demandée. Sa fermeture ne révoque pas une copie déjà transmise.' : 'Téléchargement demandé au navigateur.'} {done && 'Vérifiez le fichier dans la destination choisie.'}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button onClick={close} className="min-h-11 px-4 border border-theme-border rounded-lg">{done ? 'Fermer' : 'Annuler'}</button>
        {!done && <button disabled={!document || !agreed || busy || (format === 'docx' ? wordTooWide : !selected.length)} onClick={() => void deliver()} className="min-h-11 px-4 rounded-lg bg-theme-accent text-white disabled:opacity-40">{busy ? 'Génération…' : Capacitor.isNativePlatform() ? 'Préparer le partage' : 'Télécharger'}</button>}
      </div>
    </div>
  </BottomSheet>
}
