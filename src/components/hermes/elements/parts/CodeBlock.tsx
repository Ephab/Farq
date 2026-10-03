"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { useI18n } from "@/lib/i18n/context"
import { highlightCode } from "@/components/hermes/elements/parts/highlight"

/** Syntax-highlighted, copyable code block (highlight.js, common language set, with
 *  auto-detect when no language is given). Shared by the `code` chat element and by
 *  fenced ```code``` blocks inside MarkdownText, so a raw JSON/code reply never renders
 *  as line-by-line paragraphs. Token colors are theme-aware (see --fq-code-* / .hljs-*
 *  in coach-concept.css), so they stay legible in every light and dark theme. */
export function CodeBlock({ code, language, caption }: { code: string; language?: string; caption?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const { html, language: detected } = useMemo(() => highlightCode(code, language), [code, language])
  const label = language || (detected !== "plaintext" ? detected : t("coach.elements.code.plain"))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: no-op, the text stays selectable.
    }
  }
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{label}</span>
        <button type="button" className="code-block-copy" onClick={() => void copy()} aria-label={t("coach.thread.copyOutput")}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t("coach.thread.copied") : t("coach.elements.code.copy")}
        </button>
      </div>
      <pre dir="ltr">
        {/* highlight.js escapes all code text itself before wrapping it in token <span>s —
           what's injected here is never raw, unescaped model output. */}
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {caption ? <p className="code-block-caption" dir="auto">{caption}</p> : null}
    </div>
  )
}
