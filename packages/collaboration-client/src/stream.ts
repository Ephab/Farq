/** Fetch-based SSE: bearer headers, cursor replay, token refresh on reconnect. */
export class CollaborationStream extends EventTarget {
  private opened = false
  private openHandler: (() => void) | null = null
  get onopen() { return this.openHandler }
  set onopen(handler: (() => void) | null) {
    this.openHandler = handler
    // A subscriber attached after headers arrived still receives the current state.
    if (this.opened && handler) handler()
  }
  onerror: (() => void) | null = null
  private controller = new AbortController()
  private cursor: number
  private url: string
  private headers: () => Promise<Record<string, string>>
  private fetcher: typeof fetch

  constructor(url: string, after: number,
    headers: () => Promise<Record<string, string>>,
    fetcher: typeof fetch = globalThis.fetch) {
    super()
    this.url = url
    this.headers = headers
    this.fetcher = fetcher
    this.cursor = after
    void this.run()
  }

  close() { this.opened = false; this.controller.abort() }

  private async run() {
    while (!this.controller.signal.aborted) {
      let terminal = false
      try {
        const url = new URL(this.url)
        url.searchParams.set("after", String(this.cursor))
        // Called unbound: a browser's fetch throws "Illegal invocation" when its receiver is this stream.
        const fetcher = this.fetcher
        const response = await fetcher(url, {
          headers: { ...(await this.headers()), "Last-Event-ID": String(this.cursor) },
          credentials: "omit", cache: "no-store", redirect: "error", signal: this.controller.signal,
        })
        terminal = [401, 403, 404].includes(response.status)
        if (!response.ok || !response.body) throw new Error("Collaboration stream unavailable")
        this.opened = true
        this.onopen?.()
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        try {
          while (!this.controller.signal.aborted) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            let match: RegExpExecArray | null
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const frame = buffer.slice(0, match.index)
              buffer = buffer.slice(match.index + match[0].length)
              let event = "message", id = ""
              const data: string[] = []
              for (const line of frame.split(/\r?\n/)) {
                const value = line.slice(line.indexOf(":") + 1).replace(/^ /, "")
                if (line.startsWith("event:")) event = value
                if (line.startsWith("id:")) id = value
                if (line.startsWith("data:")) data.push(value)
              }
              if (id && /^\d+$/.test(id)) this.cursor = Number(id)
              if (data.length) this.dispatchEvent(new MessageEvent(event, { data: data.join("\n"), lastEventId: id }))
            }
            if (buffer.length > 1_000_000) throw new Error("Collaboration stream frame too large")
          }
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
      } catch {
        // User-visible state is handled by the subscriber; never log bearer headers.
      }
      if (this.controller.signal.aborted) return
      this.opened = false
      this.onerror?.()
      if (terminal) return
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); this.controller.signal.removeEventListener("abort", done); resolve() }
        const timer = setTimeout(done, 2000)
        this.controller.signal.addEventListener("abort", done, { once: true })
      })
    }
  }
}
