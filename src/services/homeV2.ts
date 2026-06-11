// Killswitch PR G (accueil v2) — partagé entre TopBar (header allégé) et
// Sidebar (pied : coût/série/thème déplacés du header). DOIVENT lire le MÊME
// flag : sinon doublon (coût affiché dans le header v1 ET dans le pied).
// Même pattern que arty-chat-sheet-v2 / arty-inputbar-v2 : clé localStorage
// GLOBALE (hors scopedStorage/crypto, lisible même crypto cassée — BUG 43),
// active par défaut, posée à '0' pour rollback sans rebuild.
export function homeV2Enabled(): boolean {
  try {
    return localStorage.getItem('arty-home-v2') !== '0'
  } catch {
    return true
  }
}
