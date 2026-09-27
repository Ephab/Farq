import { useState } from "react"
import { outlookApi } from "@/lib/outlook-api"

export function TokenConnection({ available, onConnected }: { available: boolean; onConnected: () => void }) {
  const [token, setToken] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function connect() {
    setBusy(true); setError("")
    try {
      await outlookApi("/token", { method: "POST", body: JSON.stringify({ access_token: token, accepted }) })
      setToken(""); onConnected()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect Outlook") }
    finally { setBusy(false) }
  }
  return <details className="rounded-2xl border border-border p-5">
    <summary className="cursor-pointer text-sm font-semibold">Temporary Microsoft Graph token · Windows or macOS</summary>
    {!available ? <p className="mt-3 text-sm text-muted-foreground">Run Waypoint setup to generate the local encryption key, then restart the app.</p> : <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void connect() }}>
      <p className="text-sm leading-6 text-muted-foreground">Use a Microsoft-issued access token with User.Read and Mail.Read consent. It stays encrypted on this computer and cannot refresh. Reconnect with a fresh token when it expires. Your organization’s access policies still apply.</p>
      <label className="block text-sm">Graph access token<input className="mt-2 w-full rounded-xl border border-border bg-background p-3" type="password" autoComplete="off" maxLength={32000} value={token} onChange={event => setToken(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Allow Waypoint to read my mailbox and keep cleaned email text locally for 30 days.</span></label>
      <button className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !accepted || token.trim().length < 16}>{busy ? "Connecting…" : "Connect token"}</button>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </details>
}
