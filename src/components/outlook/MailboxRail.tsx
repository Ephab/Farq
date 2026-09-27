import { useState, type ReactNode } from "react"
import { Pause, Play, RefreshCw } from "lucide-react"

import type { OutlookStatus } from "@/lib/outlook-api"

import { ClassifierPicker } from "./ClassifierPicker"
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

export function syncLine(status: OutlookStatus) {
  if (status.status === "running" || status.status === "queued") return `Syncing · ${status.processed ?? 0} classified so far`
  if (status.last_sync) return `Synced ${new Date(status.last_sync * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
  return "First sync not finished yet"
}

interface MailboxRailProps {
  status: OutlookStatus
  busy: boolean
  onAction: (path: string, method: string, body?: object) => Promise<boolean>
  onReconnected: () => void
}

/** Everything about the connection itself, kept beside the inbox instead of above it. */
export function MailboxRail({ status, busy, onAction, onReconnected }: MailboxRailProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const syncing = status.status === "running" || status.status === "queued"

  return (
    <aside aria-label="Mailbox settings" className="rounded-2xl border border-border bg-background xl:sticky xl:top-4">
      <Section title="Mailbox">
        <p className="mt-1 truncate text-xs text-muted-foreground" title={status.account}>
          {status.provider === "desktop" ? "Classic Outlook" : "Microsoft Graph token"} · {status.account}
        </p>
        <p aria-live="polite" className="mt-3 flex items-center gap-2 text-xs">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${status.error ? "bg-amber-500" : syncing ? "animate-pulse bg-primary" : "bg-emerald-500"}`} />
          {syncLine(status)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{status.auto_sync ? "Syncs every 15 minutes while Waypoint runs." : "Automatic sync is paused."}</p>
        <div className="mt-3 flex gap-2">
          <button className={control} disabled={busy || status.status === "running"} onClick={() => void onAction("/sync", "POST")}>
            <RefreshCw className={`size-3.5 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`} />Sync now
          </button>
          <button className={control} disabled={busy} onClick={() => void onAction("/preferences", "PATCH", { auto_sync: !status.auto_sync })}>
            {status.auto_sync ? <><Pause className="size-3.5" />Pause</> : <><Play className="size-3.5" />Resume</>}
          </button>
        </div>
        {status.worker_enabled === false && (
          <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            Sync is off on the server. Set OUTLOOK_SYNC_ENABLED=true and restart the API.
          </p>
        )}
        {status.error && <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs leading-5">{status.error}</p>}
        {status.status === "reconnect" && status.provider === "token" && (
          <div className="mt-3"><TokenConnection available={!!status.token_available} onConnected={onReconnected} /></div>
        )}
      </Section>

      {status.classifiers ? (
        <Section title="Classifier">
          <ClassifierPicker
            engines={status.classifiers}
            selected={status.classifier ?? "laya"}
            busy={busy}
            onSelect={(engine) => void onAction("/classifier", "PATCH", { engine })}
          />
        </Section>
      ) : null}

      <Section title="Coach access">
        <label className="mt-2 flex items-start gap-2.5 text-xs leading-5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!status.coach_access}
            disabled={busy}
            onChange={(event) => void onAction("/coach-access", "PATCH", { accepted: event.target.checked })}
          />
          <span>
            Let Coach search and read my synced emails in this browser's chats.
            <span className="mt-1 block text-muted-foreground">
              Matching text may go to your AI providers, including fallbacks, and stay in their history. Uncheck to stop.
            </span>
          </span>
        </label>
      </Section>

      <Section title="How the views work">
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
          <li><span className="font-medium text-foreground">Important</span> has your pinned mail and the classifier's picks.</li>
          <li><span className="font-medium text-foreground">Today</span> has mail received today, plus follow-ups due today.</li>
          <li><span className="font-medium text-foreground">Needs review</span> keeps Arabic and uncertain mail you haven't checked.</li>
          <li>Labels are suggestions, never confirmed facts.</li>
        </ul>
      </Section>

      <div className="border-t border-border p-4">
        {confirmDisconnect ? (
          <div role="alert">
            <p className="text-xs leading-5">Disconnect and delete cached mail, labels and follow-up dates from Waypoint? Your Outlook mailbox isn't touched.</p>
            <div className="mt-3 flex gap-2">
              <button className={`${control} border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300`} disabled={busy} onClick={() => { setConfirmDisconnect(false); void onAction("/connection", "DELETE") }}>
                Disconnect and delete
              </button>
              <button className={control} onClick={() => setConfirmDisconnect(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-red-300" onClick={() => setConfirmDisconnect(true)}>
            Disconnect mailbox
          </button>
        )}
      </div>
    </aside>
  )
}
