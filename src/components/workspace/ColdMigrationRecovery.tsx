import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'
import type { AccountErasureState } from '../../services/accountErasureJournal'
import ColdErasureRecovery from './ColdErasureRecovery'
import type { ColdMigrationAccount, createColdMigrationErasure, createColdErasurePreparation } from '../../services/workspaceWriter/migration'

/** No accounts, decrypted content, OAuth consumer or private App imports.
 * OFF is also enforced inside the writer, not merely on this button. */
export default function ColdMigrationRecovery({ erasure = false, mode = 'confirmed' }: { erasure?: boolean; mode?: AccountErasureState }) {
  return erasure ? <ColdErasureRecovery mode={mode} /> : <MigrationRecovery />
}
function MigrationRecovery() {
  const { t } = useTranslation()
  const actor = useRef<{ resume(): Promise<unknown> }>()
  const eraser = useRef<ReturnType<typeof createColdMigrationErasure>>()
  const preparer = useRef<ReturnType<typeof createColdErasurePreparation>>()
  const running = useRef(false), chosen = useRef<'resume' | 'erase' | 'prepare'>(), mounted = useRef(true)
  const [mode, setMode] = useState<'choose' | 'resume' | 'erase' | 'prepare'>('choose')
  const [prepareState, setPrepareState] = useState<'working' | 'confirm' | 'preparing' | 'retry' | 'failed' | 'noAccount' | 'done'>('working')
  const [initialInventory, setInitialInventory] = useState(false)
  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'done'>('idle')
  const [eraseState, setEraseState] = useState<'working' | 'choose' | 'confirm' | 'recording' | 'recorded' | 'failed' | 'incomplete'>('working')
  const [accounts, setAccounts] = useState<ColdMigrationAccount[]>([]), [owner, setOwner] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const resume = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || (chosen.current && chosen.current !== 'resume')) return
    chosen.current = 'resume'; setMode('resume'); running.current = true; setState('working')
    try {
      const service = await import('../../services/workspaceWriter/migration')
      if (!mounted.current) return
      actor.current ??= service.createColdWorkspaceMigration()
      await actor.current.resume(); if (mounted.current) setState('done')
    } catch { if (mounted.current) setState('failed') }
    finally { running.current = false }
  }
  const inspectErasure = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || chosen.current) return
    chosen.current = 'erase'; setMode('erase'); running.current = true
    try {
      const service = await import('../../services/workspaceWriter/migration')
      if (!mounted.current) return
      eraser.current = service.createColdMigrationErasure()
      const list = await eraser.current.inspect()
      if (mounted.current) { setAccounts(list); setEraseState(list.length ? 'choose' : 'incomplete') }
    } catch (error) {
      if (mounted.current) setEraseState(error && typeof error === 'object' && 'code' in error && (error.code === 'missing' || error.code === 'unsupported') ? 'incomplete' : 'failed')
    } finally { running.current = false }
  }
  const confirmErasure = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || eraseState !== 'confirm' || !eraser.current) return
    running.current = true; setEraseState('recording')
    try { await eraser.current.confirm(owner); if (mounted.current) setEraseState('recorded') }
    catch { if (mounted.current) setEraseState('failed') }
    finally { running.current = false }
  }
  const inspectPreparation = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || chosen.current) return
    chosen.current = 'prepare'; setMode('prepare'); running.current = true
    try {
      const service = await import('../../services/workspaceWriter/migration')
      if (!mounted.current) return
      preparer.current = service.createColdErasurePreparation()
      const snapshot = await preparer.current.inspect()
      if (mounted.current) { setInitialInventory(snapshot.initialInventory); setPrepareState('confirm') }
    } catch (error) { if (mounted.current) setPrepareState(error && typeof error === 'object' && 'code' in error && error.code === 'no-account' ? 'noAccount' : 'failed') }
    finally { running.current = false }
  }
  const prepareCopies = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || chosen.current !== 'prepare' || !preparer.current || !['confirm', 'retry'].includes(prepareState)) return
    running.current = true; setPrepareState('preparing')
    try { await preparer.current.prepare(); if (mounted.current) setPrepareState('done') }
    catch (error) {
      const divergent = error && typeof error === 'object' && 'code' in error && ['changed', 'missing', 'unsupported', 'collision'].includes(String(error.code))
      if (mounted.current) setPrepareState(divergent ? 'failed' : 'retry')
    } finally { running.current = false }
  }
  const button = 'mt-6 min-h-11 rounded-lg bg-theme-ink px-5 py-3 text-theme-bg disabled:opacity-50'
  const reload = (label: string) => <button type="button" className={button} onClick={() => window.location.reload()}>{t(label)}</button>
  // Keep control characters visible without changing the actual authority ID.
  const shownOwner = (value: string) => JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  if (ISOLATED_WORKSPACE_ENABLED && mode === 'prepare') return <>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{t(`workspaceAdmission.erasurePreparation.${prepareState}`)}</p>
    {(prepareState === 'confirm' || prepareState === 'retry') && <>
      <p className="mt-4 text-sm">{t('workspaceAdmission.erasurePreparation.consent')}</p>
      {initialInventory && <p className="mt-4 text-sm">{t('workspaceAdmission.erasurePreparation.initialInventory')}</p>}
      <button type="button" className={button} onClick={() => { void prepareCopies() }}>{t(`workspaceAdmission.erasurePreparation.${prepareState === 'retry' ? 'retryCta' : 'confirmCta'}`)}</button>
    </>}
    {prepareState === 'done' ? reload('workspaceWindow.reload') :
      !['working', 'preparing'].includes(prepareState) && reload('workspaceAdmission.migrationErasure.reloadChoice')}
  </>
  if (ISOLATED_WORKSPACE_ENABLED && mode === 'erase') return <>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{t(`workspaceAdmission.migrationErasure.${eraseState}`)}</p>
    {eraseState === 'choose' && <fieldset className="mt-4 text-left">
      <legend>{t('workspaceAdmission.migrationErasure.accounts')}</legend>
      {accounts.map(account => <label key={account.owner} className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-theme-border p-3">
        <input type="radio" name="migration-erasure-owner" checked={owner === account.owner} onChange={() => setOwner(account.owner)} />
        <span className="min-w-0 break-all">{account.label && <><span className="block">{account.label}</span>{' '}</>}<bdi dir="ltr">{shownOwner(account.owner)}</bdi></span>
      </label>)}
      <button type="button" className={button} disabled={!owner} onClick={() => setEraseState('confirm')}>{t('workspaceAdmission.migrationErasure.review')}</button>
    </fieldset>}
    {eraseState === 'confirm' && <>
      <p className="mt-4 break-all"><bdi dir="ltr">{shownOwner(owner)}</bdi></p>
      <p className="mt-4 text-sm">{t('workspaceAdmission.migrationErasure.confirmBody')}</p>
      <button type="button" className={button} onClick={() => { void confirmErasure() }}>{t('workspaceAdmission.migrationErasure.confirmCta')}</button>
    </>}
    {eraseState === 'recorded' ? reload('workspaceWindow.reload') :
      !['working', 'recording'].includes(eraseState) && reload('workspaceAdmission.migrationErasure.reloadChoice')}
  </>
  return <>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{t(`workspaceAdmission.recovery.${ISOLATED_WORKSPACE_ENABLED ? state : 'disabled'}`)}</p>
    {ISOLATED_WORKSPACE_ENABLED && (state === 'done'
      ? reload('workspaceWindow.reload')
      : <button type="button" disabled={state === 'working'} className={button} onClick={() => { void resume() }}>{t('workspaceAdmission.recovery.resume')}</button>)}
    {ISOLATED_WORKSPACE_ENABLED && mode === 'choose' && <button type="button" className="mt-3 min-h-11 px-4 underline" onClick={() => { void inspectErasure() }}>{t('workspaceAdmission.migrationErasure.inspect')}</button>}
    {ISOLATED_WORKSPACE_ENABLED && mode === 'choose' && <button type="button" className="mt-3 min-h-11 px-4 underline" onClick={() => { void inspectPreparation() }}>{t('workspaceAdmission.erasurePreparation.inspect')}</button>}
    {ISOLATED_WORKSPACE_ENABLED && mode === 'resume' && state === 'failed' && reload('workspaceAdmission.migrationErasure.reloadChoice')}
  </>
}
