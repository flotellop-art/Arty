// Native capabilities — re-export everything
export { isNative, platform } from './platform'
export { listLocalFiles, readLocalFile, writeLocalFile, createLocalDirectory, deleteLocalFile } from './filesystem'
export type { LocalFile } from './filesystem'
export { takePhoto, pickPhoto, scanDocument } from './camera'
export type { CapturedPhoto } from './camera'
export { initPushNotifications, onPushNotification, sendLocalNotification, requestNotificationPermission } from './notifications'
export { shareContent } from './share'
