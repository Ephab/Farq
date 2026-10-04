import { describe, expect, it, vi } from "vitest"
import { createCollaborationClient } from "./index"

describe("collaboration client boundary", () => {
  it("uses only the central origin and does not persist or forward cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "central-id", display_name: "Student" })))
    const client = createCollaborationClient({ baseUrl: "https://teams.example", accessToken: async () => "access", fetch: fetcher })
    expect(await client.me()).toEqual({ id: "central-id", display_name: "Student" })
    const [url, options] = fetcher.mock.calls[0]
    expect(String(url)).toBe("https://teams.example/v1/me")
    expect(options).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store",
      headers: { Authorization: "Bearer access" } })
  })

  it("does not make requests without a token", async () => {
    const fetcher = vi.fn()
    const client = createCollaborationClient({ baseUrl: "https://teams.example", accessToken: async () => null, fetch: fetcher })
    await expect(client.me()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(["http://teams.example", "https://user:secret@teams.example", "https://teams.example?token=secret",
    "https://teams.example/path", "http://localhost:8100"])("rejects unsafe origin %s", (baseUrl) => {
    expect(() => createCollaborationClient({ baseUrl, accessToken: async () => null })).toThrow()
  })

  it("permits explicit loopback development", () => {
    expect(() => createCollaborationClient({ baseUrl: "http://127.0.0.1:8100", allowDevelopmentLoopback: true,
      accessToken: async () => null })).not.toThrow()
  })

  it("does not expose raw error bodies", async () => {
    const client = createCollaborationClient({ baseUrl: "https://teams.example", accessToken: async () => "access",
      fetch: vi.fn().mockResolvedValue(new Response("sensitive details", { status: 503 })) })
    await expect(client.me()).rejects.toMatchObject({ status: 503, message: "Collaboration request failed" })
  })

  it("validates response shape", async () => {
    const client = createCollaborationClient({ baseUrl: "https://teams.example", accessToken: async () => "access",
      fetch: vi.fn().mockResolvedValue(new Response('{"id":42}')) })
    await expect(client.me()).rejects.toThrow("Invalid collaboration account response")
  })
})
