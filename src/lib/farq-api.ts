export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

export type HermesProvider = "gemini" | "nim"

const HERMES_PROVIDER_STORAGE_KEY = "farq.hermes-provider"
// Tab-only (sessionStorage) so Farq Hermes settings never leak into another
// tab, never touch .env files, and never touch a system Hermes instance.
const HERMES_GEMINI_MODEL_STORAGE_KEY = "farq.hermes-model-gemini"
const HERMES_NIM_MODEL_STORAGE_KEY = "farq.hermes-model-nim"
const HERMES_API_KEY_STORAGE_KEY = "farq.hermes-api-key"

/** Header carrying the tab-only Farq Hermes gateway key override to Farq API. */
export const HERMES_API_KEY_HEADER = "X-Hermes-Api-Key"

// Keep in sync with services/api/app/hermes.py allowlists.
export const HERMES_GEMINI_MODELS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview (default)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const

// Keep in sync with src/lib/quiz-ai.ts QUIZ_MODELS and the backend allowlist.
export const HERMES_NIM_MODELS = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B (recommended)" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Llama Nemotron Ultra 253B" },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B (fast)" },
] as const

export const DEFAULT_HERMES_GEMINI_MODEL = HERMES_GEMINI_MODELS[0].id
export const DEFAULT_HERMES_NIM_MODEL = HERMES_NIM_MODELS[0].id

export function getHermesProvider(): HermesProvider {
  if (typeof window === "undefined") return "gemini"
  return window.sessionStorage.getItem(HERMES_PROVIDER_STORAGE_KEY) === "nim" ? "nim" : "gemini"
}

export function saveHermesProvider(provider: HermesProvider): void {
  window.sessionStorage.setItem(HERMES_PROVIDER_STORAGE_KEY, provider)
}

function modelKeyFor(provider: HermesProvider): string {
  return provider === "nim" ? HERMES_NIM_MODEL_STORAGE_KEY : HERMES_GEMINI_MODEL_STORAGE_KEY
}

function defaultModelFor(provider: HermesProvider): string {
  return provider === "nim" ? DEFAULT_HERMES_NIM_MODEL : DEFAULT_HERMES_GEMINI_MODEL
}

export function getHermesModel(provider: HermesProvider): string {
  if (typeof window === "undefined") return defaultModelFor(provider)
  const options = provider === "nim" ? HERMES_NIM_MODELS : HERMES_GEMINI_MODELS
  const saved = window.sessionStorage.getItem(modelKeyFor(provider))
  if (saved && (options as readonly { id: string }[]).some((m) => m.id === saved)) return saved
  // Preserve a previously saved custom id so allowlisted backend values keep working.
  if (saved && saved.trim().length > 0) return saved
  return defaultModelFor(provider)
}

export function saveHermesModel(provider: HermesProvider, model: string): void {
  window.sessionStorage.setItem(modelKeyFor(provider), model)
}

/** Tab-only Farq Hermes gateway key override. Empty string means "use server env". */
export function getHermesApiKey(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.sessionStorage.getItem(HERMES_API_KEY_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function saveHermesApiKey(key: string): void {
  window.sessionStorage.setItem(HERMES_API_KEY_STORAGE_KEY, key)
}

export function clearLocalFarqState(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(HERMES_PROVIDER_STORAGE_KEY)
    window.sessionStorage.removeItem(HERMES_GEMINI_MODEL_STORAGE_KEY)
    window.sessionStorage.removeItem(HERMES_NIM_MODEL_STORAGE_KEY)
    window.sessionStorage.removeItem(HERMES_API_KEY_STORAGE_KEY)
    window.localStorage.removeItem("smartlearn-quiz-library-v1")
    window.localStorage.removeItem("smartlearn-nim-key")
    window.localStorage.removeItem("farq-theme")
  } catch {
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as { detail?: string }
      if (payload.detail) message = payload.detail
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const DEMO_STUDENT_ID = "demo-student"

