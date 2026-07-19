import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ChatSendHandler, FileAttachment, QuickActionId, QuickActionSelection } from '../../types'
import { generateId } from '../../utils/generateId'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { isNative } from '../../services/native/platform'
import { takePhoto, scanDocument } from '../../services/native/camera'
import {
  ImageNormalizationError,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_NORMALIZED_VISION_BATCH_BYTES,
  normalizeImageAttachmentForVision,
  normalizeImageForVision,
  type NormalizedImageAsset,
} from '../../services/imageNormalization'
import { isVision4kFoundationEnabled } from '../../services/visionFeature'
import { classifyRouteAttachments, gatherRouteInput } from '../../services/router/gatherRouteInput'
import { resolveRoute } from '../../services/router/resolveRoute'
import { filterSlashCommands, type SlashCommand } from '../../constants/slashCommands'
import { detectDates } from '../../utils/dateDetector'
import { getValidAccessToken } from '../../services/googleAuth'
import { callGoogleApi } from '../../services/googleApiHelper'
import { enhancePrompt, canEnhancePrompt } from '../../services/promptEnhancer'
import { isPromptEnhancementEnabled } from '../../services/promptEnhancerSettings'
import { hasUrl } from '../../services/aiRouter'
import { haptic } from '../../utils/haptic'
import { InputContextSlot } from './InputContextSlot'
import { ReflectionPill } from '../chat/ReflectionPill'
import { createQuickActionSelection, QUICK_ACTIONS } from '../../services/quickActions'
import { decrypt, encrypt, isCryptoReady } from '../../services/crypto'
import {
  clearComposerDraft,
  composerDraftStorageKey,
  getComposerDraft,
  hasComposerDraft,
  scopeComposerDraftKey,
  setComposerDraftMemory,
} from '../../services/composerDrafts'

export interface ComposerPrefill {
  id: number
  text: string
}

interface InputBarProps {
  onSend: ChatSendHandler
  isStreaming: boolean
  onStop?: () => void
  // Seed value for the textarea on mount. Used by the share-to-Arty flow
  // to pre-fill a suggested prompt. Only read once — later changes are
  // ignored so the user's edits aren't clobbered.
  initialText?: string
  // Seed value for attachments on mount. Same single-shot semantics as
  // initialText.
  initialFiles?: FileAttachment[]
  // Conversation flag — quand true, on est en mode EU-only (Mistral forcé,
  // données restent en Europe). Mistral n'a pas de tool web_fetch natif et
  // hallucine sur les URLs collées (citations inventées, sources [1][2][3]
  // fictives). On affiche alors un bandeau qui invite l'utilisateur à
  // coller le texte de l'article plutôt que l'URL.
  euOnly?: boolean
  /** Historique contenant des données Google privées : le preview applique la
      même précédence que l'envoi réel et ne promet jamais Terra. */
  hasPrivateHistory?: boolean
  /** Requête explicite de préremplissage (intentions/suggestions de l'accueil).
      L'id permet de rejouer deux fois le même texte sans transformer le champ
      en input contrôlé et sans écraser les modifications libres. */
  prefill?: ComposerPrefill
  /** Sur l'accueil, les suggestions vivent dans le contenu éditorial. */
  showQuickActions?: boolean
  /** Identifiant stable pour restaurer le brouillon lors d'un remount. */
  draftKey?: string
  /** Variante centrale utilisée sur l'accueil simplifié. La mécanique reste
      identique ; seule la hiérarchie visuelle change. */
  variant?: 'default' | 'hero'
}

// Roadmap UI Phase 3 #4 — Quick Actions chips contextuelles. Affichées
// sous l'input quand celui-ci est vide, elles arment le prochain texte au
// lieu d'envoyer seules un prompt incomplet. Elles évoluent selon l'heure et
// restent polyvalentes (résumé, traduction, rédaction, explication).
function getQuickActionChips(t: TFunction): Array<{ id: QuickActionId; label: string; icon: string }> {
  const hour = new Date().getHours()
  // Variant matin : commencer la journée avec un brief / résumé
  // Variant après-midi / soir : actions productives génériques
  const morning = hour < 11
  const ids: QuickActionId[] = morning
    ? ['brief', 'writeEmail', 'summarizeText', 'translateToEn']
    : ['summarize', 'write', 'translate', 'explain']

  return ids.map((id) => ({
    id,
    icon: QUICK_ACTIONS[id].icon,
    label: t(QUICK_ACTIONS[id].labelKey),
  }))
}

// V2 voice-first — tap = webkit speech, hold ≥ 600ms = Whisper recording.
const HOLD_THRESHOLD_MS = 600
const HOLD_MAX_MS = 60_000
const SWIPE_CANCEL_THRESHOLD_PX = 60

// Killswitch PR C (même pattern que arty-chat-sheet-v2, ChatTopBar.tsx) :
// slot contextuel unique + chips scrollables + micro unique actifs par
// défaut ; `arty-inputbar-v2 = '0'` dans localStorage restaure l'ancien
// empilement de bandeaux sans rebuild. Clé GLOBALE hors scopedStorage.
function inputBarV2Enabled(): boolean {
  try {
    return localStorage.getItem('arty-inputbar-v2') !== '0'
  } catch {
    return true
  }
}
// Cap d'attachements par message — l'API Anthropic plafonne (~20 images,
// 5 PDFs) avec une erreur brute ; on borne plus bas côté UI avec un message
// clair (audit UX 10 juin 2026).
const MAX_ATTACHED_FILES = 10
const MAX_VISION_IMAGES = 4
const MAX_VISION_BATCH_BYTES = MAX_NORMALIZED_VISION_BATCH_BYTES

