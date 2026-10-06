import { useCallback, useEffect, useState } from "react"
import { AlertCircle, GraduationCap, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react"
import { API_BASE, api, getCurrentStudentId, identityHeaders, type BlackboardSyncStatus } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"
import { parseServerTime } from "@/lib/server-time"
import { BlackboardCollection } from "./BlackboardCollection"

const RUNNING = new Set(["queued", "logging_in", "extracting", "reading_files", "saving"])
const STATS = ["courses", "current_courses", "upcoming_deadlines", "materials", "files", "files_read"] as const

/** My Data > Blackboard: one sign-in, then background sync. The password is sent once and never shown again. */
export function BlackboardSyncCard({ onReview, embedded = false }: { onReview?: () => void; embedded?: boolean }) {
  const { t, fmt } = useI18n()
  const studentId = getCurrentStudentId()
  const [status, setStatus] = useState<BlackboardSyncStatus | null>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const username = typed ?? status?.username ?? ""
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCollection, setShowCollection] = useState(false)
  const path = `/api/students/${studentId}/blackboard`
  const [shotUrl, setShotUrl] = useState<string | null>(null)

  // The screenshot route needs the identity header, so fetch it as a blob rather than <img src>.
  async function toggleShot() {
    if (shotUrl) { URL.revokeObjectURL(shotUrl); setShotUrl(null); return }
    try {
      const response = await fetch(`${API_BASE}${path}/sync/screenshot`, { headers: identityHeaders() })
      if (!response.ok) throw new Error(t("blackboard.extraStep.missing"))
      setShotUrl(URL.createObjectURL(await response.blob()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  useEffect(() => () => { if (shotUrl) URL.revokeObjectURL(shotUrl) }, [shotUrl])
  // A new sync replaces the screenshot; drop the one on screen once it no longer exists.
  useEffect(() => { if (!status?.has_screenshot && shotUrl) { URL.revokeObjectURL(shotUrl); setShotUrl(null) } }, [status?.has_screenshot, shotUrl])

  const load = useCallback(async () => {
    try { setStatus(await api<BlackboardSyncStatus>(`${path}/sync`)); setError(null) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [path])

  useEffect(() => { void load() }, [load])
  const running = status ? RUNNING.has(status.status) : false
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [running, load])

  async function start(withLogin: boolean) {
    setBusy(true)
    setError(null)
    try {
      const body = withLogin ? JSON.stringify({ username: username.trim(), password, remember: remember && !!status?.can_remember }) : undefined
      setStatus(await api<BlackboardSyncStatus>(`${path}/sync`, { method: "POST", body }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (withLogin) setPassword("")
      setBusy(false)
    }
  }

  async function setAutoSync(autoSync: boolean) {
    setBusy(true)
    setError(null)
    try {
      setStatus(await api<BlackboardSyncStatus>(`${path}/preferences`, { method: "PATCH", body: JSON.stringify({ auto_sync: autoSync }) }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function forget() {
    setBusy(true)
    try { await api(`${path}/connection`, { method: "DELETE" }); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const needsLogin = !status?.connected || (status.status === "failed" && !status.has_saved_login)
  const summary = status?.summary ?? {}

  return (
    <section aria-label={t("blackboard.title")} className={embedded ? "p-4 sm:p-5" : "mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"}>
      {!embedded && <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><GraduationCap className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("blackboard.title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t("blackboard.subtitle")}</p>
        </div>
      </div>}

      {status?.status === "failed" && status.failure_reason ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t(`blackboard.failure.${status.failure_reason}`)}
            {status.failure_reason === "extra_verification" && status.stage_detail ? (
              <span className="mt-1 block text-foreground">{t("blackboard.extraStep.showed")} <bdi className="font-semibold">{status.stage_detail}</bdi></span>
            ) : null}
          </span>
        </p>
      ) : null}
      {status?.status === "failed" && status.has_screenshot ? (
        <div className="mt-2">
          <button type="button" onClick={() => void toggleShot()} className="text-[13px] font-semibold text-primary underline-offset-2 hover:underline">
            {t(shotUrl ? "blackboard.extraStep.hide" : "blackboard.extraStep.view")}
          </button>
          {shotUrl ? <img src={shotUrl} alt={t("blackboard.extraStep.alt")} className="mt-2 max-h-[480px] w-full rounded-2xl border border-border object-contain object-top" /> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-[13px] text-destructive">{error}</p> : null}

      {running && status ? (
        <p className="mt-4 flex items-center gap-2 text-sm" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t(`blackboard.stage.${status.status as "queued" | "logging_in" | "extracting" | "reading_files" | "saving"}`)}
          {status.stage_detail ? <span className="text-muted-foreground">· <bdi>{status.stage_detail}</bdi></span> : null}
        </p>
      ) : needsLogin ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (username.trim() && password && !busy) void start(true) }}>
          <label className="grid gap-1 text-[13px] font-medium">{t("blackboard.username")}
            <input value={username} onChange={(e) => setTyped(e.target.value)} autoComplete="username" dir="ltr" className="h-11 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="grid gap-1 text-[13px] font-medium">{t("blackboard.password")}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" className="h-11 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          {status?.can_remember === false ? (
            <p className="text-[12px] text-muted-foreground sm:col-span-2">{t("blackboard.rememberUnavailable")}</p>
          ) : (
            <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4" />
              <span>{t("blackboard.remember")}<span className="block text-[12px] text-muted-foreground">{t("blackboard.rememberHint")}</span></span>
            </label>
          )}
          <button type="submit" disabled={!username.trim() || !password || busy} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
            {t(status?.connected || status?.status === "failed" ? "blackboard.signInAgain" : "blackboard.sync")}
          </button>
        </form>
      ) : status ? (
        <div className="mt-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STATS.map((key) => (
              <div key={key} className="rounded-2xl bg-muted/50 px-3 py-2">
                <dt className="text-[12px] text-muted-foreground">{t(`blackboard.stats.${key}`)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{fmt.number(summary[key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {status.last_synced_at ? t("blackboard.synced", { when: fmt.relative(parseServerTime(status.last_synced_at) ?? Date.now()) }) : null}
            {status.auto_sync === false ? ` · ${t("blackboard.autoOff")}`
              : status.next_sync_at ? ` · ${t("blackboard.nextSync", { when: fmt.relative(parseServerTime(status.next_sync_at) ?? Date.now()) })}` : null}
          </p>
          {summary.partial ? <p className="mt-1 text-[12px] text-muted-foreground">{t("blackboard.partial")}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void start(false)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><RotateCcw className="size-4" aria-hidden="true" />{t("blackboard.syncNow")}</button>
            <button type="button" onClick={() => void setAutoSync(status.auto_sync === false)} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              {status.auto_sync === false ? <><Play className="size-4" aria-hidden="true" />{t("blackboard.resumeAuto")}</> : <><Pause className="size-4" aria-hidden="true" />{t("blackboard.stopAuto")}</>}
            </button>
            {onReview && (summary.new_evidence ?? 0) > 0 ? <button type="button" onClick={onReview} className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted">{t("blackboard.reviewNew")}</button> : null}
            <button type="button" onClick={() => void forget()} disabled={busy} className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">{t("blackboard.forget")}</button>
          </div>
        </div>
      ) : null}
      <button type="button" onClick={() => setShowCollection((v) => !v)} className="mt-4 inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted">{t(showCollection ? "blackboard.collection.close" : "blackboard.collection.view")}</button>
      {showCollection && <BlackboardCollection onClose={() => setShowCollection(false)} syncedAt={status?.last_synced_at} />}
    </section>
  )
}
