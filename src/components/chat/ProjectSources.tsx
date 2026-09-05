import { useTranslation } from 'react-i18next'
import type { ProjectTurn } from '../../services/projects/chatPolicy'

export function ProjectSources({ turn, prepared = false }: { turn: ProjectTurn; prepared?: boolean }) {
  const { i18n } = useTranslation(), fr = i18n.language.startsWith('fr')
  return <details className="mx-4 mb-3 text-xs text-theme-muted break-words">
    <summary>{prepared ? (fr ? 'Contexte approuvé pour ce tour (pas un reçu fournisseur)' : 'Context approved for this turn (not a provider receipt)') : (fr ? 'Sources jointes à ce tour · vérifier les citations' : 'Sources supplied for this turn · check citations')}</summary>
    <p>{turn.projectName ?? (fr ? 'Bibliothèque détachée' : 'Detached library')} · {turn.mode}{turn.partial ? (fr ? ' · sélection partielle' : ' · partial selection') : ''}</p>
    <p>{fr ? 'Les repères concernent ce tour uniquement. Ils ne prouvent pas que chaque affirmation est étayée. Les lignes sont celles du texte extrait, pas des pages Word.' : 'Labels apply only to this turn. They do not prove every claim is supported. Lines refer to extracted text, not Word pages.'}</p>
    {turn.sources.map((source, index) => <div key={index} className="mt-2">
      <p>[S{index + 1}] {source.name} · {fr ? 'lignes' : 'lines'} {source.startLine}–{source.endLine} · {fr ? 'révision du projet' : 'project revision'} {source.projectRevision}{source.partial ? ' · partiel/partial' : ''}</p>
      <p className="break-all">SHA-256: {source.sourceHash}</p>
    </div>)}
  </details>
}
