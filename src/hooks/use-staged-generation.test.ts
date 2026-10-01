import { afterEach, describe, expect, it, vi } from "vitest"
import { streamStagedRoadmap } from "./use-staged-generation"

vi.mock("@/lib/i18n/context", () => ({ translate: (key: string) => `localized:${key}` }))
vi.mock("@/lib/waypoint-api", () => ({ API_BASE: "", httpErrorMessage: (status: number) => `localized:http:${status}`, identityHeaders: () => ({ "X-Waypoint-User": "student" }) }))

afterEach(() => vi.unstubAllGlobals())

function run(signal = new AbortController().signal) {
  const callbacks = { onPlan: vi.fn(), onStage: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
  return { callbacks, result: streamStagedRoadmap("student", { provider: "gemini", model: "test" }, {}, signal, callbacks) }
}

describe("staged generation error localization", () => {
  it("localizes network errors but preserves cancellation", async () => {
    const failure = new TypeError("Failed to fetch")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure))
    await expect(run().result).rejects.toThrow("localized:common.networkError")
    const controller = new AbortController()
    controller.abort()
    await expect(run(controller.signal).result).rejects.toBe(failure)
  })

  it("localizes bare HTTP failures and preserves server details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Server explanation" }), { status: 400 })))
    await expect(run().result).rejects.toThrow("localized:http:503")
    await expect(run().result).rejects.toThrow("Server explanation")
  })

  it("localizes an empty error event and premature stream end", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response('event: error\ndata: {}\n\n'))
      .mockResolvedValueOnce(new Response("")))
    const first = run()
    await first.result
    expect(first.callbacks.onError).toHaveBeenCalledWith("localized:onboarding.chat.generateFailed", undefined)
    await expect(run().result).rejects.toThrow("localized:onboarding.chat.streamEnded")
  })
})
