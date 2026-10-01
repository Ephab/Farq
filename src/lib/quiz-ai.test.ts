import { describe, expect, it } from "vitest"
import { normalizeTrueFalse, resolveMcqAnswer, sanitizeQuestions } from "./quiz-ai"
import { combineDeckTexts, type SlideDeck } from "./quiz-store"
import { formatErrorDetail } from "./waypoint-api"

describe("quiz answer normalization", () => {
  const options = ["Gradient descent", "Dropout", "Batch norm", "Early stopping"]

  it("resolves letters, numbers and case variants to the real option", () => {
    expect(resolveMcqAnswer("B", options)).toBe("Dropout")
    expect(resolveMcqAnswer("(c)", options)).toBe("Batch norm")
    expect(resolveMcqAnswer("Option D", options)).toBe("Early stopping")
    expect(resolveMcqAnswer("1", options)).toBe("Gradient descent")
    expect(resolveMcqAnswer("  dropout ", options)).toBe("Dropout")
    expect(resolveMcqAnswer("B) Dropout", options)).toBe("Dropout")
    expect(resolveMcqAnswer("A method nobody listed", options)).toBeNull()
    expect(resolveMcqAnswer("Adam", options)).toBeNull()
  })

  it("drops questions whose answer matches no option instead of rewriting option A", () => {
    const questions = sanitizeQuestions([
      { type: "mcq", question: "Q1", options, answer: "Adam" },
      { type: "MCQ", question: "Q2", options: [...options, "Dropout"], answer: "b" },
    ])
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ id: "q1", answer: "Dropout", options })
  })

  it("reads true/false in English and Arabic and rejects anything else", () => {
    expect(normalizeTrueFalse("Yes")).toBe("True")
    expect(normalizeTrueFalse("صحيح")).toBe("True")
    expect(normalizeTrueFalse("incorrect")).toBe("False")
    expect(normalizeTrueFalse("خطأ")).toBe("False")
    expect(normalizeTrueFalse("maybe")).toBeNull()
    expect(sanitizeQuestions([{ type: "true/false", question: "Q", answer: "Correct" }])[0]?.answer).toBe("True")
  })
})

describe("deck text budget", () => {
  const deck = (name: string, size: number): SlideDeck => ({ id: name, fileName: name, kind: "pdf", units: 1, chars: size, text: name[0].repeat(size), uploadedAt: 0 })

  it("gives every selected deck a share", () => {
    const { text, trimmed } = combineDeckTexts([deck("a.pdf", 20_000), deck("b.pdf", 20_000)], 12_000)
    expect(trimmed).toBe(true)
    expect(text.length).toBeLessThanOrEqual(12_000)
    expect(text).toContain("=== FILE: b.pdf ===")
    expect(text.split("b").length - 1).toBeGreaterThan(5_000)
  })
})

describe("API error details", () => {
  it("turns FastAPI validation lists into readable text", () => {
    expect(formatErrorDetail("plain")).toBe("plain")
    expect(formatErrorDetail([{ msg: "too long" }, { msg: "missing" }])).toBe("too long; missing")
    expect(formatErrorDetail({ nope: true })).toBe("")
  })
})
