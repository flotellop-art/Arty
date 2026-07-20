import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, FileAttachment } from '../../types'

vi.mock('../../services/storage', () => ({
  getConversations: vi.fn(),
  getConversation: vi.fn(),
  saveConversation: vi.fn(),
  isCacheReady: vi.fn(() => true),
  deleteConversation: vi.fn(),
}))
vi.mock('../../services/visionAutoCrop', () => ({
  VisionAutoCropError: class VisionAutoCropError extends Error {
    constructor(public readonly code: string) { super(code) }
  },
  findLatestTerraVisionBatch: vi.fn(),
  isVisionAutoCropFollowUp: vi.fn(() => true),
  prepareVisionAutoCrop: vi.fn(),
}))
vi.mock('../../services/router/gatherRouteInput', () => ({
  classifyRouteAttachments: vi.fn(() => ({
    hasFiles: true, hasImages: true, hasPdf: false, hasOtherFiles: false,
  })),
  gatherRouteInput: vi.fn((input) => input),
}))
vi.mock('../../services/router/resolveRoute', () => ({
  canExecuteRoute: vi.fn(() => true),
  resolveRoute: vi.fn(() => ({
    provider: 'openai',
    model: 'gpt-5.6-terra',
    usesOpenAIVision: true,
    reason: { code: 'image_vision_openai' },
    overrides: [],
    webSearch: false,
  })),
}))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../hooks/openaiRouteMessages', () => ({ buildOpenAIRouteMessages: vi.fn() }))
vi.mock('../../services/openaiClient', () => ({ sendMessageStream: vi.fn() }))
vi.mock('../../services/activeApiKey', () => ({ getOpenAIKey: vi.fn(() => null) }))
vi.mock('../../services/secureFileStorage', () => ({
  getFile: vi.fn(),
  putFile: vi.fn(),
  deleteFile: vi.fn(),
  deleteOwnedFiles: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: vi.fn(() => 'user-a'),
  getActiveSessionEpoch: vi.fn(() => 7),
}))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/factChecker', () => ({
  getFactCheckMode: vi.fn(() => 'off'),
  runFactCheckOnLatest: vi.fn(),
}))
vi.mock('../../services/taskService', () => ({
  detectSuggestedTasks: vi.fn(() => []),
  addTask: vi.fn(),
}))
vi.mock('../../services/reminderService', () => ({
  detectReminderIntent: vi.fn(() => null),
  createReminder: vi.fn(),
}))

import * as storage from '../../services/storage'
import { buildOpenAIRouteMessages } from '../../hooks/openaiRouteMessages'
import { resolveRoute } from '../../services/router/resolveRoute'
import { sendMessageStream } from '../../services/openaiClient'
import { putFile } from '../../services/secureFileStorage'
import {
  findLatestTerraVisionBatch,
  prepareVisionAutoCrop,
} from '../../services/visionAutoCrop'
import { useConversation } from '../../hooks/useConversation'

const source: FileAttachment = {
  id: 'source-photo',
  name: 'piece.jpg',
  type: 'image/jpeg',
  size: 2_000_000,
  width: 3072,
  height: 4096,
  normalizationVersion: 2,
}

const oldCrop: FileAttachment = {
  id: 'old-crop',
  name: 'ancien-recadrage.jpg',
  type: 'image/jpeg',
  size: 300_000,
  width: 900,
  height: 1200,
  normalizationVersion: 2,
  visionCrop: {
    kind: 'auto',
    sourceFileId: source.id,
    sourceFileIds: [source.id],
    rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
  },
}

const freshCrop: FileAttachment = {
  ...oldCrop,
  id: 'fresh-crop-memory',
  name: 'nouveau-recadrage.jpg',
  data: 'AQID',
}

