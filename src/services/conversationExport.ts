import { Capacitor } from '@capacitor/core'
import type { Conversation } from '../types'
import { generateId } from '../utils/generateId'
import * as storage from './storage'

/**
 * Download a conversation as a JSON file (Feature 7).
 */
export function exportConversation(conv: Conversation): void {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    conversation: conv,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const filename = `arty-${sanitizeFilename(conv.title)}.json`
  // Reuse the share path on native so the user can pick a destination.
  void downloadOrShare(blob, filename, 'application/json')
}

/**
 * Build a data: URL embedding the conversation as base64-encoded JSON.
 */
export function buildShareUrl(conv: Conversation): string {
  const payload = { version: 1, conversation: conv }
  const json = JSON.stringify(payload)
  // Handle UTF-8 safely in base64
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return `data:application/json;base64,${b64}`
}

/**
 * Import a conversation from a JSON file.
 * Returns the new conversation ID (generated to avoid collisions).
 */
export async function importConversationFromFile(file: File): Promise<string> {
  const text = await file.text()
  const data = JSON.parse(text) as { conversation?: Conversation; version?: number }
  if (!data.conversation || !Array.isArray(data.conversation.messages)) {
    throw new Error('Fichier invalide: pas une conversation Arty')
  }
  const original = data.conversation
  const newConv: Conversation = {
    ...original,
    id: generateId(),
    title: original.title ? `${original.title} (importée)` : 'Conversation importée',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: original.messages.map((m) => ({
      ...m,
      id: generateId(),
    })),
  }
  storage.saveConversation(newConv)
  return newConv.id
}

// ============================================================================
// Helpers communs
// ============================================================================

function sanitizeFilename(title: string | undefined): string {
  return (title || 'conversation').slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * On web: trigger a blob download.
 * On native: write to cache + open the system share sheet so the user
 * picks a destination (Drive, Mail, Files, …).
 */
async function downloadOrShare(
  blob: Blob,
  filename: string,
  _mimeType: string,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const base64 = await blobToBase64(blob)

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    })

    await Share.share({
      title: filename,
      text: 'Conversation Arty',
      url: written.uri,
      dialogTitle: 'Partager la conversation',
    })
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

// ============================================================================
// Export Markdown
// ============================================================================

/**
 * Build a Markdown string from a Conversation.
 * Pure function — easy to test.
 */
export function buildConversationMarkdown(conv: Conversation): string {
  const lines: string[] = []
  lines.push(`# ${conv.title || 'Conversation Arty'}`)
  lines.push('')
  lines.push(`*Exportée le ${formatDate(Date.now())}*  `)
  lines.push(`*Créée le ${formatDate(conv.createdAt)}*  `)
  if (conv.usedModels?.length) {
    lines.push(`*Modèles utilisés : ${conv.usedModels.join(', ')}*  `)
  }
  if (conv.euOnly) {
    lines.push(`*🇪🇺 Conversation EU (Mistral uniquement)*  `)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of conv.messages) {
    const roleLabel = msg.role === 'user' ? '👤 **Utilisateur**' : '🤖 **Arty**'
    lines.push(`### ${roleLabel}`)
    lines.push(`*${formatDate(msg.timestamp)}*`)
    lines.push('')
    const cleanContent = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content)
    lines.push(cleanContent)
    if (msg.files?.length) {
      lines.push('')
      lines.push(`*📎 Pièces jointes : ${msg.files.map((f) => f.name).join(', ')}*`)
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Export the conversation as a downloadable Markdown file.
 */
export async function exportConversationMarkdown(conv: Conversation): Promise<void> {
  const md = buildConversationMarkdown(conv)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const filename = `arty-${sanitizeFilename(conv.title)}-${Date.now()}.md`
  await downloadOrShare(blob, filename, 'text/markdown')
}

// ============================================================================
// Export PDF
// ============================================================================

/**
 * Build a styled HTML string from a Conversation, ready for jsPDF rendering.
 * Pure function — easy to test the structure.
 */
export function buildConversationHtml(conv: Conversation): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const messagesHtml = conv.messages.map((msg) => {
    const isUser = msg.role === 'user'
    const roleLabel = isUser ? 'Utilisateur' : 'Arty'
    const bgColor = isUser ? '#fef3e8' : '#f5f5f5'
    const borderColor = isUser ? '#e04b2e' : '#888888'
    const content = typeof msg.content === 'string' ? msg.content : ''
    // Light markdown -> HTML (bold, italic, code, line breaks). Escape first
    // so the regexes below only apply to legitimate markup, not user input.
    const formatted = escape(content)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:#eee;padding:2px 4px;border-radius:3px;">$1</code>')
      .replace(/\n/g, '<br>')
    const filesHtml = msg.files?.length
      ? `<div style="margin-top:6px;font-size:11px;color:#666;">📎 ${msg.files.map((f) => escape(f.name)).join(', ')}</div>`
      : ''
    return `
      <div style="margin:14px 0;padding:10px 14px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;">
        <div style="font-size:11px;color:#666;margin-bottom:4px;">
          <strong>${roleLabel}</strong> · ${formatDate(msg.timestamp)}
        </div>
        <div style="font-size:13px;line-height:1.5;color:#222;">${formatted}</div>
        ${filesHtml}
      </div>
    `
  }).join('')

  const euLine = conv.euOnly ? '🇪🇺 Conversation EU (Mistral)<br>' : ''
  const modelsLine = conv.usedModels?.length
    ? `Modèles : ${escape(conv.usedModels.join(', '))}<br>`
    : ''

  return `
    <div style="font-family:Georgia,'Apple Color Emoji','Segoe UI Emoji',serif;max-width:680px;padding:32px;color:#222;background:#fdfaf5;">
      <h1 style="font-size:24px;margin:0 0 6px 0;color:#1a1a1a;">${escape(conv.title || 'Conversation Arty')}</h1>
      <div style="font-size:12px;color:#888;margin-bottom:24px;">
        Exportée le ${formatDate(Date.now())}<br>
        ${modelsLine}
        ${euLine}
      </div>
      <hr style="border:none;border-top:1px solid #e0d8c8;margin:0 0 16px 0;">
      ${messagesHtml}
      <div style="margin-top:32px;font-size:10px;color:#aaa;text-align:center;">
        Généré par Arty — tryarty.com
      </div>
    </div>
  `
}

/**
 * Export the conversation as a downloadable PDF.
 * Uses jsPDF + html2canvas to render the styled HTML.
 *
 * jsPDF and html2canvas are heavy (~500KB combined) so they are loaded
 * lazily — only when the user actually clicks "Export PDF".
 */
export async function exportConversationPdf(conv: Conversation): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const html2canvas = (await import('html2canvas')).default

  const container = document.createElement('div')
  container.innerHTML = buildConversationHtml(conv)
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '744px' // A4 width at 96 DPI minus margin
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#fdfaf5',
      logging: false,
    })
    const imgData = canvas.toDataURL('image/png')

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    // Multi-page support: if image is taller than one page, split it.
    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pdfHeight
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
    }

    const blob = pdf.output('blob')
    const filename = `arty-${sanitizeFilename(conv.title)}-${Date.now()}.pdf`
    await downloadOrShare(blob, filename, 'application/pdf')
  } finally {
    document.body.removeChild(container)
  }
}
