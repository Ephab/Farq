import { useCallback, useEffect, useState } from "react"
import { LoaderCircle, Pause, Play, RefreshCw } from "lucide-react"
import { outlookApi, type OutlookStatus } from "@/lib/outlook-api"
import { useI18n } from "@/lib/i18n/context"
import { syncLine } from "./MailboxRail"

const CUTOFFS = [25, 50, 100, 250, 500, 1000]
const button = "inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function OutlookSettings() {
  const i18n = useI18n(), { t } = i18n
  const [status, setStatus] = useState<OutlookStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    try { setStatus(await outlookApi<OutlookStatus>("/status")) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer) }, [load])
  async function change(path: string, method: string, body?: object) {
    setBusy(true); setError("")
    try { await outlookApi(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    <p className="text-sm text-muted-foreground">{t("emails.settings.intro")}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!status ? <LoaderCircle className="size-5 animate-spin" /> : !status.connected ? <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{t("emails.settings.notConnected")}</p> : <>
      <section className="border-b border-border pb-6">
        <h4 className="text-[15px] font-semibold">{t("emails.settings.classification")}</h4>
        <p className="mt-2 text-sm text-muted-foreground">{t("emails.settings.fallback")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{t("emails.settings.cloudHint")}</p>
        <label className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{t("emails.rail.classify")}</span>
          <select aria-label={t("emails.rail.aboutLimit")} disabled={busy} value={status.classify_limit === null ? "none" : status.classify_limit ?? 50} onChange={(e) => void change("/classify-limit", "PATCH", { limit: e.target.value === "none" ? null : Number(e.target.value) })} className="min-h-10 rounded-xl border border-border bg-background px-3">
            {CUTOFFS.map((value) => <option key={value} value={value}>{t("emails.rail.latest", { count: value })}</option>)}
            <option value="none">{t("emails.rail.allEmails")}</option>
          </select>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">{t("emails.rail.limitInfo")}</p>
      </section>
      <section>
        <h4 className="text-[15px] font-semibold">{t("emails.settings.sync")}</h4>
        <p className="mt-2 break-all text-sm text-muted-foreground" dir="auto">{status.account}</p>
        <p className="mt-2 text-xs text-muted-foreground" role="status">{syncLine(status, i18n)}</p>
        <p className="mt-2 text-sm text-muted-foreground">{status.auto_sync ? t("emails.rail.autoOn") : t("emails.rail.autoOff")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={button} disabled={busy || status.status === "running" || status.status === "queued"} onClick={() => void change("/sync", "POST")}><RefreshCw className="size-4" />{t("emails.rail.syncNow")}</button>
          <button className={button} disabled={busy} onClick={() => void change("/preferences", "PATCH", { auto_sync: !status.auto_sync })}>{status.auto_sync ? <><Pause className="size-4" />{t("emails.rail.pause")}</> : <><Play className="size-4" />{t("emails.rail.resume")}</>}</button>
        </div>
        {status.error && <p role="status" className="mt-3 text-sm text-destructive">{status.error}</p>}
      </section>
    </>}
  </div>
}
