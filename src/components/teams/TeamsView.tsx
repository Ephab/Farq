"use client"

import { useEffect, useState } from "react"
import { TeamWorkspace } from "@/components/teams/TeamWorkspace"
import { TeamsHome } from "@/components/teams/TeamsHome"
import { ViewAsSwitcher } from "@/components/teams/ViewAsSwitcher"
import { ACTING_USER_EVENT, getActingUserId } from "@/lib/teams-api"
import "@/components/hermes/coach-concept.css"
import "./teams.css"

export function TeamsView() {
  const [actingUser, setActingUser] = useState(getActingUserId)
  const [teamId, setTeamId] = useState<string | null>(null)

  useEffect(() => {
    const onChange = () => {
      setActingUser(getActingUserId())
      setTeamId(null)
    }
    window.addEventListener(ACTING_USER_EVENT, onChange)
    return () => window.removeEventListener(ACTING_USER_EVENT, onChange)
  }, [])

  return (
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
  )
}
