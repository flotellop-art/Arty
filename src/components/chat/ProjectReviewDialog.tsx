import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectReview, ProjectSelection } from '../../services/projects/chatPreparation'

const button = 'min-h-11 border border-theme-border px-3 py-2 disabled:opacity-40'
export function ProjectReviewDialog({ request, onAnswer }: {
  request: ProjectReview; onAnswer: (answer: ProjectSelection | boolean | null) => void
}) {
  const { i18n } = useTranslation(), fr = i18n.language.startsWith('fr')
  const label = (f: string, e: string) => fr ? f : e
  const root = useRef<HTMLDivElement>(null)
  const answerRef = useRef(onAnswer)
  answerRef.current = onAnswer
  const synthesis = request.kind === 'select' && !!request.policy
  const [mode, setMode] = useState<'search' | 'overview'>(synthesis ? 'overview' : 'search')
  const [ids, setIds] = useState<string[]>(() => request.kind === 'select'
    ? request.initialDocumentIds?.filter(id => request.project.documents.some(d => d.id === id)) ?? (request.policy ? [] : request.project.documents.map(d => d.id)) : [])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation() }
      if (event.key === 'Escape') { event.preventDefault(); answerRef.current(null) }
      if (event.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),details>summary') ?? [])]
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [])
  return <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3">
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="project-review-title" className="bg-theme-bg text-theme-ink border border-theme-border rounded-xl max-w-3xl w-full max-h-[90dvh] overflow-y-auto p-5 space-y-4">
      <h2 id="project-review-title" className="text-xl">{label('Contexte du projet — avant envoi', 'Project context — before sending')}</h2>
      {request.kind === 'select' ? <>
        <p>{request.project.name}</p>
        <label className="block">{label('Mode de sélection locale', 'Local selection mode')}
          <select className="block w-full bg-theme-bg border p-2" disabled={synthesis} value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
            <option value="search">{label('Chercher les passages liés à la question', 'Find passages related to the question')}</option>
            <option value="overview" disabled={request.project.documents.length === 0}>{label('Aperçu des documents cochés (extraits limités)', 'Overview of selected documents (limited excerpts)')}</option>
          </select>
        </label>
        <fieldset><legend>{label('Documents à examiner', 'Documents to examine')}</legend>
          {request.project.documents.map(doc => <label key={doc.id} className="flex gap-2 py-2 break-all"><input type="checkbox" checked={ids.includes(doc.id)} onChange={e => {
            const next = e.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id)
            setIds(next); request.onSelectionChange?.([...next])
          }} />{doc.name}</label>)}
        </fieldset>
        <p className="text-sm">{synthesis
          ? label('L’aperçu est préparé localement à partir des documents cochés. L’étape suivante montre les extraits et le destinataire ; rien ne sera envoyé sans confirmation.', 'The overview is prepared locally from checked documents. The next step shows excerpts and the recipient; nothing is sent without confirmation.')
          : label('La recherche est locale et lexicale. Aucun extrait trouvé ne déclenche automatiquement une synthèse globale. L’étape suivante montre les extraits et le destinataire.', 'Search is local and lexical. No matches never trigger an automatic overview. The next step shows the excerpts and recipient.')}</p>
        {synthesis && <p>{label('Synthèse guidée : choisissez explicitement les documents. L’aperçu restera limité à leurs extraits.', 'Guided synthesis: explicitly choose documents. The overview will remain limited to their excerpts.')}</p>}
        <div className="flex gap-3"><button className={button} onClick={() => onAnswer(null)}>{label('Annuler', 'Cancel')}</button><button className={button} disabled={(synthesis || request.project.documents.length > 0) && ids.length === 0} onClick={() => onAnswer({ mode, documentIds: ids })}>{label('Préparer l’aperçu', 'Prepare preview')}</button></div>
      </> : <>
        {request.comparisonModels && <div role="status" className="border border-theme-border p-3 space-y-2">
          <p>{label('Deux appels potentiellement facturés : ', 'Two potentially billed requests: ')}{request.comparisonModels.join(' / ')}</p>
          <p>{label('Préfixe historique + documents sélectionnés actuels, pas reproduction des anciens extraits. Les deux branches conservées resteront documentaires en lecture seule.', 'Historical prefix + currently selected documents, not a replay of old excerpts. Both saved branches will remain read-only documentary conversations.')}</p>
        </div>}
        <p>{label('Destinataire IA : ', 'AI recipient: ')}{request.provider === 'mistral' ? 'Mistral (EU)' : 'Claude (Anthropic)'}.</p>
        <p className="text-sm">{label('Lecture seule : aucun outil, recherche web, rappel ou ajout automatique à la mémoire. Après engagement de l’appel, supprimer un document ne retire pas le contenu déjà transmis.', 'Read-only: no tools, web search, reminders or automatic memory. Once the request is engaged, deleting a document does not retract content already transmitted.')}</p>
        <p className="text-sm">{request.historyMessages} {label('messages historiques inclus', 'history messages included')} · {request.textChars.toLocaleString()} {label('caractères, réserve système incluse', 'characters, including system reserve')} · {Math.ceil(request.binaryBytes / 1024)} KiB {label('binaires', 'binary')}</p>
        <details><summary>{label('Question effective et consignes principales', 'Effective question and main instructions')}</summary>{!request.comparisonModels && <p className="text-xs">{label('Les clients ajoutent aussi leurs règles fixes et la date, couvertes par la réserve système.', 'Clients also add their fixed rules and date, covered by the system reserve.')}</p>}<pre className="whitespace-pre-wrap break-words text-xs">{request.question}{'\n\n'}{request.systemPrompt}</pre></details>
        {request.files.length > 0 && <p className="text-sm break-words">{label('Pièces jointes de l’historique et du tour : ', 'History and current attachments: ')}{request.files.join(', ')}</p>}
        {!request.context && <p>{label('Bibliothèque non jointe ; historique toujours transmis. Les anciennes sources ne sont pas relues.', 'No library attached; history is still sent. Previous sources are not reread.')}</p>}
        {request.context && <>
          <p>{request.context.name} · {label('révision', 'revision')} {request.context.projectRevision} · {request.context.mode}</p>
          {(request.context.truncated || request.context.noHit) && <p role="status">{request.context.noHit ? label('Aucun extrait correspondant. L’envoi ne permettra pas d’affirmer que le projet a été analysé.', 'No matching excerpt. Sending cannot establish that the project was analysed.') : label('Sélection partielle : ce n’est pas une lecture exhaustive des documents.', 'Partial selection: this is not a complete document review.')}</p>}
          {request.context.excerpts.map((excerpt, index) => <details key={index}><summary className="break-words">[S{index + 1}] {excerpt.reference.name} · {label('lignes extraites', 'extracted lines')} {excerpt.reference.startLine}–{excerpt.reference.endLine}{excerpt.reference.partial ? label(' · ligne partielle', ' · partial line') : ''}</summary><pre className="whitespace-pre-wrap break-words text-sm">{excerpt.text}</pre><p className="text-xs break-all">SHA-256: {excerpt.reference.sourceHash}</p></details>)}
        </>}
        <div className="flex gap-3"><button className={button} onClick={() => onAnswer(null)}>{label('Annuler, garder mon texte', 'Cancel, keep my text')}</button><button className={button} onClick={() => onAnswer(true)}>{request.comparisonModels ? label('Confirmer les deux appels', 'Confirm both requests') : request.context?.noHit ? label('Envoyer sans nouvel extrait', 'Send without new excerpts') : label('Confirmer cet envoi', 'Confirm this request')}</button></div>
      </>}
    </div>
  </div>
}
