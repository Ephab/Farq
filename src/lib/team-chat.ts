/** Hermes slash commands. The command text is sent as-is; `hint` is a key under teams.chat.commandHints. */
export const HERMES_COMMANDS = [
  { cmd: "/split", hint: "split" },
  { cmd: "/catchup", hint: "catchup" },
  { cmd: "/describe", hint: "describe" },
  { cmd: "/draft", hint: "draft" },
  { cmd: "/standup", hint: "standup" },
  { cmd: "/risks", hint: "risks" },
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

/** True when a scroll box is within `threshold` px of its end (or doesn't scroll at all). */
export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 80): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

const GROUP_GAP_MS = 5 * 60 * 1000
const GROUPABLE = new Set(["text", "poll"])

/** Consecutive chat messages from the same author within 5 minutes join one block. */
export function continuesGroup(
  previous: { kind: string; author_user_id: string | null; created_at: string; visible_to_user_id?: string | null } | undefined,
  message: { kind: string; author_user_id: string | null; created_at: string; visible_to_user_id?: string | null } | undefined,
): boolean {
  if (!previous || !message || !GROUPABLE.has(previous.kind) || !GROUPABLE.has(message.kind)) return false
  if (previous.author_user_id !== message.author_user_id || Boolean(previous.visible_to_user_id) !== Boolean(message.visible_to_user_id)) return false
  const gap = new Date(message.created_at).getTime() - new Date(previous.created_at).getTime()
  return gap >= 0 && gap <= GROUP_GAP_MS
}

export type RichSegment = { kind: "text" | "mention" | "command"; text: string }

/** Split a message into plain text, @mentions of known handles, and a leading /command. */
export function richSegments(text: string, handles: string[]): RichSegment[] {
  const segments: RichSegment[] = []
  let rest = text
  const command = /^\/[a-z]+/i.exec(rest)
  if (command) {
    segments.push({ kind: "command", text: command[0] })
    rest = rest.slice(command[0].length)
  }
  const known = new Set(handles.map((handle) => handle.toLowerCase()))
  let last = 0
  for (const match of rest.matchAll(/(^|\s)@([^\s@.,!?;:]+)/g)) {
    const handle = match[2]
    if (!known.has(handle.toLowerCase())) continue
    const start = (match.index ?? 0) + match[1].length
    if (start > last) segments.push({ kind: "text", text: rest.slice(last, start) })
    segments.push({ kind: "mention", text: `@${handle}` })
    last = start + handle.length + 1
  }
  if (last < rest.length) segments.push({ kind: "text", text: rest.slice(last) })
  return segments
}
