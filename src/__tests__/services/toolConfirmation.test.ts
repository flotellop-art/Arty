import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { buildToolConfirmMessage } from '../../services/toolConfirmation'
import { TOOLS } from '../../services/toolDefinitions'
import { NATIVE_TOOL_DEFINITIONS } from '../../services/tools/nativeTools'

// Faux `t` : renvoie la clé + les params, suffisant pour vérifier QUELLE clé
// est choisie et QUELS params sont passés, sans charger i18next.
const fakeT = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as TFunction

describe('buildToolConfirmMessage — garde HITL boucle d\'outils', () => {
  it('exige une confirmation sur toutes les suppressions destructives', () => {
    expect(buildToolConfirmMessage('delete_calendar_event', {}, fakeT)).toBe('chat.actionConfirm.deleteEvent')
    expect(buildToolConfirmMessage('delete_local_file', {}, fakeT)).toBe('chat.actionConfirm.deleteLocal')
    expect(buildToolConfirmMessage('wp_delete_post', {}, fakeT)).toBe('chat.actionConfirm.deleteWp')
  })

  it('WordPress : confirme toute mise en ligne mais PAS les brouillons', () => {
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T', status: 'publish' }, fakeT)).toContain('chat.actionConfirm.wp')
    // Audit F-1 : 'future' = publication programmée = publique à terme → garde.
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T', status: 'future' }, fakeT)).toContain('chat.actionConfirm.wp')
    // brouillon = pas de garde
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T', status: 'draft' }, fakeT)).toBeNull()
    // status absent → défaut 'draft' → pas de garde
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T' }, fakeT)).toBeNull()
  })

  it('WordPress : wp_update_post ne peut pas publier sans confirmation (audit F-1)', () => {
    // Le bypass historique : create draft (libre) puis update status:'publish'.
    expect(buildToolConfirmMessage('wp_update_post', { post_id: 1, status: 'publish' }, fakeT)).toContain('chat.actionConfirm.wp')
    // Rester en brouillon ou ne pas toucher au status = libre.
    expect(buildToolConfirmMessage('wp_update_post', { post_id: 1, status: 'draft' }, fakeT)).toBeNull()
    expect(buildToolConfirmMessage('wp_update_post', { post_id: 1, title: 'nouveau titre' }, fakeT)).toBeNull()
  })

  it('laisse passer librement les lectures / recherches / listings', () => {
    for (const safe of [
      'list_calendar', 'create_calendar_event', 'list_local_files', 'read_local_file',
      'web_search', 'ask_user', 'update_memory', 'wp_list_posts',
    ]) {
      expect(buildToolConfirmMessage(safe, {}, fakeT)).toBeNull()
    }
  })

  it('tombe en sécurité sur un outil inconnu (pas de garde, mais le toolExecutor le rejettera)', () => {
    expect(buildToolConfirmMessage('outil_inexistant', {}, fakeT)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test de parité (audit F-16, 3 juil. 2026) — buildToolConfirmMessage est une
// ALLOWLIST POSITIVE : un tool oublié passe sans confirmation (c'est exactement
// comme ça que le bypass wp_update_post est né, F-1). Ce test force à CLASSER
// explicitement chaque tool déclaré au LLM : soit il exige une confirmation
// (CONFIRM_REQUIRED, avec un input représentatif du cas risqué), soit il est
// déclaré sûr (SAFE_TOOLS, avec une justification une ligne).
// → Ajouter un tool dans toolDefinitions.ts sans le classer ici FAIT ÉCHOUER
//   la CI. C'est voulu : la décision confirm/no-confirm doit être consciente.
// ─────────────────────────────────────────────────────────────────────────────

// Tools sensibles → input représentatif du cas qui DOIT déclencher la garde.
const CONFIRM_REQUIRED: Record<string, Record<string, unknown>> = {
  delete_calendar_event: {},
  delete_local_file: {},
  wp_delete_post: {},
  wp_create_post: { title: 'T', status: 'publish' },
  wp_update_post: { post_id: 1, status: 'publish' },
}

// Tools sûrs sans garde. Critère (cf. toolConfirmation.ts) : ni irréversible/
// destructif, ni envoi de données à un tiers.
const SAFE_TOOLS = new Set([
  // Lectures / recherches / listings
  'list_calendar', 'list_local_files', 'read_local_file', 'wp_list_posts',
  // Écritures réversibles dans l'espace PROPRE de l'utilisateur
  'create_calendar_event', 'update_calendar_event', 'save_local_file',
  'update_memory',
  // Interaction locale / owner-only (computer-use : gate = relay owner-only +
  // serveur local durci ; share : l'humain choisit la cible dans le sheet OS)
  'create_app', 'open_app', 'screenshot_pc', 'share',
  // Utilitaires sans effet de bord externe
  'generate_report', 'calculate_distance', 'get_weather', 'ask_user',
  // Server-side (exécutés par l'API Anthropic, jamais par le toolExecutor)
  'web_search', 'web_fetch',
])

describe('parité allowlist HITL ↔ tools déclarés au LLM', () => {
  // ⚠️ TOOLS est amputé des tools natifs hors Capacitor (isNative=false en
  // CI) : on ajoute NATIVE_TOOL_DEFINITIONS (liste complète, exportée
  // inconditionnellement) pour que la parité couvre AUSSI cette famille —
  // delete_local_file est destructif (revue audit F-16).
  const declaredNames = [
    ...new Set([
      ...TOOLS.map((t: { name: string }) => t.name),
      ...NATIVE_TOOL_DEFINITIONS.map((t: { name: string }) => t.name),
    ]),
  ]

  it('chaque tool déclaré est classé (confirm OU safe) — un tool non classé = CI rouge', () => {
    const unclassified = declaredNames.filter(
      (name) => !(name in CONFIRM_REQUIRED) && !SAFE_TOOLS.has(name)
    )
    expect(
      unclassified,
      `Tools non classés dans toolConfirmation.test.ts : ${unclassified.join(', ')}. ` +
      'Décide : confirmation requise (CONFIRM_REQUIRED + case dans buildToolConfirmMessage) ou sûr (SAFE_TOOLS + justification).'
    ).toEqual([])
  })

  it('aucun tool ne peut être à la fois confirm et safe', () => {
    const both = Object.keys(CONFIRM_REQUIRED).filter((name) => SAFE_TOOLS.has(name))
    expect(both).toEqual([])
  })

  it('chaque tool CONFIRM_REQUIRED déclenche réellement la garde sur son cas risqué', () => {
    for (const [name, riskyInput] of Object.entries(CONFIRM_REQUIRED)) {
      expect(
        buildToolConfirmMessage(name, riskyInput, fakeT),
        `${name} devrait exiger une confirmation avec l'input ${JSON.stringify(riskyInput)}`
      ).not.toBeNull()
    }
  })

  it('les tools classés confirm existent bien dans les définitions (pas de garde fantôme)', () => {
    // declaredNames inclut les tools natifs via NATIVE_TOOL_DEFINITIONS,
    // donc plus besoin d'exemption : toute garde sur un nom inconnu = code mort.
    const declared = new Set(declaredNames)
    const ghosts = Object.keys(CONFIRM_REQUIRED).filter((name) => !declared.has(name))
    expect(
      ghosts,
      `Gardes sur des tools non déclarés (code mort ?) : ${ghosts.join(', ')}`
    ).toEqual([])
  })
})
