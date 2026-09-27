import { useState } from "react"
import { useI18n } from "@/lib/i18n/context"
import { outlookApi } from "@/lib/outlook-api"

export function TokenConnection({ available, onConnected }: { available: boolean; onConnected: () => void }) {
  const { t } = useI18n()
  const [token, setToken] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function connect() {
    setBusy(true); setError("")
    try {
      await outlookApi("/token", { method: "POST", body: JSON.stringify({ access_token: token, accepted }) })
      setToken(""); onConnected()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("emails.errors.connect")) }
    finally { setBusy(false) }
  }
  return <details className="rounded-2xl border border-border p-5">
    <summary className="cursor-pointer text-sm font-semibold">{t("emails.token.summary")}</summary>
    {!available ? <p className="mt-3 text-sm text-muted-foreground">{t("emails.token.noKey")}</p> : <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void connect() }}>
      <p className="text-sm leading-6 text-muted-foreground">{t("emails.token.body")}</p>
      <label className="block text-sm">{t("emails.token.label")}<input dir="ltr" className="mt-2 w-full rounded-xl border border-border bg-background p-3" type="password" autoComplete="off" maxLength={32000} value={token} onChange={event => setToken(event.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>{t("emails.token.consent")}</span></label>
      <button className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || !accepted || token.trim().length < 16}>{busy ? t("emails.token.connecting") : t("emails.token.connect")}</button>
    </form>}
    {error && <p role="alert" dir="auto" className="mt-3 text-sm text-red-600">{error}</p>}
  </details>
}
