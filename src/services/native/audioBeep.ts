import { Capacitor, registerPlugin } from '@capacitor/core'

interface AudioBeepMutePlugin {
  muteForBeep(): Promise<{ muted: boolean; refCount: number }>
  restoreFromBeep(): Promise<{ muted: boolean; refCount: number }>
  forceRestore(): Promise<void>
}

const AudioBeepMute = registerPlugin<AudioBeepMutePlugin>('AudioBeepMute')

const isAndroidNative = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export async function muteBeep(): Promise<void> {
  if (!isAndroidNative()) return
  try {
    await AudioBeepMute.muteForBeep()
  } catch (err) {
    console.warn('[audioBeep] mute failed', err)
  }
}

export async function restoreBeep(): Promise<void> {
  if (!isAndroidNative()) return
  try {
    await AudioBeepMute.restoreFromBeep()
  } catch (err) {
    console.warn('[audioBeep] restore failed', err)
  }
}

export async function forceRestoreBeep(): Promise<void> {
  if (!isAndroidNative()) return
  try {
    await AudioBeepMute.forceRestore()
  } catch {
    // best-effort cleanup
  }
}
