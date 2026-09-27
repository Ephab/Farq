import { useEffect, useState } from "react"
import { outlookApi } from "@/lib/outlook-api"

const control = "rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-muted"
type Device = { user_code: string; verification_uri: string; interval: number; expires_in: number }

export function PersonalConnection({ onConnected }: { onConnected: () => void }) {
  const [config, setConfig] = useState<{ available: boolean; device: boolean } | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [deadline, setDeadline] = useState(0)
  const [token, setToken] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { void outlookApi<{ available: boolean; device: boolean }>("/personal/config").then(setConfig).catch(() => setConfig(null)) }, [])
  useEffect(() => {
    if (!device) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (Date.now() >= deadline) { setDevice(null); setError("Sign-in expired. Start again."); return }
      try {
        const result = await outlookApi<{ connected: boolean; interval?: number }>("/personal/device/poll", { method: "POST" })
        if (cancelled) return
        if (result.connected) { setDevice(null); onConnected() }
        else setDevice({ ...device, interval: result.interval || device.interval })
      } catch (reason) { if (!cancelled) { setDevice(null); setError(reason instanceof Error ? reason.message : "Sign-in failed") } }
    }, device.interval * 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [device, deadline, onConnected])
  async function connect(kind: "device" | "token") {
    setBusy(true); setError("")
    try {
      if (kind === "device") {
        const next = await outlookApi<Device>("/personal/device/start", { method: "POST", body: JSON.stringify({ accepted }) })
        setDevice(next); setDeadline(Date.now() + next.expires_in * 1000)
      } else {
        await outlookApi("/personal/token", { method: "POST", body: JSON.stringify({ access_token: token, accepted }) })
        setToken(""); onConnected()
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect Outlook") }
    finally { setBusy(false) }
  }
  return <details className="rounded-2xl border border-border p-4">
    <summary className="cursor-pointer text-sm font-medium">Other Outlook connection options</summary>
    <p className="mt-3 text-sm text-muted-foreground">Personal Outlook and approved university Graph accounts use the same inbox and local Laya classifier. Your organization’s access policies still apply.</p>
    {!config?.available ? <p className="mt-3 text-sm text-muted-foreground">Set FARQ_TOKEN_ENCRYPTION_KEY on the API server to enable these options. See docs/outlook-setup.md.</p> : <div className="mt-4 space-y-4">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Allow Farq to read my mailbox and keep cleaned email text locally for 30 days. I can disconnect and erase the cache.</span></label>
      {config.device && <button className={control} disabled={busy || !accepted || !!device} onClick={() => void connect("device")}>Sign in with Microsoft device code</button>}
      {device && <div role="status" className="rounded-xl bg-muted p-3 text-sm">Enter <strong className="select-all font-mono">{device.user_code}</strong> at <a className="underline" href={device.verification_uri} target="_blank" rel="noopener noreferrer">Microsoft sign-in</a>. Waiting for approval…</div>}
      <details><summary className="cursor-pointer text-sm">Use a temporary Graph token</summary><p className="my-3 text-xs text-muted-foreground">Requires User.Read and Mail.Read consent. This temporary connection cannot refresh: reconnect when it expires. Tokens stay encrypted on the server.</p><input className="w-full rounded-xl border border-border bg-background p-3 text-sm" type="password" autoComplete="off" aria-label="Temporary Graph access token" value={token} onChange={event => setToken(event.target.value)} /><button className={`${control} mt-2`} disabled={busy || !accepted || token.trim().length < 16 || !!device} onClick={() => void connect("token")}>Connect temporary token</button></details>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </details>
}
