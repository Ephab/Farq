import { afterEach, describe, expect, it, vi } from "vitest"
import { teamClient } from "@/lib/teams-api"

describe("teamClient", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it("always acts as the user it was bound to", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = teamClient("demo-sara")
    await client.typing("team-falcon")
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers["X-Waypoint-User"]).toBe("demo-sara")
    expect(client.userId).toBe("demo-sara")
    expect(client.eventsUrl("team-falcon", 5)).toBe("/api/teams/team-falcon/events?as=demo-sara&after=5")
  })
})
