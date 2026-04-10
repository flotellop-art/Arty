import * as scoped from './scopedStorage'

export type ResponseStyle = 'default' | 'concis' | 'detaille' | 'formel' | 'technique'

export const STYLE_OPTIONS: Array<{ id: ResponseStyle; label: string; emoji: string }> = [
  { id: 'default', label: 'Normal', emoji: '💬' },
  { id: 'concis', label: 'Concis', emoji: '⚡' },
  { id: 'detaille', label: 'Détaillé', emoji: '📝' },
  { id: 'formel', label: 'Formel', emoji: '👔' },
  { id: 'technique', label: 'Technique', emoji: '⚙️' },
]

const STYLE_PROMPTS: Record<ResponseStyle, string> = {
  default: '',
  concis: '\n\nSTYLE ACTIF : CONCIS — Réponses ultra-courtes. 1-3 phrases max. Pas de détail superflu. Va droit au but.',
  detaille: '\n\nSTYLE ACTIF : DÉTAILLÉ — Explique en profondeur. Développe chaque point. Donne des exemples concrets. Structure avec des sous-titres.',
  formel: '\n\nSTYLE ACTIF : FORMEL — Vouvoie l\'utilisateur. Ton professionnel et soigné. Pas d\'argot ni de familiarité. Adapté pour des échanges avec des clients.',
  technique: '\n\nSTYLE ACTIF : TECHNIQUE — Vocabulaire technique du métier. Références aux normes (DTU, NF). Détails des matériaux, dosages, temps de séchage. Parle comme un expert du BTP.',
}

export function getStyle(): ResponseStyle {
  const saved = scoped.getItem('response-style')
  if (saved && saved in STYLE_PROMPTS) return saved as ResponseStyle
  return 'default'
}

export function setStyle(style: ResponseStyle): void {
  scoped.setItem('response-style', style)
}

export function getStylePrompt(style: ResponseStyle): string {
  return STYLE_PROMPTS[style] || ''
}
