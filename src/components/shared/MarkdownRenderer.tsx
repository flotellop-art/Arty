import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-serif font-bold text-bubble-user mt-4 mb-2 pb-2 border-b border-accent/20">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-serif font-semibold text-bubble-user mt-4 mb-2 pb-1 border-b border-gray-100">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-serif font-semibold text-accent mt-3 mb-1.5">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-bubble-user mt-2 mb-1 uppercase tracking-wide">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed">{children}</p>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/30 hover:decoration-accent transition-colors">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || 'Image'}
      className="w-full rounded-xl border border-gray-200 my-3 shadow-sm"
    />
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 pl-4 border-l-4 border-accent/40 bg-accent/5 rounded-r-xl py-2 pr-3 italic text-bubble-user/80">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-4 border-0 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
  ),
  ul: ({ children }) => (
    <ul className="my-2 ml-1 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-1 space-y-1 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="flex gap-2 items-start">
      <span className="text-accent mt-1.5 text-xs">●</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-bubble-user">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-accent/80 not-italic font-medium">{children}</em>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-xl border border-gray-200 shadow-sm">
      <table className="min-w-full text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-bubble-user text-cream">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wider">
      {children}
    </th>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-gray-100">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-accent/5 transition-colors">{children}</tr>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2.5">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <pre className="bg-bubble-user text-cream rounded-xl p-4 overflow-x-auto my-3 text-sm leading-relaxed shadow-sm">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      )
    }
    return (
      <code className="bg-accent/10 text-accent px-1.5 py-0.5 rounded-md text-sm font-medium" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => <>{children}</>,
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="max-w-none text-sm text-bubble-user/90 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
