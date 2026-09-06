import { encodeSyncManifest, parseSyncManifest } from './schema'
import { reconcileSyncManifests } from './causal'
import { SYNC_LIMITS, type SyncManifest, type SyncValue } from './types'
import { parseSyncStateBinding, SYNC_STATE_BYTES, SYNC_STATE_OVERHEAD, syncBase64ToBytes, syncBytesToBase64 } from './localFormat'
import { SYNC_ENVELOPE_LIMITS, parseSyncEnvelopeReference, envelopeFail as fail, envelopeFields as exact,
  envelopeScope as scope, assertEnvelopeScope as sameScope, envelopeHash as hash, type SyncVaultScope, type SyncEnvelopeReference } from './envelopeFormat'
export { SYNC_ENVELOPE_LIMITS, SyncEnvelopeError, parseSyncEnvelopeReference, type SyncVaultScope, type SyncEnvelopeReference } from './envelopeFormat'

/** Encryption only: no storage, network, UI, ACK or server authority. */
const L = SYNC_ENVELOPE_LIMITS, HEADER = 104, PREFIX = 9, TAG = 16
const utf8 = new TextEncoder(), MAGIC = utf8.encode('ARTYSYN1')
const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const unhex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g)!, pair => parseInt(pair, 16))
const digest = async (bytes: Uint8Array): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

/** Captured account/document/erasure lifetime, NOT source-content freshness.
 * The application adapter must bind this to real owner/epoch/fence admission. */
export interface SyncVaultGuard {
  signal: AbortSignal
  assertCurrent(): void
  validateReadOnly(): Promise<void>
}
/** Source revisions must still be exact UNTIL durable outbox adoption. */
export interface SyncCaptureGuard { assertCurrent(): void; validate(): Promise<void> }
/** Imported RAM key capability, NOT confirmation that this code opens the
 * intended vault. Only opening an independently expected envelope proves that;
 * the future UI must not equate unlock() success with a confirmed secret. */
export interface UnlockedSyncVault extends Readonly<SyncVaultScope> {}
export interface PreparedSyncUpdate {
  readonly reference: Readonly<SyncEnvelopeReference>
  readonly ciphertext: Blob
  /** Call immediately before adoption/dispatch; not an IDB transaction itself. */
  validate(): Promise<void>
}
export interface OpenedSyncUpdate {
  readonly manifest: SyncManifest
  /** Only NEW payloads, not an instruction to look up missing old application IDs. */
  readonly payloadIds: readonly string[]
  payload(id: string): Blob
  validate(): Promise<void>
}

function immutableBlob(input: Blob): Blob {
  // Native intrinsic rejects non-Blobs and avoids overridden size/slice methods.
  try { return Blob.prototype.slice.call(input, 0, undefined, 'application/octet-stream') }
  catch { return fail('format') }
}

type VaultState = { scope: SyncVaultScope; root: CryptoKey | null; assertCurrent(): void; validate(): Promise<void>; close(): void }
const vaults = new WeakMap<UnlockedSyncVault, VaultState>()
function active(vault: UnlockedSyncVault): VaultState {
  const state = vaults.get(vault)
  if (!state) return fail('locked')
  state.assertCurrent(); return state
}

