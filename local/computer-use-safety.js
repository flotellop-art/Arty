'use strict';

// Validateurs PURS pour le pont computer-use (aucune dépendance externe, aucun
// require) afin de pouvoir les tester en isolation (vitest via createRequire)
// sans démarrer Express. Toute valeur issue d'une requête réseau qui finit
// interpolée dans un script PowerShell DOIT passer par ici d'abord.

const KEY_MAP = Object.freeze({
  enter: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  esc: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  'ctrl+a': '^a',
  'ctrl+c': '^c',
  'ctrl+v': '^v',
  'ctrl+s': '^s',
  'ctrl+z': '^z',
  'alt+tab': '%{TAB}',
  'alt+f4': '%{F4}',
});

// Bornes larges (multi-écrans => coordonnées négatives possibles) ; le point
// de sécurité est que la valeur soit un ENTIER, pas la borne exacte.
const COORD_MIN = -100000;
const COORD_MAX = 100000;

function validationError(message) {
  const err = new Error(message);
  err.name = 'ValidationError';
  err.statusCode = 400;
  return err;
}

function _toInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

// Coordonnée de souris : entier borné. Rejette tout le reste (string non
// numérique, float, objet) => empêche l'injection PowerShell via `click`.
function parseCoordinate(value, name) {
  const label = name === 'y' ? 'y' : 'x';
  const n = _toInt(value);
  if (n === null || n < COORD_MIN || n > COORD_MAX) {
    throw validationError(`Invalid ${label} coordinate: integer in range required`);
  }
  return n;
}

// Quantité de scroll : entier 1..100, défaut 3 si absent.
function parseScrollAmount(value) {
  if (value == null) return 3;
  const n = _toInt(value);
  if (n === null || n < 1 || n > 100) {
    throw validationError('Invalid scroll amount: integer 1..100 required');
  }
  return n;
}

// Touche : UNIQUEMENT une entrée de la liste blanche. Supprime le fallback
// `|| key` qui laissait passer une chaîne arbitraire dans SendKeys.
function normalizeKey(key) {
  if (typeof key !== 'string') {
    throw validationError('Unsupported key');
  }
  const mapped = KEY_MAP[key.trim().toLowerCase()];
  if (!mapped) {
    throw validationError('Unsupported key');
  }
  return mapped;
}

module.exports = {
  KEY_MAP,
  COORD_MIN,
  COORD_MAX,
  validationError,
  parseCoordinate,
  parseScrollAmount,
  normalizeKey,
};
