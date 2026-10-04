/** Small display helpers for the shared Group Projects section. */

/** A long ID shown briefly: first and last four characters. The full ID is what Copy puts on the clipboard. */
export function shortId(id: string): string {
  const clean = id.trim()
  return clean.length <= 12 ? clean : `${clean.slice(0, 4)}…${clean.slice(-4)}`
}

/** What people type or paste is normalised before it is sent: trimmed, internal whitespace removed, upper case. */
export function cleanCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase()
}

/** Invitation codes are shown in groups of four so they can be read aloud or retyped: 5H3P-3WDZ-DPVX-N4R6. */
export function groupCode(code: string): string {
  const compact = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  return compact.match(/.{1,4}/g)?.join("-") ?? code
}

/** A code is worth sending to the server once it could plausibly be one (the server is the authority). */
export function looksLikeCode(raw: string): boolean {
  return cleanCode(raw).replace(/-/g, "").length >= 8
}

export type StartMode = "project" | "class" | "join"

/** The smallest input that makes the start button usable for each mode. */
export function readyToStart(mode: StartMode, value: string): boolean {
  return mode === "join" ? looksLikeCode(value) : value.trim().length >= 2
}
