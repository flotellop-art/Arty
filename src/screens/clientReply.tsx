import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { useClientReply } from '../hooks/useClientReply'
import { CLIENT_REPLY_LIMITS, CLIENT_REPLY_TONES, type ClientReplyFields } from '../services/workflows/clientReply'

const button = 'min-h-11 rounded-lg border border-theme-border px-4 py-2 disabled:opacity-40'
export function ClientReplyScreen({ controller, error, onBack, onAccess, onChat }: {
  controller: ReturnType<typeof useClientReply>; error: string | null; onBack(): void; onAccess(): void; onChat(id: string): void
}) {
  const { t, i18n } = useTranslation(), fr = i18n.language.startsWith('fr')
  const label = (f: string, e: string) => fr ? f : e
  const { draft, access, open, cancel } = controller
  useEffect(() => { if (!draft) open() }, [draft, open])
  useEffect(() => () => cancel(), [cancel])
  const fieldLabels = { request: label('Demande du client', 'Client request'), facts: label('Faits autorisés pour la réponse', 'Facts allowed in the reply'), objective: label('Objectif de la réponse', 'Reply objective') }
  const toneLabels = { professional: label('Professionnel', 'Professional'), warm: label('Chaleureux', 'Warm'), firm: label('Ferme et courtois', 'Firm and courteous') }
  return <main className="h-full overflow-y-auto bg-theme-bg text-theme-ink px-5 py-6">
    <div className="max-w-2xl mx-auto space-y-5">
      <button className={button} onClick={onBack}>{t('common.back')}</button>
      <h1 className="text-3xl font-display">{label('Préparer une réponse client', 'Prepare a client reply')}</h1>
      <p>{label('Collez la demande et indiquez les faits utilisables. Relisez les champs et le destinataire IA avant tout appel.', 'Paste the request and provide usable facts. Review the fields and AI recipient before any request.')}</p>
      <p className="text-sm text-theme-muted">{label('Aucun email, Agenda, projet ou fichier lu automatiquement. Aucun envoi au client ni brouillon créé dans une messagerie. Ne collez que les informations nécessaires que vous êtes autorisé à transmettre à l’IA.', 'No email, Calendar, project or file is read automatically. No message is sent to the client or created in a mailbox. Paste only necessary information you are allowed to share with the AI.')}</p>
      {!draft ? <section className="space-y-3"><p role="alert">{controller.isDemo
        ? label('Ce parcours est indisponible en démo. Quittez la démo et connectez votre compte pour préparer une réponse.', 'This workflow is unavailable in demo mode. Leave the demo and sign in to prepare a reply.')
        : t('projects.errors.unavailable')}</p>{!controller.isDemo && <button className={button} onClick={open}>{label('Réessayer', 'Try again')}</button>}</section> : <form onSubmit={e => { e.preventDefault(); void controller.submit() }} className="space-y-4">
        <fieldset disabled={draft.busy} className="space-y-4">
          {(['request', 'facts', 'objective'] as const).map(key => <div key={key}>
            <label className="block" htmlFor={`client-reply-${key}`}>{fieldLabels[key]}</label>
            <textarea id={`client-reply-${key}`} rows={key === 'objective' ? 3 : 5} className="block w-full rounded border border-theme-border bg-theme-bg p-3" aria-describedby={`client-reply-${key}-count`} aria-invalid={draft[key].length > CLIENT_REPLY_LIMITS[key]}
              value={draft[key]} onChange={e => controller.update({ [key]: e.target.value, ...(key === 'facts' && e.target.value.trim() ? { noAdditionalFacts: false } : {}) })} />
            <p id={`client-reply-${key}-count`} className="text-sm text-theme-muted">{draft[key].length}/{CLIENT_REPLY_LIMITS[key]}</p>
            {draft[key].length > CLIENT_REPLY_LIMITS[key] && <p role="alert">{label('Texte trop long : réduisez-le. Votre collage n’a pas été tronqué.', 'Text too long: shorten it. Your paste has not been truncated.')}</p>}
            {key === 'facts' && <label className="flex gap-2 py-2"><input type="checkbox" disabled={!!draft.facts.trim()} checked={draft.noAdditionalFacts} onChange={e => controller.update({ noAdditionalFacts: e.target.checked })} />{label('Je n’ai pas de faits complémentaires', 'I have no additional facts')}</label>}
          </div>)}
          <div><label className="block" htmlFor="client-reply-tone">{label('Ton', 'Tone')}</label>
            <select id="client-reply-tone" className="block w-full rounded border border-theme-border bg-theme-bg p-3" value={draft.tone} onChange={e => controller.update({ tone: e.target.value as ClientReplyFields['tone'] })}>
              {CLIENT_REPLY_TONES.map(tone => <option key={tone} value={tone}>{toneLabels[tone]}</option>)}
            </select>
          </div>
          <div><label className="block" htmlFor="client-reply-provider">{label('Destinataire IA', 'AI recipient')}</label>
            <select id="client-reply-provider" className="block w-full rounded border border-theme-border bg-theme-bg p-3" value={draft.euOnly ? 'mistral' : 'claude'} onChange={e => controller.update({ euOnly: e.target.value === 'mistral' })}>
              <option value="claude">Claude (Anthropic)</option><option value="mistral">Mistral (EU)</option>
            </select>
          </div>
        </fieldset>
        <p className="text-sm text-theme-muted">{label('Brouillon conservé pendant cette session, pas après rechargement. Demande et objectif obligatoires ; fournissez des faits ou cochez leur absence.', 'Draft kept during this session, not after reload. Request and objective are required; supply facts or confirm their absence.')}</p>
        {access && <div className="border border-theme-border rounded-lg p-3 space-y-2">
          <p role="status">{access.error ? t(access.error) : label('Accès éligible. Les clés et quotas seront vérifiés par le serveur ; aucun quota n’est réservé.', 'Eligible access. The server will verify keys and quotas; no quota is reserved.')}</p>
          {access.error && !draft.busy && <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => controller.plan.refresh()}>{label('Revérifier l’accès', 'Recheck access')}</button><button type="button" className={button} onClick={onAccess}>{label('Résoudre l’accès', 'Resolve access')}</button></div>}
        </div>}
        {(draft.error || error) && <p role="alert" className="break-words text-red-600">{draft.error || error}</p>}
        {error?.includes('no_active_subscription') && <button type="button" className={button} onClick={onAccess}>{label('Résoudre l’accès sans perdre le brouillon', 'Resolve access without losing the draft')}</button>}
        <div className="flex flex-wrap gap-3">
          <button className={button} type="submit" disabled={draft.busy || !controller.valid || !!access?.error}>{label('Relire avant l’appel IA', 'Review before the AI request')}</button>
          {draft.busy && <button className={button} type="button" onClick={cancel}>{label('Annuler la préparation', 'Cancel preparation')}</button>}
          {draft.adoptedId && <button className={button} type="button" onClick={() => onChat(draft.adoptedId!)}>{label('Retrouver le fil créé', 'Open the created chat')}</button>}
        </div>
      </form>}
      <p className="text-sm text-theme-muted">{label('Après confirmation, un nouveau fil détaché conserve la demande complète et la réponse préparée, même interrompue. Il reste sans projet associé. Copier ou exporter est explicite ; relances et suivis ouvrent une revue documentaire.', 'After confirmation, a new detached chat keeps the full request and prepared reply, even if interrupted. It stays without a linked project. Copying or exporting is explicit; retries and follow-ups open a documentary review.')}</p>
    </div>
  </main>
}
