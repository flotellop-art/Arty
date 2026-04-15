/**
 * Slash commands — prefills the InputBar with common prompts.
 */

export interface SlashCommand {
  cmd: string
  label: string
  prompt: string
  icon: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/email', label: 'Lire derniers emails non lus', icon: '📧', prompt: 'Lis mes derniers emails non lus' },
  { cmd: '/agenda', label: "Agenda d'aujourd'hui", icon: '📅', prompt: "Qu'est-ce que j'ai dans mon agenda aujourd'hui ?" },
  { cmd: '/creer-app', label: 'Créer une app sur le PC (Orchestrateur)', icon: '🖥️', prompt: "Crée une application sur mon PC (Orchestrateur local) : précise l'app (excel, word, bloc-notes, wordpress, chrome), un nom de fichier optionnel, et un contenu initial optionnel. Exemple : « Crée un classeur Excel nommé suivi-chantiers-2026 avec les colonnes Client / Adresse / Montant / Statut »." },
  { cmd: '/resume', label: 'Résumer la conversation', icon: '📋', prompt: 'Résume cette conversation' },
  { cmd: '/rapport', label: 'Générer un rapport', icon: '📄', prompt: 'Génère un rapport de cette conversation' },
  { cmd: '/traduit', label: 'Traduire en anglais', icon: '🌍', prompt: 'Traduis en anglais : ' },
  { cmd: '/meteo', label: 'Météo Valence', icon: '☁️', prompt: 'Quel temps fait-il à Valence (26) ?' },
  { cmd: '/taches', label: 'Tâches en cours', icon: '✅', prompt: 'Quelles sont mes tâches en cours ?' },
  { cmd: '/aide', label: 'Afficher l\'aide', icon: '❓', prompt: 'Que sais-tu faire ?' },
]

/** Filter commands by prefix (after the /). Empty string returns all. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q || q === '/') return SLASH_COMMANDS
  const needle = q.startsWith('/') ? q.slice(1) : q
  return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(needle))
}
