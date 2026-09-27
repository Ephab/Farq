import { describe, expect, it, vi } from "vitest"
import { en } from "@/locales/en"
import { ar } from "@/locales/ar"
import { createFormatters, createTranslator, dirOf, resolveInitialLocale, type Catalog, type Locale } from "./core"

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
