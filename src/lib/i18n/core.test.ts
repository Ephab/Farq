import { describe, expect, it, vi } from "vitest"
import { en } from "@/locales/en/index"
import { ar } from "@/locales/ar/index"
import { createFormatters, createTranslator, dirOf, matchesSearch, resolveInitialLocale, type Catalog, type Locale } from "./core"

const catalogs = { en, ar } as unknown as Record<Locale, Catalog>

describe("locale resolution", () => {
  it("prefers the saved choice, then the browser, then English", () => {
    expect(resolveInitialLocale("ar", ["en-US"])).toBe("ar")
    expect(resolveInitialLocale(null, ["ar-SA", "en"])).toBe("ar")
    expect(resolveInitialLocale("fr", ["de-DE"])).toBe("en")
  })

  it("maps Arabic to RTL and English to LTR", () => {
    expect(dirOf("ar")).toBe("rtl")
    expect(dirOf("en")).toBe("ltr")
  })
})

describe("translator", () => {
  it("interpolates and uses Arabic plural categories", () => {
    const t = createTranslator("ar", catalogs)
    expect(t("nav.unreadTeamMessages", { count: 1 })).toBe("رسالة واحدة غير مقروءة من الفريق")
    expect(t("nav.unreadTeamMessages", { count: 2 })).toBe("رسالتان غير مقروءتين من الفريق")
    expect(t("nav.unreadTeamMessages", { count: 5 })).toBe("5 رسائل غير مقروءة من الفريق")
    expect(t("nav.unreadTeamMessages", { count: 11 })).toBe("11 رسالة غير مقروءة من الفريق")
  })

  it("falls back to English and reports a missing key", () => {
    const onMissing = vi.fn()
    const partial = { en, ar: { common: {} } } as unknown as Record<Locale, Catalog>
    const t = createTranslator("ar", partial, onMissing)
    expect(t("common.save")).toBe("Save")
    expect(onMissing).toHaveBeenCalledWith("common.save", "ar")
    expect(t("does.not.exist")).toBe("exist")
  })

  it("has the same keys in both catalogs", () => {
    const keys = (node: Catalog, prefix = ""): string[] =>
      Object.entries(node).flatMap(([k, v]) =>
        typeof v === "string" || "other" in v ? [prefix + k] : keys(v as Catalog, `${prefix}${k}.`))
    expect(keys(ar as unknown as Catalog).sort()).toEqual(keys(en as unknown as Catalog).sort())
  })
})

describe("formatters", () => {
  it("keeps Western digits in Arabic by policy", () => {
    const fmt = createFormatters("ar")
    expect(fmt.number(1234)).toMatch(/1,?234|1٬234/)
    expect(fmt.number(1234)).not.toMatch(/[٠-٩]/)
    expect(fmt.date("2026-09-27T00:00:00Z", { timeZone: "UTC", year: "numeric" })).toContain("2026")
  })

  it("formats relative time in the active language", () => {
    const now = Date.parse("2026-09-27T12:00:00Z")
    expect(createFormatters("en").relative(now - 3 * 60_000, now)).toBe("3 minutes ago")
    expect(createFormatters("ar").relative(now - 3 * 60_000, now)).toMatch(/3/)
  })
})

describe("search matching", () => {
  it("folds Arabic spelling variants without touching the source", () => {
    const stored = "مَدْرَسَة إدارة الأعمال"
    expect(matchesSearch(stored, "مدرسه")).toBe(true)
    expect(matchesSearch(stored, "  ادارة ")).toBe(true)
    expect(matchesSearch("مستوى ٣", "مستوي 3")).toBe(true)
    expect(matchesSearch("Report محمد GPT-5.6", "gpt-5.6")).toBe(true)
    expect(matchesSearch("Ahmed", "محمد")).toBe(false)
    expect(stored).toBe("مَدْرَسَة إدارة الأعمال")
  })
})

describe("catalog quality", () => {
  // Catches English pasted into the Arabic catalog; brand names and codes (no spaces) are allowed.
  it("has Arabic text wherever English has a sentence", () => {
    const leaks: string[] = []
    const walk = (e: Catalog, a: Catalog, path: string) => {
      for (const [k, v] of Object.entries(e)) {
        const other = a[k]
        const here = `${path}${k}`
        if (typeof v === "string" || "other" in v) {
          const values = typeof other === "string" ? [other] : Object.values(other as Record<string, string>)
          const words = (typeof v === "string" ? v : (v as { other: string }).other).replace(/\{\w+\}/g, "").match(/\b[a-z]{2,}\b/g) ?? []
          if (words.length >= 2 && values.some((text) => !/[؀-ۿ]/.test(text))) leaks.push(here)
        } else walk(v as Catalog, other as Catalog, `${here}.`)
      }
    }
    walk(en as unknown as Catalog, ar as unknown as Catalog, "")
    expect(leaks).toEqual([])
  })

  it("keeps the same {placeholders} in every translation", () => {
    const bad: string[] = []
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== "count").sort().join()
    const walk = (e: Catalog, a: Catalog, path: string) => {
      for (const [k, v] of Object.entries(e)) {
        const other = a[k]
        if (typeof v === "string" || "other" in v) {
          const want = names(typeof v === "string" ? v : (v as { other: string }).other)
          const values = typeof other === "string" ? [other] : Object.values(other as Record<string, string>)
          if (values.some((text) => names(text) !== want)) bad.push(`${path}${k}`)
        } else walk(v as Catalog, other as Catalog, `${path}${k}.`)
      }
    }
    walk(en as unknown as Catalog, ar as unknown as Catalog, "")
    expect(bad).toEqual([])
  })
})
