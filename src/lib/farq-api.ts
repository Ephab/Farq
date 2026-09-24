export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

export type HermesProvider = "gemini" | "nim" | "hf"

const HERMES_PROVIDER_STORAGE_KEY = "farq.hermes-provider"
// Tab-only (sessionStorage) so Farq Hermes settings never leak into another
// tab, never touch .env files, and never touch a system Hermes instance.
const HERMES_GEMINI_MODEL_STORAGE_KEY = "farq.hermes-model-gemini"
const HERMES_NIM_MODEL_STORAGE_KEY = "farq.hermes-model-nim"
const HERMES_HF_MODEL_STORAGE_KEY = "farq.hermes-model-hf"
const HERMES_API_KEY_STORAGE_KEY = "farq.hermes-api-key"

/** Header carrying the tab-only Farq Hermes gateway key override to Farq API. */
export const HERMES_API_KEY_HEADER = "X-Hermes-Api-Key"

// Keep in sync with services/api/app/hermes.py allowlists.
// Order = rate-limit fallback order (see GEMINI_CHAIN in services/api/app/hermes.py).
export const HERMES_GEMINI_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (default)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (higher daily limit)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { id: "gemma-4-31b-it", label: "Gemma 4 31B (no tool calls)" },
  { id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B (no tool calls)" },
] as const

// Keep in sync with src/lib/quiz-ai.ts QUIZ_MODELS and the backend allowlist.
// Order = NIM fallback order (see NIM_CHAIN in services/api/app/hermes.py).
export const HERMES_NIM_MODELS = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B (default)" },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B (fast)" },
] as const

// Hugging Face Inference Providers; billed to the HF_TOKEN in the server .env.
// Order = fallback order after Google, from the 2026-09 smoke test.
export const HERMES_HF_MODELS = [
  { id: "deepseek-ai/DeepSeek-V4.1-Flash:deepinfra", label: "DeepSeek V4.1 Flash · DeepInfra (best)" },
  { id: "google/gemma-4-26B-A4B-it:novita", label: "Gemma 4 26B · Novita" },
  { id: "openai/gpt-oss-20b:groq", label: "gpt-oss-20b · Groq (fastest)" },
  { id: "google/gemma-4-26B-A4B-it:deepinfra", label: "Gemma 4 26B · DeepInfra (slow)" },
  { id: "meta-llama/Llama-3.1-8B-Instruct:nscale", label: "Llama 3.1 8B · nscale (no tools)" },
] as const

export const DEFAULT_HERMES_GEMINI_MODEL = HERMES_GEMINI_MODELS[0].id
export const DEFAULT_HERMES_NIM_MODEL = HERMES_NIM_MODELS[0].id
export const DEFAULT_HERMES_HF_MODEL = HERMES_HF_MODELS[0].id

export function modelsFor(provider: HermesProvider): readonly { id: string; label: string }[] {
  return provider === "nim" ? HERMES_NIM_MODELS : provider === "hf" ? HERMES_HF_MODELS : HERMES_GEMINI_MODELS
}

export function getHermesProvider(): HermesProvider {
  if (typeof window === "undefined") return "gemini"
  const saved = window.sessionStorage.getItem(HERMES_PROVIDER_STORAGE_KEY)
  return saved === "nim" || saved === "hf" ? saved : "gemini"
}

export function saveHermesProvider(provider: HermesProvider): void {
  window.sessionStorage.setItem(HERMES_PROVIDER_STORAGE_KEY, provider)
}

function modelKeyFor(provider: HermesProvider): string {
  return provider === "nim" ? HERMES_NIM_MODEL_STORAGE_KEY : provider === "hf" ? HERMES_HF_MODEL_STORAGE_KEY : HERMES_GEMINI_MODEL_STORAGE_KEY
}

function defaultModelFor(provider: HermesProvider): string {
  return provider === "nim" ? DEFAULT_HERMES_NIM_MODEL : provider === "hf" ? DEFAULT_HERMES_HF_MODEL : DEFAULT_HERMES_GEMINI_MODEL
}

export function getHermesModel(provider: HermesProvider): string {
  if (typeof window === "undefined") return defaultModelFor(provider)
  const options = modelsFor(provider)
  const saved = window.sessionStorage.getItem(modelKeyFor(provider))
  if (saved && (options as readonly { id: string }[]).some((m) => m.id === saved)) return saved
  // Preserve a previously saved custom id so allowlisted backend values keep working.
  if (saved && saved.trim().length > 0) return saved
  return defaultModelFor(provider)
}

