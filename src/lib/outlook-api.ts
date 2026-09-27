import { API_BASE } from "./farq-api"

export type EngineId = "jev" | "span" | "laya"
export interface DecisionEngine {
  id: EngineId; label: string; provider: string; location: "local" | "cloud"
  model: string; available: boolean; reason: string
}
export interface OutlookStatus {
  configured: boolean; connected: boolean; account?: string; auto_sync?: boolean
  status?: string; last_sync?: number; processed?: number; error?: string
  coach_access?: boolean; worker_enabled?: boolean
  classifier?: EngineId; classifiers?: DecisionEngine[]
  provider?: "desktop" | "token"
  desktop_available?: boolean; token_available?: boolean
}
export interface MailItem {
  id: string; subject: string; sender: string; excerpt: string; received: string; web_url: string
  pinned: boolean; dismissed: boolean; reviewed: boolean; due_date: string | null
  classification: { category?: string | null; review_reasons?: string[]; important_probability?: number | null }
}
export async function outlookApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/outlook${path}`, {
    ...init, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail || `Outlook request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}
export function localDay() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
