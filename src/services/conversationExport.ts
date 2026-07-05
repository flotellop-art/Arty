import { Capacitor } from '@capacitor/core'
import type { Conversation } from '../types'
import { generateId } from '../utils/generateId'
import * as storage from './storage'
import { getDateLocale } from '../utils/formatDate'
import { formatModelName } from './modelLabels'

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
  return new Date(ts).toLocaleString(getDateLocale(), {
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
    // D3 (CDC visibilité modèle) — export PRIVÉ : le modèle par message est
    // inclus (contrairement au partage public qui l'exclut, shareClient.ts).
    const modelSuffix = msg.role === 'assistant' && msg.model
      ? ` · ${formatModelName(msg.model)}`
      : ''
    lines.push(`*${formatDate(msg.timestamp)}${modelSuffix}*`)
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
    // D3 — export privé : modèle par message inclus (assistant uniquement).
    const modelSuffix = !isUser && msg.model ? ` · ${escape(formatModelName(msg.model))}` : ''
    return `
      <div style="margin:14px 0;padding:10px 14px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;">
        <div style="font-size:11px;color:#666;margin-bottom:4px;">
          <strong>${roleLabel}</strong> · ${formatDate(msg.timestamp)}${modelSuffix}
        </div>
        <div style="font-size:13px;line-height:1.5;color:#222;">${formatted}</div>
        ${filesHtml}
      </div>
    `
  }).join('')

  const euLine = conv.euOnly ? '🇪🇺 Conversation EU — traitement IA Mistral (France)<br>' : ''
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
 * Sanitize an HTML string before it is injected into the MAIN document via
 * innerHTML for rasterization.
 *
 * SÉCURITÉ : le HTML d'un rapport peut être produit par l'IA (outil
 * `generate_report`) et donc empoisonné par prompt-injection (un mail/fichier
 * lu par Arty). Il est affiché sans danger dans une iframe sandboxée
 * (ReportPage.tsx), mais l'export PDF le réinjecte dans l'origine PRINCIPALE
 * via innerHTML — sans nettoyage, un `<img src=x onerror=…>` ou `<svg onload=…>`
 * s'exécuterait dans le contexte de l'app et pourrait voler les clés BYOK en
 * clair + les tokens Google de localStorage (RÈGLE 5). `<script>` ne s'exécute
 * pas via innerHTML mais les attributs `on*` oui : DOMPurify retire les deux,
 * plus `javascript:`, `<iframe>`, etc.
 *
 * WHOLE_DOCUMENT est OBLIGATOIRE : le rapport met tout son CSS dans
 * <head><style>, or sans cette option DOMPurify ne renvoie que le <body> et
 * détruirait 100% du style. FORCE_BODY = ceinture+bretelles pour préserver un
 * <style> hors structure standard. DOMPurify est chargé paresseusement (comme
 * jsPDF/html2canvas) pour rester hors du bundle principal.
 */
export async function sanitizeReportHtml(html: string): Promise<string> {
  const DOMPurify = (await import('dompurify')).default
  return DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, FORCE_BODY: true })
}

/**
 * Render an arbitrary HTML string into a styled PDF, then download
 * (web) or share (native). Reusable by both the conversation export and
 * the report page (window.print() doesn't work inside Android Chrome
 * sandboxed iframes — this is the cross-platform replacement).
 *
 * jsPDF and html2canvas are heavy (~500KB combined) so they are loaded
 * lazily — only when the user actually clicks "Export PDF". The HTML is
 * sanitized (sanitizeReportHtml) before touching the main DOM — see the
 * security note above.
 */
export async function exportHtmlAsPdf(
  html: string,
  filenameBase: string,
  bgColor: string = '#fdfaf5',
): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const html2canvas = (await import('html2canvas')).default

  const container = document.createElement('div')
  container.innerHTML = await sanitizeReportHtml(html)
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = '744px' // A4 width at 96 DPI minus margin
  document.body.appendChild(container)

  try {
    const SCALE = 2
    const canvas = await html2canvas(container, {
      scale: SCALE,
      backgroundColor: bgColor,
      logging: false,
    })

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const pxPerPdfPt = canvas.width / pdfWidth
    const pageHeightPx = pdfHeight * pxPerPdfPt

    // Collecte des Y "sûrs" où couper sans traverser une ligne de texte :
    // top de chaque élément (= début d'un bloc / d'une ligne wrappée par
    // <br>) et bottom des <br>/<hr> (= début de la ligne suivante). Avant ce
    // fix, le canvas était découpé à intervalle fixe pdfHeight → coupure
    // possible au milieu d'une ligne (ex. "...comme un" + "...époux" sur 2
    // pages).
    const containerRect = container.getBoundingClientRect()
    const breakPoints = new Set<number>([0, canvas.height])
    const walk = (el: Element) => {
      const r = el.getBoundingClientRect()
      breakPoints.add(Math.round((r.top - containerRect.top) * SCALE))
      if (el.tagName === 'BR' || el.tagName === 'HR') {
        breakPoints.add(Math.round((r.bottom - containerRect.top) * SCALE))
      }
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children.item(i)
        if (child) walk(child)
      }
    }
    walk(container)
    const sortedBreaks = Array.from(breakPoints).sort((a, b) => a - b)

    let yStart = 0
    let firstPage = true
    while (yStart < canvas.height) {
      const idealEnd = yStart + pageHeightPx
      let yEnd = Math.min(idealEnd, canvas.height)
      for (let i = sortedBreaks.length - 1; i >= 0; i--) {
        const bp = sortedBreaks[i]
        if (bp !== undefined && bp > yStart && bp <= idealEnd) {
          yEnd = bp
          break
        }
      }
      // Garde anti-boucle infinie : si aucun breakpoint utilisable n'est
      // trouvé (long bloc atomique de texte > 1 page), on force un saut
      // de la taille d'une page complète et on accepte la coupe.
      if (yEnd <= yStart) yEnd = Math.min(yStart + pageHeightPx, canvas.height)

      const sliceHeight = Math.max(1, yEnd - yStart)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = sliceHeight
      const ctx = slice.getContext('2d')
      if (ctx) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, slice.width, slice.height)
        ctx.drawImage(canvas, 0, -yStart)
      }
      const sliceData = slice.toDataURL('image/png')
      const sliceHeightPt = sliceHeight / pxPerPdfPt

      if (!firstPage) pdf.addPage()
      pdf.addImage(sliceData, 'PNG', 0, 0, pdfWidth, sliceHeightPt)
      firstPage = false
      yStart = yEnd
    }

    const blob = pdf.output('blob')
    const filename = `${filenameBase}-${Date.now()}.pdf`
    await downloadOrShare(blob, filename, 'application/pdf')
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * Export the conversation as a downloadable PDF.
 * Wraps exportHtmlAsPdf with the conversation's styled HTML.
 */
export async function exportConversationPdf(conv: Conversation): Promise<void> {
  const html = buildConversationHtml(conv)
  await exportHtmlAsPdf(html, `arty-${sanitizeFilename(conv.title)}`)
}
