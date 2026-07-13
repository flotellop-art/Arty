// Mode démo des déploiements de PREVIEW (revue design sans login Google).
// Conçu et durci par 3 audits agents (2 Opus sécu + 1 Sonnet session).
//
// SÉCURITÉ — double barrière (le bypass de login ne doit JAMAIS exister en prod) :
//  1. BUILD-TIME (__DEMO_ALLOWED__, vite.config.ts) : false figé sur le build
//     de prod (branche main) → ce module n'est même pas importé (main.tsx fait
//     un import() dynamique sous `if (__DEMO_ALLOWED__)`, éliminé par Vite).
//  2. RUNTIME (isDemoAllowed) : allowlist positive d'hôtes de PREVIEW +
//     exclusion dure du natif (signal infalsifiable).
//
// CE QUE LE MODE DÉMO NE FAIT JAMAIS (sinon corruption/fuite — audits) :
//  - initCrypto / setActiveKeys : aucune clé en mémoire (RÈGLE 1), et surtout
//    pas de création du sel crypto global qui casserait les conversations
//    chiffrées d'un vrai user arrivant ensuite sur le même appareil (BUG 47).
//  - migrateExistingData : déplacerait les données legacy globales dans le
//    namespace démo.
//  Tout appel serveur échoue de toute façon : pas de token Google (proxys 401)
//  et les origins preview ne sont pas dans ALLOWED_ORIGINS (CSRF 403).

import { isNative } from './native/platform'
import { setActiveSession, getActiveSession } from './userSession'
import { getConversations, saveConversation, resetConversationMemCache } from './storage'
import type { Conversation } from '../types'

const DEMO_USER_ID = 'demo-preview'

/** Hôte de preview Cloudflare ? Allowlist POSITIVE : sous-domaine de
 *  *.appfacade.pages.dev, en excluant explicitement les domaines .pages.dev
 *  NUS de prod (audit Opus : ne jamais matcher `arty.pages.dev` /
 *  `appfacade.pages.dev` nus). tryarty.com, www.tryarty.com, app.arty.fr,
 *  localhost → ne matchent pas. Exporté pour test. */
export function isPreviewHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'appfacade.pages.dev' || h === 'arty.pages.dev') return false
  return h.endsWith('.appfacade.pages.dev')
}

export function isDemoAllowed(): boolean {
  // Barrière build-time d'abord (en prod, tout ce qui suit est dead-code).
  if (typeof __DEMO_ALLOWED__ === 'undefined' || !__DEMO_ALLOWED__) return false
  // Barrière runtime : jamais sur l'app native, jamais hors preview.
  if (isNative) return false
  if (typeof location === 'undefined') return false
  return isPreviewHost(location.hostname)
}

/** Le mode démo est-il actif (session factice posée) ? Pour la bannière. */
export function isPreviewDemoActive(): boolean {
  return getActiveSession()?.authMethod === 'demo'
}

const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: 'demo-1',
    title: 'Devis Garage Martin — relance client',
    createdAt: Date.now() - 2 * 3600_000,
    updatedAt: Date.now() - 2 * 3600_000,
    euOnly: true,
    usedModels: ['mistral'],
    messages: [
      { id: 'd1a', role: 'user', content: 'Relis le devis du Garage Martin dans mon Drive et prépare un mail de relance poli.', timestamp: Date.now() - 2 * 3600_000 },
      { id: 'd1b', role: 'assistant', content: 'J\'ai retrouvé le devis (2 340 € TTC). Voici un brouillon de relance courtois…', timestamp: Date.now() - 2 * 3600_000 },
    ],
  },
  {
    id: 'demo-2',
    title: 'Synthèse du compte-rendu chantier',
    createdAt: Date.now() - 5 * 3600_000,
    updatedAt: Date.now() - 5 * 3600_000,
    messages: [
      { id: 'd2a', role: 'user', content: 'Résume le compte-rendu de chantier que je viens de joindre.', timestamp: Date.now() - 5 * 3600_000 },
      { id: 'd2b', role: 'assistant', content: 'Trois sujets ressortent : la livraison des menuiseries, le point équipe de jeudi et la validation client…', timestamp: Date.now() - 5 * 3600_000 },
    ],
  },
  {
    id: 'demo-3',
    title: 'Itinéraire Valence → Lyon vendredi',
    createdAt: Date.now() - 26 * 3600_000,
    updatedAt: Date.now() - 26 * 3600_000,
    messages: [
      { id: 'd3a', role: 'user', content: 'Combien de temps en voiture de Valence à Lyon vendredi matin ?', timestamp: Date.now() - 26 * 3600_000 },
      { id: 'd3b', role: 'assistant', content: 'Environ 1 h 10 sans trafic ; prévois 1 h 30 aux heures de pointe.', timestamp: Date.now() - 26 * 3600_000 },
    ],
  },
  {
    id: 'demo-4',
    title: 'Comparatif mutuelles pro 2026',
    createdAt: Date.now() - 30 * 3600_000,
    updatedAt: Date.now() - 30 * 3600_000,
    messages: [
      { id: 'd4a', role: 'user', content: 'Compare les mutuelles pro pour un artisan, budget 80 €/mois.', timestamp: Date.now() - 30 * 3600_000 },
      { id: 'd4b', role: 'assistant', content: 'Voici trois options qui rentrent dans ton budget, avec leurs garanties clés…', timestamp: Date.now() - 30 * 3600_000 },
    ],
  },
]

/** Pose la session factice + les conversations d'exemple. SANS le gate (le
 *  gate vit dans setupPreviewDemo) — exporté pour test unitaire de la
 *  mécanique session+seed. */
export function seedDemoData(): void {
  const existing = getActiveSession()
  // Si une (vraie) session non-démo existe déjà, ne pas l'écraser.
  if (existing && existing.authMethod !== 'demo') return

  // 1. Session AVANT tout accès scoped (sinon écriture sous le préfixe global
  //    → écrasement des clés legacy, audit Opus vecteur #1).
  setActiveSession({
    userId: DEMO_USER_ID,
    authMethod: 'demo',
    displayName: 'Aperçu',
    createdAt: Date.now(),
  })
  // Ne pas polluer le switcher multi-comptes avec un compte « Aperçu ».
  try { localStorage.removeItem('arty-known-sessions') } catch { /* ignore */ }

  // 2. Cache conversations frais → cacheReady=true via cold-read (store vide).
  resetConversationMemCache()
  getConversations()

  // 3. Seed idempotent (ne re-seed pas si déjà présent au rechargement).
  if (getConversations().length === 0) {
    for (const conv of DEMO_CONVERSATIONS) saveConversation(conv)
  }

  // 4. Signale aux hooks React que le cache conversations est prêt (BUG 43).
  try { window.dispatchEvent(new CustomEvent('conversations-storage-ready')) } catch { /* ignore */ }
}

/** Pose une session factice + des conversations d'exemple AVANT le render
 *  React, pour que l'app s'ouvre directement (sans login) sur les previews.
 *  No-op total hors preview (double barrière). */
export function setupPreviewDemo(): void {
  if (!isDemoAllowed()) return
  // Échappatoire : ?login pour tester l'écran de connexion réel sur preview.
  try {
    if (new URLSearchParams(location.search).has('login')) return
  } catch { /* pas de location.search — ignore */ }
  seedDemoData()
}
