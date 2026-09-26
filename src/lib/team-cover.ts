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

export function coverFor(seed: string): Cover {
  const h = hash(seed || "farq")
  const base = h % 360
  const second = (base + 40 + ((h >>> 9) % 70)) % 360
  const third = (base + 160 + ((h >>> 17) % 80)) % 360
  const accents: [string, string, string] = [`hsl(${base} 68% 48%)`, `hsl(${second} 78% 62%)`, `hsl(${third} 72% 56%)`]
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

export function avatarColor(userId: string): string {
  return `hsl(${hash(userId || "?") % 360} 55% 45%)`
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = [...words[0]][0]
  if (words.length === 1) return first.toUpperCase()
  return `${first}${[...words[words.length - 1]][0]}`.toUpperCase()
}
