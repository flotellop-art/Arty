import { expect, it, vi } from 'vitest'
import { parseResetReadyControl, validResetBundle } from '../../services/workspaceWriter/resetProtocol'
import { parseErasureHeader } from '../../services/workspaceWriter/erasureProtocol'

const generation = '76ba201a-547f-44a1-9000-111111111111', resetId = '76ba201a-547f-44a1-9000-222222222222'
const ready = () => ({ format: 'arty-workspace-control', version: 7, layout: 'isolated-v1', state: 'ready', revision: 1, generation,
  requiredOwners: ['a', 'a-b'], resets: [{ owner: 'a', operationId: 'ABCDEF12-0000-0000-0000-123456789ABC', resetId, phase: 'available' }] })
const bundle = () => ({ salt: JSON.stringify(Array(16).fill(255)), check: 'v2:' + 'A'.repeat(47) + '=', version: 'v2' })
it('strict ready v7 clones the full registry and keeps opaque historical operation IDs', () => {
  const input = ready(), parsed = parseResetReadyControl(input)
  expect(parsed).toEqual(input)
  input.resets[0]!.owner = 'b'; input.requiredOwners.push('b')
  expect(parsed?.resets[0]?.owner).toBe('a'); expect(parsed?.requiredOwners).toEqual(['a', 'a-b'])
})
it.each(['unknown', 'duplicate', 'owner', 'reset-id', 'extra', 'hole', 'prototype', 'revision', 'bundle-on-available'])('strict ready v7 refuses %s', kind => {
  const value: any = ready()
  if (kind === 'unknown') value.version = 8
  if (kind === 'duplicate') value.resets.push({ ...value.resets[0] })
  if (kind === 'owner') value.resets[0].owner = 'absent'
  if (kind === 'reset-id') value.resets[0].resetId = 'invalid'
  if (kind === 'extra') value.capability = 'no remote secrets'
  if (kind === 'hole') value.resets.length = 2
  if (kind === 'prototype') Object.setPrototypeOf(value, { extra: true })
  if (kind === 'revision') value.revision = Number.MAX_SAFE_INTEGER + 1
  if (kind === 'bundle-on-available') value.resets[0].bundle = bundle()
  expect(parseResetReadyControl(value)).toBeNull()
})
it('parsers do not invoke pre-validation getters', () => {
  const get = vi.fn(() => 'provisioning'), input = ready()
  Object.defineProperty(input.resets[0], 'phase', { enumerable: true, get })
  expect(parseResetReadyControl(input)).toBeNull(); expect(get).not.toHaveBeenCalled()
  const header = { ...ready(), state: 'erasing', erasure: {} }
  Object.defineProperty(header, 'version', { enumerable: true, get })
  expect(parseErasureHeader(header)).toBeNull(); expect(get).not.toHaveBeenCalled()
})
it('a provisioning bundle is canonical, bounded and removed at consumption', () => {
  expect(validResetBundle(bundle())).toBe(true)
  for (const change of [{ salt: '[1]' }, { salt: ' ' + bundle().salt }, { check: 'v2:short' }, { version: 'v3' }, { check: 'v1:' + 'A'.repeat(47) + '=' }]) {
    expect(validResetBundle({ ...bundle(), ...change })).toBe(false)
  }
  const value: any = ready(); value.resets[0] = { ...value.resets[0], phase: 'provisioning', bundle: bundle() }
  const parsed = parseResetReadyControl(value)
  expect(parsed).not.toBeNull(); value.resets[0].bundle.salt = '[0]'
  expect((parsed?.resets[0] as any).bundle.salt).toBe(bundle().salt)
  value.resets[0] = { ...value.resets[0], phase: 'consumed' }
  expect(parseResetReadyControl(value)).toBeNull()
})
