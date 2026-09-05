import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, FileAttachment } from '../../types'
import { officeFixture } from '../helpers/officeFixture'

vi.mock('../../services/storage', () => ({ getConversations: vi.fn(), getConversation: vi.fn(), saveConversation: vi.fn(), isCacheReady: () => true }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/mistralClient', () => ({ streamMistralMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/visionAutoCrop', () => ({
  VisionAutoCropError: class extends Error {}, findLatestTerraVisionBatch: vi.fn(),
  isVisionAutoCropFollowUp: vi.fn(() => true), prepareVisionAutoCrop: vi.fn(),
}))
vi.mock('../../services/secureFileStorage', () => ({ getFile: vi.fn(), putFile: vi.fn(), deleteFile: vi.fn(), deleteOwnedFiles: vi.fn(async () => 0) }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: vi.fn(() => 'owner-a'), getActiveSessionEpoch: vi.fn(() => 1), getSessionProjectFence: () => 'initial', PROJECT_ERASURE_FENCE_KEY: 'test-project-fence' }))
vi.mock('../../services/crypto', async original => ({ ...await original<typeof import('../../services/crypto')>(), captureCryptoGuard: vi.fn(() => () => true) }))
vi.mock('../../services/autoMemory', () => ({ maybeExtractMemory: vi.fn() }))
vi.mock('../../services/pdfUrlFetch', () => ({ fetchPdfMarkdowns: vi.fn(async () => ''), fetchUrlMarkdowns: vi.fn(async () => ({ block: '', unreadable: [] })) }))
vi.mock('../../services/factChecker', () => ({ clearSearchContext: vi.fn(), getFactCheckMode: () => 'off', runFactCheckOnLatest: vi.fn() }))
vi.mock('../../services/taskService', () => ({ detectSuggestedTasks: vi.fn(() => []), addTask: vi.fn() }))
vi.mock('../../services/reminderService', () => ({ detectReminderIntent: () => null, createReminder: vi.fn() }))
vi.mock('../../services/router/notifyRouteOverrides', () => ({ notifyRouteOverrides: vi.fn() }))
vi.mock('../../services/router/gatherRouteInput', async (original) => {
  const actual = await original<typeof import('../../services/router/gatherRouteInput')>()
  return { ...actual, gatherRouteInput: vi.fn((ctx) => ({
    ...ctx, selectedModel: 'openai', availability: { claude: true, mistral: true, gemini: true, openai: true, openaiVision: true },
    plan: { plan: 'vip', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto', visionOpenAIEnabled: true, visionAutoRoutingEnabled: true,
  })) }
})

import * as storage from '../../services/storage'
import { getFile, putFile, deleteOwnedFiles } from '../../services/secureFileStorage'
import { getActiveSessionEpoch } from '../../services/userSession'
import { streamMessage } from '../../services/anthropicClient'
import { streamMistralMessage } from '../../services/mistralClient'
import { prepareVisionAutoCrop, findLatestTerraVisionBatch } from '../../services/visionAutoCrop'
import { useConversation } from '../../hooks/useConversation'
import { runFactCheckOnLatest } from '../../services/factChecker'
import { maybeExtractMemory } from '../../services/autoMemory'
import { addTask, detectSuggestedTasks } from '../../services/taskService'
import { fetchPdfMarkdowns, fetchUrlMarkdowns } from '../../services/pdfUrlFetch'
import { gatherRouteInput } from '../../services/router/gatherRouteInput'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const reference = (f: FileAttachment): FileAttachment => { const { data: _, ...rest } = f; return rest }

describe('Office — cycle complet sans API payante', () => {
  let conv: Conversation
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveSessionEpoch).mockReturnValue(1)
    vi.mocked(getFile).mockResolvedValue(null)
    vi.mocked(putFile).mockImplementation(async (f) => f.id)
    vi.mocked(detectSuggestedTasks).mockReturnValue([])
    conv = { id: 'c1', title: 'Documents', messages: [], createdAt: 1, updatedAt: 1 }
    vi.mocked(storage.getConversations).mockReturnValue([conv])
    vi.mocked(storage.getConversation).mockImplementation((id) => id === conv.id ? conv : null)
    vi.mocked(storage.saveConversation).mockImplementation(saved => { conv = saved })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const hook = renderHook(() => useConversation())
    act(() => hook.result.current.selectConversation(conv.id))
    return hook
  }
  function history(file = officeFixture()) {
    conv.messages = [{ id: 'u1', role: 'user', content: 'Lis ce document', timestamp: 1, files: [reference(file)] },
      { id: 'a1', role: 'assistant', content: 'Lecture précédente', timestamp: 2 }]
    vi.mocked(getFile).mockResolvedValue(file)
  }

  it('reports real attachment preparation and post-stream background checking as busy without blocking another conversation', async () => {
    const fileReady = deferred<string>(), background = deferred<void>()
    vi.mocked(putFile).mockReturnValueOnce(fileReady.promise)
    vi.mocked(runFactCheckOnLatest).mockReturnValueOnce(background.promise)
    // Claude text route, ordinary file preparation BEFORE startStream.
    const gather = vi.mocked(gatherRouteInput).getMockImplementation()!
    vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...gather(ctx), selectedModel: 'claude' }))
    const { result, unmount } = setup()
    let sending!: Promise<boolean>
    act(() => { sending = result.current.sendMessage('Lis cette note', conv.id, [{ id: 'f', name: 'note.txt', type: 'text/plain', data: 'QQ==' }]) })
    await waitFor(() => expect(putFile).toHaveBeenCalled())
    expect(result.current.isConversationBusy(conv.id)).toBe(true)
    expect(result.current.isConversationBusy('other')).toBe(false)
    expect(streamMessage).not.toHaveBeenCalled()
    await act(async () => { fileReady.resolve('f'); await sending })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    act(() => { call[1]('Une réponse assez longue pour être vérifiée.'); call[2]() })
    expect(runFactCheckOnLatest).toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isConversationBusy(conv.id)).toBe(true)
    await act(async () => { background.resolve(); await background.promise })
    expect(result.current.isConversationBusy(conv.id)).toBe(false)
    unmount()
  })

  it('covers the real fact-check link-recovery await before any pending badge exists', async () => {
    const actual = await vi.importActual<typeof import('../../services/factChecker')>('../../services/factChecker')
    const google = await import('../../services/googleAuth'), token = deferred<string | null>()
    const readToken = vi.spyOn(google, 'getValidAccessToken').mockReturnValueOnce(token.promise)
    actual.setFactCheckMode('off')
    vi.mocked(runFactCheckOnLatest).mockImplementationOnce(actual.runFactCheckOnLatest)
    const gather = vi.mocked(gatherRouteInput).getMockImplementation()!
    vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...gather(ctx), selectedModel: 'claude' }))
    const { result, unmount } = setup()
    await act(async () => { await result.current.sendMessage('Donne-moi un lien sur les archives', conv.id) })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    act(() => { call[1]('Voici [la source](https://example.com/unproven).'); call[2]() })
    await waitFor(() => expect(readToken).toHaveBeenCalled())
    expect(conv.messages.at(-1)?.factCheck).toBeUndefined()
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.isConversationBusy(conv.id)).toBe(true)
    await act(async () => { token.resolve(null); await token.promise })
    await waitFor(() => expect(result.current.isConversationBusy(conv.id)).toBe(false))
    unmount()
  })

  it.each(['eu', 'office', 'description', 'negation', 'translation'] as const)('refuse un appel image non annoncé/malveillant : %s', async kind => {
    conv.euOnly = kind === 'eu'
    const prior = vi.mocked(gatherRouteInput).getMockImplementation()!
    vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...prior(ctx), selectedModel: 'claude' }))
    const handler = vi.fn(async () => ({ result: 'should not run' }))
    const { result, unmount } = setup()
    act(() => result.current.setToolHandler(handler))
    const text = kind === 'description' ? 'décris une image' : kind === 'negation' ? 'Ne crée pas d’image' : kind === 'translation' ? 'Traduis : génère une image' : 'génère une image'
    await act(async () => { await result.current.sendMessage(text, conv.id, kind === 'office' ? [officeFixture()] : undefined) })
    const call = kind === 'eu' ? vi.mocked(streamMistralMessage).mock.calls[0] : vi.mocked(streamMessage).mock.calls[0]
    const response = await call[4]!.onToolCall!('generate_image', { prompt: 'logo' })
    expect(response.result).toContain('not authorized'); expect(handler).not.toHaveBeenCalled()
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('transmet la permission au bon tour et la révoque au Stop avant retry', async () => {
    const prior = vi.mocked(gatherRouteInput).getMockImplementation()!
    vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...prior(ctx), selectedModel: 'claude' }))
    const handler = vi.fn(async () => ({ result: 'ok' }))
    const { result, unmount } = setup()
    act(() => result.current.setToolHandler(handler))
    await act(async () => { await result.current.sendMessage('génère une image de chat', conv.id) })
    const onTool = vi.mocked(streamMessage).mock.calls[0][4]!.onToolCall!
    await onTool('generate_image', { prompt: 'cat' })
    const permission = (handler.mock.calls[0] as unknown as [unknown, unknown, import('../../services/tools/types').ToolExecutionContext])[2].imageGeneration!
    expect(permission.signal.aborted).toBe(false); expect(permission.assertCurrent).not.toThrow()
    act(() => result.current.stopStreaming(conv.id))
    expect(permission.signal.aborted).toBe(true); expect(permission.assertCurrent).toThrow()
    await expect(onTool('generate_image', { prompt: 'late' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(handler).toHaveBeenCalledOnce(); unmount()
  })

  it.each(['pdf', 'eu-url'] as const)('%s : ancienne préparation après Stop ne vide ni ne contrôle le nouveau tour', async kind => {
    conv.euOnly = kind === 'eu-url'
    const deferredPdf = deferred<string>(), deferredUrl = deferred<{ block: string; unreadable: string[] }>()
    if (kind === 'pdf') vi.mocked(fetchPdfMarkdowns).mockReturnValueOnce(deferredPdf.promise)
    else vi.mocked(fetchUrlMarkdowns).mockReturnValueOnce(deferredUrl.promise)
    const previousGather = vi.mocked(gatherRouteInput).getMockImplementation()!
    for (let i = 0; i < 2; i++) vi.mocked(gatherRouteInput).mockImplementationOnce(ctx => ({ ...previousGather(ctx), selectedModel: 'claude' }))
    const { result, unmount } = setup()
    let old!: Promise<boolean>
    act(() => { old = result.current.sendMessage(kind === 'pdf' ? 'Lis https://example.com/report.pdf' : 'Lis https://example.com/report', conv.id) })
    await waitFor(() => expect(kind === 'pdf' ? fetchPdfMarkdowns : fetchUrlMarkdowns).toHaveBeenCalled())
    act(() => result.current.stopStreaming(conv.id))
    await act(async () => { await result.current.sendMessage('Nouvelle demande', conv.id) })
    const client = kind === 'pdf' ? vi.mocked(streamMessage) : vi.mocked(streamMistralMessage)
    expect(client).toHaveBeenCalledTimes(1)
    const call = client.mock.calls[0]!
    act(() => call[1]('NOUVELLE REPONSE'))
    await act(async () => {
      if (kind === 'pdf') deferredPdf.resolve('ANCIEN PDF')
      else deferredUrl.resolve({ block: 'ANCIEN LIEN', unreadable: [] })
      await old
    })
    expect(client).toHaveBeenCalledTimes(1)
    act(() => call[2]())
    expect(conv.messages.at(-1)?.content).toBe('NOUVELLE REPONSE')
    unmount()
  })

  it('extrait le vrai texte une seule fois avant sauvegarde, garde seulement les références originales', async () => {
    const { result, unmount } = setup()
    const file = officeFixture()
    await act(async () => { expect(await result.current.sendMessage('Résume', conv.id, [file])).toBe(true) })
    expect(getFile).not.toHaveBeenCalled()
    expect(putFile).toHaveBeenCalledWith(expect.objectContaining({ name: file.name, data: file.data }), 'owner-a')
    expect(conv.messages[0]?.files?.[0]).toMatchObject({ name: 'facture.docx', type: file.type })
    expect(conv.messages[0]?.files?.[0]?.data).toBeUndefined()
    const payload = JSON.stringify(vi.mocked(streamMessage).mock.calls[0]?.[0])
    expect(payload).toContain('Facture 1250 euros')
    expect(payload).toContain('UNTRUSTED DOCUMENT DATA')
    expect(vi.mocked(streamMessage).mock.calls[0]?.[4]).toMatchObject({ documentReadOnly: true, tools: [] })
    expect(JSON.stringify(conv)).not.toContain('Facture 1250')
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('hydrate un suivi sans fichier courant dans le compte capturé et ne lance aucun locator photo', async () => {
    history()
    const { result, unmount } = setup()
    await act(async () => { await result.current.sendMessage('Lis mieux le montant', conv.id) })
    expect(getFile).toHaveBeenCalledExactlyOnceWith('office-file', 'owner-a')
    expect(streamMessage).toHaveBeenCalledTimes(1)
    expect(prepareVisionAutoCrop).not.toHaveBeenCalled()
    expect(findLatestTerraVisionBatch).not.toHaveBeenCalled()
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('garde le verrou EU et envoie le même texte à Mistral sans outils', async () => {
    conv.euOnly = true
    const { result, unmount } = setup()
    await act(async () => { await result.current.sendMessage('Résume', conv.id, [officeFixture()]) })
    expect(streamMessage).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(streamMistralMessage).mock.calls[0]?.[0])).toContain('Facture 1250 euros')
    expect(vi.mocked(streamMistralMessage).mock.calls[0]?.[4]).toMatchObject({ documentReadOnly: true, webSearch: false })
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('refuse un fichier corrompu avant toute écriture et garde le composeur', async () => {
    const { result, unmount } = setup()
    await act(async () => { expect(await result.current.sendMessage('Lis', conv.id, [{ ...officeFixture(), data: 'AAAA' }])).toBe(false) })
    expect(conv.messages).toHaveLength(0)
    expect(putFile).not.toHaveBeenCalled()
    expect(streamMessage).not.toHaveBeenCalled()
    expect(result.current.errorRetryable).toBe(false)
    expect(result.current.isStreaming).toBe(false)
    unmount()
  })

  it('le budget porte sur historique plus nouveau document, sans résultat partiel', async () => {
    history(officeFixture('X'.repeat(110000)))
    const { result, unmount } = setup()
    await act(async () => { expect(await result.current.sendMessage('Compare', conv.id, [officeFixture('Y'.repeat(110000), 'new')])).toBe(false) })
    expect(conv.messages).toHaveLength(2)
    expect(putFile).not.toHaveBeenCalled()
    expect(streamMessage).not.toHaveBeenCalled()
    unmount()
  })

  it('une édition avec original disparu conserve tout le fil', async () => {
    history()
    vi.mocked(getFile).mockResolvedValue(null)
    const { result, unmount } = setup()
    act(() => result.current.editAndResend('u1', 'Nouveau texte'))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(conv.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(streamMessage).not.toHaveBeenCalled()
    unmount()
  })

  it('Stop puis relance même conversation : l’ancien résultat ne détruit pas le nouveau stream', async () => {
    history()
    const read = deferred<FileAttachment | null>()
    vi.mocked(getFile).mockReturnValueOnce(read.promise)
    const { result, unmount } = setup()
    let old!: Promise<boolean>
    act(() => { old = result.current.sendMessage('Ancienne question', conv.id) })
    await waitFor(() => expect(getFile).toHaveBeenCalledTimes(1))
    act(() => result.current.stopStreaming(conv.id))
    await act(async () => { await result.current.sendMessage('Nouvelle question', conv.id) })
    expect(streamMessage).toHaveBeenCalledTimes(1)
    read.resolve(officeFixture())
    await act(async () => { expect(await old).toBe(false) })
    expect(result.current.isStreaming).toBe(true)
    expect(conv.messages.at(-1)?.content).toBe('Nouvelle question')
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('changement de session pendant hydratation : aucun envoi ni sauvegarde', async () => {
    history()
    const read = deferred<FileAttachment | null>()
    vi.mocked(getFile).mockReturnValueOnce(read.promise)
    const { result, unmount } = setup()
    let send!: Promise<boolean>
    act(() => { send = result.current.sendMessage('Résumé', conv.id) })
    await waitFor(() => expect(getFile).toHaveBeenCalled())
    vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    read.resolve(officeFixture())
    await act(async () => { expect(await send).toBe(false) })
    expect(streamMessage).not.toHaveBeenCalled()
    expect(storage.saveConversation).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(false)
    unmount()
  })

  it('Stop pendant écriture nettoie uniquement les nouveaux fichiers du propriétaire capturé', async () => {
    const write = deferred<string>()
    vi.mocked(putFile).mockReturnValueOnce(write.promise)
    const { result, unmount } = setup()
    let send!: Promise<boolean>
    act(() => { send = result.current.sendMessage('Résumé', conv.id, [officeFixture()]) })
    await waitFor(() => expect(putFile).toHaveBeenCalled())
    const newId = vi.mocked(putFile).mock.calls[0]![0].id
    expect(newId).not.toBe('office-file')
    act(() => result.current.stopStreaming(conv.id))
    write.resolve(newId)
    await act(async () => { expect(await send).toBe(false) })
    expect(deleteOwnedFiles).toHaveBeenCalledWith([newId], 'owner-a')
    expect(conv.messages).toHaveLength(0)
    expect(streamMessage).not.toHaveBeenCalled()
    unmount()
  })

  it('inclut à la fois Office historique et les pixels courants sans locator Terra', async () => {
    history()
    const { result, unmount } = setup()
    const photo = { id: 'p1', name: 'photo.png', type: 'image/png', data: 'AQID' }
    await act(async () => { await result.current.sendMessage('Compare', conv.id, [photo]) })
    const payload = JSON.stringify(vi.mocked(streamMessage).mock.calls[0]?.[0])
    expect(payload).toContain('Facture 1250 euros')
    expect(payload).toContain('"type":"image"')
    expect(payload).toContain('AQID')
    expect(prepareVisionAutoCrop).not.toHaveBeenCalled()
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it('Done ne déclenche aucun post-traitement/action et invalide les callbacks tardifs', async () => {
    const { result, unmount } = setup()
    await act(async () => { await result.current.sendMessage('Lis', conv.id, [officeFixture()]) })
    const first = vi.mocked(streamMessage).mock.calls[0]!
    vi.mocked(detectSuggestedTasks).mockReturnValue(['Envoyer le document demain'])
    act(() => { first[1]('Il faut envoyer le document demain.'); first[2]() })
    expect(runFactCheckOnLatest).not.toHaveBeenCalled()
    expect(maybeExtractMemory).not.toHaveBeenCalled()
    expect(addTask).not.toHaveBeenCalled()
    vi.mocked(getFile).mockResolvedValue(officeFixture())
    await act(async () => { await result.current.sendMessage('Et ensuite ?', conv.id) })
    const count = conv.messages.length
    act(() => { first[1]('Ancien token'); first[2](); first[3](new Error('late')) })
    expect(conv.messages).toHaveLength(count)
    expect(result.current.isStreaming).toBe(true)
    act(() => result.current.stopStreaming(conv.id)); unmount()
  })

  it.each(['beforeunload', 'stop'])('epoch après token puis %s : zéro écriture et slot libéré', async (trigger) => {
    const { result, unmount } = setup()
    await act(async () => { await result.current.sendMessage('Lis', conv.id, [officeFixture()]) })
    act(() => vi.mocked(streamMessage).mock.calls[0]![1]('Ancien compte secret'))
    vi.mocked(storage.saveConversation).mockClear()
    vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    act(() => {
      if (trigger === 'stop') result.current.stopStreaming(conv.id)
      else window.dispatchEvent(new Event('beforeunload'))
    })
    expect(storage.saveConversation).not.toHaveBeenCalled()
    expect(JSON.stringify(conv)).not.toContain('Ancien compte secret')
    expect(result.current.isStreaming).toBe(false)
    unmount()
  })
})
