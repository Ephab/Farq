"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { en } from "@/locales/en"
import { ar } from "@/locales/ar"
import {
  LOCALE_STORAGE_KEY,
  createFormatters,
  createTranslator,
  dirOf,
  resolveInitialLocale,
  type Catalog,
  type KeyOf,
  type Locale,
  type Params,
} from "./core"

export type MessageKey = KeyOf<typeof en>

const CATALOGS = { en, ar } as unknown as Record<Locale, Catalog>

// Dev builds shout about gaps; production quietly falls back to English.
const reportMissing = import.meta.env.DEV
  ? (key: string, locale: Locale) => console.warn(`[i18n] missing "${key}" for ${locale}`)
  : undefined

interface I18nValue {
  locale: Locale
  dir: "rtl" | "ltr"
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: Params) => string
  fmt: ReturnType<typeof createFormatters>
}

const I18nContext = createContext<I18nValue | null>(null)

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return "en"
  let saved: string | null = null
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY) } catch { /* storage blocked */ }
  return resolveInitialLocale(saved, window.navigator.languages ?? [window.navigator.language])
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale)

  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = dirOf(locale)
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale) } catch { /* storage blocked */ }
  }, [locale])

  const setLocale = useCallback((next: Locale) => setLocaleState(next), [])

  const value = useMemo<I18nValue>(() => ({
    locale,
    dir: dirOf(locale),
    setLocale,
    t: createTranslator(locale, CATALOGS, reportMissing),
    fmt: createFormatters(locale),
  }), [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider")
  return ctx
}
