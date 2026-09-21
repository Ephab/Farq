export type ThemeId =
  | "white"
  | "vercel-dark"
  | "linear"
  | "supabase"
  | "claude"
  | "catppuccin-mocha"
  | "tokyo-night"
  | "nord"
  | "dracula"

export interface ThemeTokens {
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  border: string
  ring: string
  primary: string
  primaryForeground: string
}

export interface Theme {
  id: ThemeId
  name: string
  description: string
  dark: boolean
  tokens: ThemeTokens
}

export const THEMES: Theme[] = [
  {
    id: "white",
    name: "White",
    description: "Clean neutral light — default",
    dark: false,
    tokens: {
      background: "#ffffff",
      foreground: "#09090b",
      muted: "#f4f4f5",
      mutedForeground: "#71717a",
      border: "#e4e4e7",
      ring: "#a1a1aa",
      primary: "#09090b",
      primaryForeground: "#fafafa",
    },
  },
  {
    id: "vercel-dark",
    name: "Vercel Dark",
    description: "Pure black / white developer monochrome",
    dark: true,
    tokens: {
      background: "#000000",
      foreground: "#fafafa",
      muted: "#171717",
      mutedForeground: "#a1a1aa",
      border: "#262626",
      ring: "#525252",
      primary: "#fafafa",
      primaryForeground: "#000000",
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Soft surfaces + indigo product polish",
    dark: false,
    tokens: {
      background: "#fafafb",
      foreground: "#1c1c28",
      muted: "#efeff4",
      mutedForeground: "#67667a",
      border: "#e3e3ec",
      ring: "#6e78d5",
      primary: "#5e6ad2",
      primaryForeground: "#ffffff",
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Emerald developer energy",
    dark: false,
    tokens: {
      background: "#ffffff",
      foreground: "#0c0c0c",
      muted: "#ecfdf5",
      mutedForeground: "#5f6b66",
      border: "#d1fae5",
      ring: "#10b981",
      primary: "#059669",
      primaryForeground: "#ffffff",
    },
  },
  {
    id: "claude",
    name: "Claude",
    description: "Warm parchment + terracotta",
    dark: false,
    tokens: {
      background: "#faf9f5",
      foreground: "#3d3a34",
      muted: "#efece4",
      mutedForeground: "#6f6a5e",
      border: "#e5e0d5",
      ring: "#d97757",
      primary: "#c96442",
      primaryForeground: "#fff7ed",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    description: "Cozy pastel dark — most loved 2026",
    dark: true,
    tokens: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      muted: "#313244",
      mutedForeground: "#a6adc8",
      border: "#45475a",
      ring: "#b4befe",
      primary: "#b4befe",
      primaryForeground: "#1e1e2e",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Neon noir for screenshots",
    dark: true,
    tokens: {
      background: "#1a1b26",
      foreground: "#a9b1d6",
      muted: "#24283b",
      mutedForeground: "#787c99",
      border: "#2f354d",
      ring: "#7aa2f7",
      primary: "#7aa2f7",
      primaryForeground: "#1a1b26",
    },
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic calm, low saturation",
    dark: true,
    tokens: {
      background: "#2e3440",
      foreground: "#d8dee9",
      muted: "#3b4252",
      mutedForeground: "#8b9bb4",
      border: "#4c566a",
      ring: "#88c0d0",
      primary: "#88c0d0",
      primaryForeground: "#2e3440",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Vampire purple high energy",
    dark: true,
    tokens: {
      background: "#282a36",
      foreground: "#f8f8f2",
      muted: "#44475a",
      mutedForeground: "#9a9ec1",
      border: "#44475a",
      ring: "#bd93f9",
      primary: "#bd93f9",
      primaryForeground: "#282a36",
    },
  },
]

export const DEFAULT_THEME_ID: ThemeId = "white"

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
