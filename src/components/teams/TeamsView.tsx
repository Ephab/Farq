"use client"

import { useEffect, useMemo, useState } from "react"
import { TeamWorkspace } from "@/components/teams/TeamWorkspace"
import { TeamsHome } from "@/components/teams/TeamsHome"
import { ViewAsSwitcher } from "@/components/teams/ViewAsSwitcher"
import { TeamClientContext } from "@/components/teams/team-client-context"
import { ACTING_USER_EVENT, getActingUserId, teamClient } from "@/lib/teams-api"
import "@/components/hermes/coach-concept.css"
import "./teams.css"

export function TeamsView() {
  const [actingUser, setActingUser] = useState(getActingUserId)
  const [teamId, setTeamId] = useState<string | null>(null)
  // One client per acting user: views bound to it keep acting as that user
  // until they unmount, even if View-as changes mid-request.
  const client = useMemo(() => teamClient(actingUser), [actingUser])

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
    <div className="fq tm-page">
      <div className="tm-topbar">
        <div>
          <h1 className="tm-title">Group Projects</h1>
          <p className="tm-sub">Your course teams: tasks, chat and documents in one place.</p>
        </div>
        <ViewAsSwitcher value={actingUser} />
      </div>
      {teamId ? (
        <TeamWorkspace key={`${actingUser}:${teamId}`} teamId={teamId} onBack={() => setTeamId(null)} />
      ) : (
        <TeamsHome key={actingUser} onOpenTeam={setTeamId} />
      )}
    </div>
    </TeamClientContext.Provider>
  )
}
