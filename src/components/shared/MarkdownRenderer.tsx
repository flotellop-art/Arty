import { memo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Components } from 'react-markdown'
import { isValidElement } from 'react'
import { getFile } from '../../services/secureFileStorage'

// P1.3 — image générée référencée par `arty-img://<fileId>`. Charge le binaire
// depuis IndexedDB chiffré et le rend via un blob: URL (révoqué au démontage).
function GeneratedImage({ fileId, alt }: { fileId: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let revoke: string | null = null
    getFile(fileId)
      .then((f) => {
        if (cancelled) return
        if (!f?.data) { setFailed(true); return }
        const bin = atob(f.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        revoke = URL.createObjectURL(new Blob([bytes], { type: f.type }))
        setUrl(revoke)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke) }
  }, [fileId])

  if (failed) return null
  if (!url) {
    return <div className="w-full aspect-square max-w-sm rounded-xl border border-theme-border my-3 bg-theme-surface animate-pulse" />
  }
  return (
    <img src={url} alt={alt || 'Image générée'}
      className="w-full max-w-sm rounded-xl border border-theme-border my-3 shadow-sm" />
  )
}

function BlockedRemoteImage({ src, alt }: { src: string; alt?: string }) {
  const { t } = useTranslation()
  return (
    <span role="note" className="block my-3 rounded-xl border border-theme-border bg-theme-surface px-4 py-3 text-xs">
      <span className="block text-theme-ink/70">
        {t('chat.bubble.remoteImageBlocked')}{alt ? ` — ${alt}` : ''}
      </span>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="mt-1 inline-block text-theme-accent underline"
      >
        {t('chat.bubble.openRemoteImage')}
      </a>
    </span>
  )
}

// Custom sanitize schema: allow Arty CSS classes + data-* attributes for action buttons
// Block: <script>, <iframe>, onerror, onload, javascript: URIs
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'div', 'span', 'button', 'section', 'article', 'details', 'summary',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'class'],
    // SÉCURITÉ (audit 14 juin) : liste BLANCHE explicite au lieu du wildcard
    // `data*`. Le wildcard laissait l'IA injecter n'importe quel data-attribut ;
    // couplé au dispatch des boutons, il amplifiait le vecteur de prompt-injection.
    // hast-util-sanitize matche les noms de PROPRIÉTÉ hast (camelCase :
    // `data-action` → `dataAction`). Seuls les params des actions connues
    // (handleAction + systemPrompt) sont autorisés.
    button: [
      'className', 'class',
      'dataAction', 'dataTo', 'dataSubject', 'dataBody', 'dataText', 'dataValue',
      'dataName', 'dataContent', 'dataTitle', 'dataStart', 'dataEnd',
      'dataLocation', 'dataStatus', 'dataPhone', 'dataUrl', 'dataQuery', 'dataSummary',
    ],
    div: [
      'className', 'class', 'style',
      'dataAction', 'dataTo', 'dataSubject', 'dataBody', 'dataText', 'dataValue',
      'dataName', 'dataContent', 'dataTitle', 'dataStart', 'dataEnd',
      'dataLocation', 'dataStatus', 'dataPhone', 'dataUrl', 'dataQuery', 'dataSummary',
    ],
    span: ['className', 'class', 'style'],
    a: ['href', 'target', 'rel', 'className'],
    img: ['src', 'alt', 'className', 'width', 'height'],
    td: ['colSpan', 'rowSpan', 'className'],
    th: ['colSpan', 'rowSpan', 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'tel'],
    // `arty-img` (P1.3) : référence vers une image générée stockée en
    // IndexedDB chiffré. Sûr — aucune ressource réseau, résolu localement en
    // blob: URL par le composant img (anti-BUG 11 : pas de base64 persisté).
    // SÉCURITÉ (audit 14 juin) : `data:` RETIRÉ — un `data:image/svg+xml,...`
    // peut porter du script exécuté dans la WebView Capacitor. Aucune feature
    // Arty ne pose de data: URI (les images passent par arty-img → blob:).
    src: ['http', 'https', 'arty-img'],
  },
  // Strip dangerous elements entirely
  strip: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
}

interface MarkdownRendererProps {
  content: string
}

// Extraction récursive du texte des nœuds React. Indispensable depuis la
// coloration syntaxique : rehype-highlight enveloppe les tokens dans des
// <span class="hljs-*"> → `children` n'est plus un tableau de strings, et
// `children.join('')` produirait "[object Object]…" dans le presse-papier.
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children)
  return ''
}

