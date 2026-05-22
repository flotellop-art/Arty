/**
 * Global configuration flag for Arty features.
 * Set to FALSE for the public Play Store release to avoid requesting restricted Google OAuth scopes
 * (such as Gmail reading/managing and Google Drive access) and the corresponding CASA audit.
 * Default is TRUE (kept for closed beta < 100 testeurs).
 */
export const ENABLE_RESTRICTED_GOOGLE_FEATURES = true;
