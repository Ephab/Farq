import { describe, expect, it } from "vitest"
import { avatarColor, coverFor, initials } from "@/lib/team-cover"

describe("coverFor", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(coverFor("f41c0n5eed01")).toEqual(coverFor("f41c0n5eed01"))
    expect(coverFor("f41c0n5eed01").image).not.toBe(coverFor("another-seed").image)
    expect(coverFor("").image).toContain("radial-gradient")
    expect(coverFor("x").color).toMatch(/^hsl\(/)
  })
})

describe("avatarColor", () => {
  it("is stable for a user", () => {
    expect(avatarColor("demo-sara")).toBe(avatarColor("demo-sara"))
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
