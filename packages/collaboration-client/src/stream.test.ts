import { afterEach, describe, expect, it, vi } from "vitest"
import { CollaborationStream } from "./stream"

afterEach(() => vi.useRealTimers())

describe("authenticated event stream", () => {
  it("decodes split multiline frames and resumes with the last cursor", async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
        for (const part of ["id: 7\r\nevent: task.changed\r\ndata: first\r", "\ndata: second\r\n\r", "\n"])
          controller.enqueue(encoder.encode(part))
        controller.close()
      } })))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    const headers = vi.fn(async () => ({ Authorization: "Bearer refreshed" }))
    const stream = new CollaborationStream("https://collab.example/v1/teams/t/events", 2, headers, fetcher)
    const event = new Promise<MessageEvent>(resolve => stream.addEventListener("task.changed", value => resolve(value as MessageEvent)))
    const received = await event
    expect(received.data).toBe("first\nsecond")
    expect(received.lastEventId).toBe("7")
    await vi.advanceTimersByTimeAsync(2100)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toContain("after=7")
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: "omit", redirect: "error",
      headers: { Authorization: "Bearer refreshed", "Last-Event-ID": "7" } })
    expect(headers).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    stream.close()
  })

  it("calls fetch without binding it to the stream (browsers throw Illegal invocation)", async () => {
    const receivers: unknown[] = []
    const fetcher = vi.fn(function (this: unknown) {
      receivers.push(this)
      return Promise.resolve(new Response(null, { status: 403 }))
    }) as unknown as typeof fetch
    const stream = new CollaborationStream("https://collab.example/events", 0, async () => ({}), fetcher)
    await vi.waitFor(() => expect(receivers).toHaveLength(1))
    expect(receivers[0]).not.toBe(stream)
    stream.close()
  })

  it("cancels reconnection when the view closes", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Offline"))
    const stream = new CollaborationStream("https://collab.example/events", 0, async () => ({}), fetcher)
    await vi.advanceTimersByTimeAsync(1)
    stream.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
