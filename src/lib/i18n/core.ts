// Framework-free i18n core: catalog lookup, interpolation, plurals and formatting.
// React bindings live in ./context.tsx so this file stays unit-testable.

export type Locale = "en" | "ar"
export const LOCALES: readonly Locale[] = ["en", "ar"]
export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_STORAGE_KEY = "waypoint-locale"

/** Plural forms follow Intl.PluralRules categories; Arabic uses all six. */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
export type Message = string | PluralMessage
export interface Catalog { [key: string]: Message | Catalog }

/** Makes `ar` mirror every key of `en`, so a missing translation fails `tsc`. */
export type CatalogShape<T> = { [K in keyof T]: T[K] extends string ? Message : T[K] extends PluralMessage ? Message : CatalogShape<T[K]> }

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
export type KeyOf<T> = { [K in keyof T & string]: T[K] extends Message ? K : Join<K, KeyOf<T[K]>> }[keyof T & string]

export type Params = Record<string, string | number>

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr"
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** Saved choice, then browser language, then the default. Mirrors the inline script in index.html. */
export function resolveInitialLocale(saved: string | null, browserLanguages: readonly string[]): Locale {
  if (isLocale(saved)) return saved
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split("-")[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/**
 * Digit policy lives here and nowhere else. Arabic UI shows Western digits (123), the
 * convention in Saudi university software; machine values (IDs, codes, URLs) never go through
 * these formatters at all, so they stay ASCII whatever this is set to.
 */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-US"
}

function lookup(catalog: Catalog, key: string): Message | undefined {
  let node: Message | Catalog | undefined = catalog
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined
    node = (node as Catalog)[part]
  }
  if (typeof node === "string") return node
  if (node && typeof node === "object" && typeof (node as PluralMessage).other === "string") return node as PluralMessage
  return undefined
}

export type MissingKeyHandler = (key: string, locale: Locale) => void

export function createTranslator(
  locale: Locale,
  catalogs: Record<Locale, Catalog>,
  onMissing: MissingKeyHandler = () => undefined,
) {
  const rules = new Intl.PluralRules(intlLocale(locale))
  const numbers = new Intl.NumberFormat(intlLocale(locale))
  return (key: string, params: Params = {}): string => {
    let message = lookup(catalogs[locale], key)
    if (message === undefined) {
      onMissing(key, locale)
      message = lookup(catalogs[DEFAULT_LOCALE], key)
      // Show something readable rather than the raw key to users.
      if (message === undefined) return key.split(".").pop() ?? key
    }
    if (typeof message !== "string") {
      const count = Number(params.count ?? 0)
      // Exact-zero wording ("No items") is allowed even where the language has no zero category.
      message = (count === 0 && message.zero) || message[rules.select(count)] || message.other
    }
    return message.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name]
      if (value === undefined) return match
      return typeof value === "number" ? numbers.format(value) : value
    })
  }
}

export function createFormatters(locale: Locale) {
  const tag = intlLocale(locale)
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" })
  return {
    number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag, options).format(value),
    percent: (ratio: number, digits = 0) =>
      new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: digits }).format(ratio),
    date: (value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
      new Intl.DateTimeFormat(tag, options).format(new Date(value)),
    time: (value: Date | string | number) =>
      new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit" }).format(new Date(value)),
    dateTime: (value: Date | string | number) =>
      new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)),
    /** "3 minutes ago" / "قبل ٣ دقائق" style, picking the largest sensible unit. */
    relative: (value: Date | string | number, now: number = Date.now()) => {
      const seconds = Math.round((new Date(value).getTime() - now) / 1000)
      const abs = Math.abs(seconds)
      if (abs < 60) return relative.format(seconds, "second")
      if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute")
      if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour")
      if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), "day")
      if (abs < 86400 * 365) return relative.format(Math.round(seconds / (86400 * 30)), "month")
      return relative.format(Math.round(seconds / (86400 * 365)), "year")
    },
    list: (items: string[]) => new Intl.ListFormat(tag, { style: "long", type: "conjunction" }).format(items),
  }
}

/**
 * Match key for search only; never store or display the result. Folds case, diacritics
 * (harakat, tatweel), Alef forms (أ إ آ ٱ → ا), ة → ه, ى → ي and Arabic-Indic digits,
 * so "مدرسة", "مدرسه" and "مَدْرَسَة" all find each other.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, " ")
    .trim()
}

export function matchesSearch(haystack: string, query: string): boolean {
  const q = normalizeForSearch(query)
  return q === "" || normalizeForSearch(haystack).includes(q)
}
