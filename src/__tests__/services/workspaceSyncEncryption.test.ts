import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import 'fake-indexeddb/auto'
import { openDB, deleteDB } from 'idb'
import { stageSyncChange } from '../../services/workspaceSync/causal'
import { encodeSyncManifest } from '../../services/workspaceSync/schema'
import type { SyncManifest, SyncChange } from '../../services/workspaceSync/types'
import { createSyncRecoveryCode, createSyncVaultSession, prepareSyncUpdate, openSyncUpdate, resumeSyncUpdate,
  parseSyncEnvelopeReference, calculateSyncEnvelopeLayout, SYNC_ENVELOPE_LIMITS as L,
  type SyncEnvelopeReference, type SyncVaultGuard } from '../../services/workspaceSync/encryption'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bound = { vaultId: id(1), epoch: id(2) }
const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const base = (): SyncManifest => ({ format: 'arty-sync-causal', version: 1, ...bound, records: [] })
const source = () => ({ assertCurrent: vi.fn(), validate: vi.fn(async () => {}) })
const raw = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const sha = async (bytes: Uint8Array) => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex')
const textHash = async (text: string) => sha(new TextEncoder().encode(text))
function lifetime() {
  const controller = new AbortController()
  const guard: SyncVaultGuard = { signal: controller.signal, assertCurrent: vi.fn(), validateReadOnly: vi.fn(async () => {}) }
  return { controller, guard }
}
async function unlocked(scope = bound, secret = code) {
  const session = createSyncVaultSession(), life = lifetime()
  return { session, ...life, key: await session.unlock(secret, scope, life.guard) }
}
async function fixture(large = false) {
  // Opaque synthetic payloads. This fixture is NOT the application DTO/capture.
  const content = JSON.stringify({ title: 'Dossier ultra privé 😀', comparison: { groupId: 'local-only-group' }, message: 'Ne pas transmettre mon secret en clair', euOnly: true })
  const values = [new Blob([content]), new Blob([new Uint8Array(large ? L.chunkBytes + 13 : 17).fill(231)]), new Blob(['Été\nTexte exact\r\n'])]
  let next = base()
  const objects = new Map<string, Blob>()
  for (const [i, blob] of values.entries()) {
    const payloadId = id(100 + i), recordId = id(10 + i)
    const change: SyncChange = { ...bound, recordId, kind: i === 0 ? 'conversation' : i === 1 ? 'file' : 'project-text',
      revision: { id: id(20 + i), intent: 'create', parents: [], value: { state: 'live', payloadId, bytes: blob.size, sha256: await sha(await raw(blob)) } } }
    next = stageSyncChange(next, change); objects.set(payloadId, blob)
  }
  return { next, objects, content }
}
async function ready(large = false) {
  const context = await unlocked(), f = await fixture(large), capture = source()
  const prepared = await prepareSyncUpdate(context.key, base(), f.next, f.objects, capture)
  return { ...context, ...f, capture, prepared, reference: prepared.reference, cipher: prepared.ciphertext }
}
async function changedReference(reference: Readonly<SyncEnvelopeReference>, blob: Blob) {
  return { ...reference, bytes: blob.size, sha256: await sha(await raw(blob)) }
}

