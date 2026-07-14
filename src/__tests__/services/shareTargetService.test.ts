import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @capacitor/core BEFORE importing the service so registerPlugin returns
// the controllable stub we read from in the assertions. vi.mock() is hoisted
// above imports — vi.hoisted() lets us reference variables from inside it.
const { mockGetPendingShare, mockAddListener } = vi.hoisted(() => ({
  mockGetPendingShare: vi.fn(),
  mockAddListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    getPendingShare: mockGetPendingShare,
    addListener: mockAddListener,
  }),
}))

import {
  buildDraftFromShare,
  consumePendingDraft,
  getPendingShare,
  addShareListener,
  setPendingDraft,
  shareFileToAttachment,
  type SharePayload,
} from '../../services/shareTargetService'

beforeEach(() => {
  vi.clearAllMocks()
  // Drain any leftover module-level draft from a previous test.
  consumePendingDraft()
})

describe('shareTargetService — getPendingShare', () => {
  it('returns null when the plugin has nothing to share', async () => {
    mockGetPendingShare.mockResolvedValue({ text: null, file: null, error: null })
    const res = await getPendingShare()
    expect(res).toBeNull()
  })

  it('returns the text payload when the plugin emits one', async () => {
    mockGetPendingShare.mockResolvedValue({
      text: 'Hello from Chrome',
      file: null,
      error: null,
    })
    const res = await getPendingShare()
    expect(res).toEqual({ text: 'Hello from Chrome', file: null, error: null })
  })

  it('returns the file payload when the plugin emits one', async () => {
    const file = {
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      base64: 'JVBERi0xLjcK',
      sizeBytes: 12,
    }
    mockGetPendingShare.mockResolvedValue({ text: null, file, error: null })
    const res = await getPendingShare()
    expect(res?.file).toEqual(file)
  })

  it('returns null when the plugin call rejects', async () => {
    mockGetPendingShare.mockRejectedValue(new Error('plugin missing'))
    const res = await getPendingShare()
    expect(res).toBeNull()
  })
})

describe('shareTargetService — addShareListener', () => {
  it('registers the listener and returns a cleanup that calls remove()', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    let captured: ((p: SharePayload) => void) | undefined
    mockAddListener.mockImplementation(async (_evt: string, fn: (p: SharePayload) => void) => {
      captured = fn
      return { remove }
    })

    const handler = vi.fn()
    const cleanup = await addShareListener(handler)

    expect(mockAddListener).toHaveBeenCalledWith('shareReceived', expect.any(Function))
    // The wrapper drops empty payloads but forwards real ones.
    captured?.({ text: null, file: null, error: null })
    expect(handler).not.toHaveBeenCalled()
    captured?.({ text: 'hi', file: null, error: null })
    expect(handler).toHaveBeenCalledWith({ text: 'hi', file: null, error: null })

    cleanup()
    expect(remove).toHaveBeenCalled()
  })

  it('returns a no-op cleanup when the plugin call rejects', async () => {
    mockAddListener.mockRejectedValue(new Error('plugin missing'))
    const cleanup = await addShareListener(() => {})
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })
})

describe('shareTargetService — buildDraftFromShare', () => {
  it('builds a text draft with the suggested prefix', () => {
    const draft = buildDraftFromShare({
      text: 'Lorem ipsum',
      file: null,
      error: null,
    })
    expect(draft).toEqual({
      text: 'Voici un texte que je viens de partager :\n\nLorem ipsum',
      files: [],
    })
  })

  it('keeps manually shared email content available for analysis', () => {
    const email = 'Objet : Devis signé\nDe : client@example.com\n\nBonjour, le devis est validé.'
    const draft = buildDraftFromShare({ text: email, file: null, error: null })

    expect(draft).toEqual({
      text: `Voici un texte que je viens de partager :\n\n${email}`,
      files: [],
    })
  })

  it('builds an image draft with the default analyse prompt', () => {
    const draft = buildDraftFromShare({
      text: null,
      file: {
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        base64: 'AAAA',
        sizeBytes: 4,
      },
      error: null,
    })
    expect(draft?.text).toBe('Analyse cette image.')
    expect(draft?.files).toHaveLength(1)
    expect(draft?.files[0]).toEqual(expect.objectContaining({
      name: 'photo.jpg',
      type: 'image/jpeg',
      data: 'AAAA',
    }))
    expect(draft?.files[0]?.id).toEqual(expect.any(String))
  })

  it('builds a PDF draft with the default summary prompt', () => {
    const draft = buildDraftFromShare({
      text: null,
      file: {
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        base64: 'JVBERi0=',
        sizeBytes: 6,
      },
      error: null,
    })
    expect(draft?.text).toBe('Résume ce PDF en points clés.')
    expect(draft?.files[0]?.type).toBe('application/pdf')
  })

  it('keeps the user-provided text alongside an image attachment', () => {
    const draft = buildDraftFromShare({
      text: 'Question subject',
      file: {
        name: 'img.png',
        mimeType: 'image/png',
        base64: 'BBBB',
        sizeBytes: 4,
      },
      error: null,
    })
    expect(draft?.text).toBe('Question subject')
    expect(draft?.files).toHaveLength(1)
  })

  it('returns null when the payload is too large', () => {
    const draft = buildDraftFromShare({ text: null, file: null, error: 'file_too_large' })
    expect(draft).toBeNull()
  })

  it('returns null when there is no usable content', () => {
    const draft = buildDraftFromShare({ text: '   ', file: null, error: null })
    expect(draft).toBeNull()
  })
})

describe('shareTargetService — pending draft singleton', () => {
  it('consumePendingDraft returns null when nothing is set', () => {
    expect(consumePendingDraft()).toBeNull()
  })

  it('consumePendingDraft returns the draft once and clears it', () => {
    setPendingDraft({ text: 'hello', files: [] })
    expect(consumePendingDraft()).toEqual({ text: 'hello', files: [] })
    expect(consumePendingDraft()).toBeNull()
  })
})

describe('shareTargetService — shareFileToAttachment', () => {
  it('maps the native ShareFile payload to a FileAttachment', () => {
    const att = shareFileToAttachment({
      name: 'a.pdf',
      mimeType: 'application/pdf',
      base64: 'JVBERi0=',
      sizeBytes: 6,
    })
    expect(att).toEqual(expect.objectContaining({
      name: 'a.pdf',
      type: 'application/pdf',
      data: 'JVBERi0=',
    }))
    expect(att.id).toEqual(expect.any(String))
  })
})
