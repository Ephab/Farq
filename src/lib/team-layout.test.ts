import { describe, expect, it } from "vitest"
import { DOCK_DEFAULT, DOCK_MIN, clampDockWidth } from "@/lib/team-layout"

describe("clampDockWidth", () => {
  it("keeps a requested width that fits", () => {
    expect(clampDockWidth(500, 1400)).toBe(500)
  })

  it("never goes below the minimum chat width", () => {
    expect(clampDockWidth(100, 1400)).toBe(DOCK_MIN)
    expect(clampDockWidth(500, 800)).toBe(DOCK_MIN)
  })

  it("always leaves room for the rail and a usable board", () => {
    expect(clampDockWidth(2000, 1400)).toBe(1400 - 220 - 28 - 360)
  })

  it("has a sensible default", () => {
    expect(clampDockWidth(DOCK_DEFAULT, 1400)).toBe(360)
  })
})
