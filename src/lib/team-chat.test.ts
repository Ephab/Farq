import { describe, expect, it } from "vitest"
import { continuesGroup, insertMention, isNearBottom, mentionQuery, parsePoll, richSegments, slashQuery } from "@/lib/team-chat"

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

describe("continuesGroup", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 20, 10, minutes)).toISOString()
  const msg = (author: string | null, minutes: number, kind = "text") => ({ kind, author_user_id: author, created_at: at(minutes), visible_to_user_id: null })
  it("joins the same author's messages within five minutes", () => {
    expect(continuesGroup(msg("a", 0), msg("a", 4))).toBe(true)
    expect(continuesGroup(msg("a", 0), msg("a", 4, "poll"))).toBe(true)
  })
  it("breaks on another author, a long gap, the first message or system cards", () => {
    expect(continuesGroup(msg("a", 0), msg("b", 1))).toBe(false)
    expect(continuesGroup(msg("a", 0), msg("a", 6))).toBe(false)
    expect(continuesGroup(undefined, msg("a", 0))).toBe(false)
    expect(continuesGroup(msg("a", 0), undefined)).toBe(false)
    expect(continuesGroup(msg(null, 0, "proposal"), msg(null, 1))).toBe(false)
  })
})

describe("richSegments", () => {
  it("marks a leading command and known mentions only", () => {
    expect(richSegments("/standup please @Hermes and @nobody, thanks @Sara!", ["Hermes", "Sara"])).toEqual([
      { kind: "command", text: "/standup" },
      { kind: "text", text: " please " },
      { kind: "mention", text: "@Hermes" },
      { kind: "text", text: " and @nobody, thanks " },
      { kind: "mention", text: "@Sara" },
      { kind: "text", text: "!" },
    ])
  })
  it("leaves plain text and emails alone", () => {
    expect(richSegments("mail me at a@b.com", ["b"])).toEqual([{ kind: "text", text: "mail me at a@b.com" }])
  })
})