const STATE_MAGIC = utf8.encode('ARTYSST1'), STATE_HEADER = 52
async function stateKey(state: VaultState, header: Uint8Array) {
  state.assertCurrent()
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: header.slice(8, 40),
    info: utf8.encode('arty-workspace-sync/local-state/v1') }, state.root!, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  state.assertCurrent(); return key
}
function stateAAD(binding: unknown, state: VaultState) {
  const parsed = parseSyncStateBinding(binding); sameScope(parsed, state.scope)
  // Authenticates owner, generation, enrollment, revision AND the entire exact
  // pending reference, including its ciphertext digest and byte length.
  return utf8.encode(JSON.stringify(parsed))
}
export async function sealSyncLocalState(vault: UnlockedSyncVault, binding: unknown, plaintext: Blob): Promise<string> {
  const state = active(vault), aad = stateAAD(binding, state), input = immutableBlob(plaintext)
  if (!input.size || input.size > SYNC_STATE_BYTES) return fail('limit')
  const header = new Uint8Array(STATE_HEADER); header.set(STATE_MAGIC)
  header.set(crypto.getRandomValues(new Uint8Array(44)), 8)
  const raw = await bytes(input, state)
  try {
    const key = await stateKey(state, header)
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.slice(40), additionalData: aad, tagLength: 128 }, key, raw))
    state.assertCurrent(); await state.validate(); state.assertCurrent()
    const packet = new Uint8Array(STATE_HEADER + sealed.length); packet.set(header); packet.set(sealed, STATE_HEADER)
    return syncBytesToBase64(packet, SYNC_STATE_OVERHEAD + 1, SYNC_STATE_BYTES + SYNC_STATE_OVERHEAD)
  } finally { raw.fill(0) }
}
export async function openSyncLocalState(vault: UnlockedSyncVault, binding: unknown, ciphertext: string) {
  const state = active(vault), aad = stateAAD(binding, state)
  const packet = syncBase64ToBytes(ciphertext, SYNC_STATE_OVERHEAD + 1, SYNC_STATE_BYTES + SYNC_STATE_OVERHEAD)
  if (!STATE_MAGIC.every((v, i) => packet[i] === v)) return fail('format')
  const key = await stateKey(state, packet.slice(0, STATE_HEADER))
  let plaintext: Uint8Array | undefined
  try {
    try { plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packet.slice(40, STATE_HEADER), additionalData: aad, tagLength: 128 }, key, packet.slice(STATE_HEADER))) }
    catch { state.assertCurrent(); return fail('integrity') }
    state.assertCurrent(); await state.validate(); state.assertCurrent()
    const blob = new Blob([plaintext], { type: 'application/octet-stream' })
    return Object.freeze({ get plaintext() { state.assertCurrent(); return blob }, validate: () => state.validate() })
  } finally { plaintext?.fill(0) }
}

export function createSyncRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  try { return `ARTYSYNC1-${hex(bytes).toUpperCase().match(/.{8}/g)!.join('-')}` }
  finally { bytes.fill(0) }
}
function secretBytes(input: string): Uint8Array {
  if (typeof input !== 'string' || input.length > 128) return fail('secret')
  const code = input.trim().toUpperCase()
  if (!/^ARTYSYNC1-(?:[0-9A-F]{8}-){7}[0-9A-F]{8}$/.test(code)) return fail('secret')
  return unhex(code.slice(10).replace(/-/g, ''))
}

/** One RAM slot per client context. New unlock/lock retires the old AND any
 * pending unlock. No raw key, CryptoKey, recovery code or persistent key slot
 * is exposed. JS copies already given to callers cannot be physically wiped. */
export function createSyncVaultSession() {
  let generation = 0, current: VaultState | null = null
  const lock = () => { generation++; current?.close(); current = null }
  return Object.freeze({ lock, async unlock(code: string, scopeInput: unknown, inputGuard: SyncVaultGuard): Promise<UnlockedSyncVault> {
    lock()
    const mine = generation, bound = scope(scopeInput), signal = inputGuard.signal
    const accountCurrent = inputGuard.assertCurrent.bind(inputGuard), accountValidate = inputGuard.validateReadOnly.bind(inputGuard)
    let closed = false, root: CryptoKey | null = null
    const close = () => { closed = true; root = null; signal.removeEventListener('abort', close) }
    const assertSlot = () => {
      if (closed || mine !== generation) return fail('locked')
      if (signal.aborted) { close(); return fail('cancelled') }
    }
    const assertCurrent = () => {
      assertSlot()
      try { accountCurrent() }
      catch { close(); return fail('cancelled') }
      // A trusted adapter can still reenter lock/unlock/abort synchronously.
      // Its callback must not turn a retired slot into an authorized read.
      assertSlot()
    }
    const state: VaultState = { scope: bound, get root() { return root }, set root(value) { root = value }, close, assertCurrent,
      async validate() {
        assertCurrent()
        try { await accountValidate(); assertCurrent() }
        catch (error) { close(); throw error }
      } }
    signal.addEventListener('abort', close, { once: true })
    let raw: Uint8Array | undefined
    try {
      assertCurrent(); raw = secretBytes(code)
      root = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']); assertCurrent()
      await state.validate(); assertCurrent()
      const handle = Object.freeze({ ...bound })
      vaults.set(handle, state); current = state
      return handle
    } catch (error) { close(); throw error }
    finally { raw?.fill(0); code = '' }
  } })
}

