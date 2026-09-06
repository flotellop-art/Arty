import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../i18n'
import { usePlanStatus } from './usePlanStatus'
import { captureLocalReadScope, beginProjectOperation, listProjects } from '../services/projects/store'
import { ProjectError, type Project, type ProjectSummary } from '../services/projects/types'
import type { ReviewProjectRequest } from '../services/projects/chatPreparation'
import type { captureProjectSynthesis } from '../services/workflows/projectSynthesis'
import { projectSynthesisAccess } from '../services/workflows/projectSynthesisAccess'
import { synthesisQuestion, SYNTHESIS_OBJECTIVE_LIMIT } from '../services/workflows/projectSynthesis'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'

type Draft = { projectId: string; projects: ProjectSummary[]; objective: string; documentIds: string[];
  loading: boolean; busy: boolean; error: string | null; adoptedId?: string }
type Start = (args: Parameters<typeof captureProjectSynthesis>[0]) => Promise<boolean>

/** Mounted above Routes: access resolution/Back never throw away the form.
 * Content is memory-only and invalidated on owner, crypto or erasure changes. */
export function useProjectSynthesis(start: Start, review: ReviewProjectRequest, navigate: (id: string) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef(draft); draftRef.current = draft
  const scopeRef = useRef<ReturnType<typeof captureLocalReadScope> | null>(null)
  const pending = useRef<AbortController | null>(null)
  const loadSerial = useRef(0), alive = useRef(true)
  const plan = usePlanStatus(draft !== null), planRef = useRef(plan); planRef.current = plan
  const callbacks = useRef({ start, review, navigate }); callbacks.current = { start, review, navigate }
  const patch = useCallback((values: Partial<Draft>) => {
    if (!alive.current || !draftRef.current) return
    const next = { ...draftRef.current, ...values }; draftRef.current = next; setDraft(next)
  }, [])
  const cancel = useCallback(() => {
    const old = pending.current; pending.current = null; old?.abort(); patch({ busy: false })
  }, [patch])
  const clear = useCallback(() => {
    cancel(); scopeRef.current = null; loadSerial.current++
    draftRef.current = null; if (alive.current) setDraft(null)
  }, [cancel])
  const load = useCallback(async () => {
    cancel()
    const scope = scopeRef.current, serial = ++loadSerial.current
    if (!scope) return
    const current = () => { scope.assertCurrent(); if (!alive.current || scopeRef.current !== scope || loadSerial.current !== serial) throw new ProjectError('cancelled') }
    patch({ loading: true, error: null })
    try {
      current()
      const operation = await beginProjectOperation(); current()
      const projects = await listProjects(operation); current()
      const before = draftRef.current?.projects.find(p => p.id === draftRef.current?.projectId)
      const after = projects.find(p => p.id === draftRef.current?.projectId)
      patch({ projects, loading: false, ...(before && before.revision !== after?.revision ? { documentIds: [] } : {}) })
    } catch (reason) {
      if (scopeRef.current === scope && serial === loadSerial.current) patch({ loading: false, error: i18n.t(`projects.errors.${reason instanceof ProjectError ? reason.code : 'unavailable'}`) })
    }
  }, [cancel, patch])
  const open = useCallback((project?: Project) => {
    try { scopeRef.current?.assertCurrent() } catch { clear() }
    try {
      if (!scopeRef.current) scopeRef.current = captureLocalReadScope()
      cancel()
      const previous = draftRef.current
      const next: Draft = previous ? { ...previous, ...(project && project.id !== previous.projectId
        ? { projectId: project.id, documentIds: [], adoptedId: undefined } : {}) }
        : { projectId: project?.id ?? '', projects: [], objective: '', documentIds: [], busy: false, loading: true, error: null }
      draftRef.current = next; setDraft(next); void load()
    } catch { clear() }
  }, [cancel, clear, load])
  const update = useCallback((values: Pick<Partial<Draft>, 'objective' | 'projectId'>) => {
    cancel()
    patch({ ...values, error: null, adoptedId: undefined, ...(values.projectId !== undefined ? { documentIds: [] } : {}) })
  }, [cancel, patch])
  const submit = useCallback(async () => {
    const source = draftRef.current, scope = scopeRef.current
    if (!source || !scope || source.loading || pending.current) return
    const project = source.projects.find(p => p.id === source.projectId && p.status === 'ready')?.project
    if (!project) { patch({ error: i18n.t('projects.errors.unavailable') }); return }
    const controller = new AbortController(); pending.current = controller
    const objective = source.objective, ids = [...source.documentIds], locale = i18n.language
    patch({ busy: true, error: null })
    const assertDraft = () => {
      scope.assertCurrent()
      if (!alive.current || pending.current !== controller || controller.signal.aborted) throw new ProjectError('cancelled')
    }
    try {
      const accepted = await callbacks.current.start({ project, objective, locale, signal: controller.signal, assertDraft,
        assertAccess() {
          const access = projectSynthesisAccess(planRef.current, project.euOnly, synthesisQuestion(objective, locale))
          if (access.error) throw new Error(i18n.t(access.error))
        },
        review: async (value, signal) => {
          assertDraft()
          const answer = await callbacks.current.review(value.kind === 'select' ? { ...value, initialDocumentIds: ids,
            onSelectionChange(next) { if (pending.current === controller && !controller.signal.aborted) patch({ documentIds: [...next] }) },
          } : value, signal)
          assertDraft()
          if (value.kind === 'select' && answer && typeof answer === 'object') patch({ documentIds: [...answer.documentIds] })
          return answer
        },
        onAdopted(id) {
          assertDraft(); pending.current = null
          patch({ busy: false, adoptedId: id })
          callbacks.current.navigate(id)
        },
      })
      if (pending.current === controller && !accepted) patch({ error: null }) // shared hook owns the precise preparation error
    } catch (reason) {
      if (pending.current === controller) patch({ error: reason instanceof ProjectError ? i18n.t(`projects.errors.${reason.code}`)
        : reason instanceof Error ? reason.message : i18n.t('projects.errors.unavailable') })
    } finally {
      if (pending.current === controller) { pending.current = null; patch({ busy: false }) }
    }
  }, [patch])
  useEffect(() => {
    alive.current = true
    const unsubscribe = onLocalDataInvalidated(clear)
    const timer = setInterval(() => { try { scopeRef.current?.assertCurrent() } catch { clear() } }, 250)
    return () => { alive.current = false; clearInterval(timer); unsubscribe(); clear() }
  }, [clear])
  const selected = draft?.projects.find(p => p.id === draft.projectId && p.status === 'ready')?.project
  let access: ReturnType<typeof projectSynthesisAccess> | null = null
  if (selected) {
    const objective = draft?.objective ?? ''
    // Local input validation is not an entitlement problem and must never
    // send a healthy account to purchase/reconnect. No truncation of its draft.
    access = projectSynthesisAccess(plan, selected.euOnly, synthesisQuestion(
      objective.trim() && objective.length <= SYNTHESIS_OBJECTIVE_LIMIT ? objective : 'Synthèse / Synthesis', i18n.language))
  }
  return { draft, selected, access, plan, open, update, cancel, submit, reload: load, clear }
}
