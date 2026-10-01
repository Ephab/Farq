"use client"

import { Fragment, type ReactNode } from "react"

/** Inline `code`, **bold**, *italic* and [links](https://…). Everything is rendered as React
 *  text nodes, so model output can never inject markup and "&" in a URL stays a real "&". */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let n = 0
  const push = (node: ReactNode) => { parts.push(node); n += 1 }
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) push(<Fragment key={`${keyPrefix}-t${n}`}>{text.slice(last, match.index)}</Fragment>)
    const token = match[0]
    const key = `${keyPrefix}-i${n}`
    if (token.startsWith("`")) {
      push(<code key={key} dir="ltr" className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{token.slice(1, -1)}</code>)
    } else if (token.startsWith("**")) {
      push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("*")) {
      push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const label = token.slice(1, token.indexOf("]"))
      const href = token.slice(token.indexOf("](") + 2, -1)
      push(<a key={key} href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{label}</a>)
    }
    last = match.index + token.length
  }
  if (last < text.length) push(<Fragment key={`${keyPrefix}-t${n}`}>{text.slice(last)}</Fragment>)
  return parts
}

/** Minimal markdown for Hermes answers: headings, bullets, numbered lists, paragraphs. */
export function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const { ordered, items } = list
    list = null
    blocks.push(
      ordered
        ? <ol key={`b${blocks.length}`} className="list-decimal space-y-1 ps-5">{items.map((item, i) => <li key={i} dir="auto">{inline(item, `b${blocks.length}o${i}`)}</li>)}</ol>
        : <ul key={`b${blocks.length}`} className="list-disc space-y-1 ps-5">{items.map((item, i) => <li key={i} dir="auto">{inline(item, `b${blocks.length}u${i}`)}</li>)}</ul>,
    )
  }
  lines.forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const heading = line.match(/^\s*#{1,4}\s+(.+)$/)
    if (bullet) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] } }
      list.items.push(bullet[1])
    } else if (numbered) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] } }
      list.items.push(numbered[1])
    } else {
      flush()
      if (line.trim()) {
        blocks.push(heading
          ? <p key={`b${blocks.length}`} dir="auto" className="font-semibold">{inline(heading[1], `b${blocks.length}h`)}</p>
          : <p key={`b${blocks.length}`} dir="auto">{inline(line.trim(), `b${blocks.length}p`)}</p>)
      }
    }
  })
  flush()
  return <div className="space-y-2">{blocks}</div>
}
