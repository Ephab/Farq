import type { TeamsHomeData } from "@/lib/teams-api"

const DAY = 86_400_000

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

export function dueLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  // Whole local calendar days, so "6 pm today" is due today, not tomorrow.
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(new Date(time)) - startOfDay(now)) / DAY)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return "due today"
  if (days === 1) return "due tomorrow"
  return `due in ${days} days`
}

export function shortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

/** ISO instant → the local calendar date an `<input type="date">` shows. */
export function toDateInput(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A picked calendar date means "by the end of that day" in the student's time zone. */
export function fromDateInput(value: string): string | null {
  if (!value) return null
  const date = new Date(`${value}T23:59:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Deterministic one-liners for the front-page strip (no model involved). */
export function briefingLines(home: TeamsHomeData): string[] {
  if (home.user.role === "instructor") {
    if (home.teams.length === 0) return ["No teams have formed in your courses yet."]
    const courses = new Set(home.teams.map((team) => team.course.id)).size
    const summary = `${plural(home.teams.length, "team")} across ${plural(courses, "course")}. Team chats stay private to students.`
    return [summary, ...home.teams.filter((team) => team.risk).map((team) => `${team.name}: ${team.risk}`)]
  }
  const lines: string[] = []
  for (const team of home.teams) {
    if (team.unread) lines.push(`${plural(team.unread, "new message")} in ${team.name}`)
  }
  for (const team of home.teams) {
    if (team.risk) lines.push(`${team.name}: ${team.risk}`)
  }
  const next = home.teams.find((team) => team.next_task)
  if (next?.next_task) lines.push(`Next for you: ${next.next_task.title} (${next.name})`)
  if (home.invites.length) lines.push(`${plural(home.invites.length, "invite")} waiting`)
  for (const item of home.needs_team) lines.push(`${item.course.code} ${item.title} still needs a team`)
  return lines.length ? lines : ["You're all caught up."]
}

/** Suggest a free number for a section added after `after`: 1.2 → 1.3, 3 → 4 (skipping taken keys);
 * a key that doesn't end in a number gets a ".1" child. */
export function nextSectionKey(after: string | undefined, taken: string[]): string {
  const used = new Set(taken)
  if (!after) {
    let top = 1
    while (used.has(String(top))) top += 1
    return String(top)
  }
  const match = after.match(/^(.*?)(\d+)$/)
  let candidate = match ? `${match[1]}${Number(match[2]) + 1}` : `${after}.1`
  while (used.has(candidate)) {
    const again = candidate.match(/^(.*?)(\d+)$/)
    candidate = again ? `${again[1]}${Number(again[2]) + 1}` : `${candidate}.1`
  }
  return candidate
}
