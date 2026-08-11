// Périmètre d'outils exposé au provider OpenAI (10 août 2026).
//
// POURQUOI UNE ALLOWLIST EXPLICITE, et pas `TOOLS` en bloc comme Mistral.
// Avant l'ajout du function calling, la route OpenAI n'avait AUCUN outil :
// c'était, de fait, le filet structurel qui garantissait qu'aucune donnée
// privée Google/appareil n'atteignait un provider US même si le routage se
// trompait (la garde BUG 12 est purement textuelle et s'évalue AVANT de
// savoir quel outil le modèle appellera). Donner `TOOLS` en bloc supprimait
// ce filet : « organise ma semaine » ne matche aucune regex de données
// privées, part sur ChatGPT en sélection manuelle, et le modèle pouvait
// appeler `list_calendar`.
//
// La comparaison avec Mistral ne tient pas : Mistral, c'est le mode Europe,
// où l'utilisateur a explicitement accepté un provider souverain. OpenAI,
// c'est les États-Unis — un autre arbitrage produit, qui doit être écrit.
//
// Règle : tout outil doit être classé ci-dessous, exposé OU bloqué avec sa
// raison. Le test de parité (openaiToolPolicy.test.ts) fait échouer la CI sur
// un outil non classé — pattern F-16/F-1 du 3 juillet 2026. Le filtrage est
// FAIL-CLOSED : un outil inconnu de l'allowlist n'est jamais envoyé.
//
// Élargir cette liste est une décision produit + sécurité, jamais un effet de
// bord d'un refactor.

import { TOOLS } from '../toolDefinitions'
import { convertToolsToOpenAI } from './openaiFormat'
import { FETCH_URL_TOOL_DEF } from './fetchUrlTool'
import { WEB_SEARCH_TOOL_DEF } from './clientWebSearch'

/** Outils custom d'Arty exposés à OpenAI, avec la raison de leur innocuité. */
export const OPENAI_ALLOWED_TOOLS: Readonly<Record<string, string>> = {
  generate_report: "produit un document à partir du texte du modèle ; ne lit aucune donnée privée",
  ask_user: "formulaire interactif ; n'accède à aucune donnée",
}

/** Outils volontairement NON exposés à OpenAI, avec le motif du refus. */
export const OPENAI_BLOCKED_TOOLS: Readonly<Record<string, string>> = {
  // Données Google privées — réservées à Claude (BUG 12).
  list_calendar: 'agenda Google (donnée privée) — chemin Claude uniquement',
  create_calendar_event: 'écriture agenda Google — chemin Claude uniquement',
  update_calendar_event: 'écriture agenda Google — chemin Claude uniquement',
  delete_calendar_event: 'suppression agenda Google — chemin Claude uniquement',
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
  wp_create_post: 'publication WordPress — chemin Claude uniquement',
  wp_list_posts: 'contenu du site de l\'utilisateur — chemin Claude uniquement',
  wp_update_post: 'publication WordPress — chemin Claude uniquement',
  wp_delete_post: 'suppression WordPress — chemin Claude uniquement',
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
export function buildOpenAIToolList(options: { webSearch: boolean }) {
  const custom = convertToolsToOpenAI(TOOLS).filter(
    (tool) => Object.prototype.hasOwnProperty.call(OPENAI_ALLOWED_TOOLS, tool.function.name),
  )
  return [
    ...custom,
    FETCH_URL_TOOL_DEF,
    ...(options.webSearch ? [WEB_SEARCH_TOOL_DEF] : []),
  ]
}