type Payload = Extract<SyncValue, { state: 'live' }>
function payloads(manifest: SyncManifest): Map<string, Payload> {
  const values = new Map<string, Payload>()
  for (const record of manifest.records) for (const revision of record.revisions) {
    if (revision.value.state === 'live') values.set(revision.value.payloadId, revision.value)
  }
  return values
}
function delta(base: SyncManifest, next: SyncManifest): Payload[] {
  // Also rejects missing ancestry and payload/revision equivocation.
  reconcileSyncManifests(base, next, next)
  const before = payloads(base)
  const added = [...payloads(next).values()].filter(value => !before.has(value.payloadId))
  if (added.length > L.payloads) return fail('limit')
  return added.sort((a, b) => a.payloadId < b.payloadId ? -1 : a.payloadId > b.payloadId ? 1 : 0)
}
export function calculateSyncEnvelopeLayout(metadataBytes: number, payloadBytes: readonly number[]) {
  if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 1) return fail('format')
  if (metadataBytes > L.metadataBytes || !Array.isArray(payloadBytes) || payloadBytes.length > L.payloads) return fail('limit')
  let plaintextBytes = metadataBytes, frames = Math.ceil(metadataBytes / L.chunkBytes)
  for (const bytes of payloadBytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 1) return fail('format')
    if (bytes > SYNC_LIMITS.objectBytes) return fail('limit')
    plaintextBytes += bytes; frames += Math.ceil(bytes / L.chunkBytes)
  }
  const bytes = HEADER + plaintextBytes + frames * (PREFIX + TAG)
  if (plaintextBytes > L.plaintextBytes || frames > L.frames || bytes > L.ciphertextBytes) return fail('limit')
  return { plaintextBytes, frames, bytes }
}
function prefix(index: number, length: number, kind: 1 | 2): Uint8Array {
  const result = new Uint8Array(PREFIX), view = new DataView(result.buffer)
  result[0] = kind; view.setUint32(1, index); view.setUint32(5, length); return result
}
function params(header: Uint8Array, pre: Uint8Array, index: number): AesGcmParams {
  const iv = new Uint8Array(12); new DataView(iv.buffer).setUint32(8, index)
  const aad = new Uint8Array(HEADER + PREFIX); aad.set(header); aad.set(pre, HEADER)
  return { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }
}
async function derive(state: VaultState, header: Uint8Array, operationId: string): Promise<CryptoKey> {
  state.assertCurrent()
  const info = utf8.encode(JSON.stringify(['arty-workspace-sync/envelope/v1', state.scope.vaultId, state.scope.epoch, operationId]))
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: header.slice(56, 88), info }, state.root!,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  state.assertCurrent(); return key
}
function headerFor(bound: SyncVaultScope, operationId: string, metadataBytes: number, layout: ReturnType<typeof calculateSyncEnvelopeLayout>): Uint8Array {
  const header = new Uint8Array(HEADER), view = new DataView(header.buffer)
  header.set(MAGIC); header.set(unhex(bound.vaultId.replace(/-/g, '')), 8); header.set(unhex(bound.epoch.replace(/-/g, '')), 24)
  header.set(unhex(operationId.replace(/-/g, '')), 40); header.set(crypto.getRandomValues(new Uint8Array(32)), 56)
  view.setUint32(88, metadataBytes); view.setUint32(92, layout.plaintextBytes); view.setUint32(96, layout.frames)
  return header // reserved [100,104) is strictly zero
}
function checkHeader(header: Uint8Array, reference: Readonly<SyncEnvelopeReference>) {
  if (header.length !== HEADER || !MAGIC.every((byte, i) => byte === header[i]) || header.slice(100).some(byte => byte !== 0)) return fail('format')
  for (const [offset, expected] of [[8, reference.vaultId], [24, reference.epoch], [40, reference.operationId]] as const) {
    if (hex(header.slice(offset, offset + 16)) !== expected.replace(/-/g, '')) return fail('scope')
  }
  const view = new DataView(header.buffer), metadataBytes = view.getUint32(88), plaintextBytes = view.getUint32(92), frames = view.getUint32(96)
  if (metadataBytes < 1 || plaintextBytes < metadataBytes || frames < Math.ceil(metadataBytes / L.chunkBytes)) return fail('format')
  if (metadataBytes > L.metadataBytes || plaintextBytes > L.plaintextBytes || frames > L.frames) return fail('limit')
  if (HEADER + plaintextBytes + frames * (PREFIX + TAG) !== reference.bytes) return fail('format')
  return { metadataBytes, plaintextBytes, frames, bytes: reference.bytes }
}
async function bytes(blob: Blob, state: VaultState): Promise<Uint8Array> {
  state.assertCurrent()
  const value = new Uint8Array(await Blob.prototype.arrayBuffer.call(blob))
  try { state.assertCurrent(); return value } catch (error) { value.fill(0); throw error }
}
async function blobDigest(blob: Blob, state: VaultState): Promise<string> {
  const raw = await bytes(blob, state)
  try { const result = await digest(raw); state.assertCurrent(); return result }
  finally { raw.fill(0) }
}
function prepared(state: VaultState, reference: Readonly<SyncEnvelopeReference>, ciphertext: Blob, capture?: SyncCaptureGuard): PreparedSyncUpdate {
  const assert = () => { state.assertCurrent(); capture?.assertCurrent(); state.assertCurrent() }
  return Object.freeze({ get reference() { assert(); return reference }, get ciphertext() { assert(); return ciphertext },
    async validate() { assert(); await state.validate(); assert(); if (capture) { await capture.validate(); assert() } } })
}