function isImageCandidate(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function normalizedAttachment(id: string, name: string, asset: NormalizedImageAsset): FileAttachment {
  return {
    id,
    name,
    type: asset.mimeType,
    data: asset.data,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    normalizationVersion: asset.normalizationVersion,
  }
}

function imagePreparationError(t: TFunction, error: unknown, name: string): string {
  if (!(error instanceof ImageNormalizationError)) {
    return t('chat.input.imagePreparationFailed', { name })
  }
  const key = {
    source_too_large: 'chat.input.imageSourceTooLarge',
    source_too_many_pixels: 'chat.input.imageTooManyPixels',
    unsupported_format: 'chat.input.imageUnsupported',
    mime_mismatch: 'chat.input.imageUnsupported',
    decode_failed: 'chat.input.imageDecodeFailed',
    encode_failed: 'chat.input.imageEncodeFailed',
    output_too_large: 'chat.input.imageOutputTooLarge',
    corrupt_output: 'chat.input.imageDecodeFailed',
  }[error.code]
  return t(key, { name })
}

function visionBatchError(files: FileAttachment[], next: FileAttachment, t: TFunction): string | null {
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (images.length >= MAX_VISION_IMAGES) return t('chat.input.tooManyImages', { max: MAX_VISION_IMAGES })
  const total = images.reduce((sum, file) => sum + (file.size ?? 0), 0) + (next.size ?? 0)
  if (total > MAX_VISION_BATCH_BYTES) return t('chat.input.imageBatchTooLarge')
  return null
}

function remainingVisionBatchBytes(files: FileAttachment[]): number {
  const used = files
    .filter((file) => file.type.startsWith('image/'))
    .reduce((sum, file) => sum + (file.size ?? 0), 0)
  return Math.max(0, MAX_VISION_BATCH_BYTES - used)
}

function nextImageBudget(files: FileAttachment[], remainingImages = 1): number {
  return Math.min(
    MAX_NORMALIZED_IMAGE_BYTES,
    Math.floor(remainingVisionBatchBytes(files) / Math.max(1, remainingImages)),
  )
}

// Vignette d'aperçu d'un fichier en attente d'envoi. Pour les images, affiche
// la photo réelle via blob URL (le base64 est en RAM, pas encore persisté).
// Sans ça, l'utilisateur voit juste un emoji "🖼️" et a l'impression que la
// photo n'a pas été chargée.
function PendingFilePreview({ file, onRemove, disabled = false }: { file: FileAttachment; onRemove: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')

  useEffect(() => {
    if (!isImage || !file.data) return
    let urlToRevoke: string | null = null
    try {
      const byteString = atob(file.data)
      const arr = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
      const blob = new Blob([arr], { type: file.type })
      urlToRevoke = URL.createObjectURL(blob)
      setPreviewUrl(urlToRevoke)
    } catch {
      // ignore, fallback to icon
    }
    return () => { if (urlToRevoke) URL.revokeObjectURL(urlToRevoke) }
  }, [file.data, file.type, isImage])

  if (isImage && previewUrl) {
    return (
      <div className="relative flex-shrink-0">
        <img
          src={previewUrl}
          alt={file.name}
          className="h-[64px] w-[64px] border border-theme-border object-cover"
          title={file.name}
        />
        <button
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('chat.input.removeFile', { name: file.name })}
          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center border border-theme-border bg-theme-surface text-[10px] leading-none text-theme-muted hover:border-theme-accent hover:text-theme-accent disabled:cursor-wait disabled:opacity-40"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1.5 border border-theme-border bg-theme-surface px-2.5 py-1.5 text-xs text-theme-ink/80">
      <span>{isImage ? '🖼️' : '📄'}</span>
      <span className="max-w-[120px] truncate">{file.name}</span>
      <button
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('chat.input.removeFile', { name: file.name })}
        className="text-theme-muted hover:text-theme-accent ml-1 p-1 leading-none disabled:cursor-wait disabled:opacity-40"
      >
        ✕
      </button>
    </div>
  )
}

export function InputBar({ onSend, isStreaming, onStop, initialText, initialFiles, euOnly, hasPrivateHistory = false, prefill, showQuickActions = true, draftKey, variant = 'default' }: InputBarProps) {
  const { t } = useTranslation()
  const heroVariant = variant === 'hero'
  // Évalué à chaque render (lecture localStorage triviale) — un testeur peut
  // poser le killswitch en DevTools et le voir s'appliquer immédiatement.
  const v2 = inputBarV2Enabled()
  const vision4kFoundation = isVision4kFoundationEnabled()
  const scopedDraftKey = draftKey ? scopeComposerDraftKey(draftKey) : undefined
  const encryptedDraftKey = scopedDraftKey ? composerDraftStorageKey(scopedDraftKey) : undefined
  const previousDraftKeyRef = useRef(scopedDraftKey)
  const draftTouchedRef = useRef(Boolean(initialText))
  const draftWriteVersionRef = useRef(0)
  const [text, setText] = useState(() => initialText ?? (scopedDraftKey ? getComposerDraft(scopedDraftKey) ?? '' : ''))
  const [files, setFiles] = useState<FileAttachment[]>(() => initialFiles ?? [])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false)
  const [isPreparingImages, setIsPreparingImages] = useState(false)
  const [, setRoutePreviewVersion] = useState(0)
  // Un clic sur une action rapide ARME le prochain envoi. L'instruction
  // n'entre jamais dans le textarea ni dans la bulle user : seuls l'ID et la
  // locale allowlistés traversent le flux d'envoi.
  const [pendingQuickAction, setPendingQuickAction] = useState<QuickActionSelection | undefined>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Le sélecteur de modèle est un store externe. Sans cet event, changer
  // Auto/Claude/Mistral/OpenAI laisserait la destination pré-envoi périmée
  // jusqu'à la prochaine frappe.
  useEffect(() => {
    const refresh = () => setRoutePreviewVersion((version) => version + 1)
    window.addEventListener('model-changed', refresh)
    window.addEventListener('arty-trial-remaining-changed', refresh)
    window.addEventListener('arty-plan-status-changed', refresh)
    return () => {
      window.removeEventListener('model-changed', refresh)
      window.removeEventListener('arty-trial-remaining-changed', refresh)
      window.removeEventListener('arty-plan-status-changed', refresh)
    }
  }, [])

  const attachmentRouteFlags = classifyRouteAttachments(files)
  let attachmentRouteProvider: 'terra' | 'mistral' | 'claude' | null = null
  if (attachmentRouteFlags.hasImages) {
    const preview = resolveRoute(gatherRouteInput({
      originalText: text,
      ...attachmentRouteFlags,
      euOnly: !!euOnly,
      hasPrivateHistory,
    }))
    attachmentRouteProvider = preview.usesOpenAIVision
      ? 'terra'
      : preview.provider === 'mistral'
        ? 'mistral'
        : 'claude'
  }

  useEffect(() => {
    if (!prefill) return
    draftTouchedRef.current = true
    setText(prefill.text)
    setPendingQuickAction(undefined)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const end = textareaRef.current?.value.length ?? 0
      textareaRef.current?.setSelectionRange(end, end)
    })
  }, [prefill?.id])

  useEffect(() => {
    if (!draftKey || !scopedDraftKey) return
    setComposerDraftMemory(scopedDraftKey, text)

    const writeVersion = ++draftWriteVersionRef.current
    if (!encryptedDraftKey) return
    if (!text) {
      if (draftTouchedRef.current) localStorage.removeItem(encryptedDraftKey)
      return
    }
    if (!isCryptoReady()) return
    void encrypt(text).then((ciphertext) => {
      if (draftWriteVersionRef.current === writeVersion) {
        localStorage.setItem(encryptedDraftKey, ciphertext)
      }
    }).catch(() => {})
  }, [draftKey, encryptedDraftKey, scopedDraftKey, text])

  useEffect(() => {
    if (!encryptedDraftKey || hasComposerDraft(scopedDraftKey!) || initialText) return
    let active = true
    const restoreEncryptedDraft = () => {
      if (!active || !isCryptoReady()) return
      const ciphertext = localStorage.getItem(encryptedDraftKey)
      if (!ciphertext) return
      void decrypt(ciphertext).then((restored) => {
        if (!active || !restored) return
        setComposerDraftMemory(scopedDraftKey!, restored)
        setText((current) => current || restored)
      }).catch(() => {})
    }
    restoreEncryptedDraft()
    window.addEventListener('conversations-storage-ready', restoreEncryptedDraft)
    return () => {
      active = false
      window.removeEventListener('conversations-storage-ready', restoreEncryptedDraft)
    }
  }, [encryptedDraftKey, initialText, scopedDraftKey])

  useEffect(() => {
    if (previousDraftKeyRef.current === scopedDraftKey) return
    previousDraftKeyRef.current = scopedDraftKey
    draftTouchedRef.current = Boolean(initialText)
    draftWriteVersionRef.current += 1
    setText(initialText ?? (scopedDraftKey ? getComposerDraft(scopedDraftKey) ?? '' : ''))
    const nextInitialFiles = initialFiles ?? []
    filesRef.current = nextInitialFiles
    setFiles(nextInitialFiles)
    setPendingQuickAction(undefined)
  }, [initialFiles, initialText, scopedDraftKey])

  // Attach menu popup (replaces separate camera/scan/web-camera buttons).
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  // Slash command palette state
  const [showSlashPalette, setShowSlashPalette] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const filteredCommands = filterSlashCommands(text)

  // Calendar event suggestion (Feature 16)
  const [calendarSuggestion, setCalendarSuggestion] = useState<{ text: string; date: Date } | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [showCalendarForm, setShowCalendarForm] = useState(false)

  // Audio recording state — Whisper branch (long press).
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [isSwipeCancelling, setIsSwipeCancelling] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  // Feedback fichiers refusés (>10 MB / trop nombreux) — auto-effacé après 6 s.
  const [fileError, setFileError] = useState<string | null>(null)
  useEffect(() => {
    if (!fileError) return
    const id = setTimeout(() => setFileError(null), 6000)
    return () => clearTimeout(id)
  }, [fileError])
  // 0..1 during the 0–600ms hold window. Drives the progress ring SVG.
  const [holdProgress, setHoldProgress] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelRecordingRef = useRef(false)
  const wantRecordingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const pointerStartXRef = useRef(0)
  const pressStartRef = useRef(0)
  // Flip to true when the 600ms threshold is crossed — the visual switches to
  // "whisper" and the release path routes through transcription instead of
  // toggling webkit speech.
  const crossedThresholdRef = useRef(false)
  // Webkit listening state at pointerDown — so a short tap can intelligently
  // toggle (start if was off, stop if was on).
  const wasListeningAtDownRef = useRef(false)

  // Synced refs — MediaRecorder.onstop is async and captures closure values at
  // recorder creation. Reading these via refs lets the callback see the latest
  // draft/attachments at the moment the user releases the mic.
  const textRef = useRef('')
  const filesRef = useRef<FileAttachment[]>(initialFiles ?? [])
  // Mutex synchrone : React peut batcher setIsPreparingImages. Sans ce ref,
  // deux sélections déclenchées avant le render suivant normalisent en
  // parallèle puis la dernière fin écrase le résultat de l'autre.
  const imagePreparationLockRef = useRef(false)

  const acquireImagePreparationLock = (showProgress = true): boolean => {
    if (imagePreparationLockRef.current) return false
    imagePreparationLockRef.current = true
    setIsPreparingAttachments(true)
    if (showProgress) setIsPreparingImages(true)
    return true
  }

  const releaseImagePreparationLock = () => {
    imagePreparationLockRef.current = false
    setIsPreparingAttachments(false)
    setIsPreparingImages(false)
  }

  const {
    isListening,
    interimTranscript,
    error: micError,
    isSupported: isMicSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition()

  // Check Google connection — re-evaluates on 'google-storage-ready' because
  // the first mount can fire before bootstrapGoogleStorage has decrypted tokens
  // on native (crypto is async). Without this the Whisper gate stays false
  // even after login finishes.
  useEffect(() => {
    let active = true
    const check = () => {
      getValidAccessToken().then((t) => { if (active) setGoogleConnected(!!t) }).catch(() => {})
    }
    check()
    window.addEventListener('google-storage-ready', check)
    return () => {
      active = false
      window.removeEventListener('google-storage-ready', check)
    }
  }, [])

  // Keep refs in sync with state for use inside MediaRecorder.onstop closure.
  useEffect(() => { textRef.current = text }, [text])
  useEffect(() => { filesRef.current = files }, [files])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [text])

  // Show slash palette when input starts with "/"
  useEffect(() => {
    if (text.startsWith('/') && !text.includes(' ') && !text.includes('\n')) {
      setShowSlashPalette(true)
      setSlashSelectedIndex(0)
    } else {
      setShowSlashPalette(false)
    }
  }, [text])

  // Detect dates in input for calendar suggestion pill
  useEffect(() => {
    if (!googleConnected || !text.trim()) {
      setCalendarSuggestion(null)
      return
    }
    const found = detectDates(text)
    if (found) {
      setCalendarSuggestion({ text: found.match, date: found.date })
    } else {
      setCalendarSuggestion(null)
    }
  }, [text, googleConnected])

  // Callback for speech recognition
  const handleTranscript = useCallback((spokenText: string) => {
    draftTouchedRef.current = true
    setText((prev) => {
      if (!prev) return spokenText
      return prev + (prev.endsWith(' ') ? '' : ' ') + spokenText
    })
  }, [])

  // Pure send function — takes explicit text/files rather than closing over
  // state, so the async MediaRecorder.onstop callback can call it with fresh
  // refs. Returns true on successful send, false if blocked (empty or streaming).
  const sendText = useCallback((textToSend: string, filesToSend: FileAttachment[]): boolean | Promise<boolean> => {
    const trimmed = textToSend.trim()
    if (
      (!trimmed && filesToSend.length === 0) ||
      isStreaming ||
      isSubmitting ||
      isPreparingAttachments ||
      imagePreparationLockRef.current
    ) return false
    if (isListening) stopListening()
    // Roadmap UI Phase 1 #6 — retour haptique léger sur envoi. Confirme
    // l'action même en bruit de fond / poche / écran non regardé.
    haptic('light').catch(() => {})
    const clearAcceptedDraft = () => {
      draftWriteVersionRef.current += 1
      if (scopedDraftKey) clearComposerDraft(scopedDraftKey)
      draftTouchedRef.current = false
      setText('')
      filesRef.current = []
      setFiles([])
      setPendingQuickAction(undefined)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      return true
    }

    let accepted: ReturnType<ChatSendHandler>
    try {
      accepted = onSend(
      trimmed || t('chat.input.defaultFilePrompt'),
      filesToSend.length > 0 ? filesToSend : undefined,
      pendingQuickAction ? { quickAction: pendingQuickAction } : undefined,
      )
    } catch {
      return false
    }
    if (accepted && typeof (accepted as Promise<void | boolean>).then === 'function') {
      setIsSubmitting(true)
      return (accepted as Promise<void | boolean>)
        .then((result) => (result === false ? false : clearAcceptedDraft()))
        .catch(() => false)
        .finally(() => setIsSubmitting(false))
    }
    if (accepted === false) return false
    return clearAcceptedDraft()
  }, [encryptedDraftKey, isStreaming, isSubmitting, isPreparingAttachments, isListening, stopListening, onSend, t, pendingQuickAction, scopedDraftKey])

  const handleSend = () => { sendText(text, files) }

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    draftTouchedRef.current = true
    setText(cmd.prompt)
    // Une commande slash explicite remplace le mode rapide précédemment
    // armé, sinon deux intentions invisibles se cumuleraient.
    setPendingQuickAction(undefined)
    setShowSlashPalette(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleQuickActionClick = useCallback((id: QuickActionId) => {
    // Second clic = annulation ; clic sur une autre action = remplacement.
    setPendingQuickAction((current) =>
      current?.id === id ? undefined : createQuickActionSelection(id)
    )
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashPalette && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlashPalette(false)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const cmd = filteredCommands[slashSelectedIndex]
        if (cmd) applySlashCommand(cmd)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Bug remonté en live : sur mobile, le bouton retour-ligne du clavier
      // soft envoyait le message au lieu de faire un saut de ligne (le
      // clavier n'a pas de touche Shift accessible facilement). Maintenant :
      // sur mobile (natif Capacitor OU media query pointer:coarse = écran
      // tactile), Enter laisse passer le retour ligne naturel. Sur desktop,
      // comportement chat standard (Enter envoie, Shift+Enter saute ligne).
      const isMobile =
        isNative ||
        (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
      if (isMobile) return
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (!selectedFiles) return

    const containsVisionImage = vision4kFoundation && Array.from(selectedFiles).some(isImageCandidate)
    const ownsPreparationLock = vision4kFoundation
      ? acquireImagePreparationLock(containsVisionImage)
      : false
    if (vision4kFoundation && !ownsPreparationLock) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setFileError(null)
    const next = [...filesRef.current]
    const errors: string[] = []
    const legacyRejectedNames: string[] = []
    const existingImages = next.filter((file) => file.type.startsWith('image/')).length
    let remainingVisionCandidates = vision4kFoundation
      ? Math.min(
          Math.max(0, MAX_VISION_IMAGES - existingImages),
          Array.from(selectedFiles).filter(isImageCandidate).length,
        )
      : 0
    try {
      // Séquentiel volontairement : quatre décodages 48 MP en parallèle font
      // exploser le pic RAM d'une WebView mobile.
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles.item(i)
        if (!file) continue
        if (next.length >= MAX_ATTACHED_FILES) {
          errors.push(t('chat.input.tooManyFiles', { max: MAX_ATTACHED_FILES }))
          break
        }

        const imageCandidate = isImageCandidate(file)
        const outputBudget = vision4kFoundation && imageCandidate && remainingVisionCandidates > 0
          ? nextImageBudget(next, remainingVisionCandidates)
          : MAX_NORMALIZED_IMAGE_BYTES
        if (vision4kFoundation && imageCandidate && remainingVisionCandidates > 0) {
          remainingVisionCandidates -= 1
        }
        const sourceLimit = vision4kFoundation && imageCandidate
          ? MAX_IMAGE_SOURCE_BYTES
          : 10 * 1024 * 1024
        if (file.size > sourceLimit) {
          if (vision4kFoundation && imageCandidate) {
            errors.push(t('chat.input.imageSourceTooLarge', { name: file.name }))
          } else {
            legacyRejectedNames.push(file.name)
          }
          continue
        }

        try {
          let attachment: FileAttachment
          if (vision4kFoundation && imageCandidate) {
            if (next.filter((item) => item.type.startsWith('image/')).length >= MAX_VISION_IMAGES) {
              errors.push(t('chat.input.tooManyImages', { max: MAX_VISION_IMAGES }))
              continue
            }
            if (outputBudget <= 0) {
              errors.push(t('chat.input.imageBatchTooLarge'))
              continue
            }
            const asset = await normalizeImageForVision(file, file.type, {
              maxOutputBytes: outputBudget,
            })
            attachment = normalizedAttachment(generateId(), file.name, asset)
            const limitError = visionBatchError(next, attachment, t)
            if (limitError) {
              errors.push(limitError)
              continue
            }
          } else {
            attachment = {
              id: generateId(),
              name: file.name,
              type: file.type || 'application/octet-stream',
              data: await readBlobAsBase64(file),
              size: file.size,
            }
          }
          next.push(attachment)
        } catch (error) {
          errors.push(
            vision4kFoundation && imageCandidate
              ? imagePreparationError(t, error, file.name)
              : t('chat.input.fileReadFailed', { name: file.name }),
          )
        }
      }

      if (legacyRejectedNames.length > 0) {
        errors.push(t('chat.input.fileTooLarge', { names: legacyRejectedNames.join(', ') }))
      }
      filesRef.current = next
      setFiles(next)
      if (errors.length > 0) setFileError([...new Set(errors)].join(' '))
    } finally {
      if (ownsPreparationLock) releaseImagePreparationLock()
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeFile = (index: number) => {
    if (imagePreparationLockRef.current) return
    const next = filesRef.current.filter((_, i) => i !== index)
    filesRef.current = next
    setFiles(next)
  }

  const handleCamera = async () => {
    if (vision4kFoundation && filesRef.current.length >= MAX_ATTACHED_FILES) {
      setFileError(t('chat.input.tooManyFiles', { max: MAX_ATTACHED_FILES }))
      return
    }
    if (
      vision4kFoundation &&
      filesRef.current.filter((file) => file.type.startsWith('image/')).length >= MAX_VISION_IMAGES
    ) {
      setFileError(t('chat.input.tooManyImages', { max: MAX_VISION_IMAGES }))
      return
    }
    if (vision4kFoundation && nextImageBudget(filesRef.current) <= 0) {
      setFileError(t('chat.input.imageBatchTooLarge'))
      return
    }
    const ownsPreparationLock = vision4kFoundation
      ? acquireImagePreparationLock()
      : false
    if (vision4kFoundation && !ownsPreparationLock) return
    setFileError(null)
    try {
      const photo = await takePhoto(
        vision4kFoundation ? { maxDimension: MAX_IMAGE_DIMENSION } : undefined,
      )
      if (!photo) return
      let attachment: FileAttachment = {
        id: generateId(),
        name: `photo_${Date.now()}.${photo.mimeType.split('/')[1] || 'jpeg'}`,
        type: photo.mimeType,
        data: photo.base64,
      }
      if (vision4kFoundation) {
        attachment = await normalizeImageAttachmentForVision(attachment, {
          maxOutputBytes: nextImageBudget(filesRef.current),
        })
      }
      const limitError = vision4kFoundation
        ? visionBatchError(filesRef.current, attachment, t)
        : null
      if (limitError) {
        setFileError(limitError)
        return
      }
      const next = [...filesRef.current, attachment]
      filesRef.current = next
      setFiles(next)
    } catch (error) {
      setFileError(imagePreparationError(t, error, t('chat.input.photoFallbackName')))
    } finally {
      if (ownsPreparationLock) releaseImagePreparationLock()
    }
  }

  const handleScan = async () => {
    if (vision4kFoundation && filesRef.current.length >= MAX_ATTACHED_FILES) {
      setFileError(t('chat.input.tooManyFiles', { max: MAX_ATTACHED_FILES }))
      return
    }
    if (
      vision4kFoundation &&
      filesRef.current.filter((file) => file.type.startsWith('image/')).length >= MAX_VISION_IMAGES
    ) {
      setFileError(t('chat.input.tooManyImages', { max: MAX_VISION_IMAGES }))
      return
    }
    if (vision4kFoundation && nextImageBudget(filesRef.current) <= 0) {
      setFileError(t('chat.input.imageBatchTooLarge'))
      return
    }
    const ownsPreparationLock = vision4kFoundation
      ? acquireImagePreparationLock()
      : false
    if (vision4kFoundation && !ownsPreparationLock) return
    try {
      const doc = await scanDocument()
      if (!doc) return
      let attachment: FileAttachment = {
        id: generateId(),
        name: `scan_${Date.now()}.${doc.mimeType.split('/')[1] || 'jpeg'}`,
        type: doc.mimeType,
        data: doc.base64,
      }
      if (vision4kFoundation) {
        attachment = await normalizeImageAttachmentForVision(attachment, {
          maxOutputBytes: nextImageBudget(filesRef.current),
        })
        const limitError = visionBatchError(filesRef.current, attachment, t)
        if (limitError) {
          setFileError(limitError)
          return
        }
      }
      const next = [...filesRef.current, attachment]
      filesRef.current = next
      setFiles(next)
      // Ajouter le prompt OCR seulement après acceptation du scan : aucun
      // texte orphelin si la normalisation ou la borne du lot le refuse.
      draftTouchedRef.current = true
      setText((prev) => {
        if (prev.trim().length > 0) return prev
        return t('chat.input.scanPrompt', {
          defaultValue: "Extrais les informations clés de ce document : montants, dates, expéditeur, destinataire, sujet, et tout point notable.",
        })
      })
    } catch (error) {
      setFileError(imagePreparationError(t, error, t('chat.input.photoFallbackName')))
    } finally {
      if (ownsPreparationLock) releaseImagePreparationLock()
    }
  }

  // Feature 14 — Web camera (mobile) via <input type="file" capture>
  const handleWebCamera = () => {
    cameraInputRef.current?.click()
  }

  const handleWebCameraChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (vision4kFoundation && filesRef.current.length >= MAX_ATTACHED_FILES) {
      setFileError(t('chat.input.tooManyFiles', { max: MAX_ATTACHED_FILES }))
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      return
    }
    if (
      vision4kFoundation &&
      filesRef.current.filter((file) => file.type.startsWith('image/')).length >= MAX_VISION_IMAGES
    ) {
      setFileError(t('chat.input.tooManyImages', { max: MAX_VISION_IMAGES }))
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      return
    }
    if (vision4kFoundation && nextImageBudget(filesRef.current) <= 0) {
      setFileError(t('chat.input.imageBatchTooLarge'))
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      return
    }
    const ownsPreparationLock = vision4kFoundation
      ? acquireImagePreparationLock()
      : false
    if (vision4kFoundation && !ownsPreparationLock) {
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      return
    }
    setFileError(null)
    try {
      if (vision4kFoundation && f.size > MAX_IMAGE_SOURCE_BYTES) {
        setFileError(t('chat.input.imageSourceTooLarge', { name: f.name }))
        return
      }
      let attachment: FileAttachment
      if (vision4kFoundation) {
        const asset = await normalizeImageForVision(f, f.type, {
          maxOutputBytes: nextImageBudget(filesRef.current),
        })
        attachment = normalizedAttachment(generateId(), f.name || `photo_${Date.now()}.jpg`, asset)
        const limitError = visionBatchError(filesRef.current, attachment, t)
        if (limitError) {
          setFileError(limitError)
          return
        }
      } else {
        attachment = {
          id: generateId(),
          name: f.name || `photo_${Date.now()}.jpg`,
          type: f.type || 'image/jpeg',
          data: await readBlobAsBase64(f),
          size: f.size,
        }
      }
      const next = [...filesRef.current, attachment]
      filesRef.current = next
      setFiles(next)
    } catch (error) {
      setFileError(imagePreparationError(t, error, f.name))
    } finally {
      if (ownsPreparationLock) releaseImagePreparationLock()
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  // V2 voice button — tap = webkit speech toggle, hold ≥ 600ms = Whisper.
  // Flow:
  //   pointerDown: start 16ms interval tracking 0→1 hold progress,
  //                start MediaRecorder silently (captures audio from t=0 so
  //                nothing is lost when the hold crosses the threshold).
  //   progress === 1 (at 600ms): crossedThresholdRef = true, visual flips to
  //                "whisper" state, MediaRecorder keeps capturing.
  //   pointerMove (dx < -60px AND crossed): isSwipeCancelling = true.
  //   pointerUp:
  //     if swipe-cancelled → discard audio, no webkit toggle.
  //     if held < 600ms    → discard audio, toggle webkit listening.
  //     if held ≥ 600ms    → stop MediaRecorder → transcribe → auto-send.
  //   pointerCancel / unmount: discard everything.
  // Safety: max 60s auto-stop, stream torn down on every exit path.

  const pickAudioMimeType = (): string => {
    if (typeof MediaRecorder === 'undefined') return ''
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg;codecs=opus',
    ]
    for (const mt of candidates) {
      if (MediaRecorder.isTypeSupported(mt)) return mt
    }
    return ''
  }

  const clearRecordingTimers = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
  }, [])

  const clearHoldInterval = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
  }, [])

  const hardResetRecording = useCallback(() => {
    clearRecordingTimers()
    clearHoldInterval()
    const rec = mediaRecorderRef.current
    mediaRecorderRef.current = null
    // Signal onstop to discard — must be set BEFORE rec.stop() triggers the
    // async onstop callback. onstop consumes and resets the flag itself.
    cancelRecordingRef.current = true
    if (rec && rec.state !== 'inactive') {
      try { rec.stop() } catch {}
    }
    audioChunksRef.current = []
    wantRecordingRef.current = false
    pointerIdRef.current = null
    crossedThresholdRef.current = false
    setIsRecordingAudio(false)
    setIsSwipeCancelling(false)
    setHoldProgress(0)
  }, [clearRecordingTimers, clearHoldInterval])

  const startAudioRecording = useCallback(async () => {
    if (isRecordingAudio || mediaRecorderRef.current) return
    setAudioError(null)
    wantRecordingRef.current = true

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      wantRecordingRef.current = false
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }

    // Pause Web Speech API if it was listening — two getUserMedia consumers on
    // the same mic confuse Android SpeechRecognizer and iOS AVAudioSession.
    if (isListening) {
      try { stopListening() } catch {}
    }

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          noiseSuppression: true,
          echoCancellation: true,
        },
      })
    } catch (err) {
      // If the user already released (stopAudioRecording cleared the flag),
      // don't clobber any tooShort / swipe-cancel message they already see.
      if (!wantRecordingRef.current) return
      wantRecordingRef.current = false
      const name = (err as { name?: string } | null)?.name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' ||
          name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        // CRIT-10 (audit étape 8) — BUG 44 partiel : sur Capacitor natif il
        // n'y a pas de "paramètres du navigateur" visibles. Le message
        // doit pointer vers Paramètres Android → Apps → Arty → Autorisations.
        setAudioError(isNative ? t('chat.input.voice.micDeniedNative') : t('chat.input.voice.micDenied'))
      } else {
        setAudioError(t('chat.input.voice.unsupported'))
      }
      return
    }

    // Guard: pointerUp may have fired before getUserMedia resolved.
    if (!wantRecordingRef.current) {
      stream.getTracks().forEach((tr) => tr.stop())
      return
    }

    const mimeType = pickAudioMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch (err) {
      // Constructor throws on unsupported mime — release the stream NOW or the
      // mic stays hot (the classic leak the previous audit flagged).
      console.warn('MediaRecorder constructor failed:', err)
      stream.getTracks().forEach((tr) => tr.stop())
      wantRecordingRef.current = false
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }

    audioChunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    recorder.onerror = (e) => {
      console.warn('MediaRecorder error:', e)
      stream?.getTracks().forEach((tr) => tr.stop())
      hardResetRecording()
      setAudioError(t('chat.input.voice.unsupported'))
    }
    recorder.onstop = async () => {
      stream?.getTracks().forEach((tr) => tr.stop())
      clearRecordingTimers()
      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      const wasCancelled = cancelRecordingRef.current
      cancelRecordingRef.current = false
      mediaRecorderRef.current = null
      setIsRecordingAudio(false)
      setIsSwipeCancelling(false)
      if (wasCancelled || chunks.length === 0) return

      const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || 'audio/webm' })
      // Too small = near-empty chunk (<300ms of opus ≈ 0.5KB) → skip to avoid
      // wasting a Whisper request on silence.
      if (blob.size < 1024) return

      setIsTranscribing(true)
      try {
        const { transcribeAudio } = await import('../../services/whisperClient')
        // Conversation EU : dictée via Voxtral (Mistral, France), jamais OpenAI US.
        const transcription = await transcribeAudio(blob, { euOnly })
        if (!transcription) return

        // V2 — Whisper always auto-sends (WhatsApp-style). If streaming blocks
        // sendText we fall back to the textarea so the transcription isn't lost.
        const draft = textRef.current.trim()
        const combined = draft ? draft + ' ' + transcription : transcription
        const sent = await sendText(combined, filesRef.current)
        if (!sent) {
          draftTouchedRef.current = true
          setText((prev) => (prev ? prev + ' ' : '') + transcription)
        }
      } catch (err) {
        console.warn('Whisper transcription failed:', err)
        // Surface the real error from OpenAI / proxy (insufficient_quota,
        // model not found, email not whitelisted…) instead of the generic
        // "transcription échouée" so the user can act on it.
        const detail = err instanceof Error && err.message ? err.message : ''
        setAudioError(detail || t('chat.input.voice.transcribeFailed'))
      } finally {
        setIsTranscribing(false)
      }
    }

    mediaRecorderRef.current = recorder
    try {
      recorder.start()
    } catch (err) {
      console.warn('MediaRecorder start failed:', err)
      stream.getTracks().forEach((tr) => tr.stop())
      hardResetRecording()
      setAudioError(t('chat.input.voice.unsupported'))
      return
    }
    setIsRecordingAudio(true)
    setRecordingDuration(0)
    recordTimerRef.current = setInterval(() => {
      setRecordingDuration((d) => d + 1)
    }, 1000)
    // Safety cap — auto-stop after HOLD_MAX_MS even if pointer is stuck.
    maxDurationTimerRef.current = setTimeout(() => {
      const r = mediaRecorderRef.current
      if (r && r.state === 'recording') {
        try { r.stop() } catch {}
      }
    }, HOLD_MAX_MS)
  }, [isRecordingAudio, isListening, stopListening, t, clearRecordingTimers, hardResetRecording, sendText, euOnly])

  const stopAudioRecording = useCallback((cancel = false) => {
    wantRecordingRef.current = false
    const rec = mediaRecorderRef.current
    if (rec && rec.state === 'recording') {
      cancelRecordingRef.current = cancel
      try { rec.stop() } catch {}
    } else {
      // Nothing to stop (e.g., getUserMedia still pending, or already stopped).
      // Keep cancel flag set so the pending start aborts via wantRecordingRef.
      clearRecordingTimers()
      if (!rec) {
        setIsRecordingAudio(false)
        setIsSwipeCancelling(false)
      }
    }
  }, [clearRecordingTimers])

  // V2 pointer handlers — tap toggles webkit speech, hold ≥ 600ms records Whisper.
  const handleVoicePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Prevent the browser's long-press context menu and stop focus stealing.
    e.preventDefault()
    pointerIdRef.current = e.pointerId
    pointerStartXRef.current = e.clientX
    pressStartRef.current = Date.now()
    crossedThresholdRef.current = false
    wasListeningAtDownRef.current = isListening
    setIsSwipeCancelling(false)
    setAudioError(null)
    setHoldProgress(0)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}

    // Start MediaRecorder silently if Whisper is available — audio from t=0 is
    // preserved so the full utterance is captured once threshold is crossed.
    if (canUseWhisperRef.current) {
      void startAudioRecording()
    }

    // Drive the progress ring (0→1 over 600ms) + flip to "whisper" at t=threshold.
    const t0 = pressStartRef.current
    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - t0
      const p = Math.min(elapsed / HOLD_THRESHOLD_MS, 1)
      setHoldProgress(p)
      if (p >= 1 && !crossedThresholdRef.current) {
        crossedThresholdRef.current = true
        clearHoldInterval()
      }
    }, 16)
  }, [isListening, startAudioRecording, clearHoldInterval])

  const handleVoicePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    // Swipe-cancel only applies once the threshold is crossed (whisper mode).
    if (!crossedThresholdRef.current) return
    const dx = e.clientX - pointerStartXRef.current
    const cancelling = dx < -SWIPE_CANCEL_THRESHOLD_PX
    setIsSwipeCancelling((prev) => (prev === cancelling ? prev : cancelling))
  }, [])

  const handleVoicePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const heldMs = Date.now() - pressStartRef.current
    const cancelSwipe = isSwipeCancelling
    const crossed = crossedThresholdRef.current
    const wasListening = wasListeningAtDownRef.current
    pointerIdRef.current = null
    crossedThresholdRef.current = false
    clearHoldInterval()
    setHoldProgress(0)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}

    if (cancelSwipe) {
      // User slid left to abort the Whisper recording.
      stopAudioRecording(true)
      return
    }

    if (crossed && heldMs >= HOLD_THRESHOLD_MS) {
      // Long-press release → send Whisper transcription.
      stopAudioRecording(false)
      return
    }

    // Short tap (< 600ms threshold). Deux cas :
    //
    // A) On était DÉJÀ en train d'enregistrer en mode continu (tap-pour-stop)
    //    → arrête et envoie via Whisper. Marche sur toutes plateformes.
    //
    // B) On démarre un nouvel enregistrement. Sur natif (Android/iOS) on
    //    utilise Whisper en mode continu — la dictée Android native fait
    //    des bips à chaque session de 8s et perd des mots (BUG 46). Sur web
    //    desktop, Web Speech (Chrome/Firefox) marche bien sans bip → on
    //    garde le comportement legacy toggle.
    if (isRecordingAudio) {
      // L'audio buffer dépasse les 600ms (sinon on serait passé par
      // crossed=true ci-dessus). On envoie via Whisper.
      stopAudioRecording(false)
      return
    }

    stopAudioRecording(true)
    if (isNative) {
      // Démarrage Whisper continu (silencieux, fiable). Re-tap pour stop.
      void startAudioRecording()
      return
    }

    // Web desktop — Web Speech API legacy (Chrome/Firefox sans bip).
    if (!isMicSupported) return
    if (wasListening) {
      try { stopListening() } catch {}
    } else {
      try { startListening(handleTranscript) } catch {}
    }
  }, [isSwipeCancelling, isRecordingAudio, stopAudioRecording, startAudioRecording, clearHoldInterval, isMicSupported, startListening, stopListening, handleTranscript])

  const handleVoicePointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    crossedThresholdRef.current = false
    clearHoldInterval()
    setHoldProgress(0)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    stopAudioRecording(true)
  }, [stopAudioRecording, clearHoldInterval])

  // Safety: tear down the recorder + stream if the component unmounts while
  // recording. Without this the mic stays hot after navigating away.
  // hardResetRecording handles the cancel flag + flags + state itself.
  useEffect(() => {
    return () => { hardResetRecording() }
  }, [])

  // Feature 16 — Create calendar event from detected date
  const handleCreateCalendarEvent = useCallback(async (title: string, date: Date) => {
    try {
      const startISO = date.toISOString().slice(0, 19)
      const endISO = new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 19)
      await callGoogleApi('/api/calendar/action', {
        type: 'create',
        title,
        start: startISO,
        end: endISO,
      })
      setCalendarSuggestion(null)
      setShowCalendarForm(false)
    } catch (err) {
      console.warn('Create event failed:', err)
    }
  }, [])

  // Mobile detection for camera button (Feature 14)
  const hasCameraSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const showWebCamera = !isNative && hasCameraSupport && isMobile

  // Has OpenAI key (Feature 15) — BYOK OR server proxy available (gated by
  // ALLOWED_EMAILS côté serveur). Pour les testeurs sans clé, `googleConnected`
  // suffit à révéler le bouton : le serveur rejette les non-whitelistés.
  const [hasOpenAI, setHasOpenAI] = useState(false)
  useEffect(() => {
    import('../../services/activeApiKey').then((m) => {
      setHasOpenAI(m.hasOpenAIKey())
    })
  }, [])
  const canUseWhisper = hasOpenAI || googleConnected
  // Ref'd for handleVoicePointerDown — avoids re-creating the callback whenever
  // the gate flips (e.g. when Google storage finally decrypts after mount).
  const canUseWhisperRef = useRef(canUseWhisper)
  useEffect(() => { canUseWhisperRef.current = canUseWhisper }, [canUseWhisper])

  // Prompt enhancement (1.0.14) — ✨ button reformulates the prompt via Haiku/Mistral
  const [enhanceEnabled, setEnhanceEnabled] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  useEffect(() => {
    setEnhanceEnabled(isPromptEnhancementEnabled() && canEnhancePrompt())
  }, [])

  const handleEnhance = async () => {
    const current = text.trim()
    if (!current || isEnhancing) return
    setIsEnhancing(true)
    setEnhanceError(null)
    try {
      const enhanced = await enhancePrompt(current, { euOnly })
      draftTouchedRef.current = true
      setText(enhanced)
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : t('errors.promptEnhancementFailed'))
    } finally {
      setIsEnhancing(false)
    }
  }

  return (
    <div
      className={heroVariant
        ? 'relative bg-transparent p-0'
        : 'relative border-t border-theme-ink bg-theme-bg px-[34px] pb-4 pt-3 max-[899px]:px-[14px] max-[899px]:pb-[14px] max-[899px]:pt-[10px]'}
      style={heroVariant ? undefined : { paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}
    >
      <div className={`relative mx-auto w-full ${heroVariant ? 'max-w-[760px]' : 'max-w-[1060px]'}`}>
      {/* Slash command palette (Feature 2) */}
      {showSlashPalette && filteredCommands.length > 0 && (
        <div className={`absolute bottom-full left-4 right-4 z-20 mb-2 overflow-hidden border bg-theme-surface animate-fade-in ${heroVariant ? 'rounded-[18px] border-theme-ink/10 shadow-[0_12px_32px_rgb(var(--theme-ink)/0.10)]' : 'border-theme-border'}`}>
          <div className="text-[10px] uppercase tracking-kicker font-semibold text-theme-muted px-3 py-2 border-b border-theme-border bg-theme-bg">
            {t('chat.input.slashPaletteHeader')}
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.cmd}
                onClick={() => applySlashCommand(cmd)}
                onMouseEnter={() => setSlashSelectedIndex(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === slashSelectedIndex ? 'bg-theme-accent/10' : 'hover:bg-theme-ink/5'
                }`}
              >
                <span className="text-base">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-theme-ink font-semibold">{cmd.cmd}</p>
                  <p className="text-xs text-theme-muted truncate">{cmd.label}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ===== Rendu hérité (killswitch arty-inputbar-v2 = '0') — bandeaux
          empilables conservés tels quels pour rollback sans rebuild. En v2,
          ces blocs sont remplacés par <InputContextSlot> plus bas. ===== */}
      {/* Prompt enhancement error (1.0.14) */}
      {!v2 && enhanceError && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-700 dark:text-red-400">
          <span>⚠️</span>
          <span className="flex-1 truncate">{enhanceError}</span>
          <button
            onClick={() => setEnhanceError(null)}
            className="text-red-700 dark:text-red-400 hover:opacity-70 transition-opacity"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick Actions chips — affichées sous l'input quand celui-ci est
          vide ET pas de fichier attaché ET pas en train de streamer/écouter.
          Un tap sélectionne le mode du prochain message, sans envoi immédiat.
          Le set évolue selon l'heure (matin = brief, soir = résumé). */}
      {!v2 && showQuickActions && !text.trim() && files.length === 0 && !isStreaming && !isListening && !isRecordingAudio && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {getQuickActionChips(t).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => handleQuickActionClick(chip.id)}
              aria-pressed={pendingQuickAction?.id === chip.id}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                pendingQuickAction?.id === chip.id
                  ? 'bg-theme-accent text-theme-bg border-theme-accent'
                  : 'bg-theme-surface border-theme-border text-theme-ink hover:border-theme-accent hover:text-theme-accent'
              }`}
              aria-label={t('chat.input.chipSuggestion', { label: chip.label })}
            >
              {chip.icon} {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Calendar event suggestion pill (Feature 16) */}
      {!v2 && calendarSuggestion && !showCalendarForm && (
        <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-theme-accent/10 border border-theme-accent/20 rounded-xl text-xs text-theme-ink">
          <span>📅</span>
          <span className="flex-1 truncate">
            {t('calendar.suggestionPillPrefix')}<span className="font-semibold">{calendarSuggestion.text}</span>
          </span>
          <button
            onClick={() => setShowCalendarForm(true)}
            className="px-2 py-0.5 rounded-md bg-theme-accent text-theme-bg text-[10px] font-semibold hover:opacity-90"
          >
            {t('calendar.create')}
          </button>
          <button
            onClick={() => setCalendarSuggestion(null)}
            className="text-theme-muted hover:text-theme-ink"
            aria-label={t('calendar.dismissSuggestion')}
          >
            ✕
          </button>
        </div>
      )}

      {showCalendarForm && calendarSuggestion && (
        <CalendarMiniForm
          detected={calendarSuggestion}
          context={text}
          onConfirm={handleCreateCalendarEvent}
          onCancel={() => setShowCalendarForm(false)}
        />
      )}

      {/* URL hint banner — Mistral ne peut pas lire les URLs (pas de tool
          web_fetch natif). Affiché en mode EU-only quand une URL est
          détectée dans la draft. Les conversations non-EU sont auto-routées
          vers Claude (web_fetch) dans aiRouter.detectProvider(). */}
      {euOnly && hasUrl(text) && (
        <div className="mb-2 flex items-start gap-2 border border-theme-accent/20 bg-theme-accent/10 px-3 py-2 text-xs text-theme-ink">
          <span className="mt-0.5">💡</span>
          <span className="flex-1">{t('chat.input.euOnlyUrlHint')}</span>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {files.map((file, i) => (
            // MED (audit étape 8) — key stable basée sur (name + size + index).
            // Avant : key={i} sur une liste mutable (removeFile). Si l'user
            // supprime un fichier au milieu, React recycle le DOM node — le
            // blob URL du preview pointait vers le mauvais fichier.
            <PendingFilePreview
              key={`${file.name}-${file.size ?? 0}-${i}`}
              file={file}
              onRemove={() => removeFile(i)}
              disabled={isPreparingAttachments}
            />
          ))}
        </div>
      )}

      {attachmentRouteProvider && (
        <div
          className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-theme-muted"
          role="status"
          data-testid="attachment-route-preview"
        >
          <span aria-hidden="true">↗</span>
          <span>
            {attachmentRouteFlags.hasSupportedVisionImages && (
              <>{t('chat.input.optimized4k')} · </>
            )}
            {t('chat.input.routePreview', {
              provider: t(`chat.input.routeProvider.${attachmentRouteProvider}`),
            })}
          </span>
        </div>
      )}

      {/* Slot contextuel v2 — UNE zone à priorité (voix > erreur > calendrier
          > chips) au lieu des bandeaux empilés. Les aperçus fichiers et le
          hint EU restent au-dessus, hors du slot : ce sont des données
          d'entrée / un conseil, pas un état contextuel (audit PR C, R4). */}
      {v2 && (
        <InputContextSlot
          error={micError || audioError || fileError || enhanceError}
          onDismissError={enhanceError && !micError && !audioError && !fileError ? () => setEnhanceError(null) : undefined}
          isRecordingAudio={isRecordingAudio}
          recordingDuration={recordingDuration}
          isSwipeCancelling={isSwipeCancelling}
          isTranscribing={isTranscribing}
          isListening={isListening}
          interimTranscript={interimTranscript}
          calendarSuggestion={showCalendarForm ? null : calendarSuggestion}
          onCreateCalendarEvent={() => setShowCalendarForm(true)}
          onDismissCalendar={() => setCalendarSuggestion(null)}
          showChips={!text.trim() && files.length === 0 && !isStreaming && !isPreparingAttachments && !isListening && !isRecordingAudio}
          chips={showQuickActions ? getQuickActionChips(t) : []}
          activeChipId={pendingQuickAction?.id}
          onChipClick={handleQuickActionClick}
          reflectionSlot={heroVariant ? undefined : <ReflectionPill euOnly={euOnly} />}
        />
      )}

      {isPreparingImages && (
        <div className="text-xs text-theme-muted italic mb-1 px-1 flex items-center gap-2" role="status">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-theme-accent" />
          {t('chat.input.preparingImage')}
        </div>
      )}

      {/* Mic / audio / file error message (speech recognition + Whisper + attachements) */}
      {!v2 && (micError || audioError || fileError) && (
        <div className="text-xs text-red-500 mb-1 px-1" role="alert">
          {micError || audioError || fileError}
        </div>
      )}

      {/* Interim transcript indicator (Web Speech API) */}
      {!v2 && isListening && interimTranscript && (
        <div className="text-xs text-theme-muted italic mb-1 px-1 truncate">
          {interimTranscript}...
        </div>
      )}

      {/* Voice message recording indicator (Whisper hold-to-record) */}
      {!v2 && isRecordingAudio && (
        <div
          className={`mb-1 px-2 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
            isSwipeCancelling
              ? 'bg-red-500/15 text-red-700 dark:text-red-400 font-semibold'
              : 'bg-theme-ink/5 text-theme-muted'
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isSwipeCancelling ? 'bg-red-600' : 'bg-red-500 animate-pulse'
            }`}
          />
          <span className="font-mono tabular-nums">
            {recordingDuration.toString().padStart(2, '0')}s
          </span>
          <span className="flex-1 truncate">
            {isSwipeCancelling
              ? t('chat.input.voice.releaseToCancel')
              : t('chat.input.voice.recording')}
          </span>
          {!isSwipeCancelling && (
            <span className="text-[10px] opacity-70 whitespace-nowrap">
              {t('chat.input.voice.swipeToCancel')}
            </span>
          )}
        </div>
      )}

      {/* Transcribing indicator (after release, while Whisper is responding) */}
      {!v2 && isTranscribing && !isRecordingAudio && (
        <div className="text-xs text-theme-muted italic mb-1 px-1 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-theme-accent animate-pulse" />
          {t('chat.input.voice.transcribing')}
        </div>
      )}

      <div className={`relative flex items-end gap-2 border transition-[border-color,box-shadow,transform] duration-[180ms] ${
        heroVariant
          ? 'min-h-[112px] rounded-[24px] border-theme-ink/10 bg-white/60 px-4 pb-3 pt-4 shadow-[0_1px_2px_rgb(var(--theme-ink)/0.04),0_12px_32px_rgb(var(--theme-ink)/0.07)] focus-within:-translate-y-px focus-within:border-theme-accent/40 focus-within:shadow-[0_2px_4px_rgb(var(--theme-ink)/0.05),0_16px_38px_rgb(var(--theme-ink)/0.10)] focus-within:ring-4 focus-within:ring-theme-accent/10 dark:bg-theme-surface/80 max-[639px]:min-h-[128px] max-[639px]:rounded-[20px] max-[639px]:px-3 max-[639px]:pb-2.5 max-[639px]:pt-3'
          : 'min-h-[52px] rounded-[20px] border-theme-ink/10 bg-white/60 px-3 py-2 shadow-[0_1px_2px_rgb(var(--theme-ink)/0.04),0_8px_24px_rgb(var(--theme-ink)/0.06)] focus-within:border-theme-accent/40 focus-within:ring-4 focus-within:ring-theme-accent/10 dark:bg-theme-surface/80'
      }`}>
        {/* + menu — file upload + native camera/scan + web camera (mobile). */}
        <AttachMenu
          open={showAttachMenu}
          onOpenChange={setShowAttachMenu}
          onPickFile={() => fileInputRef.current?.click()}
          onPickCamera={isNative ? handleCamera : (showWebCamera ? handleWebCamera : undefined)}
          onPickScan={isNative ? handleScan : undefined}
          ariaLabel={t('chat.input.aria.attachMenu')}
          labels={{
            file: t('chat.input.menu.file'),
            photo: t('chat.input.menu.photo'),
            scan: t('chat.input.menu.scan'),
          }}
          rounded
          disabled={isPreparingAttachments}
        />
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.md,.json,.xml,.doc,.docx,.xls,.xlsx"
          multiple
          className="hidden"
        />
        {showWebCamera && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleWebCameraChange}
            className="hidden"
          />
        )}

        {/* Textarea or voice wave — voice modes replace the textarea. */}
        {(isListening || isRecordingAudio) ? (
          <div className="flex-1 flex items-center px-1 py-1.5 min-h-[36px]">
            <VoiceWave tone={isRecordingAudio ? 'danger' : 'accent'} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              draftTouchedRef.current = true
              setText(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.input.placeholder')}
            rows={1}
            // Audit UX — plus de `disabled={isStreaming}` : on peut composer le
            // message suivant pendant que la réponse arrive (comme claude.ai).
            // sendText garde le verrou d'ENVOI pendant le stream ; sur mobile,
            // le clavier ne se referme plus à chaque envoi.
            className={`min-w-0 flex-1 resize-none bg-transparent font-sans font-normal leading-relaxed text-theme-ink placeholder:text-theme-muted focus:outline-none ${
              heroVariant ? 'min-h-[76px] py-1 text-[17px] max-[639px]:min-h-[88px] max-[639px]:text-base' : 'py-2 text-sm'
            }`}
          />
        )}

        {/* Prompt enhancement (1.0.14) — ✨ reformulates the prompt via Haiku/Mistral */}
        {enhanceEnabled && (
          <button
            onClick={handleEnhance}
            disabled={!text.trim() || isEnhancing}
            className={`relative mb-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-theme-ink/10 bg-theme-bg/60 shadow-[0_1px_2px_rgb(var(--theme-ink)/0.025)] transition-[color,background-color,border-color,transform,box-shadow] duration-[180ms] active:scale-[0.98] ${
              isEnhancing
                ? 'bg-theme-accent/20 text-theme-accent'
                : 'text-theme-muted hover:border-theme-accent/30 hover:bg-theme-accent/10 hover:text-theme-accent-text disabled:opacity-30'
            }`}
            aria-label={t('chat.input.aria.enhance')}
            title={isEnhancing ? t('chat.input.enhancing') : t('chat.input.enhanceTooltip')}
          >
            {isEnhancing ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="animate-spin">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 30" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 2.5L10.2 6.3L14 7.5L10.2 8.7L9 12.5L7.8 8.7L4 7.5L7.8 6.3L9 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path d="M13.5 12.5L14 14L15.5 14.5L14 15L13.5 16.5L13 15L11.5 14.5L13 14L13.5 12.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}

        {/* Whisper audio recording (Feature 15) — if OpenAI key is available.
            v2 : retiré — le hold du VoiceButton couvre Whisper, deux boutons
            micro aux gestes contradictoires (toggle vs hold) brouillaient
            l'affordance (audit PR C, R5). Le killswitch le restaure. */}
        {!v2 && hasOpenAI && (
          <button
            onClick={isRecordingAudio ? () => stopAudioRecording() : startAudioRecording}
            className={`relative flex-shrink-0 p-1.5 rounded-full transition-colors mb-0.5 ${
              isRecordingAudio
                ? 'bg-red-100 text-red-500 hover:bg-red-200'
                : 'hover:bg-theme-ink/5 text-theme-muted'
            }`}
            aria-label={isRecordingAudio ? t('chat.input.whisperStop') : t('chat.input.whisperStart')}
            title={isRecordingAudio ? t('chat.input.recordingWithDuration', { duration: recordingDuration }) : t('chat.input.whisperTooltip')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="5" fill="currentColor" />
            </svg>
            {isRecordingAudio && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold px-1 rounded-full">
                {recordingDuration}s
              </span>
            )}
          </button>
        )}

        {/* Morphing CTA — Stop (streaming) / Send (text) / Voice (idle).
            Roadmap UI Phase 3 #7 — bouton agrandi 40px → 52px (WCAG 2.2
            "Target Size Minimum" recommande 44px, 52px = confort terrain). */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-theme-ink text-theme-bg shadow-[0_8px_22px_-12px_rgb(var(--theme-ink)/0.85)] transition-[background-color,transform,box-shadow] duration-[180ms] hover:bg-theme-accent active:scale-[0.98]"
            aria-label={t('chat.input.aria.stop')}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          </button>
        ) : (text.trim() || files.length > 0) ? (
          <button
            onClick={handleSend}
            disabled={isSubmitting || isPreparingAttachments}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-theme-accent bg-theme-accent text-theme-bg shadow-[0_8px_22px_-12px_rgb(var(--theme-accent)/0.9)] transition-[background-color,color,transform,box-shadow] duration-[180ms] hover:bg-theme-ink hover:text-theme-bg active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
            aria-label={t('chat.input.aria.send')}
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2M7 2L3 6M7 2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (canUseWhisper || isMicSupported) ? (
          <VoiceButton
            onPointerDown={handleVoicePointerDown}
            onPointerMove={handleVoicePointerMove}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerCancel}
            isListening={isListening}
            isRecordingAudio={isRecordingAudio}
            isSwipeCancelling={isSwipeCancelling}
            isTranscribing={isTranscribing}
            crossedThreshold={crossedThresholdRef.current}
            holdProgress={holdProgress}
            ariaLabel={t('chat.input.aria.holdToRecord')}
            showIdleRing={v2 && canUseWhisper}
            rounded
          />
        ) : null}
      </div>

      {/* Hint dictée/Whisper (v2) — le hold 600ms était indécouvrable sans
          indication (constat beta). Affiché à l'idle uniquement. */}
      {v2 && !isStreaming && !isListening && !isRecordingAudio && !isTranscribing && !text.trim() && files.length === 0 && (canUseWhisper || isMicSupported) && (
        <p className="text-center text-[10px] font-sans text-theme-muted mt-2">
          {canUseWhisper ? t('chat.input.voice.hint') : t('chat.input.voice.hintTapOnly')}
        </p>
      )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AttachMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPickFile: () => void
  onPickCamera?: () => void
  onPickScan?: () => void
  ariaLabel: string
  labels: { file: string; photo: string; scan: string }
  rounded?: boolean
  disabled?: boolean
}

function AttachMenu({ open, onOpenChange, onPickFile, onPickCamera, onPickScan, ariaLabel, labels, rounded, disabled = false }: AttachMenuProps) {
  const hasMulti = !!(onPickCamera || onPickScan)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  const handlePrimaryClick = () => {
    if (disabled) return
    if (!hasMulti) onPickFile()
    else onOpenChange(!open)
  }

  return (
    <div ref={containerRef} className="relative mb-0.5 flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={handlePrimaryClick}
        disabled={disabled}
        className={`flex h-11 w-11 items-center justify-center border text-theme-muted transition-[color,background-color,border-color,transform,box-shadow] duration-[180ms] active:scale-[0.98] disabled:cursor-wait disabled:opacity-40 ${rounded
          ? 'rounded-full border-theme-ink/10 bg-theme-bg/60 shadow-[0_1px_2px_rgb(var(--theme-ink)/0.025)] hover:border-theme-accent/30 hover:bg-theme-accent/10 hover:text-theme-accent-text'
          : 'border-theme-border hover:border-theme-accent hover:text-theme-accent-text'
        }`}
        aria-label={hasMulti ? ariaLabel : labels.file}
        aria-expanded={hasMulti ? open : undefined}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {hasMulti && open && (
        <div className={`absolute bottom-full left-0 z-30 mb-2 min-w-[160px] overflow-hidden border bg-theme-bg animate-fade-in ${rounded ? 'rounded-[18px] border-theme-ink/10 shadow-[0_12px_32px_rgb(var(--theme-ink)/0.10)]' : 'border-theme-ink'}`}>
          <MenuItem
            onClick={() => { onOpenChange(false); onPickFile() }}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13 5v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h4l4 4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            }
            label={labels.file}
          />
          {onPickCamera && (
            <MenuItem
              onClick={() => { onOpenChange(false); onPickCamera() }}
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5 4l1-2h4l1 2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              }
              label={labels.photo}
            />
          )}
          {onPickScan && (
            <MenuItem
              onClick={() => { onOpenChange(false); onPickScan() }}
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              }
              label={labels.scan}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-theme-ink hover:bg-theme-ink/5 transition-colors"
    >
      <span className="text-theme-muted">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// VoiceWave — 9 animated bars used as textarea replacement while listening or
// recording. Colour tones track the mode (accent = webkit, danger = Whisper).
function VoiceWave({ tone, n = 9 }: { tone: 'accent' | 'danger'; n?: number }) {
  const colour = tone === 'danger' ? 'rgb(224 75 46)' : 'rgb(var(--theme-accent))'
  return (
    <div className="flex items-center gap-[3px] h-5" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] h-full rounded-sm origin-bottom"
          style={{
            background: colour,
            animation: `wave ${0.75 + i * 0.05}s ease-in-out ${i * 0.06}s infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

// Morphing voice CTA — idle / listening (webkit) / hold-progress / whisper.
interface VoiceButtonProps {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void
  isListening: boolean
  isRecordingAudio: boolean
  isSwipeCancelling: boolean
  isTranscribing: boolean
  crossedThreshold: boolean
  holdProgress: number
  ariaLabel: string
  /** v2 : anneau pointillé statique à l'idle — hint « ce bouton se maintient ». */
  showIdleRing?: boolean
  rounded?: boolean
}

function VoiceButton({
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  isListening, isRecordingAudio, isSwipeCancelling, isTranscribing,
  crossedThreshold, holdProgress, ariaLabel, showIdleRing, rounded,
}: VoiceButtonProps) {
  // Size morph: 52px idle, 56px active (listening or whisper). Roadmap UI
  // Phase 3 #7 — WCAG 2.2 "Target Size Minimum" + confort terrain (gants,
  // mains mouillées, lumière variable). Avant : 40px/48px.
  const active = isListening || isRecordingAudio
  const size = active ? 56 : 52
  const showRing = holdProgress > 0 && holdProgress < 1 && !crossedThreshold
  const circumference = 2 * Math.PI * 18 // r=18

  let bgClass: string
  let pulseClass = ''
  if (isSwipeCancelling) {
    bgClass = 'bg-red-500 text-white'
  } else if (isRecordingAudio) {
    bgClass = 'bg-red-700 text-white'
    pulseClass = 'animate-pulse-ring-danger'
  } else if (isListening) {
    bgClass = 'bg-theme-accent text-theme-bg'
    pulseClass = 'animate-pulse-ring-accent'
  } else {
    bgClass = rounded
      ? 'border border-theme-ink/10 bg-theme-bg/60 text-theme-muted shadow-[0_1px_2px_rgb(var(--theme-ink)/0.025)] hover:border-theme-accent/30 hover:bg-theme-accent/10 hover:text-theme-accent-text'
      : 'border border-theme-border bg-transparent text-theme-muted hover:border-theme-accent hover:text-theme-accent-text'
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: size,
        height: size,
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        transition: rounded
          ? 'width 180ms cubic-bezier(.2,0,0,1), height 180ms cubic-bezier(.2,0,0,1)'
          : 'width 0.25s cubic-bezier(0.34,1.56,0.64,1), height 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}
      className={`relative mb-0.5 flex flex-shrink-0 items-center justify-center transition-[color,background-color,border-color,transform,box-shadow] duration-[180ms] ${bgClass} ${pulseClass} ${rounded ? 'rounded-full active:scale-[0.98]' : ''}`}
      aria-label={ariaLabel}
      disabled={isTranscribing}
    >
      {/* Anneau pointillé idle (v2) — purement décoratif, élément SÉPARÉ de
          l'anneau de progression : ne touche ni showRing ni holdProgress
          (frontière BUG 46, audit PR C R2). Masqué dès que le bouton est
          actif ou qu'un hold démarre. */}
      {showIdleRing && !active && !showRing && (
        <span
          aria-hidden="true"
          className="absolute rounded-full border-2 border-dashed border-theme-accent/35 pointer-events-none"
          style={{ inset: -3 }}
        />
      )}
      {/* Hold-progress ring — fills 0→1 during 0-600ms hold. */}
      {showRing && (
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ transform: 'rotate(-90deg)' }}
          width={size}
          height={size}
          viewBox="0 0 40 40"
        >
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="rgb(224 75 46)"
            strokeWidth="3"
            strokeDasharray={`${holdProgress * circumference} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
      )}
      {/* Icon: "W" during Whisper, mic otherwise. */}
      {isRecordingAudio ? (
        <span className="font-display italic font-semibold text-lg leading-none">W</span>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 9C4 11.76 6.24 14 9 14C11.76 14 14 11.76 14 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="9" y1="14" x2="9" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}

// Mini-form for confirming a calendar event (Feature 16)
interface CalendarMiniFormProps {
  detected: { text: string; date: Date }
  context: string
  onConfirm: (title: string, date: Date) => void
  onCancel: () => void
}

function CalendarMiniForm({ detected, context, onConfirm, onCancel }: CalendarMiniFormProps) {
  const { t } = useTranslation()
  const defaultTitle = context.trim().slice(0, 80) || t('calendar.defaultEventTitle', { text: detected.text })
  const [title, setTitle] = useState(defaultTitle)
  const [dateStr, setDateStr] = useState(() => {
    const d = detected.date
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })

  return (
    <div className="mb-2 border border-theme-accent/30 bg-theme-surface p-3">
      <p className="text-xs font-semibold text-theme-ink mb-2">📅 {t('calendar.newEvent')}</p>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('calendar.eventTitlePlaceholder')}
        className="mb-2 w-full border border-theme-border bg-transparent px-2 py-1.5 text-xs text-theme-ink focus:border-theme-accent focus:outline-none"
      />
      <input
        type="datetime-local"
        value={dateStr}
        onChange={(e) => setDateStr(e.target.value)}
        className="mb-2 w-full border border-theme-border bg-transparent px-2 py-1.5 text-xs text-theme-ink focus:border-theme-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 border border-theme-border py-1.5 text-xs text-theme-ink/80 hover:border-theme-accent"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={() => onConfirm(title, new Date(dateStr))}
          className="flex-1 border border-theme-accent bg-theme-accent py-1.5 text-xs font-semibold text-theme-bg hover:bg-theme-ink"
        >
          {t('calendar.addToCalendar')}
        </button>
      </div>
    </div>
  )
}
