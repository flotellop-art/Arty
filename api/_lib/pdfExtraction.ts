import pdf = require('pdf-parse')

interface PdfResult {
  content: string
  pages?: number
  method: 'pdf-parse' | 'ocr' | 'failed'
}

export async function extractPdfText(buffer: Buffer): Promise<PdfResult> {
  // 1. Try pdf-parse
  try {
    const pdfData = await pdf(buffer)
    const text = pdfData.text || ''
    const readable = text.replace(/[^\w\sàâäéèêëïîôùûüçœæÀÂÄÉÈÊËÏÎÔÙÛÜÇŒÆ.,;:!?€$%()/-]/g, '')
    if (text.trim().length >= 50 && readable.length > text.length * 0.5) {
      return { content: text, pages: pdfData.numpages, method: 'pdf-parse' }
    }
  } catch { /* pdf-parse failed */ }

  // 2. Try Google Vision OCR
  const visionKey = process.env.GOOGLE_VISION_API_KEY
  if (visionKey) {
    try {
      const base64Data = buffer.toString('base64')
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/files:annotate?key=${visionKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              inputConfig: { content: base64Data, mimeType: 'application/pdf' },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              pages: [1, 2, 3, 4, 5],
            }],
          }),
        }
      )
      const visionBody = await visionRes.text()
      if (visionRes.ok) {
        const visionData = JSON.parse(visionBody)
        const pages = visionData.responses?.[0]?.responses || []
        const ocrText = pages
          .map((p: { fullTextAnnotation?: { text?: string } }) => p.fullTextAnnotation?.text || '')
          .filter(Boolean)
          .join('\n\n--- Page suivante ---\n\n')
        if (ocrText && ocrText.trim().length > 10) {
          return { content: ocrText, method: 'ocr' }
        }
        return { content: `[OCR: aucun texte trouvé. Réponse: ${visionBody.slice(0, 200)}]`, method: 'failed' }
      }
      return { content: `[OCR échoué (${visionRes.status}): ${visionBody.slice(0, 200)}]`, method: 'failed' }
    } catch (e) {
      return { content: `[OCR erreur: ${e instanceof Error ? e.message : 'inconnu'}]`, method: 'failed' }
    }
  }

  return { content: '[PDF illisible — GOOGLE_VISION_API_KEY non configurée sur Vercel]', method: 'failed' }
}
