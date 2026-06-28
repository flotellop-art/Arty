const crypto = require('crypto');

const DEFAULT_TUNNEL_SECRET = 'dev-secret-change-me';
const MIN_SECRET_LENGTH = 32;
const MAX_COORDINATE = 100000;
const MAX_SCROLL_AMOUNT = 20;
const MAX_TEXT_LENGTH = 5000;

const KEY_MAP = Object.freeze({
  enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', up: '{UP}', down: '{DOWN}',
  left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}',
  pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ',
  'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+s': '^s',
  'ctrl+z': '^z', 'ctrl+x': '^x', 'alt+tab': '%{TAB}', 'alt+f4': '%{F4}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
});

function requireStrongTunnelSecret(raw) {
  const secret = typeof raw === 'string' ? raw.trim() : '';
  if (!secret || secret === DEFAULT_TUNNEL_SECRET || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`TUNNEL_SECRET must be set to a non-default secret of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

function safeCompareSecret(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const receivedHash = crypto.createHash('sha256').update(received).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(receivedHash, expectedHash);
}

function parseBoundedInteger(value, name, min, max) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) n = Number(value.trim());
  else throw new Error(`Invalid ${name}`);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}

function parseCoordinate(value, name) { return parseBoundedInteger(value, name, 0, MAX_COORDINATE); }
function parseScrollAmount(value) { return value == null || value === '' ? 3 : parseBoundedInteger(value, 'amount', 1, MAX_SCROLL_AMOUNT); }
function parseScrollDirection(value) {
  const direction = typeof value === 'string' ? value.toLowerCase() : 'down';
  if (direction !== 'up' && direction !== 'down') throw new Error('Invalid direction');
  return direction;
}
function validateText(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) throw new Error('Invalid text');
  return value;
}
function normalizeKey(value) {
  if (typeof value !== 'string') throw new Error('Invalid key');
  const sendKey = KEY_MAP[value.toLowerCase().trim()];
  if (!sendKey) throw new Error('Invalid key');
  return sendKey;
}
function psSingleQuote(value) { return String(value).replace(/'/g, "''"); }
function escapeSendKeysText(text) { return validateText(text).replace(/[+^%~(){}[\]]/g, '{$&}'); }

module.exports = { DEFAULT_TUNNEL_SECRET, MIN_SECRET_LENGTH, KEY_MAP, requireStrongTunnelSecret, safeCompareSecret, parseCoordinate, parseScrollAmount, parseScrollDirection, validateText, normalizeKey, psSingleQuote, escapeSendKeysText };
