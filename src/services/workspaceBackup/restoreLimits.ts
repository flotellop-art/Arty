/** First Web release: admission limits, NOT archive-format or cold-reader
 * limits. Existing adopted jobs must remain recoverable after policy changes.
 * These are conservative resource bounds, not a guarantee of device memory. */
export const RESTORE_ARCHIVE_BYTES = 16 * 1024 * 1024
export const RESTORE_ADOPTION_BYTES = 32 * 1024 * 1024
