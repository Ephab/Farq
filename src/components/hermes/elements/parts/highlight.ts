import hljs from "highlight.js/lib/common"

/** A few spellings people/models use that don't match highlight.js's own registered name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  jsx: "javascript",
  tsx: "typescript",
  "c++": "cpp",
  "c#": "csharp",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  yml: "yaml",
  md: "markdown",
  rb: "ruby",
  kt: "kotlin",
  rs: "rust",
  golang: "go",
  "objective-c": "objectivec",
  html: "xml",
}

export interface HighlightResult {
  /** Highlighted markup — highlight.js escapes all text itself, safe for dangerouslySetInnerHTML. */
  html: string
  /** The language actually used (resolved alias, or auto-detected). "plaintext" when unknown. */
  language: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch
  ))
}

/** Highlights `code` for display. Uses the given `language` when highlight.js recognizes it
 *  (covers the "common" bundle: bash, c, cpp, csharp, css, go, java, javascript, json, kotlin,
 *  markdown, php, python, ruby, rust, shell, sql, swift, typescript, xml/html, yaml, and more),
 *  otherwise auto-detects. Never throws: a lexer error falls back to plain escaped text. */
export function highlightCode(code: string, language?: string): HighlightResult {
  const requested = language?.trim().toLowerCase()
  const resolved = requested ? (LANGUAGE_ALIASES[requested] ?? requested) : undefined
  try {
    if (resolved && hljs.getLanguage(resolved)) {
      const result = hljs.highlight(code, { language: resolved, ignoreIllegals: true })
      return { html: result.value, language: resolved }
    }
    const auto = hljs.highlightAuto(code)
    return { html: auto.value, language: auto.language ?? "plaintext" }
  } catch {
    return { html: escapeHtml(code), language: "plaintext" }
  }
}
