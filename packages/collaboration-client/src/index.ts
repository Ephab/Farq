/** Central API only. The caller owns login and in-memory access-token lifetime. */
export interface CollaborationAccount {
  id: string
  display_name: string
}

export const CLIENT_VERSION = "0.1.0"

export class CollaborationError extends Error {
  readonly status: number
  constructor(status: number) {
    super(status === 401 ? "Sign in to collaboration" : status === 426 ? "Update Waypoint to keep using collaboration" : "Collaboration request failed")
    this.status = status
  }
}

export function createCollaborationClient(options: {
  baseUrl: string
  accessToken: () => Promise<string | null>
  allowDevelopmentLoopback?: boolean
  fetch?: typeof globalThis.fetch
}) {
  const base = new URL(options.baseUrl)
  const local = options.allowDevelopmentLoopback && base.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  if ((base.protocol !== "https:" && !local) || base.username || base.password
      || base.search || base.hash || base.pathname !== "/") {
    throw new Error("Use an explicit HTTPS collaboration origin")
  }
  const fetcher = options.fetch ?? globalThis.fetch
  return {
    async me(signal?: AbortSignal): Promise<CollaborationAccount> {
      const token = await options.accessToken()
      if (!token) throw new CollaborationError(401)
      const response = await fetcher(new URL("/v1/me", base), {
        headers: { Authorization: `Bearer ${token}`, "X-Waypoint-Client-Version": CLIENT_VERSION },
        credentials: "omit", redirect: "error", cache: "no-store", signal,
      })
      if (!response.ok) throw new CollaborationError(response.status)
      const body: unknown = await response.json()
      if (!body || typeof body !== "object" || !("id" in body) || !("display_name" in body)
          || typeof body.id !== "string" || typeof body.display_name !== "string") {
        throw new Error("Invalid collaboration account response")
      }
      return { id: body.id, display_name: body.display_name }
    },
  }
}
