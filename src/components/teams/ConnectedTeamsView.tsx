"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CloudOff } from "lucide-react"
import { AccountChip } from "./AccountChip"
import { CoachAccess } from "./CoachAccess"
import { LocalTeams } from "./LocalTeams"
import { collaborationAuth, setCollaborationConsent, type CollaborationSession } from "@/lib/collaboration-auth"
import { centralTeamTransport, fetchCentralCapabilities, type CentralCapabilities } from "@/lib/central-team-transport"
import { errorMessage, teamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

import { GroupProjectsBrowser } from "./GroupProjectsBrowser"

/** Group Projects on the shared server. There is no sign-in: this computer's shared account is created automatically
 * the first time the page opens (see the local API's device broker), so the page goes straight to what you can do. */
export function ConnectedTeamsView() {
  const { t } = useI18n()
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [capabilities, setCapabilities] = useState<CentralCapabilities | null>(null)
  const account = session?.account
  const connect = useCallback(async () => {
    setLoading(true)
    try {
      setSession(await collaborationAuth<CollaborationSession>("session"))
      setError(null)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void connect() }, [connect])
  useEffect(() => {
    setCapabilities(null)
    if (!account || !session) return
    let current = true
    void fetchCentralCapabilities(session.api_origin).then(value => { if (current) setCapabilities(value) })
      .catch(() => { if (current) setCapabilities({ teamAI: false, projectImport: false }) })
    return () => { current = false }
  }, [account?.id, session?.api_origin])
  const client = useMemo(() => account && session && capabilities
    ? teamClient(account.id, centralTeamTransport(session.api_origin, account.id, capabilities)) : null,
  [account?.id, session?.api_origin, capabilities])

  if (error || (!client && !loading && !account)) {
    return <div className="fq tm-page gp-page"><div className="gp-offline" role="alert">
      <CloudOff className="size-7" aria-hidden="true" />
      <h1>{t("teams.gp.offlineTitle")}</h1>
      <p>{t("teams.gp.offlineBody")}</p>
      {error ? <small dir="auto">{error}</small> : null}
      <button type="button" className="tm-btn tm-btn-primary" onClick={() => void connect()}>{t("teams.gp.retry")}</button>
    </div></div>
  }
  if (!client || !account) return <div className="fq tm-page gp-page"><p className="gp-muted gp-centered" role="status">{t("teams.gp.settingUp")}</p></div>
  return <GroupProjectsBrowser key={account.id} client={client} settings={<>
    <AccountChip id={account.id} name={account.display_name} />
    <CoachAccess />
    <LocalTeams />
    <button type="button" className="gp-disconnect" onClick={() => void setCollaborationConsent(false).catch(() => undefined)}>{t("teams.gp.disconnect")}</button>
  </>} />
}
