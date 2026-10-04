"use client"

import { useState } from "react"
import { moveTeamToShared, type MoveTeamResult } from "@/lib/collaboration-auth"
import { errorMessage } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Lead-only, two steps: preview what would move, then confirm. The local copy becomes read-only afterwards. */
export function MoveToShared({ teamId, userId }: { teamId: string; userId: string }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState<MoveTeamResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null)
    try {
      const result = await moveTeamToShared(teamId, userId, { dry_run: dryRun, confirm: !dryRun })
      if (dryRun) setPreview(result); else setDone(true)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  if (done) return <p role="status">{t("teams.move.done")}</p>
  const counts = preview?.summary.counts
  return <div className="tm-list">
    {error ? <p role="alert">{error}</p> : null}
    {!preview ? <>
      <p className="tm-muted">{t("teams.move.hint")}</p>
      <button className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void run(true)}>{t("teams.move.preview")}</button>
    </> : <>
      <p>{t("teams.move.counts", { tasks: counts?.tasks ?? 0, documents: counts?.documents ?? 0, decisions: counts?.decisions ?? 0 })}</p>
      <p className="tm-muted">{t("teams.move.excluded", { items: (preview.summary.excluded ?? []).join(", ") })}</p>
      {preview.summary.unassigned_to_invite?.length
        ? <p className="tm-muted">{t("teams.move.invite", { names: preview.summary.unassigned_to_invite.join(", ") })}</p> : null}
      <label className="tm-field"><span><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> {t("teams.move.confirm")}</span></label>
      <button className="tm-btn tm-btn-sm" disabled={busy || !confirmed} onClick={() => void run(false)}>{t("teams.move.go")}</button>
    </>}
  </div>
}