function conversation(): Conversation {
  return {
    id: 'conv-1',
    title: 'Photo',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      { id: 'source-msg', role: 'user', content: 'Décris la photo', timestamp: 1, files: [source] },
      {
        id: 'source-answer', role: 'assistant', content: 'Une pièce.', timestamp: 2,
        reasonCode: 'image_vision_openai',
      },
      { id: 'crop-msg', role: 'user', content: 'Lis le cadre à gauche', timestamp: 3, files: [oldCrop] },
      { id: 'crop-answer', role: 'assistant', content: 'Ancienne lecture.', timestamp: 4 },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useConversation — séquences auto-crop', () => {
  let conv: Conversation

  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    conv = conversation()
    vi.mocked(storage.getConversations).mockReturnValue([conv])
    vi.mocked(storage.getConversation).mockImplementation((id) => id === conv.id ? conv : null)
    vi.mocked(findLatestTerraVisionBatch).mockReturnValue([source])
    vi.mocked(prepareVisionAutoCrop).mockResolvedValue(freshCrop)
    vi.mocked(putFile).mockResolvedValue('fresh-crop-stored')
    vi.mocked(buildOpenAIRouteMessages).mockResolvedValue({
      messages: [{ role: 'user', content: 'analyse' }],
      consumedCurrentFiles: true,
    })
    vi.mocked(sendMessageStream).mockReturnValue(new AbortController())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('conserve tout le fil si le stockage du crop édité échoue', async () => {
    vi.mocked(putFile).mockRejectedValueOnce(new Error('idb full'))
    const initialIds = conv.messages.map((message) => message.id)
    const { result } = renderHook(() => useConversation())

    act(() => result.current.selectConversation(conv.id))
    act(() => result.current.editAndResend('crop-msg', 'Lis le cadre à droite'))

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(conv.messages.map((message) => message.id)).toEqual(initialIds)
    expect(result.current.errorRetryable).toBe(false)
    expect(sendMessageStream).not.toHaveBeenCalled()
  })

  it('ne tronque le fil qu’après la persistance réussie du nouveau crop', async () => {
    const write = deferred<string>()
    vi.mocked(putFile).mockReturnValueOnce(write.promise)
    const initialIds = conv.messages.map((message) => message.id)
    const { result } = renderHook(() => useConversation())

    act(() => result.current.selectConversation(conv.id))
    act(() => result.current.editAndResend('crop-msg', 'Lis le cadre à droite'))
    await waitFor(() => expect(putFile).toHaveBeenCalled())
    expect(conv.messages.map((message) => message.id)).toEqual(initialIds)

    write.resolve('fresh-crop-stored')
    await waitFor(() => expect(sendMessageStream).toHaveBeenCalledTimes(1))
    expect(conv.messages.slice(0, 2).map((message) => message.id)).toEqual(['source-msg', 'source-answer'])
    expect(conv.messages).toHaveLength(3)
    expect(conv.messages[2]?.content).toBe('Lis le cadre à droite')
    expect(conv.messages[2]?.files?.[0]?.id).toBe('fresh-crop-stored')
    expect(result.current.errorRetryable).toBe(true)

    act(() => result.current.stopStreaming(conv.id))
  })

  it('ne lance pas l’analyse finale si Stop survient pendant son builder', async () => {
    const routeBuild = deferred<{
      messages: Array<{ role: 'user'; content: string }>
      consumedCurrentFiles: boolean
    }>()
    vi.mocked(buildOpenAIRouteMessages).mockReturnValueOnce(routeBuild.promise)
    const { result } = renderHook(() => useConversation())

    act(() => result.current.selectConversation(conv.id))
    let sending!: Promise<boolean>
    act(() => { sending = result.current.sendMessage('Lis le cadre blanc à gauche', conv.id) })
    await waitFor(() => expect(buildOpenAIRouteMessages).toHaveBeenCalledTimes(1))

    act(() => result.current.stopStreaming(conv.id))
    routeBuild.resolve({
      messages: [{ role: 'user', content: 'analyse' }],
      consumedCurrentFiles: true,
    })
    await act(async () => { await sending })

    expect(sendMessageStream).not.toHaveBeenCalled()
  })

  it('fige Terra même si le sélecteur change pendant le repérage', async () => {
    const { result } = renderHook(() => useConversation())

    act(() => result.current.selectConversation(conv.id))
    await act(async () => {
      await result.current.sendMessage('Lis le cadre blanc à gauche', conv.id)
    })

    expect(resolveRoute).toHaveBeenCalledTimes(1)
    expect(sendMessageStream).toHaveBeenCalledTimes(1)
    expect(buildOpenAIRouteMessages).toHaveBeenCalledWith(expect.objectContaining({
      routeDecision: expect.objectContaining({
        provider: 'openai',
        usesOpenAIVision: true,
      }),
    }))

    act(() => result.current.stopStreaming(conv.id))
  })
})
