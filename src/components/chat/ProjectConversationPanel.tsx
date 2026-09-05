import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../types'
import { beginProjectOperation, listProjects, getProject } from '../../services/projects/store'
import { ProjectError, type Project, type ProjectSummary } from '../../services/projects/types'
import { hasProjectHistory } from '../../services/projects/chatPolicy'

export function ProjectConversationPanel({ conversation, busy, onChange }: {
  conversation: Conversation; busy: boolean; onChange: (project: Project | null) => Promise<boolean>
}) {
  const { t, i18n } = useTranslation(), fr = i18n.language.startsWith('fr')
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false)
  const [list, setList] = useState<ProjectSummary[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('')
  const [linked, setLinked] = useState<{ id: string; status: string; name?: string } | null>(null)
  useEffect(() => {
    let alive = true
    const id = conversation.projectId
    if (!id) { setLinked(null); return }
    const refresh = async () => {
      try {
        const op = await beginProjectOperation(), summary = await getProject(op, id); op.assertCurrent()
        if (alive) setLinked({ id, status: summary?.status ?? 'unavailable', name: summary?.project?.name })
      } catch { if (alive) setLinked({ id, status: 'unavailable' }) }
    }
    void refresh(); window.addEventListener('focus', refresh)
    return () => { alive = false; window.removeEventListener('focus', refresh) }
  }, [conversation.projectId])
  const load = async () => {
    setLoading(true); setError('')
    try {
      const op = await beginProjectOperation(), items = await listProjects(op); op.assertCurrent()
      setList(items); setSelected(conversation.projectId ?? ''); setOpen(true)
      if (conversation.projectId) {
        const current = items.find(item => item.id === conversation.projectId)
        setLinked({ id: conversation.projectId, status: current?.status ?? 'unavailable', name: current?.project?.name })
      }
    } catch (reason) { setError(t(`projects.errors.${reason instanceof ProjectError ? reason.code : 'unavailable'}`)) }
    finally { setLoading(false) }
  }
  const apply = async () => {
    const project = selected ? list.find(p => p.id === selected)?.project : null
    if (selected && !project) return
    setLoading(true)
    try { if (await onChange(project ?? null)) setOpen(false) } finally { setLoading(false) }
  }
  return <section className="mx-4 my-2 text-sm border border-theme-border rounded-lg p-3 space-y-2">
    <button disabled={busy || loading} onClick={() => { if (open) setOpen(false); else void load() }} className="min-h-11 underline disabled:opacity-40">{conversation.projectId ? (fr ? 'Association projet · gérer' : 'Project association · manage') : (fr ? 'Associer un projet' : 'Link a project')}</button>
    {conversation.projectId && <p>{linked?.id !== conversation.projectId ? (fr ? 'Vérification de la bibliothèque…' : 'Checking library…') : linked.status === 'ready' ? linked.name : linked.status === 'deleted' ? (fr ? 'Projet supprimé — détachement possible ci-dessous.' : 'Project deleted — you can detach it below.') : linked.status === 'locked' ? (fr ? 'Projet verrouillé.' : 'Project locked.') : (fr ? 'Projet indisponible ; aucune source ne sera envoyée.' : 'Project unavailable; no sources will be sent.')}</p>}
    {hasProjectHistory(conversation) && <p className="text-xs">{fr ? 'Fil documentaire en lecture seule. Chaque message envoyé dans ce fil présente son contexte ; aucune mémoire personnelle ni recherche web automatique.' : 'Read-only documentary chat. Every message sent in this chat previews its context; no personal memory or automatic web search.'}</p>}
    {error && <p role="alert">{error}</p>}
    {open && <>
      <select aria-label={fr ? 'Projet de la conversation' : 'Conversation project'} className="w-full border p-2 bg-theme-bg" value={selected} disabled={busy || loading} onChange={e => setSelected(e.target.value)}>
        <option value="">{fr ? 'Aucune bibliothèque jointe' : 'No library attached'}</option>
        {conversation.projectId && !list.some(p => p.id === conversation.projectId) && <option value={conversation.projectId} disabled>{fr ? 'Projet associé indisponible' : 'Linked project unavailable'}</option>}
        {list.map(p => <option key={p.id} value={p.id} disabled={p.status !== 'ready'}>{p.project?.name ?? (p.status === 'deleted' ? (fr ? 'Projet supprimé' : 'Deleted project') : (fr ? 'Projet verrouillé' : 'Locked project'))}{p.euOnly ? ' · EU' : ''}</option>)}
      </select>
      <p className="text-xs">{fr ? 'Détacher conserve les réponses et leurs références, ainsi que la lecture seule et la restriction EU. Pour un projet EU, commence un nouveau fil si les anciens échanges étaient hors EU. Les PDF ne sont pas lus dans les fils projet EU.' : 'Detaching preserves replies, references, read-only mode and EU restrictions. Start a new chat for an EU project if past messages were non-EU. PDFs are not read in EU project chats.'}</p>
      <button className="min-h-11 border px-3 disabled:opacity-40" disabled={busy || loading || selected === (conversation.projectId ?? '')} onClick={() => void apply()}>{fr ? 'Confirmer cette association' : 'Confirm association'}</button>
    </>}
  </section>
}
