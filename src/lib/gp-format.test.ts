import { describe, expect, it } from "vitest"
import { cleanCode, groupCode, looksLikeCode, readyToStart, shortId } from "./gp-format"

describe("shortId", () => {
  it("shortens a long ID to its ends and leaves short ones alone", () => {
    expect(shortId("2748029e-bd10-4c80-aaa6-4603e8a02a42")).toBe("2748…2a42")
    expect(shortId("abc123")).toBe("abc123")
    expect(shortId("  2748029e-bd10-4c80-aaa6-4603e8a02a42 ")).toBe("2748…2a42")
  })
})

describe("invitation codes", () => {
  it("normalises pasted codes", () => {
    expect(cleanCode(" 5h3p-3wdz \n dpvx-n4r6 ")).toBe("5H3P-3WDZDPVX-N4R6")
  })
  it("groups in fours for reading", () => {
    expect(groupCode("5H3P3WDZDPVXN4R6")).toBe("5H3P-3WDZ-DPVX-N4R6")
    expect(groupCode("5h3p-3wdz-dpvx-n4r6")).toBe("5H3P-3WDZ-DPVX-N4R6")
  })
  it("only treats plausible codes as ready to send", () => {
    expect(looksLikeCode("5H3P-3WDZ-DPVX-N4R6")).toBe(true)
    expect(looksLikeCode("hello")).toBe(false)
    expect(looksLikeCode("   ")).toBe(false)
  })
})

describe("readyToStart", () => {
  it("needs a real name for projects and classes", () => {
    expect(readyToStart("project", "A")).toBe(false)
    expect(readyToStart("project", " Capstone ")).toBe(true)
    expect(readyToStart("class", "")).toBe(false)
    expect(readyToStart("class", "SWE 363")).toBe(true)
  })
  it("needs a plausible code to join", () => {
    expect(readyToStart("join", "abc")).toBe(false)
    expect(readyToStart("join", "5H3P-3WDZ-DPVX-N4R6")).toBe(true)
  })
})
