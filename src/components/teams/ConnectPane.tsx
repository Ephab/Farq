"use client"

import { useState } from "react"
import { Cloud } from "lucide-react"
import { setCollaborationConsent } from "@/lib/collaboration-auth"
import { errorMessage } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Shown the first time, before anything leaves this computer: Group Projects runs on an external server. */
export function ConnectPane({ server, onLater }: { server: string; onLater: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agree = async () => {
    setBusy(true); setError(null)
    try { await setCollaborationConsent(true) } catch (reason) { setError(errorMessage(reason)); setBusy(false) }
  }
  return (
    <div className="fq tm-page gp-page">
      <section className="gp-connect" aria-labelledby="gp-connect-title">
        <Cloud className="size-7" aria-hidden="true" />
        <h1 id="gp-connect-title">{t("teams.gp.connectTitle")}</h1>
        <p>{t("teams.gp.connectIntro")} <bdi dir="ltr" className="gp-server">{server}</bdi></p>
        <div className="gp-connect-cols">
          <div><h2>{t("teams.gp.connectSharedHead")}</h2><ul>
            <li>{t("teams.gp.connectShared1")}</li><li>{t("teams.gp.connectShared2")}</li><li>{t("teams.gp.connectShared3")}</li></ul></div>
          <div><h2>{t("teams.gp.connectKeptHead")}</h2><ul>
            <li>{t("teams.gp.connectKept1")}</li><li>{t("teams.gp.connectKept2")}</li></ul></div>
        </div>
        <p className="gp-connect-note">{t("teams.gp.connectNote")}</p>
        {error ? <small role="alert" dir="auto">{error}</small> : null}
        <div className="gp-connect-actions">
          <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void agree()}>{t("teams.gp.connectAgree")}</button>
          <button type="button" className="tm-btn" disabled={busy} onClick={onLater}>{t("teams.gp.connectLater")}</button>
        </div>
      </section>
    </div>
  )
}
