import { useState, type ReactNode } from "react"

import { InfoTip } from "./InfoTip"

import type { OutlookStatus } from "@/lib/outlook-api"
import { useI18n } from "@/lib/i18n/context"

import { TokenConnection } from "./TokenConnection"


const control = "inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border p-4 first:border-t-0" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

type I18n = ReturnType<typeof useI18n>

export function syncLine(status: OutlookStatus, { t, fmt }: Pick<I18n, "t" | "fmt">) {
  if (status.status === "running" || status.status === "queued") return t("emails.rail.syncing", { count: status.processed ?? 0 })
  if (status.last_sync) return t("emails.rail.synced", { time: fmt.dateTime(status.last_sync * 1000) })
  return t("emails.rail.firstSync")
}

interface MailboxRailProps {
  status: OutlookStatus
  busy: boolean
  onAction: (path: string, method: string, body?: object) => Promise<boolean>
  onReconnected: () => void
}

/** Everything about the connection itself, kept beside the inbox instead of above it. */
export function MailboxRail({ status, busy, onAction, onReconnected }: MailboxRailProps) {
  const i18n = useI18n()
  const { t } = i18n
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const syncing = status.status === "running" || status.status === "queued"

  return (
    <aside aria-label={t("emails.rail.label")} className="rounded-2xl border border-border bg-background xl:sticky xl:top-4">
      <Section title={t("emails.rail.mailbox")}>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={status.account}>
          {status.provider === "desktop" ? t("emails.rail.classicOutlook") : t("emails.rail.graphToken")} · <span className="ltr-value">{status.account}</span>
        </p>
        <p aria-live="polite" className="mt-3 flex items-center gap-2 text-xs">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${status.error ? "bg-amber-500" : syncing ? "animate-pulse bg-primary" : "bg-emerald-500"}`} />
          {syncLine(status, i18n)}
          <InfoTip label={t("emails.rail.aboutSync")}>{status.auto_sync ? t("emails.rail.autoOn") : t("emails.rail.autoOff")}</InfoTip>
        </p>
        {status.worker_enabled === false && (
          <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            {t("emails.rail.workerOff", { setting: "⁦OUTLOOK_SYNC_ENABLED=true⁩" })}
          </p>
        )}
        {status.error && <p role="status" dir="auto" className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs leading-5">{status.error}</p>}
        {status.status === "reconnect" && status.provider === "token" && (
          <div className="mt-3"><TokenConnection available={!!status.token_available} onConnected={onReconnected} /></div>
        )}
      </Section>

      <Section title={t("emails.rail.coachAccess")}>
        <label className="mt-2 flex items-start gap-2.5 text-xs leading-5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!status.coach_access}
            disabled={busy}
            onChange={(event) => void onAction("/coach-access", "PATCH", { accepted: event.target.checked })}
          />
          <span>
            {t("emails.rail.coachConsent")}{" "}
            <InfoTip label={t("emails.rail.aboutCoach")}>{t("emails.rail.coachInfo")}</InfoTip>
          </span>
        </label>
      </Section>

      <Section title={t("emails.rail.howViews")}>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
          <li><span className="font-medium text-foreground">{t("emails.views.important")}</span> {t("emails.rail.howImportant")}</li>
          <li><span className="font-medium text-foreground">{t("emails.views.today")}</span> {t("emails.rail.howToday")}</li>
          <li><span className="font-medium text-foreground">{t("emails.views.review")}</span> {t("emails.rail.howReview")}</li>
          <li>{t("emails.rail.howLabels")}</li>
        </ul>
      </Section>

      <div className="border-t border-border p-4">
        {confirmDisconnect ? (
          <div role="alert">
            <p className="text-xs leading-5">{t("emails.rail.disconnectConfirm")}</p>
            <div className="mt-3 flex gap-2">
              <button className={`${control} border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300`} disabled={busy} onClick={() => { setConfirmDisconnect(false); void onAction("/connection", "DELETE") }}>
                {t("emails.rail.disconnectDelete")}
              </button>
              <button className={control} onClick={() => setConfirmDisconnect(false)}>{t("emails.rail.cancel")}</button>
            </div>
          </div>
        ) : (
          <button className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-red-300" onClick={() => setConfirmDisconnect(true)}>
            {t("emails.rail.disconnect")}
          </button>
        )}
      </div>
    </aside>
  )
}
