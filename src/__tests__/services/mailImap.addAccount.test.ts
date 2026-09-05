import { describe, it, expect, vi, beforeEach } from 'vitest'

// BUG 66 : addMailAccount tente le mot de passe NORMALISÉ d'abord, puis le
// brut en filet — uniquement sur refus d'authentification.

const { mockAddAccount } = vi.hoisted(() => ({ mockAddAccount: vi.fn() }))

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ addAccount: mockAddAccount }),
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}))

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
  getActiveSessionEpoch: () => 1,
}))

import { addMailAccount } from '../../services/native/mailImap'
import { blockProjectOperations } from '../../services/projects/localErasureGuard'

const GMAIL_INPUT = {
  provider: 'gmail',
  label: 'Gmail',
  host: 'imap.gmail.com',
  email: 'test@gmail.com',
  password: 'abcd efgh ijkl mnop',
}

beforeEach(() => {
  mockAddAccount.mockReset()
})

describe('addMailAccount — normalisation et retry', () => {
  it('ignores runtime scope/incarnation fields supplied outside the input contract', async () => {
    mockAddAccount.mockResolvedValue({ id: 'x', messageCount: 0 })
    await addMailAccount({ ...GMAIL_INPUT, scope: 'victim', incarnation: 'old' } as typeof GMAIL_INPUT)
    expect(mockAddAccount).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user-test' }))
    expect(mockAddAccount.mock.calls[0]![0]).not.toHaveProperty('incarnation')
  })
  it.each([false, true])('rejects an old auth retry during/after erasure release=%s', async released => {
    let reject!: (error: Error) => void
    mockAddAccount.mockReturnValueOnce(new Promise((_yes, no) => { reject = no }))
    const pending = addMailAccount(GMAIL_INPUT), rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(mockAddAccount).toHaveBeenCalledTimes(1))
    const release = blockProjectOperations('user-test')
    if (released) release()
    reject(new Error('auth_failed'))
    await rejected; release()
    expect(mockAddAccount).toHaveBeenCalledTimes(1)
  })
  it('envoie le mot de passe normalisé (sans espaces) en premier', async () => {
    mockAddAccount.mockResolvedValue({ id: 'x', messageCount: 3 })
    await addMailAccount(GMAIL_INPUT)
    expect(mockAddAccount).toHaveBeenCalledTimes(1)
    expect(mockAddAccount.mock.calls[0][0].password).toBe('abcdefghijklmnop')
    expect(mockAddAccount.mock.calls[0][0].scope).toBe('user-test')
  })

  it('retente avec le brut si le normalisé est refusé en auth_failed', async () => {
    mockAddAccount
      .mockRejectedValueOnce(new Error('auth_failed: Invalid credentials (Failure)'))
      .mockResolvedValueOnce({ id: 'x', messageCount: 1 })
    const res = await addMailAccount(GMAIL_INPUT)
    expect(res.messageCount).toBe(1)
    expect(mockAddAccount).toHaveBeenCalledTimes(2)
    expect(mockAddAccount.mock.calls[1][0].password).toBe('abcd efgh ijkl mnop')
  })

  it("ne fait qu'UN appel quand la normalisation est un no-op (pas de double échec chez Gmail)", async () => {
    mockAddAccount.mockRejectedValue(new Error('auth_failed'))
    await expect(
      addMailAccount({ ...GMAIL_INPUT, password: 'abcdefghijklmnop' })
    ).rejects.toThrow('auth_failed')
    expect(mockAddAccount).toHaveBeenCalledTimes(1)
  })

  it('ne retente PAS sur connect_failed', async () => {
    mockAddAccount.mockRejectedValue(new Error('connect_failed'))
    await expect(addMailAccount(GMAIL_INPUT)).rejects.toThrow('connect_failed')
    expect(mockAddAccount).toHaveBeenCalledTimes(1)
  })

  it('ne retente PAS sur too_many_accounts ni invalid_password', async () => {
    mockAddAccount.mockRejectedValueOnce(new Error('too_many_accounts'))
    await expect(addMailAccount(GMAIL_INPUT)).rejects.toThrow('too_many_accounts')
    mockAddAccount.mockRejectedValueOnce(new Error('invalid_password'))
    await expect(addMailAccount(GMAIL_INPUT)).rejects.toThrow('invalid_password')
    expect(mockAddAccount).toHaveBeenCalledTimes(2)
  })

  it('propage le dernier auth_failed quand les deux candidats échouent', async () => {
    mockAddAccount
      .mockRejectedValueOnce(new Error('auth_failed: Invalid credentials (Failure)'))
      .mockRejectedValueOnce(new Error('auth_failed: Invalid credentials (Failure)'))
    await expect(addMailAccount(GMAIL_INPUT)).rejects.toThrow('auth_failed')
    expect(mockAddAccount).toHaveBeenCalledTimes(2)
  })
})
