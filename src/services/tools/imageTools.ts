/**
 * P1.3 — Outil de génération d'images.
 *
 * Le tool `generate_image` N'EST PAS dans le tableau TOOLS par défaut : il est
 * injecté CONDITIONNELLEMENT (cf. wantsImageGeneration + useConversation) quand
 * l'utilisateur demande explicitement une image. C'est la seule garantie qu'il
 * ne tire pas à l'aveugle sur « décris-moi une image » (qui brûlerait le cap —
 * la frustration n°1 du marché). Le handler reste toujours enregistré (inerte
 * tant que le tool n'est pas exposé au modèle).
 *
 * L'image générée est stockée en IndexedDB chiffré (putFile) — JAMAIS en
 * base64 dans la conversation (anti-BUG 11). Elle est affichée via une
 * référence `arty-img://<fileId>` que le MarkdownRenderer résout au rendu.
 */

import type { ToolHandler, ToolResult } from './types'
import { generateImage } from '../imageClient'
import { putFile } from '../secureFileStorage'
import { generateId } from '../../utils/generateId'
import i18n from '../../i18n'

export const generateImageToolDefinition = {
  name: 'generate_image',
  description:
    "Génère une image à partir d'une description. N'UTILISE CET OUTIL QUE si l'utilisateur demande EXPLICITEMENT de créer/générer/dessiner une image, un logo, une illustration ou un visuel (« génère une image de… », « crée-moi un logo… », « dessine… »). NE PAS l'utiliser si l'utilisateur demande une DESCRIPTION, une explication, ou emploie un conditionnel (« décris… », « à quoi ressemblerait… », « imagine… »). Après génération, affiche l'image en incluant EXACTEMENT le markdown renvoyé par l'outil dans ta réponse.",
  input_schema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string' as const,
        description:
          "Description détaillée et optimisée de l'image à générer, en anglais de préférence (meilleurs résultats). Enrichis la demande de l'utilisateur avec du style, du cadrage, de l'ambiance.",
      },
    },
    required: ['prompt'],
  },
}

// Verbe de création + nom visuel. Restrictif : exclut « décris/imagine/ressemble ».
const IMAGE_CREATE_VERBS =
  /\b(g[eé]n[eè]re|cr[eé]e|cr[eé]er|dessine|dessiner|fais(?:-moi)?|illustre|generate|create|draw|make|design)\b/i
const IMAGE_NOUNS =
  /\b(image|images|logo|logos|dessin|illustration|visuel|photo|picture|drawing|artwork|avatar|ic[oô]ne|icon|banni[eè]re|banner|affiche|poster|wallpaper|fond d['e ]?[eé]cran)\b/i
const IMAGE_NEGATIVE =
  /\b(d[eé]cris|d[eé]crire|d[eé]crivez|explique|expliquer|ressemblerait|imagine|describe|explain)\b/i

/**
 * L'utilisateur demande-t-il EXPLICITEMENT de générer une image ? Doit avoir un
 * verbe de création + un nom visuel, et pas de verbe « descriptif » qui
 * trahirait une intention non-générative. Pattern volontairement strict :
 * un faux négatif (on rate « fais-moi un truc visuel ») est sans coût ;
 * un faux positif brûle le cap de l'utilisateur (inacceptable).
 */
export function wantsImageGeneration(text: string): boolean {
  if (IMAGE_NEGATIVE.test(text)) return false
  return IMAGE_CREATE_VERBS.test(text) && IMAGE_NOUNS.test(text)
}

export function createImageHandlers(): Record<string, ToolHandler> {
  return {
    generate_image: async (input): Promise<ToolResult> => {
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
      if (!prompt) return { result: i18n.t('image.errorNoPrompt') }

      const res = await generateImage(prompt)
      if (!res.ok) {
        // Message destiné à Claude (qui le relaiera à l'utilisateur). Jamais
        // de génération silencieuse ni de cap brûlé sans explication.
        const key =
          res.code === 'plan_locked'
            ? 'image.errorPlanLocked'
            : res.code === 'cap_reached'
              ? 'image.errorCapReached'
              : res.code === 'auth'
                ? 'image.errorAuth'
                : 'image.errorFailed'
        return { result: i18n.t(key) }
      }

      // Anti-BUG 11 : l'image va en IndexedDB chiffré, pas dans la conversation.
      const fileId = generateId()
      try {
        await putFile({ id: fileId, name: 'image.png', type: res.mimeType, size: 0, data: res.base64 })
      } catch {
        return { result: i18n.t('image.errorFailed') }
      }

      // fileData → Claude « voit » l'image (bloc image). result → instruction
      // d'affichage via la référence arty-img:// résolue par MarkdownRenderer.
      return {
        result: `Image générée avec succès. AFFICHE-LA en incluant exactement ce markdown dans ta réponse (et seulement une courte légende) :\n![image générée](arty-img://${fileId})`,
        fileData: { name: 'image.png', mimeType: res.mimeType, base64: res.base64 },
      }
    },
  }
}
