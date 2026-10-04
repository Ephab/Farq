import { describe, expect, it } from "vitest"
import { avatarColor, avatarLetter, coverFor, initials } from "@/lib/team-cover"

describe("coverFor", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(coverFor("f41c0n5eed01")).toEqual(coverFor("f41c0n5eed01"))
    expect(coverFor("f41c0n5eed01").image).not.toBe(coverFor("another-seed").image)
    expect(coverFor("").image).toContain("radial-gradient")
    // Theme colours, never fixed hues: every cover stays inside the active theme.
    expect(coverFor("x").color).toBe("var(--fq-accent)")
    expect(coverFor("x").image).not.toMatch(/hsl\(/)
  })
})

describe("avatars", () => {
  it("use the sidebar's neutral colour for everyone", () => {
    expect(avatarColor("demo-sara")).toBe("var(--muted)")
    expect(avatarColor("someone-else")).toBe(avatarColor("demo-sara"))
  })
  it("show a single upper-case letter like the sidebar", () => {
    expect(avatarLetter("sara alharbi")).toBe("S")
    expect(avatarLetter("  noura")).toBe("N")
    expect(avatarLetter("سارة")).toBe("س")
    expect(avatarLetter("   ")).toBe("?")
  })
})

describe("initials", () => {
  it("uses first and last word", () => {
    expect(initials("Sara Alharbi")).toBe("SA")
    expect(initials("noura")).toBe("N")
    expect(initials("   ")).toBe("?")
  })

  it("initials handles Arabic names", () => {
    expect(initials("سارة الحربي")).toBe("سا")
  })
})
