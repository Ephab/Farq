import { translate } from "@/lib/i18n/context"
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

export type HermesProvider = "gemini" | "nim" | "hf" | "openrouter"

// Removed per-tab model/key overrides (sessionStorage) are cleared once so old tabs do not keep them.
const RETIRED_SESSION_KEYS = [
  "waypoint.hermes-provider", "waypoint.hermes-model-gemini", "waypoint.hermes-model-nim",
  "waypoint.hermes-model-hf", "waypoint.hermes-model-openrouter", "waypoint.hermes-api-key",
]

export function clearLocalWaypointState(): void {
  if (typeof window === "undefined") return
  try {
    RETIRED_SESSION_KEYS.forEach((key) => window.sessionStorage.removeItem(key))
    window.localStorage.removeItem("waypoint-quiz-library-v1")
    window.localStorage.removeItem("waypoint-nim-key")
    window.localStorage.removeItem("waypoint-theme")
    window.localStorage.removeItem(CURRENT_STUDENT_STORAGE_KEY)
    // Group Projects "Viewing as" (teams-api.ts) must not keep acting as the previous student.
    window.sessionStorage.removeItem("waypoint.current-user")
  } catch {
    // Storage blocked: nothing persisted to clear.
  }
}

/** Localized message for a bare HTTP failure (no server `detail`). */
export function httpErrorMessage(status: number): string {
  if (status === 401) return translate("common.errors.unauthorized")
  if (status === 403) return translate("common.errors.forbidden")
  if (status === 404) return translate("common.errors.notFound")
  if (status === 408 || status === 504) return translate("common.errors.timeout")
  if (status >= 500) return translate("common.errors.server", { status })
  return translate("common.errors.generic", { status })
}

/** A model-run failure in the student's words: provider overload and timeouts read as "busy, try again". */
export function runErrorMessage(message: string): string {
  return /did not finish within|\b(429|502|503)\b|overloaded|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED|rate.?limit/i.test(message)
      && !/authentication failed|credentials|API key/i.test(message)
    ? translate("common.errors.modelBusy")
    : message
}

/** Who this browser acts as. The API checks it on every student record (see services/api/app/ownership.py). */
export const USER_HEADER = "X-Waypoint-User"

export function identityHeaders(): Record<string, string> {
  return { [USER_HEADER]: getCurrentStudentId() }
}

