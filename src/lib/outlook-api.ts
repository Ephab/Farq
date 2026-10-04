import { API_BASE, httpErrorMessage } from "./waypoint-api"
import { translate } from "@/lib/i18n/context"

export type EngineId = "jev" | "span" | "laya"
export interface DecisionEngine {
  id: EngineId; label: string; provider: string; location: "local" | "cloud"
  model: string; available: boolean; reason: string
}
export interface OutlookStatus {
  configured: boolean; connected: boolean; account?: string; auto_sync?: boolean
  status?: string; last_sync?: number; processed?: number; error?: string
  coach_access?: boolean; worker_enabled?: boolean
  classifier?: EngineId | "auto"; classifier_order?: EngineId[]; classifiers?: DecisionEngine[]
  classify_limit?: number | null; pending?: number
  provider?: "desktop" | "token"
  desktop_available?: boolean; token_available?: boolean
}
export interface MailItem {
  id: string; subject: string; sender: string; excerpt: string; received: string; web_url: string
  pinned: boolean; dismissed: boolean; reviewed: boolean; due_date: string | null
  classification: { category?: string | null; review_reasons?: string[]; important_probability?: number | null }
}
export async function outlookApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/outlook${path}`, {
      ...init, credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason
    throw new Error(translate("common.networkError"))
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail || httpErrorMessage(response.status))
  }
  return response.json() as Promise<T>
}
export function localDay() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
