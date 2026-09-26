/** Hermes slash commands. Shown now, answered from Plan 2 onwards. */
export const HERMES_COMMANDS = [
  { cmd: "/split", hint: "Split the remaining work fairly" },
  { cmd: "/catchup", hint: "Summarise what you missed" },
  { cmd: "/describe", hint: "Write a task description" },
  { cmd: "/draft", hint: "Draft an SRS, SDS or SPMP section" },
  { cmd: "/standup", hint: "Run an async stand-up" },
  { cmd: "/risks", hint: "Flag deadline risks" },
] as const

/** The partial handle after a trailing "@", or null when not mentioning. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft)
  return match ? match[1] : null
}

export function insertMention(draft: string, name: string): string {
  const handle = name.trim().split(/\s+/)[0] || name
  return draft.replace(/@([^\s@]*)$/, `@${handle} `)
}

/** The partial command while the draft is a single "/word", else null. */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft)
  return match ? match[1] : null
}

export function parsePoll(text: string): { question: string; options: string[] } | null {
  const match = /^\/poll\s+(.+)$/s.exec(text.trim())
  if (!match) return null
  const parts = match[1].split("|").map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return null
  return { question: parts[0], options: parts.slice(1, 9) }
}