// Independent writer for hostile, correctly authenticated plaintext. Deliberately
// does not call the production encoder, layout, KDF, header or framing helpers.
async function authenticatedFixture(metadata: string | Uint8Array, payloads: Uint8Array[] = []) {
  const descriptor = typeof metadata === 'string' ? new TextEncoder().encode(metadata) : metadata
  const operationId = crypto.randomUUID(), header = new Uint8Array(104), view = new DataView(header.buffer)
  header.set(new TextEncoder().encode('ARTYSYN1'))
  for (const [offset, value] of [[8, bound.vaultId], [24, bound.epoch], [40, operationId]] as const) header.set(Buffer.from(value.replace(/-/g, ''), 'hex'), offset)
  header.set(crypto.getRandomValues(new Uint8Array(32)), 56)
  const sections = [descriptor, ...payloads], chunk = 262144
  view.setUint32(88, descriptor.length)
  view.setUint32(92, sections.reduce((total, section) => total + section.length, 0))
  view.setUint32(96, sections.reduce((total, section) => total + Math.ceil(section.length / chunk), 0))
  const root = await webcrypto.subtle.importKey('raw', Buffer.from(code.slice(10).replace(/-/g, ''), 'hex'), 'HKDF', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: header.slice(56, 88),
    info: new TextEncoder().encode(JSON.stringify(['arty-workspace-sync/envelope/v1', bound.vaultId, bound.epoch, operationId])) }, root,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const parts: BlobPart[] = [header]; let index = 0
  for (const [sectionIndex, section] of sections.entries()) for (let offset = 0; offset < section.length; offset += chunk) {
    const plaintext = section.subarray(offset, offset + chunk), prefix = new Uint8Array(9), iv = new Uint8Array(12), aad = new Uint8Array(113)
    prefix[0] = sectionIndex === 0 ? 1 : 2
    new DataView(prefix.buffer).setUint32(1, index); new DataView(prefix.buffer).setUint32(5, plaintext.length)
    new DataView(iv.buffer).setUint32(8, index); aad.set(header); aad.set(prefix, 104)
    parts.push(prefix, await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext)); index++
  }
  const ciphertext = new Blob(parts)
  const reference: SyncEnvelopeReference = { format: 'arty-sync-envelope-ref', version: 1, ...bound, operationId,
    bytes: ciphertext.size, sha256: await sha(await raw(ciphertext)) }
  return { ciphertext, reference }
}
async function descriptorFor(next = base(), from = base()) {
  return { format: 'arty-sync-update', version: 1, baseHash: await textHash(encodeSyncManifest(from)), manifest: next }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden in codec tests') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('sync envelope candidate: real WebCrypto, no application outbox or upload', () => {
  it('opens the same bytes in a second RAM context and verifies all payloads before exposure', async () => {
    const a = await ready(true), b = await unlocked()
    const opened = await openSyncUpdate(b.key, a.reference, a.cipher, base())
    expect(opened.manifest).toEqual(a.next)
    for (const [id, blob] of a.objects) expect(await raw(opened.payload(id))).toEqual(await raw(blob))
    expect(opened.payloadIds).toEqual([...a.objects.keys()])
    expect(() => opened.payload(id(999))).toThrow('sync_envelope_missing')
    const copy = opened.manifest; copy.records.splice(0)
    expect(opened.manifest).toEqual(a.next)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not expose content, logical IDs, plaintext hashes or secret in the envelope header/reference', async () => {
    const a = await ready(), ciphertext = Buffer.from(await raw(a.cipher)), reference = JSON.stringify(a.reference)
    const privateValues = [a.content, code, 'Dossier ultra privé', id(10), id(20), id(100)]
    for (const record of a.next.records) for (const rev of record.revisions) if (rev.value.state === 'live') privateValues.push(rev.value.sha256)
    for (const value of privateValues) {
      expect(ciphertext.includes(Buffer.from(value))).toBe(false)
      expect(reference.includes(value)).toBe(false)
    }
    expect(ciphertext.subarray(0, 8).toString()).toBe('ARTYSYN1')
    expect(ciphertext.subarray(8, 24).toString('hex')).toBe(bound.vaultId.replace(/-/g, ''))
    expect(ciphertext.subarray(24, 40).toString('hex')).toBe(bound.epoch.replace(/-/g, ''))
    expect(ciphertext.subarray(40, 56).toString('hex')).toBe(a.reference.operationId.replace(/-/g, ''))
    expect([...ciphertext.subarray(100, 104)]).toEqual([0, 0, 0, 0])
  })

  it('uses fresh operation IDs, salt and ciphertext for new preparations of identical input', async () => {
    const a = await ready(), another = await prepareSyncUpdate(a.key, base(), a.next, a.objects, source())
    expect(another.reference.operationId).not.toBe(a.reference.operationId)
    const left = await raw(a.cipher), right = await raw(another.ciphertext)
    expect(left.slice(56, 88)).not.toEqual(right.slice(56, 88))
    expect(left.slice(104)).not.toEqual(right.slice(104))
  })

  it('uses nonextractable HKDF root/derived keys, separated context, and one global nonce sequence', async () => {
    const imports = vi.spyOn(crypto.subtle, 'importKey'), derive = vi.spyOn(crypto.subtle, 'deriveKey'), encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    const a = await ready(true)
    expect(imports.mock.calls[0]![3]).toBe(false)
    expect(imports.mock.calls[0]![2]).toBe('HKDF')
    expect((imports.mock.calls[0]![1] as Uint8Array).every(b => b === 0)).toBe(true)
    const parameters = derive.mock.calls[0]![0] as HkdfParams
    expect(parameters).toMatchObject({ name: 'HKDF', hash: 'SHA-256' })
    expect(JSON.parse(new TextDecoder().decode(parameters.info))).toEqual(['arty-workspace-sync/envelope/v1', bound.vaultId, bound.epoch, a.reference.operationId])
    expect(derive.mock.calls[0]![3]).toBe(false)
    const keys = new Set(encrypt.mock.calls.map(call => call[1]))
    expect(keys.size).toBe(1)
    let i = 0
    for (const [options, key] of encrypt.mock.calls) {
      const p = options as AesGcmParams, iv = p.iv as Uint8Array, aad = p.additionalData as Uint8Array
      expect(key.extractable).toBe(false); expect(p.tagLength).toBe(128)
      expect(iv.length).toBe(12); expect(new DataView(iv.buffer).getUint32(8)).toBe(i)
      expect(new DataView(aad.buffer).getUint32(105)).toBe(i)
      expect(aad.length).toBe(113); i++
    }
    expect(i).toBeGreaterThan(3)
    await expect(crypto.subtle.exportKey('raw', [...keys][0]!)).rejects.toThrow()
  })

  it('accepts only the distinct random recovery-key format, not passwords/archive codes', async () => {
    const a = createSyncRecoveryCode(), b = createSyncRecoveryCode()
    expect(a).toMatch(/^ARTYSYNC1-(?:[A-F0-9]{8}-){7}[A-F0-9]{8}$/); expect(a).not.toBe(b)
    await expect(unlocked(bound, ` ${code.toLowerCase()} `)).resolves.toBeDefined()
    for (const bad of ['password', 'server-provided', code.replace('ARTYSYNC1', 'ARTY1'), code.slice(0, -1), `${code}-00`, 'x'.repeat(1000)]) {
      await expect(unlocked(bound, bad)).rejects.toThrow('sync_envelope_secret')
    }
  })

  it('refuses a wrong valid-shaped secret without a partial result', async () => {
    const a = await ready(), wrong = await unlocked(bound, createSyncRecoveryCode())
    await expect(openSyncUpdate(wrong.key, a.reference, a.cipher, base())).rejects.toThrow('sync_envelope_integrity')
  })

  it.each(['vaultId', 'epoch', 'operationId'] as const)('rejects a mismatching expected %s, even with a correct ciphertext hash', async field => {
    const a = await ready(), reference = { ...a.reference, [field]: id(900) }
    await expect(openSyncUpdate(a.key, reference, a.cipher, base())).rejects.toThrow('sync_envelope_scope')
  })

  it('rejects substitution of another completely valid envelope from the same vault', async () => {
    const a = await ready(), b = await prepareSyncUpdate(a.key, base(), a.next, a.objects, source())
    await expect(openSyncUpdate(a.key, { ...a.reference, bytes: b.reference.bytes, sha256: b.reference.sha256 }, b.ciphertext, base())).rejects.toThrow('sync_envelope_scope')
    // A new matching reference legitimately opens it; this is NOT freshness.
    await expect(openSyncUpdate(a.key, b.reference, b.ciphertext, base())).resolves.toBeDefined()
  })

  it('binds the independent exact base inside the encrypted descriptor', async () => {
    const a = await ready()
    await expect(openSyncUpdate(a.key, a.reference, a.cipher, a.next)).rejects.toThrow('sync_envelope_base')
    expect(encodeSyncManifest(base())).toBe(encodeSyncManifest(base()))
  })

  it('transports only payloads newly introduced relative to the retained base', async () => {
    const a = await ready(), content = new Blob(['Modification après la première opération'])
    const payloadId = id(200)
    const next = stageSyncChange(a.next, { ...bound, recordId: id(10), kind: 'conversation', revision: { id: id(30), intent: 'edit', parents: [id(20)],
      value: { state: 'live', payloadId, bytes: content.size, sha256: await sha(await raw(content)) } } })
    const operation = await prepareSyncUpdate(a.key, a.next, next, new Map([[payloadId, content]]), source())
    const opened = await openSyncUpdate(a.key, operation.reference, operation.ciphertext, a.next)
    expect(opened.payloadIds).toEqual([payloadId])
    expect(await opened.payload(payloadId).text()).toBe(await content.text())
    expect(() => opened.payload(id(100))).toThrow('sync_envelope_missing')
    await expect(prepareSyncUpdate(a.key, a.next, next, new Map([...a.objects, [payloadId, content]]), source())).rejects.toThrow('sync_envelope_missing')
  })

  it('requires the exact preceding base on a fresh receiver, then opens a chain without losing ancestral payloads', async () => {
    const a = await ready(), blob = new Blob(['second revision']), payloadId = id(200)
    const next = stageSyncChange(a.next, { ...bound, recordId: id(10), kind: 'conversation', revision: {
      id: id(30), intent: 'edit', parents: [id(20)], value: { state: 'live', payloadId, bytes: blob.size, sha256: await sha(await raw(blob)) },
    } })
    const second = await prepareSyncUpdate(a.key, a.next, next, new Map([[payloadId, blob]]), source()), b = await unlocked()
    await expect(openSyncUpdate(b.key, second.reference, second.ciphertext, base())).rejects.toThrow('sync_envelope_base')
    const firstReceived = await openSyncUpdate(b.key, a.reference, a.cipher, base())
    const secondReceived = await openSyncUpdate(b.key, second.reference, second.ciphertext, firstReceived.manifest)
    expect(secondReceived.manifest).toEqual(next)
    expect(secondReceived.payloadIds).toEqual([payloadId])
    expect(await raw(firstReceived.payload(id(100)))).toEqual(await raw(a.objects.get(id(100))!))
    expect(await raw(firstReceived.payload(id(101)))).toEqual(await raw(a.objects.get(id(101))!))
    expect(await secondReceived.payload(payloadId).text()).toBe('second revision')
    // The transport does not implicitly fetch or retain those older bodies.
    expect(() => secondReceived.payload(id(100))).toThrow('sync_envelope_missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('supports a tombstone-only delta without pretending missing payloads are deletions', async () => {
    const a = await ready()
    const next = stageSyncChange(a.next, { ...bound, recordId: id(10), kind: 'conversation', revision: { id: id(30), intent: 'delete', parents: [id(20)], value: { state: 'deleted' } } })
    const update = await prepareSyncUpdate(a.key, a.next, next, new Map(), source())
    const opened = await openSyncUpdate(a.key, update.reference, update.ciphertext, a.next)
    expect(opened.payloadIds).toEqual([]); expect(opened.manifest).toEqual(next)
    await expect(prepareSyncUpdate(a.key, a.next, base(), new Map(), source())).rejects.toThrow('sync_rebase')
  })

  it('refuses missing, extra, wrong-sized or wrong-content payloads before returning a prepared operation', async () => {
    const a = await unlocked(), f = await fixture()
    await expect(prepareSyncUpdate(a.key, base(), f.next, new Map(), source())).rejects.toThrow('sync_envelope_missing')
    await expect(prepareSyncUpdate(a.key, base(), f.next, new Map([...f.objects, [id(999), new Blob(['extra'])]]), source())).rejects.toThrow('sync_envelope_missing')
    const different = new Map(f.objects); different.set(id(100), new Blob(['bad']))
    await expect(prepareSyncUpdate(a.key, base(), f.next, different, source())).rejects.toThrow('sync_envelope_integrity')
    different.set(id(100), new Blob([new Uint8Array(f.objects.get(id(100))!.size)]))
    await expect(prepareSyncUpdate(a.key, base(), f.next, different, source())).rejects.toThrow('sync_envelope_integrity')
  })

  it('snapshots inputs before awaiting without invoking overridden Blob/Map methods', async () => {
    const a = await unlocked(), f = await fixture(), expected = encodeSyncManifest(f.next)
    const evil = f.objects.get(id(100))!, original = await raw(evil)
    Object.defineProperty(evil, 'size', { get() { throw new Error('do not invoke') } })
    Object.defineProperty(evil, 'slice', { value() { throw new Error('do not invoke') } })
    Object.defineProperty(f.objects, 'size', { get() { throw new Error('do not invoke') } })
    Object.defineProperty(f.objects, 'get', { value() { throw new Error('do not invoke') } })
    const task = prepareSyncUpdate(a.key, base(), f.next, f.objects, source())
    f.next.records.splice(0); f.objects.clear()
    const prepared = await task, opened = await openSyncUpdate(a.key, prepared.reference, prepared.ciphertext, base())
    expect(encodeSyncManifest(opened.manifest)).toBe(expected)
    expect(await raw(opened.payload(id(100)))).toEqual(original)
  })

  it('never exports an update after source freshness is lost during preparation', async () => {
    const a = await unlocked(), f = await fixture(), capture = source()
    capture.validate.mockImplementationOnce(async () => { throw new Error('source_changed') })
    await expect(prepareSyncUpdate(a.key, base(), f.next, f.objects, capture)).rejects.toThrow('source_changed')
  })

  it.each([0, 7, 56, 70, 88, 92, 96, 100, 104, 105, 110, 120, -1])('refuses modified bytes at %i, even if the public hash is recomputed', async point => {
    const a = await ready(), modified = await raw(a.cipher), position = point === -1 ? modified.length - 1 : point
    modified[position]! ^= 1
    const blob = new Blob([modified]), reference = await changedReference(a.reference, blob)
    await expect(openSyncUpdate(a.key, reference, blob, base())).rejects.toThrow(/^sync_envelope_/)
  })

  it('refuses truncation, trailing bytes, frame permutation/duplication and cross-envelope frame splicing', async () => {
    const a = await ready(true), b = await prepareSyncUpdate(a.key, base(), a.next, a.objects, source())
    const ab = await raw(a.cipher), bb = await raw(b.ciphertext)
    const metadataLength = new DataView(ab.buffer).getUint32(88), firstSize = 9 + metadataLength + 16
    const startPayload = 104 + firstSize, payloadOneSize = 9 + a.objects.get(id(100))!.size + 16
    const startLarge = startPayload + payloadOneSize, chunkSize = 9 + L.chunkBytes + 16, tailSize = 9 + 13 + 16
    const variants = [a.cipher.slice(0, -1), new Blob([a.cipher, 'extra']),
      new Blob([ab.slice(0, startLarge), ab.slice(startLarge + chunkSize, startLarge + chunkSize + tailSize), ab.slice(startLarge, startLarge + chunkSize), ab.slice(startLarge + chunkSize + tailSize)]),
      new Blob([ab.slice(0, startLarge + chunkSize), ab.slice(startLarge, startLarge + chunkSize), ab.slice(startLarge + chunkSize)]),
      new Blob([ab.slice(0, startLarge), bb.slice(startLarge, startLarge + chunkSize), ab.slice(startLarge + chunkSize)]),
    ]
    for (const blob of variants) await expect(openSyncUpdate(a.key, await changedReference(a.reference, blob), blob, base())).rejects.toThrow(/^sync_envelope_/)
  })

  it('checks the durable ciphertext hash, not only the AEAD tags', async () => {
    const a = await ready(), decrypt = vi.spyOn(crypto.subtle, 'decrypt')
    await expect(openSyncUpdate(a.key, { ...a.reference, sha256: '0'.repeat(64) }, a.cipher, base())).rejects.toThrow('sync_envelope_integrity')
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('preflights aggregate plaintext before any payload read, random salt or derived envelope key', async () => {
    const a = await unlocked(), objects = new Map<string, Blob>(); let next = base()
    for (let n = 10; n < 12; n++) {
      const blob = new Blob([new Uint8Array(9 * 1024 * 1024)]); objects.set(id(100 + n), blob)
      next = stageSyncChange(next, { ...bound, recordId: id(n), kind: 'file', revision: { id: id(20 + n), intent: 'create', parents: [],
        value: { state: 'live', payloadId: id(100 + n), bytes: blob.size, sha256: '0'.repeat(64) } } })
    }
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer'), derive = vi.spyOn(crypto.subtle, 'deriveKey'), random = vi.spyOn(crypto, 'getRandomValues')
    await expect(prepareSyncUpdate(a.key, base(), next, objects, source())).rejects.toThrow('sync_envelope_limit')
    expect(read).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
  })

  it('does not let claimed header sizes trigger a KDF or body allocation', async () => {
    const a = await ready(), modified = await raw(a.cipher)
    new DataView(modified.buffer).setUint32(88, L.metadataBytes + 1)
    const blob = new Blob([modified]), reference = await changedReference(a.reference, blob), derive = vi.spyOn(crypto.subtle, 'deriveKey')
    await expect(openSyncUpdate(a.key, reference, blob, base())).rejects.toThrow(/^sync_envelope_/)
    expect(derive).not.toHaveBeenCalled()
  })

  it('checks layout and public-reference bounds without coercion or getters', () => {
    expect(calculateSyncEnvelopeLayout(10, [1, L.chunkBytes + 1])).toEqual({ plaintextBytes: L.chunkBytes + 12, frames: 4, bytes: L.chunkBytes + 216 })
    for (const [meta, sizes] of [[0, []], [1.5, []], [1, [0]], [1, [-1]], [1, [Infinity]], [1, [10 * 1024 * 1024 + 1]], [L.metadataBytes + 1, []], [1, Array(257).fill(1)]] as [number, number[]][]) {
      expect(() => calculateSyncEnvelopeLayout(meta, sizes)).toThrow(/^sync_envelope_/)
    }
    let called = false
    const ref = { format: 'arty-sync-envelope-ref', version: 1, ...bound, operationId: id(9), bytes: 200, get sha256() { called = true; return '0'.repeat(64) } }
    expect(() => parseSyncEnvelopeReference(ref)).toThrow('sync_envelope_format'); expect(called).toBe(false)
  })

  it('opens an independently encrypted valid descriptor, then refuses authenticated noncanonical or unknown metadata', async () => {
    const a = await unlocked(), descriptor = await descriptorFor(), canonical = JSON.stringify(descriptor)
    const valid = await authenticatedFixture(canonical)
    expect((await openSyncUpdate(a.key, valid.reference, valid.ciphertext, base())).manifest).toEqual(base())
    const variants = [
      JSON.stringify({ ...descriptor, extra: true }), JSON.stringify({ ...descriptor, version: 2 }),
      JSON.stringify({ ...descriptor, format: 'arty-backup' }),
      canonical.replace('"version":1', '"version":1,"version":1'),
      ` ${canonical}`, `${canonical}\n`, JSON.stringify(descriptor, null, 2),
      JSON.stringify({ manifest: descriptor.manifest, baseHash: descriptor.baseHash, version: 1, format: 'arty-sync-update' }),
      new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(canonical)]), new Uint8Array([0xc0, 0xaf]),
    ]
    for (const metadata of variants) {
      const malformed = await authenticatedFixture(metadata)
      await expect(openSyncUpdate(a.key, malformed.reference, malformed.ciphertext, base())).rejects.toThrow('sync_envelope_format')
    }
  })

  it('rejects valid AEAD tags around wrong private base, scope and causal ancestry', async () => {
    const a = await ready(), descriptor = await descriptorFor()
    for (const [metadata, error, from] of [
      [{ ...descriptor, baseHash: '0'.repeat(64) }, 'sync_envelope_base', base()],
      [{ ...descriptor, manifest: { ...base(), epoch: id(999) } }, 'sync_envelope_scope', base()],
      [await descriptorFor(base(), a.next), 'sync_rebase', a.next],
    ] as const) {
      const malformed = await authenticatedFixture(JSON.stringify(metadata))
      await expect(openSyncUpdate(a.key, malformed.reference, malformed.ciphertext, from)).rejects.toThrow(error)
    }
  })

  it('does not expose any payload when authenticated contents disagree with private commitments or counts', async () => {
    const a = await unlocked(), f = await fixture(), descriptor = JSON.stringify(await descriptorFor(f.next))
    const originals = await Promise.all([...f.objects.values()].map(raw))
    const badContent = originals.map(value => value.slice()); badContent[2]![0]! ^= 1
    const wrong = await authenticatedFixture(descriptor, badContent)
    await expect(openSyncUpdate(a.key, wrong.reference, wrong.ciphertext, base())).rejects.toThrow('sync_envelope_integrity')
    for (const contents of [originals.slice(0, -1), [...originals, new Uint8Array([1])], [originals[1]!, originals[0]!, originals[2]!]]) {
      const malformed = await authenticatedFixture(descriptor, contents)
      await expect(openSyncUpdate(a.key, malformed.reference, malformed.ciphertext, base())).rejects.toThrow('sync_envelope_format')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('handles metadata across frame boundaries without resending ancestral payloads or resetting nonce indexes', async () => {
    const a = await unlocked(), before = base(), oldHash = await textHash('a')
    for (let n = 0; n < 1000; n++) before.records.push({ id: id(10000 + n), kind: 'conversation', revisions: [{
      id: id(20000 + n), intent: 'create', parents: [], value: { state: 'live', payloadId: id(30000 + n), bytes: 1, sha256: oldHash },
    }] })
    expect(new TextEncoder().encode(encodeSyncManifest(before)).length).toBeGreaterThan(L.chunkBytes)
    const payload = new Blob(['b']), next = stageSyncChange(before, { ...bound, recordId: id(10000), kind: 'conversation', revision: {
      id: id(40000), intent: 'edit', parents: [id(20000)], value: { state: 'live', payloadId: id(50000), bytes: 1, sha256: await textHash('b') },
    } })
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    const update = await prepareSyncUpdate(a.key, before, next, new Map([[id(50000), payload]]), source())
    const kinds = encrypt.mock.calls.map(call => (call[0] as AesGcmParams).additionalData as Uint8Array).map(aad => aad[104])
    expect(kinds).toEqual([1, 1, 2])
    expect(encrypt.mock.calls.map(call => new DataView(((call[0] as AesGcmParams).iv as Uint8Array).buffer).getUint32(8))).toEqual([0, 1, 2])
    const opened = await openSyncUpdate(a.key, update.reference, update.ciphertext, before)
    expect(opened.manifest).toEqual(next); expect(opened.payloadIds).toEqual([id(50000)])
    expect(await opened.payload(id(50000)).text()).toBe('b')
  })
})

describe('RAM lifetime and byte-identical saved candidate, not a production outbox', () => {
  it.each(['lock', 'abort', 'unlock'] as const)('refuses plaintext if an account callback synchronously reenters %s', async action => {
    const a = await ready(), opened = await openSyncUpdate(a.key, a.reference, a.cipher, base())
    let pending: ReturnType<typeof a.session.unlock> | undefined
    vi.mocked(a.guard.assertCurrent).mockImplementationOnce(() => {
      if (action === 'lock') a.session.lock()
      else if (action === 'abort') a.controller.abort()
      else pending = a.session.unlock(code, bound, a.guard)
    })
    expect(() => opened.payload(id(100))).toThrow('sync_envelope_locked')
    expect(() => a.prepared.ciphertext).toThrow('sync_envelope_locked')
    const replacement = await pending
    if (replacement) await expect(prepareSyncUpdate(replacement, base(), a.next, a.objects, source())).resolves.toBeDefined()
  })

  it.each(['lock', 'abort', 'unlock'] as const)('refuses prepared adoption if a capture callback synchronously reenters %s', async action => {
    const a = await ready(); let pending: ReturnType<typeof a.session.unlock> | undefined
    a.capture.assertCurrent.mockImplementationOnce(() => {
      if (action === 'lock') a.session.lock()
      else if (action === 'abort') a.controller.abort()
      else pending = a.session.unlock(code, bound, a.guard)
    })
    expect(() => a.prepared.ciphertext).toThrow('sync_envelope_locked')
    const replacement = await pending
    if (replacement) await expect(prepareSyncUpdate(replacement, base(), a.next, a.objects, source())).resolves.toBeDefined()
  })

  it('refuses already-aborted unlock before key import and retires a key if durable unlock admission fails', async () => {
    const session = createSyncVaultSession(), life = lifetime(), imports = vi.spyOn(crypto.subtle, 'importKey')
    life.controller.abort()
    await expect(session.unlock(code, bound, life.guard)).rejects.toThrow('sync_envelope_cancelled')
    expect(imports).not.toHaveBeenCalled()
    const fresh = lifetime(); vi.mocked(fresh.guard.validateReadOnly).mockRejectedValueOnce(new Error('admission_lost'))
    await expect(session.unlock(code, bound, fresh.guard)).rejects.toThrow('admission_lost')
    expect((imports.mock.calls[0]![1] as Uint8Array).every(byte => byte === 0)).toBe(true)
    await expect(session.unlock(code, bound, fresh.guard)).resolves.toBeDefined()
  })

  it('rechecks source freshness at final adoption after all frames are encrypted', async () => {
    const a = await unlocked(), f = await fixture(), capture = source(), encrypt = vi.spyOn(crypto.subtle, 'encrypt')
    capture.validate.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => { throw new Error('source_after_encrypt') })
    await expect(prepareSyncUpdate(a.key, base(), f.next, f.objects, capture)).rejects.toThrow('source_after_encrypt')
    expect(encrypt.mock.calls.length).toBeGreaterThan(3)
    await expect(prepareSyncUpdate(a.key, base(), f.next, f.objects, source())).resolves.toBeDefined()
  })

  it('retires old handles on lock/new unlock, including return to the same scope', async () => {
    const a = await ready(), reference = a.reference, cipher = a.cipher
    a.session.lock()
    expect(() => a.prepared.ciphertext).toThrow('sync_envelope_locked')
    const second = await a.session.unlock(code, bound, a.guard)
    await expect(openSyncUpdate(a.key, reference, cipher, base())).rejects.toThrow('sync_envelope_locked')
    await expect(openSyncUpdate(second, reference, cipher, base())).resolves.toBeDefined()
    await expect(openSyncUpdate({ ...second }, reference, cipher, base())).rejects.toThrow('sync_envelope_locked')
  })

  it('closes opened views after abort; it cannot erase a Blob already copied by a caller', async () => {
    const a = await ready(), opened = await openSyncUpdate(a.key, a.reference, a.cipher, base()), handedOut = opened.payload(id(100))
    a.controller.abort()
    expect(() => opened.manifest).toThrow('sync_envelope_locked')
    expect(() => opened.payload(id(100))).toThrow('sync_envelope_locked')
    await expect(opened.validate()).rejects.toThrow('sync_envelope_locked')
    expect(await handedOut.text()).toBe(a.content)
  })

  it('terminally retires the secret after a durable admission/fence failure', async () => {
    const a = await ready(), reference = a.reference, cipher = a.cipher
    vi.mocked(a.guard.validateReadOnly).mockRejectedValueOnce(new Error('durable_fence_changed'))
    await expect(a.prepared.validate()).rejects.toThrow('durable_fence_changed')
    await expect(openSyncUpdate(a.key, reference, cipher, base())).rejects.toThrow('sync_envelope_locked')
  })

  it.each(['importKey', 'deriveKey', 'encrypt', 'digest'] as const)('rejects an in-flight preparation retired after %s', async method => {
    const a = await unlocked(), f = await fixture(), original = crypto.subtle[method].bind(crypto.subtle) as (...args: any[]) => Promise<any>
    vi.spyOn(crypto.subtle, method).mockImplementationOnce(async (...args: any[]) => { const result = await original(...args); a.session.lock(); return result })
    const task = method === 'importKey' ? a.session.unlock(code, bound, a.guard) : prepareSyncUpdate(a.key, base(), f.next, f.objects, source())
    await expect(task).rejects.toThrow('sync_envelope_locked')
  })

  it('does not publish decrypted plaintext if the key is retired while decrypt is awaiting', async () => {
    const a = await ready(), original = crypto.subtle.decrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => { const result = await original(...args); a.session.lock(); return result })
    await expect(openSyncUpdate(a.key, a.reference, a.cipher, base())).rejects.toThrow('sync_envelope_locked')
  })

  it('cancels an old unlock completed after a newer unlock succeeds', async () => {
    const session = createSyncVaultSession(), life = lifetime(), original = crypto.subtle.importKey.bind(crypto.subtle)
    let release!: () => void
    const pause = new Promise<void>(yes => { release = yes })
    vi.spyOn(crypto.subtle, 'importKey').mockImplementationOnce(async (...args: any[]) => { const key = await (original as any)(...args); await pause; return key })
    const first = session.unlock(code, bound, life.guard)
    const rejected = expect(first).rejects.toThrow('sync_envelope_locked')
    const second = await session.unlock(code, bound, life.guard)
    release(); await rejected
    const f = await fixture()
    await expect(prepareSyncUpdate(second, base(), f.next, f.objects, source())).resolves.toBeDefined()
  })

  it('replays exact ciphertext after fake-IDB serialization/reopen and a source edit, with zero encrypt calls', async () => {
    const a = await ready(), name = `sync-encryption-test-${crypto.randomUUID()}`
    let db = await openDB(name, 1, { upgrade(db) { db.createObjectStore('candidate') } })
    try {
      // Only public ref and ciphertext persisted. No recovery key or plaintext
      // manifest. This is an IDB serialization probe, not the app's outbox.
      const saved = { reference: a.reference, ciphertext: a.cipher }
      await db.put('candidate', saved, 'one')
      const before = await raw(a.cipher)
      a.capture.assertCurrent.mockImplementation(() => { throw new Error('source_now_changed') })
      expect(() => a.prepared.ciphertext).toThrow('source_now_changed')
      a.session.lock(); db.close()
      db = await openDB(name, 1)
      const loaded = await db.get('candidate', 'one'), b = await unlocked()
      const encrypt = vi.spyOn(crypto.subtle, 'encrypt'), random = vi.spyOn(crypto, 'getRandomValues')
      const resumed = await resumeSyncUpdate(b.key, loaded.reference, loaded.ciphertext, base())
      await resumed.validate()
      expect(resumed.reference).toEqual(saved.reference)
      expect(await raw(resumed.ciphertext)).toEqual(before)
      expect(encrypt).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled()
      const opened = await openSyncUpdate(b.key, resumed.reference, resumed.ciphertext, base())
      expect(opened.manifest).toEqual(a.next)
    } finally { db.close(); await deleteDB(name) }
  })
})
