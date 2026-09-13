// Public tools are the default. Personal tools are available only for an explicit
// provider selection on a private turn, with shared execution and confirmations.
// Every catalog entry remains classified; unknown tools are never exposed.

import { convertToolsToOpenAI } from './openaiFormat'
import { FETCH_URL_TOOL_DEF } from './fetchUrlTool'
import { WEB_SEARCH_TOOL_DEF } from './clientWebSearch'
import { buildPortableTools, type PersonalToolOptions } from './personalToolPolicy'

/** Outils custom d'Arty exposés à OpenAI, avec la raison de leur innocuité. */
export const OPENAI_ALLOWED_TOOLS: Readonly<Record<string, string>> = {
  generate_report: "produit un document à partir du texte du modèle ; ne lit aucune donnée privée",
  ask_user: "formulaire interactif ; n'accède à aucune donnée",
}

/** Outils volontairement NON exposés à OpenAI, avec le motif du refus. */
export const OPENAI_BLOCKED_TOOLS: Readonly<Record<string, string>> = {
  read_memory: 'mémoire privée — sélection manuelle et contexte privé requis',
  // Données Google privées — réservées à Claude (BUG 12).
  list_calendar: 'agenda Google (donnée privée) — sélection manuelle privée requise',
  create_calendar_event: 'écriture agenda Google — sélection manuelle privée requise',
  update_calendar_event: 'écriture agenda Google — sélection manuelle privée requise',
  delete_calendar_event: 'suppression agenda Google — sélection manuelle privée requise',
  // Position précise de l'utilisateur : ces deux outils réinjectent les
  // coordonnées GPS (ou la ville résolue) dans le résultat renvoyé au modèle.
  // Les transmettre à un provider US sans consentement explicite serait une
  // bascule silencieuse. web_search couvre le besoin dès que l'utilisateur
  // nomme la ville lui-même.
  get_weather: 'révèle la localisation de l\'utilisateur à un provider US',
  calculate_distance: 'réinjecte les coordonnées GPS précises dans le résultat',
  // Stockage de l'appareil.
  list_local_files: "fichiers de l'appareil",
  read_local_file: "fichiers de l'appareil",
  save_local_file: "écriture sur l'appareil",
  delete_local_file: "suppression sur l'appareil",
  share: 'partage sortant depuis l\'appareil',
  // Contrôle machine.
  open_app: 'contrôle de la machine de l\'utilisateur',
  screenshot_pc: "capture d'écran de la machine",
  create_app: 'écriture de code exécutable',
  // Publication sur le site de l'utilisateur.
  wp_create_post: 'publication WordPress — sélection manuelle privée requise',
  wp_list_posts: 'contenu du site de l\'utilisateur — sélection manuelle privée requise',
  wp_update_post: 'publication WordPress — sélection manuelle privée requise',
  wp_delete_post: 'suppression WordPress — sélection manuelle privée requise',
  // Mémoire persistante = données personnelles accumulées.
  update_memory: 'écrit dans la mémoire persistante (données personnelles)',
  // Sentiers : position GPS + snapshots locaux, fonctionnalité pensée pour
  // le chemin Claude/Auto (carte, export GPX, boutons de rapport).
  find_trails: 'utilise la position GPS et le cache de snapshots local',
  export_trail_gpx: 'export de fichier depuis un snapshot local',
}

/** Tools exécutés par le client lui-même, jamais routés vers le handler. */
export const OPENAI_CLIENT_TOOLS = ['web_search', 'fetch_url'] as const

/**
 * Garde d'EXÉCUTION. Filtrer la liste envoyée ne suffit pas : rien n'empêche
 * un modèle — a fortiori sous injection de prompt — d'émettre un tool_call
 * pour un outil non déclaré. Sans cette vérification, `list_calendar` demandé
 * par une page piégée serait exécuté quand même. Fail-closed.
 */
export function isToolAllowedForOpenAI(name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(OPENAI_ALLOWED_TOOLS, name) ||
    (OPENAI_CLIENT_TOOLS as readonly string[]).includes(name)
  )
}

/**
 * Liste des tools (format OpenAI) envoyée à l'API Chat Completions.
 * `webSearch` porte la décision centrale du routeur : false (données privées)
 * retire la recherche publique. `fetch_url` reste — il est borné aux URLs déjà
 * présentes dans la conversation, cf. fetchUrlTool.
 */
export function buildOpenAIToolList(options: { webSearch: boolean } & PersonalToolOptions) {
  const custom = convertToolsToOpenAI(buildPortableTools(options))
  const privateContext = options.personalTools || options.privateContext
  return [
    ...custom,
    ...(!privateContext ? [FETCH_URL_TOOL_DEF] : []),
    ...(options.webSearch && !privateContext ? [WEB_SEARCH_TOOL_DEF] : []),
  ]
}
