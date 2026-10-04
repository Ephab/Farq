"use client"

import { useEffect, useMemo, useState } from "react"
import { TeamWorkspace } from "@/components/teams/TeamWorkspace"
import { TeamsHome } from "@/components/teams/TeamsHome"
import { ViewAsSwitcher } from "@/components/teams/ViewAsSwitcher"
import { TeamClientContext } from "@/components/teams/team-client-context"
import { ACTING_USER_EVENT, getActingUserId, teamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"
import "@/components/hermes/coach-concept.css"
import "./teams.css"
import "./groups.css"
import "./workspace.css"
import { ConnectedTeamsView } from "./ConnectedTeamsView"
import { ConnectPane } from "./ConnectPane"
import { useCollaborationMode } from "@/lib/collaboration-mode"
import { DemoTeamsView } from "./DemoTeamsView"

export function TeamsView() {
  const mode = useCollaborationMode()
  const [later, setLater] = useState(false)
  if (mode.kind === "loading") return null
  if (mode.kind === "demo") return <DemoTeamsView />
  if (mode.kind === "connected") return <ConnectedTeamsView />
  if (mode.kind === "ask" && !later) return <ConnectPane server={mode.server} onLater={() => setLater(true)} />
  return <LocalTeamsView />
}

function LocalTeamsView() {
  const { t } = useI18n()
  const [actingUser, setActingUser] = useState(getActingUserId)
  const [teamId, setTeamId] = useState<string | null>(null)
  // One client per acting user: views bound to it keep acting as that user
  // until they unmount, even if View-as changes mid-request.
  const client = useMemo(() => teamClient(actingUser), [actingUser])
  const openTeam = (id: string) => setTeamId(id)

  useEffect(() => {
    const onChange = () => {
      setActingUser(getActingUserId())
      setTeamId(null)
    }
    window.addEventListener(ACTING_USER_EVENT, onChange)
    return () => window.removeEventListener(ACTING_USER_EVENT, onChange)
  }, [])

  return (
    <TeamClientContext.Provider value={client}>
    <div className={`fq tm-page gp-page${teamId ? " gp-page-wide" : " tm-page-home"}`}>
      {!teamId ? <div className="gp-head">
        <div>
          <h1 className="gp-title">{t("teams.page.title")}</h1>
          <p className="gp-sub">{t("teams.page.subtitle")}</p>
        </div>
        <ViewAsSwitcher value={actingUser} />
      </div> : null}
      {teamId ? (
        <TeamWorkspace key={`${actingUser}:${teamId}`} teamId={teamId} onBack={() => setTeamId(null)} />
      ) : (
        <TeamsHome key={actingUser} onOpenTeam={openTeam} />
      )}
    </div>
    </TeamClientContext.Provider>
  )
}
