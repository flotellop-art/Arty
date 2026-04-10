import { Capacitor } from '@capacitor/core'

/** True when running inside the Capacitor native shell (Android / iOS) */
export const isNative = Capacitor.isNativePlatform()

/** 'android' | 'ios' | 'web' */
export const platform = Capacitor.getPlatform()
