"use client"

import { useRef, useState } from "react"
import { Check, Copy, UserPlus } from "lucide-react"
import { Sheet } from "@/components/teams/ui"
import { useTeamClient } from "@/components/teams/team-client-context"
import { groupCode } from "@/lib/gp-format"
import { errorMessage } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

type Issued = { id: string; code: string; expires_at: string }

/** One button that makes an invitation code and shows it, ready to send, in a side sheet. Works for classes and projects. */
export function InviteCode({ kind, id, label, compact = false }: { kind: "classes" | "teams"; id: string; label: string; compact?: boolean }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [issued, setIssued] = useState<Issued | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await action() } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const make = () => run(async () => { setIssued(await api.issueCode(kind, id)); setCopied(false); setOpen(true) })
  const revoke = () => run(async () => { if (issued) await api.revokeCode(issued.id); setIssued(null); setOpen(false) })
  const copy = async () => {
    if (!issued) return
    try { await navigator.clipboard.writeText(groupCode(issued.code)); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { /* blocked clipboard */ }
  }
  return <div className="gp-invite">
    <button ref={trigger} type="button" className={`tm-btn tm-btn-primary${compact ? " tm-btn-sm" : ""}`} disabled={busy} onClick={() => (issued ? setOpen(true) : void make())}>
      <UserPlus className="size-4" aria-hidden="true" /> {label}
    </button>
    {error && !open ? <p className="gp-error" role="alert">{error}</p> : null}
    {open && issued ? <Sheet title={label} returnFocus={trigger} onClose={() => setOpen(false)} footer={<button type="button" className="tm-btn" onClick={() => setOpen(false)}>{t("teams.gp.done")}</button>}>
      <div className="gp-invite-sheet">
        <p className="gp-muted">{t("teams.gp.inviteHint")}</p>
        <strong className="gp-code gp-code-big" dir="ltr" aria-label={groupCode(issued.code)}>{groupCode(issued.code)}</strong>
        <div><button type="button" className="tm-btn tm-btn-primary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />} {copied ? t("teams.gp.copied") : t("teams.gp.copyCode")}
        </button></div>
        <p className="gp-muted">{t("teams.gp.codeExpires", { date: new Date(issued.expires_at).toLocaleDateString() })}</p>
        <p className="gp-muted"><button type="button" className="gp-link" disabled={busy} onClick={() => void make()}>{t("teams.gp.newCode")}</button>
          {" · "}<button type="button" className="gp-link" disabled={busy} onClick={() => void revoke()}>{t("teams.gp.revoke")}</button></p>
        {error ? <p className="gp-error" role="alert">{error}</p> : null}
      </div>
    </Sheet> : null}
  </div>
}
