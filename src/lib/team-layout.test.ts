import { describe, expect, it } from "vitest"
import { DOCK_DEFAULT, DOCK_MIN, RAIL_MAX, RAIL_MIN, clampDockWidth, clampRailWidth, clampWorkspaceChatWidth } from "@/lib/team-layout"

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

  it("accounts for a widened rail", () => {
    expect(clampDockWidth(2000, 1400, 300)).toBe(1400 - 300 - 28 - 360)
  })
})

describe("clampRailWidth", () => {
  it("keeps a requested width that fits", () => {
    expect(clampRailWidth(280, 1600, 360)).toBe(280)
  })

  it("stays between the rail limits", () => {
    expect(clampRailWidth(50, 1600, 360)).toBe(RAIL_MIN)
    expect(clampRailWidth(900, 2400, 360)).toBe(RAIL_MAX)
  })

  it("never squeezes the board below its minimum", () => {
    expect(clampRailWidth(400, 1100, 360)).toBe(1100 - 360 - 28 - 360)
  })
})

describe("workspace chat sizing", () => {
  it("uses the full width available after removing the old navigation rail", () => {
    expect(clampWorkspaceChatWidth(2000, 1200)).toBe(820)
    expect(clampWorkspaceChatWidth(500, 1200)).toBe(500)
  })
  it("protects the chat minimum and tolerates narrow containers or invalid saved widths", () => {
    expect(clampWorkspaceChatWidth(50, 1200)).toBe(DOCK_MIN)
    expect(clampWorkspaceChatWidth(500, 500)).toBe(DOCK_MIN)
    expect(clampWorkspaceChatWidth(Number.NaN, 1200)).toBe(DOCK_DEFAULT)
  })
})