/** Before adoption only. NEW operation identity and salt on every call. Once
 * durable, use resumeSyncUpdate; calling this again is NOT a retry. */
export async function prepareSyncUpdate(vault: UnlockedSyncVault, baseInput: unknown, nextInput: unknown,
  inputPayloads: ReadonlyMap<string, Blob>, source: SyncCaptureGuard): Promise<PreparedSyncUpdate> {
  const state = active(vault)
  // Capture callbacks/metadata/native immutable Blobs before the first await.
  const capture = { assertCurrent: source.assertCurrent.bind(source), validate: source.validate.bind(source) }
  const assert = () => { state.assertCurrent(); capture.assertCurrent(); state.assertCurrent() }
  assert()
  const base = parseSyncManifest(baseInput), next = parseSyncManifest(nextInput)
  sameScope(state.scope, base); sameScope(state.scope, next)
  const added = delta(base, next), baseJSON = encodeSyncManifest(base)
  // SHA-256 has fixed length: preflight EXACT metadata size before hashing/KDF.
  const metadataFor = (baseHash: string) => JSON.stringify({ format: 'arty-sync-update', version: 1, baseHash, manifest: next })
  const metadataLength = utf8.encode(metadataFor('0'.repeat(64))).length
  const layout = calculateSyncEnvelopeLayout(metadataLength, added.map(value => value.bytes))
  if (!(inputPayloads instanceof Map) || Object.getPrototypeOf(inputPayloads) !== Map.prototype ||
    Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(inputPayloads) !== added.length) return fail('missing')
  const objects = new Map<string, Blob>()
  for (const value of added) {
    const input = Map.prototype.get.call(inputPayloads, value.payloadId)
    if (!input) return fail('missing')
    const blob = immutableBlob(input)
    if (blob.size !== value.bytes) return fail('integrity')
    objects.set(value.payloadId, blob)
  }
  const operationId = crypto.randomUUID(), header = headerFor(state.scope, operationId, metadataLength, layout)
  let metadata: Uint8Array | undefined
  const parts: BlobPart[] = [header]
  try {
    await capture.validate(); assert(); await state.validate(); assert()
    const baseBytes = utf8.encode(baseJSON)
    let baseHash: string
    try { baseHash = await digest(baseBytes); assert() } finally { baseBytes.fill(0) }
    metadata = utf8.encode(metadataFor(baseHash))
    const key = await derive(state, header, operationId); assert()
    let index = 0
    const encrypt = async (plain: Uint8Array, kind: 1 | 2) => {
      assert(); const pre = prefix(index, plain.length, kind)
      const ciphertext = await crypto.subtle.encrypt(params(header, pre, index), key, plain)
      assert(); parts.push(pre, ciphertext); index++
    }
    for (let offset = 0; offset < metadata.length; offset += L.chunkBytes) await encrypt(metadata.subarray(offset, offset + L.chunkBytes), 1)
    for (const value of added) {
      const blob = objects.get(value.payloadId)!
      const actualHash = await blobDigest(blob, state); assert()
      if (actualHash !== value.sha256) return fail('integrity')
      for (let offset = 0; offset < blob.size; offset += L.chunkBytes) {
        const plain = await bytes(blob.slice(offset, offset + L.chunkBytes), state)
        try { await encrypt(plain, 2) } finally { plain.fill(0) }
      }
    }
    const ciphertext = new Blob(parts, { type: 'application/octet-stream' })
    if (index !== layout.frames || ciphertext.size !== layout.bytes) return fail('integrity')
    const cipherHash = await blobDigest(ciphertext, state); assert()
    const reference = parseSyncEnvelopeReference({ format: 'arty-sync-envelope-ref', version: 1, ...state.scope,
      operationId, bytes: ciphertext.size, sha256: cipherHash })
    const result = prepared(state, reference, ciphertext, capture)
    await result.validate(); assert(); return result
  } finally { metadata?.fill(0); parts.length = 0; objects.clear() }
}

