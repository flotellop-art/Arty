import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Components } from 'react-markdown'
import type { MouseEvent, ReactNode } from 'react'
import { isValidElement } from 'react'
import { Capacitor } from '@capacitor/core'
import { isAllowedReportAction } from '../../services/reportActions'

// Model/public Markdown never grants access to private local file IDs.
function UnavailableImage() {
  const { t } = useTranslation()
  return <span role="note" className="block my-2 text-xs text-theme-muted">{t('image.galleryUnavailable')}</span>
}

function BlockedRemoteImage({ src, alt }: { src: string; alt?: string }) {
  const { t } = useTranslation()
  return (
    <span role="note" className="block my-3 rounded-xl border border-theme-border bg-theme-surface px-4 py-3 text-xs">
      <span className="block text-theme-ink/70">
        {t('chat.bubble.remoteImageBlocked')}{alt ? ` — ${alt}` : ''}
      </span>
      <MarkdownLink
        href={src}
        className="mt-1 inline-block text-theme-accent underline"
      >
        {t('chat.bubble.openRemoteImage')}
      </MarkdownLink>
    </span>
  )
}

function MarkdownLink({
  href,
  children,
  className = 'text-theme-accent underline decoration-theme-accent/30 hover:decoration-theme-accent hover:bg-theme-accent/5 rounded px-0.5 transition-all',
}: {
  href?: string
  children: ReactNode
  className?: string
}) {
  const openNative = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!href || !Capacitor.isNativePlatform()) return
    try {
      const parsed = new URL(href)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
      event.preventDefault()
      void import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url: parsed.toString() }))
        .catch((err) => console.warn('[MarkdownRenderer] external link failed', err))
    } catch {
      event.preventDefault()
    }
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={className}
      onClick={openNative}
    >
      {children}
    </a>
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
      'dataTrailId', // view_trail — UUID opaque résolu dans IndexedDB
      'dataRouteId', // ancien message : conservé uniquement pour afficher l'aide de migration
    ],
    div: [
      'className', 'class', 'style',
      'dataAction', 'dataTo', 'dataSubject', 'dataBody', 'dataText', 'dataValue',
      'dataName', 'dataContent', 'dataTitle', 'dataStart', 'dataEnd',
      'dataLocation', 'dataStatus', 'dataPhone', 'dataUrl', 'dataQuery', 'dataSummary',
      'dataTrailId', // view_trail — UUID opaque résolu dans IndexedDB
      'dataRouteId', // ancien message : jamais résolu en relation réseau
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
    // No data:, blob: or private file URI supplied by model/third-party text.
    src: ['http', 'https'],
  },
  // Strip dangerous elements entirely
  strip: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
}

interface MarkdownRendererProps {
  content: string
  historical?: boolean
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
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  button: ({ children, ...props }) => {
    const action = (props as Record<string, unknown>)['data-action']
    // Les conversations antérieures peuvent encore contenir des boutons
    // d'intégrations supprimées. On conserve leur libellé comme texte, mais
    // on ne rend jamais une action inconnue cliquable.
    if (typeof action !== 'string' || !isAllowedReportAction(action)) {
      return <span>{children}</span>
    }
    return <button {...props}>{children}</button>
  },
  img: ({ src, alt }) => {
    // Remote Markdown images can be tracking pixels. Never fetch them merely
    // because model/third-party text was rendered; an explicit no-referrer link
    // lets the user open the resource in a separate tab if they choose.
    if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
      return <BlockedRemoteImage src={src} alt={alt} />
    }
    return <UnavailableImage />
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
const historicalSchema = {
  ...sanitizeSchema,
  attributes: { ...sanitizeSchema.attributes,
    button: ['className', 'class'], div: ['className', 'class'], span: ['className', 'class'],
  },
}
const historicalComponents: Components = {
  ...components,
  // Original content remains byte-for-byte available to copying/export. These
  // old links may target private IDs on THIS account, so none grant navigation.
  a: ({ children }) => <span>{children}</span>,
  button: ({ children }) => <span>{children}</span>,
  img: () => <UnavailableImage />,
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, historical = false }: MarkdownRendererProps) {
  return (
    <div className="max-w-none text-sm text-theme-ink/90 leading-relaxed report-content">
      {/* Ordre des plugins IMPÉRATIF : highlight AVANT sanitize, pour que les
          <span class="hljs-*"> ajoutés soient validés par le schema (le
          wildcard '*': ['className'] les laisse passer). L'inverse poserait
          du contenu non vérifié après la sanitisation (BUG 20 : sanitize
          reste TOUJOURS actif, en dernier). */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, historical ? historicalSchema : sanitizeSchema]]} components={historical ? historicalComponents : components}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
