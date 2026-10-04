"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CloudOff } from "lucide-react"
import { useAnimatedSidebar } from "@/components/motion/animated-sidebar"
import { AccountChip } from "./AccountChip"
import { ClassesSection } from "./ClassesSection"
import { ClassPage } from "./ClassPage"
import { CoachAccess } from "./CoachAccess"
import { LocalTeams } from "./LocalTeams"
import { ProjectsSection } from "./ProjectsSection"
import { StartPanel } from "./StartPanel"
import { TeamClientContext } from "./team-client-context"
import { TeamWorkspace } from "./TeamWorkspace"
import { collaborationAuth, setCollaborationConsent, type CollaborationSession } from "@/lib/collaboration-auth"
import { centralTeamTransport, fetchCentralCapabilities, type CentralCapabilities } from "@/lib/central-team-transport"
import { cleanCode, type StartMode } from "@/lib/gp-format"
import { errorMessage, teamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

type Route = { kind: "home" } | { kind: "class"; id: string } | { kind: "team"; id: string }

/** Group Projects on the shared server. There is no sign-in: this computer's shared account is created automatically
 * the first time the page opens (see the local API's device broker), so the page goes straight to what you can do. */
export function ConnectedTeamsView() {
  const { t } = useI18n()
  const sidebar = useAnimatedSidebar()
  const [session, setSession] = useState<CollaborationSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>({ kind: "home" })
  const [revision, setRevision] = useState(0)
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
  useEffect(() => { setRoute({ kind: "home" }) }, [account?.id])
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

  const refresh = () => setRevision(value => value + 1)
  const openTeam = (id: string) => { setRoute({ kind: "team", id }); sidebar.setOpen(false); sidebar.setOpenMobile(false) }
  const openClass = (id: string) => { setRoute({ kind: "class", id }); sidebar.setOpen(false); sidebar.setOpenMobile(false) }
  const home = () => { setRoute({ kind: "home" }); refresh() }
  const start = async (mode: StartMode, value: string): Promise<boolean> => {
    if (!client) return false
    setBusy(true); setStartError(null)
    try {
      if (mode === "project") openTeam((await client.createRoom(value)).id)
      else if (mode === "class") openClass((await client.createClass(value)).id)
      else {
        const joined = await client.redeemCode(cleanCode(value))
        if (joined.team_id) openTeam(joined.team_id)
        else if (joined.class_id) openClass(joined.class_id)
        else refresh()
      }
      return true
    } catch (reason) { setStartError(errorMessage(reason)); return false }
    finally { setBusy(false) }
  }

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
  const inWorkspace = route.kind === "team"
  return (
    <div className={`fq tm-page gp-page${inWorkspace ? " gp-page-wide" : ""}`}>
      <TeamClientContext.Provider value={client}>
        {route.kind === "team" ? <TeamWorkspace key={`${account.id}:${route.id}`} teamId={route.id} onBack={home} />
          : route.kind === "class" ? <ClassPage key={`${account.id}:${route.id}`} id={route.id} onBack={home} onOpenTeam={openTeam} onChanged={refresh} />
          : <div className="gp-home">
            <header className="gp-head">
              <div><h1 className="gp-title">{t("teams.page.title")}</h1><p className="gp-sub">{t("teams.gp.subtitle")}</p></div>
              <AccountChip id={account.id} name={account.display_name} />
            </header>
            <StartPanel busy={busy} error={startError} onSubmit={start} />
            <ProjectsSection key={`p:${account.id}:${revision}`} onOpenTeam={openTeam} />
            <ClassesSection key={`c:${account.id}:${revision}`} onOpenClass={openClass} />
            <LocalTeams />
            <CoachAccess />
            <button type="button" className="gp-disconnect" onClick={() => void setCollaborationConsent(false).catch(() => undefined)}>{t("teams.gp.disconnect")}</button>
          </div>}
      </TeamClientContext.Provider>
    </div>
  )
}