/** Reference and causal base must come from an independently captured ticket,
 * never be inferred from the received header. This is integrity, NOT freshness. */
export async function openSyncUpdate(vault: UnlockedSyncVault, referenceInput: unknown, input: Blob, baseInput: unknown): Promise<OpenedSyncUpdate> {
  const state = active(vault), reference = parseSyncEnvelopeReference(referenceInput), base = parseSyncManifest(baseInput)
  sameScope(state.scope, reference); sameScope(state.scope, base)
  const ciphertext = immutableBlob(input)
  if (ciphertext.size !== reference.bytes) return fail('integrity')
  const baseJSON = encodeSyncManifest(base)
  const header = await bytes(ciphertext.slice(0, HEADER), state), layout = checkHeader(header, reference)
  await state.validate()
  // Check the entire saved ciphertext commitment before any decryption.
  if (await blobDigest(ciphertext, state) !== reference.sha256) return fail('integrity')
  const key = await derive(state, header, reference.operationId)
  let index = 0, offset = HEADER
  const decrypt = async (length: number, kind: 1 | 2): Promise<Uint8Array> => {
    state.assertCurrent()
    if (length < 1 || length > L.chunkBytes || offset + PREFIX + length + TAG > ciphertext.size) return fail('format')
    const pre = await bytes(ciphertext.slice(offset, offset + PREFIX), state)
    const expected = prefix(index, length, kind)
    if (!expected.every((byte, i) => byte === pre[i])) return fail('format')
    offset += PREFIX
    const cipher = await bytes(ciphertext.slice(offset, offset + length + TAG), state)
    let plain: Uint8Array | undefined
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt(params(header, pre, index), key, cipher))
      state.assertCurrent(); offset += cipher.length; index++
      return plain
    } catch { plain?.fill(0); state.assertCurrent(); return fail('integrity') }
    finally { cipher.fill(0) }
  }
  const metadata = new Uint8Array(layout.metadataBytes), objects = new Map<string, Blob>()
  try {
    for (let offset = 0; offset < metadata.length; offset += L.chunkBytes) {
      const plain = await decrypt(Math.min(L.chunkBytes, metadata.length - offset), 1)
      try { metadata.set(plain, offset) } finally { plain.fill(0) }
    }
    let json: string, raw: unknown
    try { json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(metadata); raw = JSON.parse(json) }
    catch { return fail('format') }
    const descriptor = exact(raw, ['format', 'version', 'baseHash', 'manifest'])
    if (descriptor.format !== 'arty-sync-update' || descriptor.version !== 1) return fail('format')
    const baseHash = hash(descriptor.baseHash), next = parseSyncManifest(descriptor.manifest)
    sameScope(state.scope, next)
    if (JSON.stringify({ format: 'arty-sync-update', version: 1, baseHash, manifest: next }) !== json) return fail('format')
    const baseBytes = utf8.encode(baseJSON)
    try { const actual = await digest(baseBytes); state.assertCurrent(); if (actual !== baseHash) return fail('base') }
    finally { baseBytes.fill(0) }
    const added = delta(base, next), shape = calculateSyncEnvelopeLayout(metadata.length, added.map(value => value.bytes))
    if (shape.bytes !== layout.bytes || shape.frames !== layout.frames || shape.plaintextBytes !== layout.plaintextBytes) return fail('format')
    for (const value of added) {
      const parts: BlobPart[] = []
      try {
        for (let remaining = value.bytes; remaining > 0; remaining -= L.chunkBytes) {
          const plain = await decrypt(Math.min(remaining, L.chunkBytes), 2)
          try { parts.push(new Blob([plain])) } finally { plain.fill(0) }
        }
        const blob = new Blob(parts)
        if (await blobDigest(blob, state) !== value.sha256) return fail('integrity')
        objects.set(value.payloadId, blob)
      } finally { parts.length = 0 }
    }
    if (index !== layout.frames || offset !== ciphertext.size) return fail('format')
    await state.validate(); state.assertCurrent()
    const ids = Object.freeze(added.map(value => value.payloadId))
    return Object.freeze({
      // Return detached copies: caller mutation never changes this private view.
      get manifest() { state.assertCurrent(); return parseSyncManifest(next) },
      get payloadIds() { state.assertCurrent(); return ids },
      payload(id: string) { state.assertCurrent(); const blob = objects.get(id); if (!blob) return fail('missing'); return blob },
      validate: () => state.validate(),
    })
  } catch (error) { objects.clear(); throw error }
  finally { metadata.fill(0) }
}

/** Re-open a DURABLY saved candidate under a current account-only lifetime.
 * Never calls encrypt, generates a salt/ID, reads the current conversation or
 * changes the causal base. No outbox commit or dispatch is implemented here. */
export async function resumeSyncUpdate(vault: UnlockedSyncVault, referenceInput: unknown, input: Blob, baseInput: unknown): Promise<PreparedSyncUpdate> {
  const state = active(vault), reference = parseSyncEnvelopeReference(referenceInput), ciphertext = immutableBlob(input)
  const opened = await openSyncUpdate(vault, reference, ciphertext, baseInput)
  await opened.validate(); state.assertCurrent()
  return prepared(state, reference, ciphertext)
}
