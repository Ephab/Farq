"use client"

import { useEffect, useState } from "react"
import { coachAccess } from "@/lib/collaboration-auth"
import { errorMessage } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Lets the personal Hermes coach search classes and teams for you (read-only, two hours). Off until you switch it on. */
export function CoachAccess() {
  const { t } = useI18n()
  const [on, setOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void coachAccess("GET").then(status => setOn(status.coach_access)).catch(() => setOn(false)) }, [])
  const toggle = async (next: boolean) => {
    setError(null)
    try { setOn((await coachAccess(next ? "POST" : "DELETE")).coach_access) } catch (reason) { setError(errorMessage(reason)) }
  }
  return <section className="gp-coach" aria-labelledby="gp-coach-title">
    <div>
      <h3 id="gp-coach-title" className="gp-h3">{t("teams.gp.coachTitle")}</h3>
      <p className="gp-muted">{t("teams.gp.coachHint")}</p>
      {error ? <p className="gp-error" role="alert">{error}</p> : null}
    </div>
    <label className="gp-switch">
      <input type="checkbox" role="switch" checked={on} onChange={event => void toggle(event.target.checked)} />
      <span className="gp-switch-track" aria-hidden="true"><i /></span>
      <span>{t("teams.gp.coachLabel")}</span>
    </label>
  </section>
}