export function saveHermesModel(provider: HermesProvider, model: string): void {
  window.sessionStorage.setItem(modelKeyFor(provider), model)
}

/** True when the value is an NVIDIA API key, not a Farq gateway key. */
export function isNvapiKey(key: string): boolean {
  return key.trim().toLowerCase().startsWith("nvapi")
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
    window.sessionStorage.removeItem(HERMES_HF_MODEL_STORAGE_KEY)
    window.sessionStorage.removeItem(HERMES_API_KEY_STORAGE_KEY)
    window.localStorage.removeItem("smartlearn-quiz-library-v1")
    window.localStorage.removeItem("smartlearn-nim-key")
    window.localStorage.removeItem("farq-theme")
    window.localStorage.removeItem(CURRENT_STUDENT_STORAGE_KEY)
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

// The signed-in student. There is no auth yet, so the browser remembers which
// student record it created (see docs/future-work.md). Falls back to the demo.
const CURRENT_STUDENT_STORAGE_KEY = "farq.current-student"
export const ROADMAP_CHANGED_EVENT = "farq:roadmap-changed"

export function getCurrentStudentId(): string {
  if (typeof window === "undefined") return DEMO_STUDENT_ID
  try {
    return window.localStorage.getItem(CURRENT_STUDENT_STORAGE_KEY) || DEMO_STUDENT_ID
  } catch {
    return DEMO_STUDENT_ID
  }
}

export function hasChosenStudent(): boolean {
  try {
    return Boolean(window.localStorage.getItem(CURRENT_STUDENT_STORAGE_KEY))
  } catch {
    return false
  }
}

export function setCurrentStudentId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(CURRENT_STUDENT_STORAGE_KEY, id)
    else window.localStorage.removeItem(CURRENT_STUDENT_STORAGE_KEY)
  } catch {
    // Storage blocked: the app keeps working for this page load only.
  }
}

export function notifyRoadmapChanged(): void {
  window.dispatchEvent(new Event(ROADMAP_CHANGED_EVENT))
}

/** Provider/model/key for any call that runs Hermes, matching the chat composer.
 *
 * An nvapi key forces the nim provider: the backend routes it onto the NIM
 * ladder (ultra -> super -> lightning) and never forwards it as gateway
 * auth, so it is safe to keep sending it in the header.
 */
export function hermesRequestParts(): { body: { provider: HermesProvider; model: string }; headers: Record<string, string> } {
  const key = getHermesApiKey().trim()
  const provider: HermesProvider = isNvapiKey(key) ? "nim" : getHermesProvider()
  return { body: { provider, model: getHermesModel(provider) }, headers: key ? { [HERMES_API_KEY_HEADER]: key } : {} }
}

export type OnboardingStatus = "basics" | "sources" | "review" | "chat" | "generating" | "preview" | "done"

export interface StudentProfile {
  student_id: string
  display_name: string
  institution: string
  program: string
  discipline: string
  year_label: string
  grad_target: string
  onboarding_status: OnboardingStatus
  thread_id: string
}

export type SourceKind = "transcript_pdf" | "cv_pdf" | "linkedin_pdf" | "linkedin_zip" | "github" | "folder" | "portfolio_url" | "orcid"

export interface DataSourceItem {
  id: string
  kind: SourceKind
  label: string
  config: Record<string, string>
  status: "pending" | "syncing" | "ready" | "failed" | "removed"
  error: string | null
  added?: number
}

export interface EvidenceItem {
  id: string
  source_id: string
  kind: string
  title: string
  data: Record<string, unknown>
  source_ref: string
  status: "suggested" | "confirmed" | "dismissed"
}

export interface Discipline {
  id: string
  label: string
  sources: SourceKind[]
  coming_soon: string[]
}

export async function uploadSourceFile(studentId: string, sourceId: string, file: File): Promise<DataSourceItem> {
  const { body, headers } = hermesRequestParts()
  const form = new FormData()
  form.append("file", file)
  form.append("provider", body.provider)
  form.append("model", body.model)
  // No JSON content-type: the browser sets the multipart boundary.
  const response = await fetch(`${API_BASE}/api/students/${studentId}/sources/${sourceId}/upload`, { method: "POST", body: form, headers })
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
  return response.json() as Promise<DataSourceItem>
}

