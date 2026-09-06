import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { useProjectSynthesis } from '../hooks/useProjectSynthesis'
import { SYNTHESIS_OBJECTIVE_LIMIT } from '../services/workflows/projectSynthesis'

const button = 'min-h-11 rounded-lg border border-theme-border px-4 py-2 disabled:opacity-40'
export function ProjectSynthesisScreen({ controller, error, onBack, onProjects, onAccess, onChat }: {
  controller: ReturnType<typeof useProjectSynthesis>; error: string | null; onBack(): void; onProjects(): void; onAccess(): void; onChat(id: string): void
}) {
  const { t, i18n } = useTranslation(), fr = i18n.language.startsWith('fr')
  const label = (f: string, e: string) => fr ? f : e
  const { draft, selected, access, open, cancel } = controller
  useEffect(() => { if (!draft) open() }, [draft, open])
  useEffect(() => () => cancel(), [cancel])
  return <main className="h-full overflow-y-auto bg-theme-bg text-theme-ink px-5 py-6">
    <div className="max-w-2xl mx-auto space-y-5">
      <button className={button} onClick={onBack}>{t('common.back')}</button>
      <h1 className="text-3xl font-display">{label('Synthèse guidée de projet', 'Guided project synthesis')}</h1>
      <p>{label('Définissez l’objectif, puis choisissez les documents. Vous relirez les extraits et le destinataire IA avant tout envoi.', 'Define the objective, then choose documents. You will review the excerpts and AI recipient before sending anything.')}</p>
      <p className="text-sm text-theme-muted">{label('Jusqu’à 20 passages / 20 000 caractères : une synthèse des extraits, jamais une lecture exhaustive. Aucun Agenda, outil, rappel ou ajout automatique à la mémoire.', 'Up to 20 excerpts / 20,000 characters: a synthesis of excerpts, never a complete review. No Calendar, tools, reminders or automatic memory.')}</p>
      {!draft ? <p role="alert">{t('projects.errors.unavailable')}</p> : <form onSubmit={e => { e.preventDefault(); void controller.submit() }} className="space-y-4">
        <fieldset disabled={draft.busy || draft.loading} className="space-y-4">
          <label className="block">{label('Projet documentaire', 'Document project')}
            <select className="block w-full rounded border border-theme-border bg-theme-bg p-3" value={draft.projectId} onChange={e => controller.update({ projectId: e.target.value })}>
              <option value="">{label('Choisir un projet', 'Choose a project')}</option>
              {draft.projects.map(project => <option key={project.id} value={project.id} disabled={project.status !== 'ready'}>{project.project?.name ?? t('projects.errors.locked')}{project.euOnly ? ' · EU' : ''}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void controller.reload()}>{label('Actualiser les projets', 'Refresh projects')}</button>
            <button type="button" className={button} onClick={onProjects}>{label('Gérer les documents', 'Manage documents')}</button>
          </div>
          <label className="block">{label('Objectif de la synthèse', 'Synthesis objective')}
            <textarea rows={5} className="block w-full rounded border border-theme-border bg-theme-bg p-3" value={draft.objective} onChange={e => controller.update({ objective: e.target.value })} placeholder={label('Ex. Préparer le point client : faits établis, risques et questions à confirmer.', 'E.g. Prepare the client update: established facts, risks and questions to confirm.')} />
          </label>
          <p className="text-sm text-theme-muted">{draft.objective.length}/{SYNTHESIS_OBJECTIVE_LIMIT} · {label('Brouillon conservé pendant cette session, pas après rechargement.', 'Draft kept during this session, not after reload.')}</p>
          {draft.objective.length > SYNTHESIS_OBJECTIVE_LIMIT && <p role="alert">{label('Objectif trop long : réduisez-le. Votre texte n’a pas été tronqué.', 'Objective too long: shorten it. Your text has not been truncated.')}</p>}
          {selected && !selected.documents.length && <p role="alert">{label('Ce projet est vide. Ajoutez au moins un document lisible.', 'This project is empty. Add at least one readable document.')}</p>}
        </fieldset>
        {draft.loading && <p role="status">{t('common.loading')}</p>}
        {access && <div className="border border-theme-border rounded-lg p-3 space-y-2">
          <p>{label('Destination prévue : ', 'Expected recipient: ')}{access.provider === 'mistral' ? 'Mistral (EU)' : 'Claude (Anthropic)'}</p>
          <p role="status">{access.error ? t(access.error) : label('Accès éligible. Les clés et quotas seront vérifiés par le serveur ; aucun quota n’est réservé.', 'Eligible access. The server will verify keys and quotas; no quota is reserved.')}</p>
          {access.error && !draft.busy && <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => controller.plan.refresh()}>{label('Revérifier l’accès', 'Recheck access')}</button><button type="button" className={button} onClick={onAccess}>{label('Résoudre l’accès', 'Resolve access')}</button></div>}
        </div>}
        {(draft.error || error) && <p role="alert" className="break-words text-red-600">{draft.error || error}</p>}
        {error?.includes('no_active_subscription') && <button type="button" className={button} onClick={onAccess}>{label('Résoudre l’accès sans perdre le brouillon', 'Resolve access without losing the draft')}</button>}
        <div className="flex flex-wrap gap-3">
          <button className={button} type="submit" disabled={draft.busy || draft.loading || !selected?.documents.length || !draft.objective.trim() || draft.objective.length > SYNTHESIS_OBJECTIVE_LIMIT || !!access?.error}>{label('Choisir les documents et relire', 'Choose documents and review')}</button>
          {draft.busy && <button className={button} type="button" onClick={cancel}>{label('Annuler la préparation', 'Cancel preparation')}</button>}
          {draft.adoptedId && <button className={button} type="button" onClick={() => onChat(draft.adoptedId!)}>{label('Retrouver le fil créé', 'Open the created chat')}</button>}
        </div>
      </form>}
      <p className="text-sm text-theme-muted">{label('Après confirmation, le fil documentaire conserve votre demande et la réponse, y compris un partiel interrompu. Copier ou exporter une réponse reste explicite. Les suivis et relances depuis le chat ouvrent une revue documentaire générique ; pour refaire une synthèse guidée, revenez ici.', 'After confirmation, the documentary chat keeps your request and answer, including an interrupted partial. Copying or exporting an answer remains explicit. Follow-ups and retries from chat open a generic documentary review; return here to make another guided synthesis.')}</p>
    </div>
  </main>
}
