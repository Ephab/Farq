import { afterEach, describe, expect, it, vi } from "vitest"
import { collaborationAuth } from "./collaboration-auth"
import { centralTeamTransport } from "./central-team-transport"

vi.mock("./collaboration-auth", () => ({ collaborationAuth: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe("central team transport", () => {
  it("binds bearer requests to the service and current account", async () => {
    vi.mocked(collaborationAuth).mockResolvedValue({ access_token: "short-lived", account_id: "alice" })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal("fetch", fetcher)
    await centralTeamTransport("https://collab.example", "alice").request("/api/teams")
    expect(String(fetcher.mock.calls[0][0])).toBe("https://collab.example/v1/teams")
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" })
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer short-lived")
  })

  it("blocks account switching and external routes before sending credentials", async () => {
    vi.mocked(collaborationAuth).mockResolvedValue({ access_token: "bob-token", account_id: "bob" })
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetcher)
    const transport = centralTeamTransport("https://collab.example", "alice")
    await expect(transport.request("/api/teams")).rejects.toThrow("account changed")
    await expect(transport.request("https://other.example/teams")).rejects.toThrow("Invalid collaboration route")
    await expect(transport.request("/api/../../secret")).rejects.toThrow("Invalid collaboration route")
    expect(fetcher).not.toHaveBeenCalled()
  })
})
