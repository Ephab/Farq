/** FNV-1a: tiny, stable string hash so every member sees the same cover. */
function hash(seed: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export interface Cover { image: string; color: string; accents: [string, string, string] }

/** Covers are built from the active theme's accent (CSS variables, resolved where they are drawn), so they follow the
 * theme and its dark mode. The seed only varies where the soft highlights sit, so each project looks a little different. */
export function coverFor(seed: string): Cover {
  const h = hash(seed || "waypoint")
  const accents: [string, string, string] = [
    "var(--fq-accent)",
    "color-mix(in srgb, var(--fq-accent) 62%, var(--fq-surface-solid))",
    "color-mix(in srgb, var(--fq-accent) 36%, var(--fq-surface-solid))",
  ]
  const x1 = 8 + ((h >>> 3) % 30)
  const y1 = 10 + ((h >>> 7) % 40)
  const x2 = 62 + ((h >>> 11) % 30)
  const y2 = 50 + ((h >>> 13) % 40)
  return {
    image: `radial-gradient(circle at ${x1}% ${y1}%, ${accents[1]}, transparent 60%), radial-gradient(circle at ${x2}% ${y2}%, ${accents[2]}, transparent 55%)`,
    color: accents[0],
    accents,
  }
}

/** Same neutral circle as the account avatar in the sidebar, for everyone, in every theme. */
export function avatarColor(_userId: string): string {
  return "var(--muted)"
}

/** The single letter shown in an avatar, as in the sidebar. */
export function avatarLetter(name: string): string {
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : "?"
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = [...words[0]][0]
  if (words.length === 1) return first.toUpperCase()
  return `${first}${[...words[words.length - 1]][0]}`.toUpperCase()
}
