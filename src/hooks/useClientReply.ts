import { useCallback, useEffect, useRef, useState } from 'react'
import i18n from '../i18n'
import { usePlanStatus } from './usePlanStatus'
import { captureLocalReadScope } from '../services/projects/store'
import { ProjectError } from '../services/projects/types'
import type { ReviewProjectRequest } from '../services/projects/chatPreparation'
import { captureClientReplyFields, clientReplyQuestion, type captureClientReply, type ClientReplyFields } from '../services/workflows/clientReply'
import { projectSynthesisAccess } from '../services/workflows/projectSynthesisAccess'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'
import { getActiveSession } from '../services/userSession'

type Draft = ClientReplyFields & { euOnly: boolean; busy: boolean; error: string | null; adoptedId?: string }
type Start = (args: Parameters<typeof captureClientReply>[0]) => Promise<boolean>
const empty: ClientReplyFields = { request: '', facts: '', objective: '', tone: 'professional', noAdditionalFacts: false }

/** Manual inputs only; never enumerate projects, files, accounts or messages. */
export function useClientReply(start: Start, review: ReviewProjectRequest, navigate: (id: string) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef(draft); draftRef.current = draft
  const scopeRef = useRef<ReturnType<typeof captureLocalReadScope> | null>(null)
  const pending = useRef<AbortController | null>(null), alive = useRef(true)
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
    cancel(); scopeRef.current = null; draftRef.current = null
    if (alive.current) setDraft(null)
  }, [cancel])
  const open = useCallback(() => {
    try { scopeRef.current?.assertCurrent() } catch { clear() }
    try {
      if (!scopeRef.current) scopeRef.current = captureLocalReadScope()
      cancel()
      const next = draftRef.current ?? { ...empty, euOnly: false, busy: false, error: null }
      draftRef.current = next; setDraft(next)
    } catch { clear() }
  }, [cancel, clear])
  const update = useCallback((values: Partial<ClientReplyFields & { euOnly: boolean }>) => {
    cancel(); patch({ ...values, error: null, adoptedId: undefined })
  }, [cancel, patch])
  const submit = useCallback(async () => {
    const source = draftRef.current, scope = scopeRef.current
    if (!source || !scope || pending.current) return
    const controller = new AbortController(); pending.current = controller
    patch({ busy: true, error: null })
    const assertDraft = () => {
      scope.assertCurrent()
      if (!alive.current || scopeRef.current !== scope || pending.current !== controller || controller.signal.aborted) throw new ProjectError('cancelled')
    }
    try {
      assertDraft()
      const fields = captureClientReplyFields(source), euOnly = source.euOnly, locale = i18n.language
      const question = clientReplyQuestion(fields, locale)
      await callbacks.current.start({ fields, euOnly, locale, signal: controller.signal, assertDraft,
        assertAccess() {
          const access = projectSynthesisAccess(planRef.current, euOnly, question)
          if (access.error) throw new Error(i18n.t(access.error))
        },
        review: async (value, signal) => {
          assertDraft()
          const answer = await callbacks.current.review(value, signal)
          assertDraft(); return answer
        },
        onAdopted(id) {
          assertDraft(); pending.current = null
          patch({ busy: false, adoptedId: id }); callbacks.current.navigate(id)
        },
      })
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
  let valid = false, question = 'Réponse client / Client reply'
  if (draft) { try { question = clientReplyQuestion(draft, i18n.language); valid = true } catch { /* local validation, not a plan error */ } }
  const access = draft ? projectSynthesisAccess(plan, draft.euOnly, question) : null
  return { draft, valid, access, plan, open, update, cancel, clear, submit, isDemo: getActiveSession()?.authMethod === 'demo' }
}