/** EventSource cannot send headers, so event streams take the same identity as `?as=`. */
export function withIdentityQuery(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}as=${encodeURIComponent(getCurrentStudentId())}`
}

/** A failed API call that keeps its HTTP status, so callers can tell "not found" from "offline". */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/** FastAPI `detail` as readable text: a string as-is, a validation error list as its messages. */
export function formatErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : ""))
      .filter(Boolean)
      .join("; ")
  }
  return ""
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      // Explicit headers win, so a team client's View-as user is never replaced.
      headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...identityHeaders(), ...init?.headers },
    })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason
    throw new Error(translate("common.networkError"))
  }
  if (!response.ok) {
    // Server `detail` text is server content and passes through; a bare status gets a localized message.
    let message = httpErrorMessage(response.status)
    try {
      const payload = await response.json() as { detail?: unknown }
      message = formatErrorDetail(payload.detail) || message
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}

export const DEMO_STUDENT_ID = "demo-student"

export interface DecisionStatus {
  state: "disabled" | "observing" | "active" | "degraded"
  enabled: boolean
  mode: "off" | "shadow" | "active"
  engine: "jev" | "span" | "laya" | null
  engine_label: string | null
  model: string | null
  engines: { id: string; label: string; available: boolean; reason: string }[]
  active_purposes: string[]
  last_success_at: string | null
  last_failure_at: string | null
  last_error: string | null
}

// The signed-in student. There is no auth yet, so the browser remembers which
// student record it created (see docs/future-work.md). Falls back to the demo.
const CURRENT_STUDENT_STORAGE_KEY = "waypoint.current-student"
export const ROADMAP_CHANGED_EVENT = "waypoint:roadmap-changed"

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

export interface OpportunitySummary {
  source: "hackathonat"
  unseen_count: number
  last_synced_at: string | null
  stale: boolean
  status: "ready" | "stale" | "unavailable"
}

export interface ProjectBrief {
  title: string
  problem: string
  objective: string
  deliverables: string[]
  milestones: string[]
  constraints: string[]
  tools: string[]
  resources: Array<{ label: string; url: string }>
  rubric: Array<{ id: string; title: string; description: string; weight: number }>
}

export interface ProjectEvaluation {
  id: string
  project_id: string
  submission_id: string
  status: "queued" | "running" | "completed" | "failed"
  stage: string
  adapter: string
  score: number | null
  coverage: "unknown" | "low" | "medium" | "high"
  report: null | {
    summary: string
    strengths: string[]
    improvements: string[]
    limitations: string[]
    criteria: Array<{ criterion_id: string; score: number; evidence: string[]; feedback: string }>
  }
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface WaypointProject {
  id: string
  student_id: string
  roadmap_node_id: string
  title: string
  discipline: string
  project_type: string
  lifecycle: "planned" | "in-progress" | "evaluating" | "evaluated"
  latest_score: number | null
  best_score: number | null
  current_revision_id: string | null
  brief: ProjectBrief
  draft_revisions: Array<{ id: string; version: number; source: string; brief: ProjectBrief; created_at: string }>
  evaluations: ProjectEvaluation[]
}

export type SourceKind = "transcript_pdf" | "cv_pdf" | "linkedin_pdf" | "linkedin_zip" | "github" | "folder" | "portfolio_url" | "orcid"

export type BlackboardFailure = "bad_password" | "extra_verification" | "unreachable" | "needs_login" | "browser_missing" | "extract_failed" | "interrupted"

export interface BlackboardSyncStatus {
  connected: boolean
  status: "idle" | "queued" | "logging_in" | "extracting" | "reading_files" | "saving" | "done" | "failed"
  stage_detail: string
  failure_reason: BlackboardFailure | null
  username: string | null
  has_saved_login: boolean
  can_remember: boolean
  last_synced_at: string | null
  next_sync_at: string | null
  summary: Partial<Record<"courses" | "current_courses" | "upcoming_deadlines" | "overdue" | "announcements" | "materials" | "files_read" | "grades" | "new_evidence", number>> & { partial?: boolean }
}

export interface BlackboardDeadline {
  id: string
  title: string
  course: string
  due_at: string
  url: string
  overdue: boolean
}

/** Readable name for a source kind in the active language. Sources created without a value of
 *  their own are stored with the kind as their label, so this is the fallback. */
export function sourceKindLabel(kind: SourceKind): string {
  return translate(`common.sourceKinds.${kind}`)
}

export interface DataSourceItem {
  id: string
  kind: SourceKind
  label: string
  config: Record<string, string>
  status: "pending" | "syncing" | "ready" | "failed" | "removed"
  error: string | null
  /** ISO timestamp of the last successful read; null until the first sync. */
  last_synced_at?: string | null
  /** Evidence rows added by the sync that just ran. */
  added?: number
  /** Live progress while status is "syncing" (process-local on the server). */
  stage?: "queued" | "reading" | "extracting" | "saving"
  progress?: { done?: number; total?: number }
  elapsed_seconds?: number
  /** A non-fatal remark kept after a read, e.g. part of a long document could not be read. */
  note?: string
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

export async function uploadSourceFile(studentId: string, sourceId: string, file: File, options: { background?: boolean } = {}): Promise<DataSourceItem> {
  const form = new FormData()
  form.append("file", file)
  // No JSON content-type: the browser sets the multipart boundary.
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/students/${studentId}/sources/${sourceId}/upload${options.background ? "?background=true" : ""}`, { method: "POST", body: form, headers: identityHeaders() })
  } catch {
    throw new Error(translate("common.networkError"))
  }
  if (!response.ok) {
    let message = httpErrorMessage(response.status)
    try {
      const payload = await response.json() as { detail?: unknown }
      message = formatErrorDetail(payload.detail) || message
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<DataSourceItem>
}

