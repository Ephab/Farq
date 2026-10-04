import { API_BASE } from "@/lib/waypoint-api"
import { getActingUserId } from "@/lib/teams-api"

export interface CentralAccount { id: string; display_name: string }
export interface CollaborationSession { account: CentralAccount | null; api_origin: string }

export interface CoachAccess { coach_access: boolean; expires_in: number | null }

/** Opt in/out of the personal coach searching classes for this student (read-only, this sign-in only). */
export async function coachAccess(method: "GET" | "POST" | "DELETE"): Promise<CoachAccess> {
  const response = await fetch(`${API_BASE}/api/collaboration/auth/coach${method === "GET" ? "/status" : ""}`, {
    method: method === "GET" ? "POST" : method, credentials: "include", cache: "no-store", redirect: "error",
    headers: { "X-Waypoint-Collaboration": "1", "X-Waypoint-User": getActingUserId() },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === "string" ? body.detail : "Collaboration coach access unavailable")
  }
  return response.json() as Promise<CoachAccess>
}

export interface CoachDraft {
  skills: string[]; roles: string[]; interests: string[]; goals: string[]; languages: string[]
  timezone: string; meeting_slots: number[]; hours_per_week: number | null
}

/** The profile draft the coach staged for this class (read once). It only fills the form; the student reviews and publishes. */
export async function coachDraft(classId: string): Promise<CoachDraft | null> {
  const response = await fetch(`${API_BASE}/api/collaboration/auth/coach/draft`, {
    method: "POST", credentials: "include", cache: "no-store", redirect: "error",
    headers: { "X-Waypoint-Collaboration": "1", "X-Waypoint-User": getActingUserId(), "Content-Type": "application/json" },
    body: JSON.stringify({ class_id: classId }),
  })
  if (!response.ok) throw new Error("Could not load the coach's draft")
  return ((await response.json()) as { draft: CoachDraft | null }).draft
}

export interface MoveTeamResult {
  dry_run: boolean; moved: boolean; shared_team_id: string | null
  summary: { counts?: { tasks: number; documents: number; decisions: number }; excluded?: string[]; unassigned_to_invite?: string[] }
}

/** Ask the local app to move one of this computer's teams to the shared service (preview first, then confirm). */
export async function moveTeamToShared(teamId: string, userId: string, body: { dry_run: boolean; confirm: boolean }): Promise<MoveTeamResult> {
  const response = await fetch(`${API_BASE}/api/collaboration/auth/teams/${encodeURIComponent(teamId)}/move`, {
    method: "POST", credentials: "include", cache: "no-store", redirect: "error",
    headers: { "X-Waypoint-Collaboration": "1", "X-Waypoint-User": userId, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new Error(typeof failure?.detail === "string" ? failure.detail : "Could not move the team")
  }
  return response.json() as Promise<MoveTeamResult>
}

export type CollaborationStatus = { configured: false } | { configured: true; server: string; consented: boolean }

async function consentCall(path: string, method: "POST" | "DELETE"): Promise<Response> {
  return fetch(`${API_BASE}/api/collaboration/auth/${path}`, {
    method, credentials: "include", cache: "no-store", redirect: "error",
    headers: { "X-Waypoint-Collaboration": "1", "X-Waypoint-User": getActingUserId() },
  })
}

/** Is a shared server configured for this app, and has this student agreed to connect to it? */
export async function collaborationStatus(): Promise<CollaborationStatus> {
  const response = await consentCall("status", "POST")
  if (!response.ok) throw new Error("Could not check the shared server setting")
  return response.json() as Promise<CollaborationStatus>
}

export const COLLABORATION_CONSENT_EVENT = "waypoint:collaboration-consent-changed"

/** Record the student's one-time agreement to connect to the configured server (or take it back). */
export async function setCollaborationConsent(agree: boolean): Promise<void> {
  const response = await consentCall("consent", agree ? "POST" : "DELETE")
  if (!response.ok) throw new Error("Could not save your choice")
  window.dispatchEvent(new Event(COLLABORATION_CONSENT_EVENT))
}

export async function collaborationAuth<T>(action: "session" | "token" | "logout"): Promise<T> {
  const response = await fetch(`${API_BASE}/api/collaboration/auth/${action}`, {
    method: "POST", credentials: "include", cache: "no-store", redirect: "error",
    headers: { "X-Waypoint-Collaboration": "1", "X-Waypoint-User": getActingUserId() },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === "string" ? body.detail : "Collaboration sign-in unavailable")
  }
  return response.json() as Promise<T>
}