// Bloc de code avec header (langage + bouton copier) et coloration syntaxique
// via rehype-highlight — standard claude.ai/ChatGPT (plan d'action P0.1/P0.2).
function CodeBlock({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
  // useTranslation (pas i18n.t direct) : abonne le composant au changement de
  // langue — MarkdownRenderer est memo'é sur `content` et ne re-rendrait pas.
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1] ?? ''
  const handleCopy = async () => {
    try {
      const code = extractText(children).replace(/\n$/, '')
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard indisponible */ }
  }
  return (
    <div className="my-3 rounded-xl overflow-hidden shadow-sm bg-theme-ink">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-theme-bg/10">
        <span className="text-[10px] font-sans uppercase tracking-wider text-theme-bg/60">
          {lang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className={`px-2 py-1 rounded-md text-[10px] font-sans uppercase tracking-wider transition-all ${
            copied
              ? 'bg-theme-accent text-theme-bg'
              : 'text-theme-bg/70 hover:text-theme-bg hover:bg-theme-bg/10 focus-visible:bg-theme-bg/10'
          }`}
          aria-label={copied ? t('chat.bubble.codeCopied') : t('chat.bubble.copyCode')}
        >
          {copied ? `✓ ${t('chat.bubble.codeCopied')}` : t('chat.bubble.copyCode')}
        </button>
      </div>
      <pre className="text-theme-bg p-4 overflow-x-auto text-sm leading-relaxed">
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-display font-medium text-theme-ink mt-4 mb-2 pb-2 border-b-2 border-theme-accent/30">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-display font-medium text-theme-ink mt-4 mb-2 pb-1 border-b border-theme-border">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-display font-medium text-theme-accent mt-3 mb-1.5">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-theme-ink mt-2 mb-1 uppercase tracking-wider opacity-60">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed">{children}</p>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-theme-accent underline decoration-theme-accent/30 hover:decoration-theme-accent hover:bg-theme-accent/5 rounded px-0.5 transition-all">
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    // P1.3 — image générée stockée en IndexedDB : résolue en blob: URL.
    if (typeof src === 'string' && src.startsWith('arty-img://')) {
      return <GeneratedImage fileId={src.slice('arty-img://'.length)} alt={alt} />
    }
    // Remote Markdown images can be tracking pixels. Never fetch them merely
    // because model/third-party text was rendered; an explicit no-referrer link
    // lets the user open the resource in a separate tab if they choose.
    if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
      return <BlockedRemoteImage src={src} alt={alt} />
    }
    return <span role="note" className="text-xs text-theme-ink/60">{alt || 'Image'}</span>
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 pl-4 border-l-4 border-theme-accent bg-theme-accent/5 rounded-r-xl py-3 pr-4 italic text-theme-ink/80">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-4 border-0 h-px bg-gradient-to-r from-transparent via-theme-muted/40 to-transparent" />
  ),
  // Listes : le marqueur est rendu par CSS (index.css `.md-marker::before`) —
  // puce ● dans un <ul>, compteur "1." dans un <ol>. Avant, le ● était
  // hardcodé dans le renderer li → les listes numérotées de l'IA perdaient
  // leur numérotation (audit UX).
  ul: ({ children }) => (
    <ul className="my-2 space-y-1 md-list">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 space-y-1 md-list">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="flex gap-2 items-start">
      <span className="md-marker text-theme-accent mt-1 text-xs flex-shrink-0" aria-hidden />
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => (
    // text-inherit (pas text-theme-ink) pour que les **bold** dans un
    // contexte avec couleur inversée (ex : thead bg-theme-ink) restent
    // lisibles. Avec text-theme-ink hardcodé, **texte** dans un header
    // de tableau devenait texte clair sur fond clair = invisible.
    <strong className="font-semibold text-inherit">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-theme-accent not-italic font-medium">{children}</em>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-xl border border-theme-border shadow-sm">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-theme-ink text-theme-bg">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">{children}</th>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-theme-border">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-theme-accent/5 transition-colors">{children}</tr>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2.5">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    // Après rehype-highlight, la classe devient "hljs language-x" → un simple
    // startsWith('language-') raterait tous les blocs colorés. Les blocs SANS
    // langage (``` nu) n'ont aucune classe : on les détecte au saut de ligne
    // (un code inline n'en contient jamais) — fix du bug "bloc rendu en inline".
    const isBlock = /language-|hljs/.test(className ?? '') || extractText(children).includes('\n')
    if (isBlock) {
      return <CodeBlock className={className} {...props}>{children}</CodeBlock>
    }
    return (
      <code className="bg-theme-accent/10 text-theme-accent px-1.5 py-0.5 rounded-md text-sm font-medium" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => <>{children}</>,
  // HTML elements for rich reports
  div: ({ className, children, style, ...props }) => (
    <div className={className || ''} style={sanitizeReportStyle(style)} {...props}>{children}</div>
  ),
  span: ({ className, children, style, ...props }) => (
    <span className={className || ''} style={sanitizeReportStyle(style)} {...props}>{children}</span>
  ),
}

/**
 * Rich reports only need percentage widths for progress/severity bars. Drop
 * every other model-controlled CSS property, especially url() values that
 * could otherwise load a remote tracking resource without user interaction.
 */
function sanitizeReportStyle(style: React.CSSProperties | undefined): React.CSSProperties | undefined {
  const width = style?.width
  if (typeof width === 'string' && /^(?:100|[1-9]?\d)%$/.test(width)) {
    return { width }
  }
  return undefined
}

// CRIT-8 (audit étape 6) — memo'ed pour éviter le reparse markdown à chaque
// re-render de la liste pendant le streaming. Avant : à chaque token reçu, TOUS
// les anciens messages (qui ont un `content` stable) étaient reparsés
// (remark+rehype+sanitize). Combiné à CRIT-7 (1000 setState par stream),
// c'était O(n_messages × n_tokens) parses sur mobile.
export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="max-w-none text-sm text-theme-ink/90 leading-relaxed report-content">
      {/* Ordre des plugins IMPÉRATIF : highlight AVANT sanitize, pour que les
          <span class="hljs-*"> ajoutés soient validés par le schema (le
          wildcard '*': ['className'] les laisse passer). L'inverse poserait
          du contenu non vérifié après la sanitisation (BUG 20 : sanitize
          reste TOUJOURS actif, en dernier). */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, sanitizeSchema]]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
