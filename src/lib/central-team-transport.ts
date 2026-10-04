import { CollaborationStream } from "../../packages/collaboration-client/src/stream"
import { collaborationAuth } from "@/lib/collaboration-auth"
import type { TeamTransport } from "@/lib/teams-api"

/** Sent on every central request so the service can refuse clients it no longer supports (HTTP 426). */
export const COLLABORATION_CLIENT_VERSION = "0.1.0"

export interface CentralCapabilities { teamAI: boolean; projectImport: boolean }

export async function fetchCentralCapabilities(origin: string): Promise<CentralCapabilities> {
  const base = new URL(origin)
  const token = await collaborationAuth<{ access_token: string }>("token")
  const response = await fetch(new URL("/v1/capabilities", base), { credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token.access_token}`, "X-Waypoint-Client-Version": COLLABORATION_CLIENT_VERSION, "ngrok-skip-browser-warning": "1" } })
  if (!response.ok) return { teamAI: false, projectImport: false }
  const body = await response.json().catch(() => null)
  return { teamAI: body?.team_ai === true, projectImport: body?.project_import === true }
}

export function centralTeamTransport(origin: string, accountId: string, capabilities: CentralCapabilities = { teamAI: false, projectImport: false }): TeamTransport {
  const base = new URL(origin)
  const loopback = import.meta.env.DEV && base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)
  if ((base.protocol !== "https:" && !loopback) || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Invalid collaboration service address")
  }
  async function headers(): Promise<Record<string, string>> {
    const token = await collaborationAuth<{ access_token: string; account_id: string }>("token")
    if (token.account_id !== accountId) throw new Error("Collaboration account changed. Reopen Group Projects.")
    // The tunnel header only stops a free ngrok domain from answering API calls with its warning page.
    return { Authorization: `Bearer ${token.access_token}`, "X-Waypoint-Client-Version": COLLABORATION_CLIENT_VERSION, "ngrok-skip-browser-warning": "1" }
  }
  const url = (path: string) => {
    if (!path.startsWith("/api/") || path.includes("\\")) throw new Error("Invalid collaboration route")
    const target = new URL(path.replace(/^\/api\//, "/v1/"), base)
    if (target.origin !== base.origin || !target.pathname.startsWith("/v1/")) throw new Error("Invalid collaboration route")
    return target
  }
  async function raw(path: string, init?: RequestInit) {
    const target = url(path)
    const requestHeaders = new Headers(init?.headers)
    for (const [name, value] of Object.entries(await headers())) requestHeaders.set(name, value)
    if (init?.body && !(init.body instanceof FormData)) requestHeaders.set("Content-Type", "application/json")
    const response = await fetch(target, { ...init, headers: requestHeaders,
      credentials: "omit", cache: "no-store", redirect: "error" })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(response.status === 426 ? "Update Waypoint to keep using collaboration"
        : typeof body?.detail === "string" ? body.detail : "Collaboration request failed")
    }
    return response
  }
  return {
    mode: "central", teamAI: capabilities.teamAI, projectImport: capabilities.projectImport,
    raw,
    async request<T>(path: string, init?: RequestInit): Promise<T> { return (await raw(path, init)).json() as Promise<T> },
    events(teamId: string, after: number) {
      return new CollaborationStream(String(url(`/api/teams/${encodeURIComponent(teamId)}/events`)), after, headers)
    },
  }
}
