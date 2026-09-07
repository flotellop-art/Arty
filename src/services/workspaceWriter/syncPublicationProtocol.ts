import { parseSyncApplyHeader, syncApplyJobKey, type SyncApplyHeader } from './syncApplyProtocol'
import { parseSyncUpdateHeader, syncUpdateJobKey, type SyncUpdateHeader } from './syncUpdateProtocol'

/** Admission-only union: no crypto, payload reader, writer or implicit fallback. */
export type SyncPublicationHeader = SyncApplyHeader | SyncUpdateHeader
export const parseSyncPublicationHeader = (v: unknown): SyncPublicationHeader | null => parseSyncApplyHeader(v) ?? parseSyncUpdateHeader(v)
export const syncPublicationJobKey = (h: SyncPublicationHeader) => h.version === 10 ? syncApplyJobKey(h.apply.id) : syncUpdateJobKey(h.apply.id)
