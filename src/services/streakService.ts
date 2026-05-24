/**
 * F-004 — Streak Service
 * Compteur de jours consécutifs d'utilisation d'Arty.
 *
 * Stockage : scopedStorage (plain JSON sync + chiffrement AES-256 en arrière-plan),
 * jamais envoyé au serveur.
 *
 * Design éthique :
 * - Pas de notification
 * - Pas de punition si streak cassé (repart à 1 silencieusement)
 * - Pause vacances : gèle le streak sans le casser
 * - Badge discret (visible seulement >= 2 jours)
 */

import * as scoped from './scopedStorage'

const STREAK_KEY = 'streak-data'

export interface StreakData {
  /** Date ISO YYYY-MM-DD du dernier jour actif */
  lastActiveDate: string | null
  /** Jours consécutifs actuels */
  currentStreak: number
  /** Record personnel */
  longestStreak: number
  /** Mode vacances : gèle le streak sans le casser */
  vacationMode: boolean
  /** Date ISO où la pause a commencé (pour info utilisateur) */
  vacationStart: string | null
}

const DEFAULT_DATA: StreakData = {
  lastActiveDate: null,
  currentStreak: 0,
  longestStreak: 0,
  vacationMode: false,
  vacationStart: null,
}

/** Retourne la date locale au format YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Différence en jours calendaires entre deux dates YYYY-MM-DD */
function daysBetween(a: string, b: string): number {
  const msA = new Date(a).getTime()
  const msB = new Date(b).getTime()
  return Math.round(Math.abs(msA - msB) / 86_400_000)
}

/**
 * Lit les données streak depuis le localStorage chiffré.
 * Lecture synchrone (plain JSON) pour être non-bloquant au rendu.
 */
export function getStreakData(): StreakData {
  const stored = scoped.getJSON<StreakData>(STREAK_KEY)
  if (!stored) return { ...DEFAULT_DATA }
  return { ...DEFAULT_DATA, ...stored }
}

/**
 * Persiste les données streak (JSON plain sync + chiffrement async).
 */
function saveStreakData(data: StreakData): void {
  scoped.secureSetJSON(STREAK_KEY, data)
  // Notifie les composants React qui écoutent (ex: StreakBadge)
  try {
    window.dispatchEvent(new CustomEvent('arty-streak-updated', { detail: data }))
  } catch { /* SSR / test env */ }
}

/**
 * Enregistre une activité aujourd'hui.
 * Idempotent : plusieurs appels le même jour = un seul incrément.
 *
 * Règles :
 * - Si mode vacances actif -> ne fait rien (streak gelé).
 * - Si déjà enregistré aujourd'hui -> ne fait rien.
 * - Si hier -> incrémente le streak.
 * - Si plus d'un jour d'absence -> repart à 1 (pas de punition).
 */
export function recordActivity(): StreakData {
  const data = getStreakData()
  const today = todayStr()

  // Mode vacances : on ne touche pas au streak
  if (data.vacationMode) return data

  // Déjà enregistré aujourd'hui : idempotent
  if (data.lastActiveDate === today) return data

  let newStreak: number

  if (!data.lastActiveDate) {
    // Premier jour
    newStreak = 1
  } else {
    const gap = daysBetween(data.lastActiveDate, today)
    if (gap === 1) {
      // Hier -> continuation
      newStreak = data.currentStreak + 1
    } else {
      // Absence > 1 jour -> repart à 1, sans message négatif
      newStreak = 1
    }
  }

  const updated: StreakData = {
    ...data,
    lastActiveDate: today,
    currentStreak: newStreak,
    longestStreak: Math.max(data.longestStreak, newStreak),
  }

  saveStreakData(updated)
  return updated
}

/**
 * Active ou désactive le mode vacances.
 * - Activation : gèle le streak à sa valeur actuelle.
 * - Désactivation : reprend le streak là où il était.
 *   Si l'utilisateur revient après une longue pause SANS mode vacances,
 *   le streak sera recalculé au prochain recordActivity().
 */
export function setVacationMode(enabled: boolean): StreakData {
  const data = getStreakData()
  const updated: StreakData = {
    ...data,
    vacationMode: enabled,
    vacationStart: enabled ? todayStr() : null,
  }
  saveStreakData(updated)
  return updated
}

/**
 * Remet le streak à zéro (ex: bouton "effacer mes données").
 */
export function clearStreakData(): void {
  scoped.setJSON(STREAK_KEY, DEFAULT_DATA)
  try {
    window.dispatchEvent(new CustomEvent('arty-streak-updated', { detail: DEFAULT_DATA }))
  } catch { /* SSR */ }
}
