"use client"

import { Fragment, type ReactNode } from "react"
import { CodeBlock } from "@/components/hermes/elements/parts/CodeBlock"

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

/** A row of a pipe table: `| a | b |` -> ["a", "b"]. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell) => cell.trim())
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** Minimal markdown for prose: headings, bullets, numbered lists, paragraphs, pipe tables. */
function ProseBlocks({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const lines = text.split("\n")
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const { ordered, items } = list
    list = null
    blocks.push(
      ordered
        ? <ol key={`${keyPrefix}b${blocks.length}`} className="list-decimal space-y-1 ps-5">{items.map((item, i) => <li key={i} dir="auto">{inline(item, `${keyPrefix}b${blocks.length}o${i}`)}</li>)}</ol>
        : <ul key={`${keyPrefix}b${blocks.length}`} className="list-disc space-y-1 ps-5">{items.map((item, i) => <li key={i} dir="auto">{inline(item, `${keyPrefix}b${blocks.length}u${i}`)}</li>)}</ul>,
    )
  }
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    // Pipe table: a header row, a separator row, then 1+ data rows.
    if (/^\s*\|.*\|\s*$/.test(line) && idx + 1 < lines.length && TABLE_SEPARATOR.test(lines[idx + 1])) {
      flush()
      const header = splitTableRow(line)
      let cursor = idx + 2
      const rows: string[][] = []
      while (cursor < lines.length && /^\s*\|.*\|\s*$/.test(lines[cursor])) {
        rows.push(splitTableRow(lines[cursor]))
        cursor += 1
      }
      const key = `${keyPrefix}b${blocks.length}`
      blocks.push(
        <div key={key} className="md-table-scroll">
          <table>
            <thead><tr>{header.map((cell, i) => <th key={i} dir="auto">{inline(cell, `${key}h${i}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c} dir="auto">{inline(cell, `${key}r${r}c${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      idx = cursor - 1
      continue
    }
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
          ? <p key={`${keyPrefix}b${blocks.length}`} dir="auto" className="font-semibold">{inline(heading[1], `${keyPrefix}b${blocks.length}h`)}</p>
          : <p key={`${keyPrefix}b${blocks.length}`} dir="auto">{inline(line.trim(), `${keyPrefix}b${blocks.length}p`)}</p>)
      }
    }
  }
  flush()
  return <>{blocks}</>
}

/** Splits text on fenced ```code``` blocks so they render through the shared, copyable
 *  CodeBlock instead of being flattened into paragraphs line by line (the bug this fixes:
 *  a raw ```json quiz reply used to render as plain text, one line per paragraph). */
export function MarkdownText({ text }: { text: string }) {
  // A fresh regex per call: a module-level `/g` regex would carry `lastIndex` state across
  // renders/instances, which is exactly the kind of shared mutable state that bites later.
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let n = 0
  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) {
      const prose = text.slice(last, match.index)
      if (prose.trim()) parts.push(<ProseBlocks key={`p${n}`} text={prose} keyPrefix={`p${n}`} />)
    }
    const lang = match[1].trim()
    const code = match[2].replace(/\n$/, "")
    parts.push(<CodeBlock key={`c${n}`} code={code} language={lang || undefined} />)
    last = match.index + match[0].length
    n += 1
  }
  if (last < text.length) {
    const prose = text.slice(last)
    if (prose.trim()) parts.push(<ProseBlocks key={`p${n}`} text={prose} keyPrefix={`p${n}`} />)
  }
  if (parts.length === 0) return null
  return <div className="space-y-2">{parts}</div>
}
