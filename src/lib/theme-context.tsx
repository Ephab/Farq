"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { DEFAULT_THEME_ID, getTheme, type ThemeId } from "@/lib/themes"

const STORAGE_KEY = "farq-theme"

interface ThemeContextValue {
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored) return getTheme(stored).id
  return DEFAULT_THEME_ID
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(getInitialTheme)

  useEffect(() => {
    const theme = getTheme(themeId)
    const root = document.documentElement
    root.setAttribute("data-theme", theme.id)
    root.style.colorScheme = theme.dark ? "dark" : "light"
    window.localStorage.setItem(STORAGE_KEY, theme.id)
  }, [themeId])

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(getTheme(id).id)
  }, [])

  const value = useMemo(() => ({ themeId, setThemeId }), [themeId, setThemeId])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
