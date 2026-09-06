import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addProjectDocument, beginProjectOperation, createProject, deleteProject, listProjects,
  removeProjectDocument, updateProject, type ProjectOperation } from '../services/projects/store'
import { prepareProjectDocument } from '../services/projects/documentImport'
import { buildProjectContext, type ProjectContext } from '../services/projects/context'
import { PROJECT_LIMITS, ProjectError, type Project, type ProjectSummary } from '../services/projects/types'

const button = 'min-h-11 border border-theme-border px-3 py-2 text-sm disabled:opacity-40'
const input = 'w-full border border-theme-border bg-theme-bg p-2 text-theme-ink'

export function ProjectsScreen({ onBack, onStartConversation, onProjectSynthesis }: { onBack: () => void; onStartConversation?: (project: Project) => void; onProjectSynthesis?: (project: Project) => void }) {
  const { t, i18n } = useTranslation()
  const operation = useRef<ProjectOperation | null>(null), running = useRef(false), fileInput = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]), [selected, setSelected] = useState<ProjectSummary | null>(null)
  const [newName, setNewName] = useState(''), [newEU, setNewEU] = useState(false)
  const [name, setName] = useState(''), [instructions, setInstructions] = useState('')
  const [query, setQuery] = useState(''), [sourceIds, setSourceIds] = useState<string[]>([])
  const [context, setContext] = useState<ProjectContext | null>(null), [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [imported, setImported] = useState(0)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const project = selected?.project
  const dirty = project && (name !== project.name || instructions !== project.instructions)
  const reportError = (reason: unknown) => setError(reason instanceof ProjectError ? reason.code : 'unavailable')

  useEffect(() => {
    let alive = true, refreshing = false
    const load = async () => {
      if (!alive || refreshing) return
      refreshing = true; setLoading(true); setError('')
      try {
        const captured = await beginProjectOperation()
        const guarded: ProjectOperation = { ...captured, assertCurrent() {
          captured.assertCurrent()
          if (!alive) throw new ProjectError('cancelled')
        } }
        guarded.assertCurrent(); operation.current = guarded
        const projects = await listProjects(guarded); guarded.assertCurrent()
        setSummaries(projects)
      } catch (reason) { if (alive) reportError(reason) }
      finally { refreshing = false; if (alive) setLoading(false) }
    }
    const ready = () => { if (!operation.current) void load() }
    window.addEventListener('file-storage-ready', ready)
    void load()
    return () => { alive = false; operation.current = null; window.removeEventListener('file-storage-ready', ready) }
  }, [loadAttempt])

  const show = (summary: ProjectSummary | null) => {
    setSelected(summary); setName(summary?.project?.name ?? ''); setInstructions(summary?.project?.instructions ?? '')
    setSourceIds([]); setContext(null); setConfirmDelete(null); setQuery('')
    setImported(0)
  }
  const remember = (saved: Project) => {
    const summary: ProjectSummary = { id: saved.id, revision: saved.revision, euOnly: saved.euOnly, status: 'ready', project: saved }
    setSummaries(prior => [summary, ...prior.filter(p => p.id !== saved.id)])
    show(summary)
  }
  const run = async (action: (op: ProjectOperation) => Promise<void>) => {
    if (running.current) return
    const op = operation.current
    if (!op) { setError('unavailable'); return }
    running.current = true; setBusy(true); setError('')
    try { op.assertCurrent(); await action(op) }
    catch (reason) { if (operation.current === op) reportError(reason) }
    finally { running.current = false; if (operation.current === op) setBusy(false) }
  }
  const importFiles = (files: File[]) => {
    if (!project || dirty) return
    void run(async op => {
      let current = project, count = 0
      setImported(0)
      for (const file of files) {
        op.assertCurrent()
        const prepared = await prepareProjectDocument(op, file)
        current = await addProjectDocument(op, current, prepared)
        op.assertCurrent(); remember(current); setImported(++count)
      }
    })
  }
  const retrieve = (mode: 'search' | 'overview') => {
    if (!project || dirty) return
    void run(async op => {
      const result = await buildProjectContext(op, project, query, { mode, ...(sourceIds.length ? { documentIds: sourceIds } : {}) })
      op.assertCurrent(); setContext(result)
    })
  }
  return <div className="h-full overflow-y-auto bg-theme-bg text-theme-ink p-4 sm:p-6">
    <div className="mx-auto max-w-5xl pb-12">
      <button className={button} disabled={!!dirty} onClick={onBack}>← {t('common.back')}</button>
      <h1 className="font-display text-3xl mt-5">{t('projects.title')}</h1>
      <p className="mt-2 text-sm text-theme-muted">{t('projects.privacy')}</p>
      <p className="mt-1 text-xs text-theme-muted">{t('projects.limits')}</p>
      {!onStartConversation && <p className="mt-2 text-sm">{t('projects.localStage')}</p>}
      {error && <div role="alert" className="mt-4 border border-red-500 p-3 text-sm">
        {t(`projects.errors.${error}`)}
        <p className="mt-1">{t('projects.recovery')}</p>
      </div>}
      {loading ? <p role="status" className="mt-6">{t('common.loading')}</p> : <>
        <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(async op => {
          if (dirty) return
          const saved = await createProject(op, newName, newEU); op.assertCurrent(); remember(saved); setNewName('')
        }) }}>
          <label className="flex-1 min-w-48 text-sm">{t('projects.newName')}<input className={input} value={newName} maxLength={PROJECT_LIMITS.nameChars} required disabled={busy || !!dirty || !operation.current} onChange={e => setNewName(e.target.value)} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={newEU} disabled={busy || !!dirty} onChange={e => setNewEU(e.target.checked)} />{t('projects.eu')}</label>
          <button className={button} disabled={busy || !!dirty || !newName.trim() || !operation.current}>{t('projects.create')}</button>
        </form>
        <div className="mt-6 grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label={t('projects.list')} className="space-y-2">
            {summaries.length === 0 && <p className="text-sm text-theme-muted">{t('projects.empty')}</p>}
            {summaries.map(summary => <button key={summary.id} className={`${button} w-full break-words text-left ${selected?.id === summary.id ? 'bg-theme-ink/5' : ''}`} disabled={busy || !!dirty} aria-current={selected?.id === summary.id ? 'page' : undefined} onClick={() => { show(summary); setError('') }}>
              {summary.project?.name ?? `${t('projects.locked')} · ${summary.id.slice(0, 8)}`}{summary.euOnly ? ' 🇪🇺' : ''}
            </button>)}
            <button className={`${button} w-full`} disabled={busy || !!dirty} onClick={() => {
              show(null); setSummaries([]); setLoadAttempt(attempt => attempt + 1)
            }}>{t('projects.reload')}</button>
          </nav>
          {selected && <section className="min-w-0 border border-theme-border p-4" aria-label={t('projects.details')}>
            {project ? <>
              <form onSubmit={event => { event.preventDefault(); void run(async op => { const saved = await updateProject(op, project, { name, instructions }); op.assertCurrent(); remember(saved) }) }}>
                <label className="block text-sm">{t('projects.name')}<input className={input} value={name} maxLength={PROJECT_LIMITS.nameChars} required disabled={busy} onChange={e => setName(e.target.value)} /></label>
                <label className="mt-3 block text-sm">{t('projects.instructions')}<textarea className={`${input} min-h-24`} value={instructions} maxLength={PROJECT_LIMITS.instructionsChars} disabled={busy} onChange={e => setInstructions(e.target.value)} /></label>
                <p className="mt-1 text-xs text-theme-muted">{project.euOnly ? t('projects.euFixed') : t('projects.standardFixed')} · {t('projects.revision', { revision: project.revision })}</p>
                <div className="mt-3 flex gap-2"><button className={button} disabled={busy || !dirty || !name.trim()}>{t('projects.save')}</button>
                  {dirty && <button type="button" className={button} disabled={busy} onClick={() => { setName(project.name); setInstructions(project.instructions) }}>{t('projects.discard')}</button>}
                </div>
              </form>
              {dirty && <p className="mt-2 text-sm" role="status">{t('projects.saveFirst')}</p>}
              <h2 className="mt-6 font-display text-xl">{t('projects.documents')}</h2>
              <p className="mt-1 text-xs text-theme-muted">{t('projects.formats')}</p>
              <input ref={fileInput} type="file" multiple accept=".txt,.md,.csv,.docx,.xlsx" className="sr-only" tabIndex={-1} aria-label={t('projects.import')} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; importFiles(files) }} />
              <button className={`${button} mt-3`} disabled={busy || !!dirty} onClick={() => fileInput.current?.click()}>{t('projects.import')}</button>
              {imported > 0 && <p role="status" className="mt-2 text-xs">{t('projects.imported', { count: imported })}</p>}
              <ul className="mt-3 space-y-3">
                {project.documents.map(doc => <li key={doc.id} className="border-b border-theme-border pb-3">
                  <label className="flex items-start gap-2 break-all text-sm"><input type="checkbox" className="mt-1" checked={sourceIds.includes(doc.id)} disabled={busy || !!dirty} onChange={e => { setSourceIds(ids => e.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id)); setContext(null) }} />
                    <span>{doc.name}<span className="block text-xs text-theme-muted">{doc.format.toUpperCase()} · {Math.ceil(doc.sourceBytes / 1024)} KiB · SHA-256 {doc.sourceHash.slice(0, 12)}…</span></span>
                  </label>
                  <button className={`${button} mt-2`} disabled={busy || !!dirty} onClick={() => setConfirmDelete(doc.id)}>{t('projects.removeDocument')}</button>
                </li>)}
              </ul>
              <form className="mt-5" onSubmit={event => { event.preventDefault(); retrieve('search') }}>
                <label className="block text-sm">{t('projects.search')}<input className={input} value={query} maxLength={PROJECT_LIMITS.queryChars} disabled={busy || !!dirty} onChange={e => { setQuery(e.target.value); setContext(null) }} /></label>
                <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy || !!dirty || !query.trim()}>{t('projects.find')}</button>
                  <button type="button" className={button} disabled={busy || !!dirty || sourceIds.length === 0} onClick={() => retrieve('overview')}>{t('projects.overview')}</button></div>
              </form>
              {context && <section className="mt-5 border border-theme-border p-3" aria-label={t('projects.preview')}>
                <h3 className="font-medium">{t('projects.preview')}</h3>
                <p className="text-xs text-theme-muted">{t('projects.coverage', { excerpts: context.excerpts.length, documents: context.examinedDocuments, chars: context.promptChars })}</p>
                <p className="mt-2 text-sm">{t(context.noHit ? 'projects.noHit' : context.truncated ? 'projects.truncated' : 'projects.excerptsOnly')}</p>
                {context.excerpts.map((excerpt, index) => <details key={`${excerpt.reference.documentId}-${index}`} className="mt-3">
                  <summary className="cursor-pointer break-words text-sm">[S{index + 1}] {excerpt.reference.name} · {t('projects.lines', { start: excerpt.reference.startLine, end: excerpt.reference.endLine })}{excerpt.reference.partial ? ` · ${t('projects.partial')}` : ''}</summary>
                  <p className="text-xs break-all text-theme-muted">SHA-256 {excerpt.reference.sourceHash}</p>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{excerpt.text}</pre>
                </details>)}
              </section>}
              {onStartConversation && <button className={`${button} mt-5`} disabled={busy || !!dirty} onClick={() => { try { if (!operation.current) throw new ProjectError('unavailable'); operation.current.assertCurrent(); onStartConversation(project) } catch (reason) { reportError(reason) } }}>{t('projects.startChat')}</button>}
              {onProjectSynthesis && <button className={`${button} mt-3`} disabled={busy || !!dirty || !project.documents.length} onClick={() => { try { if (!operation.current) throw new ProjectError('unavailable'); operation.current.assertCurrent(); onProjectSynthesis(project) } catch (reason) { reportError(reason) } }}>{i18n.language.startsWith('fr') ? 'Synthèse guidée — choisir les documents' : 'Guided synthesis — choose documents'}</button>}
            </> : <p className="text-sm">{t('projects.lockedHelp')}</p>}
            <button className={`${button} mt-6 text-red-600`} disabled={busy} onClick={() => setConfirmDelete('project')}>{t('projects.delete')}</button>
            {confirmDelete && <div role="alertdialog" aria-label={t('projects.confirmTitle')} className="mt-3 border border-red-500 p-3">
              <p className="font-medium">{t('projects.confirmTitle')}</p>
              <p className="mt-2 text-sm">{t(confirmDelete === 'project' ? 'projects.deleteWarning' : 'projects.removeWarning')}</p>
              <div className="mt-3 flex gap-2"><button className={`${button} text-red-600`} disabled={busy || (confirmDelete !== 'project' && !!dirty)} onClick={() => void run(async op => {
                if (confirmDelete !== 'project' && dirty) return
                if (confirmDelete === 'project') { await deleteProject(op, selected.id, selected.revision); op.assertCurrent(); setSummaries(rows => rows.filter(p => p.id !== selected.id)); show(null) }
                else if (project) { const saved = await removeProjectDocument(op, project, confirmDelete); op.assertCurrent(); remember(saved) }
              })}>{t('projects.confirmDelete')}</button><button className={button} disabled={busy} onClick={() => setConfirmDelete(null)}>{t('account.cancel')}</button></div>
            </div>}
          </section>}
        </div>
        {busy && <p role="status" className="mt-4">{t('common.loading')}</p>}
      </>}
    </div>
  </div>
}
