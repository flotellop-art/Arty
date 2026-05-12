import { Capacitor } from '@capacitor/core'

/**
 * Helper haptic centralisé (roadmap UI Phase 1 #6 — Material You 3.0 standard
 * 2026, Apple HIG : haptic comme signal sémantique). Sur natif Android/iOS,
 * délègue au plugin Capacitor Haptics. Sur web/PWA, fallback `navigator.vibrate`
 * (Android Chrome) ou no-op (iOS Safari ne supporte pas `vibrate`).
 *
 * On charge le plugin en LAZY pour éviter de gonfler le bundle web — la grosse
 * majorité des utilisateurs web n'auront jamais besoin du module Capacitor
 * complet et `navigator.vibrate` suffit.
 */

type HapticIntensity = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

async function getNativeHaptics() {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const mod = await import('@capacitor/haptics')
    return mod
  } catch {
    return null
  }
}

/**
 * Déclenche un retour haptique. Silencieux sur les plateformes qui ne supportent
 * pas (iOS Safari, desktop Firefox). Ne JAMAIS throw — un échec haptic ne doit
 * pas casser le flow utilisateur.
 *
 * Mapping vibration ms :
 * - light : 10 ms (envoi message, tap secondaire)
 * - medium : 20 ms (action confirmée, tâche créée)
 * - heavy : 30 ms (action importante, paiement)
 * - success : 10-30-10 ms (validation longue)
 * - warning : 20-50-20 ms (attention)
 * - error : 40-30-40 ms (erreur)
 */
export async function haptic(intensity: HapticIntensity = 'light'): Promise<void> {
  // Native path — plus fin sémantiquement (ImpactStyle.Light/Medium/Heavy +
  // notificationType Success/Warning/Error). On laisse Capacitor choisir le
  // bon pattern OS.
  const native = await getNativeHaptics()
  if (native) {
    try {
      if (intensity === 'success' || intensity === 'warning' || intensity === 'error') {
        await native.Haptics.notification({
          type: native.NotificationType[intensity.charAt(0).toUpperCase() + intensity.slice(1) as 'Success' | 'Warning' | 'Error'],
        })
        return
      }
      await native.Haptics.impact({
        style: native.ImpactStyle[intensity.charAt(0).toUpperCase() + intensity.slice(1) as 'Light' | 'Medium' | 'Heavy'],
      })
      return
    } catch {
      /* fallback to web below */
    }
  }

  // Web fallback — `navigator.vibrate` (Android Chrome / Edge / Firefox).
  // No-op silencieux sur iOS Safari et desktop.
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const patterns: Record<HapticIntensity, number | number[]> = {
        light: 10,
        medium: 20,
        heavy: 30,
        success: [10, 30, 10],
        warning: [20, 50, 20],
        error: [40, 30, 40],
      }
      navigator.vibrate(patterns[intensity])
    }
  } catch { /* user has disabled vibration in settings */ }
}
