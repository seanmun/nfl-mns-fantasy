import type { ReactNode } from 'react'

// Small markdown renderer for admin-authored text — the manager's note,
// the pool's own rules, announcement bodies.
//
// It builds REACT ELEMENTS, never an HTML string, so there is no
// dangerouslySetInnerHTML anywhere and therefore no injection surface at
// all. That is the whole reason this exists instead of a library: the one
// place this app holds text written by one user and shown to others is
// not a good place to be clever.
//
// Supported, deliberately: paragraphs, ## headings, - bullets, **bold**,
// *italic*, and blank-line breaks. Anything else renders as plain text.

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // Split on **bold** and *italic*, keeping the delimiters as captures.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)

  parts.forEach((part, i) => {
    if (!part) return
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>)
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>)
    } else {
      out.push(part)
    }
  })
  return out
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const text = paragraph.join(' ')
    blocks.push(
      <p key={`p${blocks.length}`} className="mb-4 last:mb-0">
        {inline(text, `p${blocks.length}`)}
      </p>
    )
    paragraph = []
  }

  const flushBullets = () => {
    if (!bullets.length) return
    const items = bullets
    blocks.push(
      <ul key={`u${blocks.length}`} className="mb-4 last:mb-0 flex flex-col gap-2 pl-5 list-disc">
        {items.map((b, i) => (
          <li key={i}>{inline(b, `u${blocks.length}-${i}`)}</li>
        ))}
      </ul>
    )
    bullets = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.trim() === '') {
      flushParagraph()
      flushBullets()
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushBullets()
      blocks.push(
        <h3
          key={`h${blocks.length}`}
          className="text-[1.15rem] font-bold mt-6 first:mt-0 mb-2 text-[var(--color-foreground)]"
        >
          {inline(heading[2], `h${blocks.length}`)}
        </h3>
      )
      continue
    }

    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      bullets.push(bullet[1])
      continue
    }

    flushBullets()
    paragraph.push(line.trim())
  }

  flushParagraph()
  flushBullets()

  return <div className={className}>{blocks}</div>
}
