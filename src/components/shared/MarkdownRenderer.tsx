import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Components } from 'react-markdown'
import { isValidElement } from 'react'

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
    '*': ['className', 'class', 'style'],
    button: ['className', 'class', 'data*'],
    div: ['className', 'class', 'style', 'data*'],
    span: ['className', 'class', 'style'],
    a: ['href', 'target', 'rel', 'className'],
    img: ['src', 'alt', 'className', 'width', 'height'],
    td: ['colSpan', 'rowSpan', 'className'],
    th: ['colSpan', 'rowSpan', 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'tel'],
    src: ['http', 'https', 'data'],
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
  img: ({ src, alt }) => (
    <img src={src} alt={alt || 'Image'}
      className="w-full rounded-xl border border-theme-border my-3 shadow-sm" />
  ),
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
  div: ({ className, children, ...props }) => (
    <div className={className || ''} {...props}>{children}</div>
  ),
  span: ({ className, children, style, ...props }) => (
    <span className={className || ''} style={style} {...props}>{children}</span>
  ),
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
