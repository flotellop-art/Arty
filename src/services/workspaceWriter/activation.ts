/** Compatibility commitment once isolated data has been published. Keep ON
 * in rollback builds so existing spaces and adopted jobs remain accessible.
 * Neither constant is a URL/localStorage flag or a remote revocation. */
export const ISOLATED_WORKSPACE_ENABLED = true
/** Initial Web migration/restore only. Turning this OFF in a new release must
 * never disable cold resume/abandon/erasure/reset or ready readers/writers. */
export const WORKSPACE_RESTORE_START_ENABLED = true
