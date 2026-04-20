/**
 * User profile — stores the name and date of birth collected via the
 * onboarding popup (ProfileSetupModal). Kept separate from UserSession
 * so it survives account switches without leaking across users
 * (scoped storage prefixes by userId).
 *
 * Data is stored as plain JSON under `user-profile`. It is NOT sensitive:
 * the first name is meant to be displayed prominently in the Home hero.
 * The DoB is kept local — used for age-aware greetings / horoscope
 * features later, never sent to any server.
 */

import * as scoped from './scopedStorage'

const KEY = 'user-profile'

export interface UserProfile {
  /** The first name shown in the Home hero ("Bonjour *Florent.*") */
  name: string
  /** ISO date string YYYY-MM-DD (input type="date" format) or empty */
  dob: string
  /** Timestamp when the user completed (or skipped) the setup */
  completedAt: number
}

export function getUserProfile(): UserProfile | null {
  return scoped.getJSON<UserProfile>(KEY)
}

export function setUserProfile(partial: Omit<UserProfile, 'completedAt'>): UserProfile {
  const profile: UserProfile = {
    name: partial.name.trim(),
    dob: partial.dob.trim(),
    completedAt: Date.now(),
  }
  scoped.setJSON(KEY, profile)
  window.dispatchEvent(new CustomEvent('user-profile-changed', { detail: profile }))
  return profile
}

/**
 * Mark the profile as completed even if the user skipped the modal, so
 * we don't show it again. Stores an empty name/dob that callers can
 * distinguish from a null profile.
 */
export function skipUserProfile(): void {
  scoped.setJSON(KEY, { name: '', dob: '', completedAt: Date.now() } satisfies UserProfile)
  window.dispatchEvent(new CustomEvent('user-profile-changed', { detail: null }))
}
