export type ThemeId =
  | "white"
  | "vercel-dark"
  | "fjord"
  | "porcelain"
  | "nocturne"
  | "catppuccin-mocha"
  | "tokyo-night"
  | "velvet"
  | "dracula"
  | "sage"
  | "rose-quartz"
  | "deep-ocean"

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
      mutedForeground: "#65656f",
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
    id: "fjord",
    name: "Fjord",
    description: "Glacial mist + deep sea ink",
    dark: false,
    tokens: {
      background: "#f3f6f8",
      foreground: "#10222e",
      muted: "#e3eaf0",
      mutedForeground: "#5b6e7d",
      border: "#d2dde6",
      ring: "#2b7a99",
      primary: "#10222e",
      primaryForeground: "#f3f6f8",
    },
  },
  {
    id: "porcelain",
    name: "Porcelain",
    description: "Warm ivory + espresso noir, champagne detail",
    dark: false,
    tokens: {
      background: "#faf7f2",
      foreground: "#1c1917",
      muted: "#efe8dc",
      mutedForeground: "#796f65",
      border: "#e2d8c8",
      ring: "#c19a5b",
      primary: "#1c1917",
      primaryForeground: "#faf7f2",
    },
  },
  {
    id: "nocturne",
    name: "Nocturne",
    description: "Midnight ink + champagne gold",
    dark: true,
    tokens: {
      background: "#0f1220",
      foreground: "#ede8db",
      muted: "#1b1f33",
      mutedForeground: "#9b97ad",
      border: "#2b3048",
      ring: "#c6a87c",
      primary: "#d6b98c",
      primaryForeground: "#0f1220",
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
    id: "velvet",
    name: "Velvet Noir",
    description: "Plum noir + dusty rose, 2026 editorial",
    dark: true,
    tokens: {
      background: "#22141d",
      foreground: "#f4e8e2",
      muted: "#38222f",
      mutedForeground: "#c2a0ae",
      border: "#4f3145",
      ring: "#d68ba0",
      primary: "#d68ba0",
      primaryForeground: "#22141d",
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
  {
    id: "sage",
    name: "Sage",
    description: "Soft sage + forest green",
    dark: false,
    tokens: {
      background: "#f5f7f2",
      foreground: "#182b21",
      muted: "#e6ece1",
      mutedForeground: "#536858",
      border: "#cdd9c8",
      ring: "#34704c",
      primary: "#285c3e",
      primaryForeground: "#ffffff",
    },
  },
  {
    id: "rose-quartz",
    name: "Rose Quartz",
    description: "Blush stone + berry ink",
    dark: false,
    tokens: {
      background: "#fcf6f7",
      foreground: "#38212d",
      muted: "#f3e7eb",
      mutedForeground: "#80606d",
      border: "#e7ced8",
      ring: "#a53f65",
      primary: "#933657",
      primaryForeground: "#ffffff",
    },
  },
  {
    id: "deep-ocean",
    name: "Deep Ocean",
    description: "Deep teal + sea-glass blue",
    dark: true,
    tokens: {
      background: "#0c1c24",
      foreground: "#e2f0f2",
      muted: "#17323d",
      mutedForeground: "#9bb8c2",
      border: "#2a4855",
      ring: "#72d2d8",
      primary: "#72d2d8",
      primaryForeground: "#0c1c24",
    },
  },
]

export const DEFAULT_THEME_ID: ThemeId = "white"

export function getTheme(id: string): Theme {
  // Legacy ids removed Sep 2026 (green/orange) map to their premium replacements.
  if (id === "supabase") return THEMES.find((t) => t.id === "porcelain") ?? THEMES[0]
  if (id === "claude") return THEMES.find((t) => t.id === "nocturne") ?? THEMES[0]
  if (id === "nord") return THEMES.find((t) => t.id === "velvet") ?? THEMES[0]
  if (id === "linear") return THEMES.find((t) => t.id === "fjord") ?? THEMES[0]
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
