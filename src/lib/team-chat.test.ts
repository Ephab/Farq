import { describe, expect, it } from "vitest"
import { insertMention, isNearBottom, mentionQuery, parsePoll, slashQuery } from "@/lib/team-chat"

describe("mentions", () => {
  it("finds the partial handle after a trailing @", () => {
    expect(mentionQuery("hey @sa")).toBe("sa")
    expect(mentionQuery("@")).toBe("")
    expect(mentionQuery("mail me at a@b.c")).toBeNull()
    expect(mentionQuery("hello")).toBeNull()
  })

  it("replaces the partial handle with the first name", () => {
    expect(insertMention("thanks @sa", "Sara Alharbi")).toBe("thanks @Sara ")
  })
})

describe("slash commands", () => {
  it("only matches a lone command token", () => {
    expect(slashQuery("/sp")).toBe("sp")
    expect(slashQuery("/")).toBe("")
    expect(slashQuery("/poll When?")).toBeNull()
    expect(slashQuery("hi /x")).toBeNull()
  })
})

describe("parsePoll", () => {
  it("splits question and options on pipes", () => {
    expect(parsePoll("/poll When do we meet? | Sun 8pm | Tue 8pm")).toEqual({ question: "When do we meet?", options: ["Sun 8pm", "Tue 8pm"] })
  })

  it("needs a question and two options", () => {
    expect(parsePoll("/poll Only | one")).toBeNull()
    expect(parsePoll("hello")).toBeNull()
  })
})

describe("isNearBottom", () => {
  it("treats the last few lines as the bottom", () => {
    expect(isNearBottom(920, 1500, 500)).toBe(true)
    expect(isNearBottom(1000, 1500, 500)).toBe(true)
    expect(isNearBottom(600, 1500, 500)).toBe(false)
    expect(isNearBottom(0, 400, 500)).toBe(true)
  })
})
