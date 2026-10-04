"use client"

import { useEffect, useMemo, useState } from "react"
import { MoveToShared } from "./MoveToShared"
import { getActingUserId, teamClient, type TeamCard } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Teams that exist only on this computer. A lead can move one to the shared server so friends elsewhere can join. */
export function LocalTeams() {
  const { t } = useI18n()
  const userId = useMemo(() => getActingUserId(), [])
  const [teams, setTeams] = useState<TeamCard[]>([])
  useEffect(() => {
    let current = true
    void teamClient(userId).home().then(home => { if (current) setTeams(home.teams.filter(team => team.viewer_role === "lead" && !team.moved)) })
      .catch(() => { if (current) setTeams([]) })
    return () => { current = false }
  }, [userId])
  if (!teams.length) return null
  return <details className="gp-details">
    <summary>{t("teams.gp.onThisComputer")} · {teams.length}</summary>
    <p className="gp-muted">{t("teams.gp.onThisComputerHint")}</p>
    <ul className="gp-local">
      {teams.map(team => <li key={team.id}>
        <strong dir="auto"><bdi>{team.name}</bdi></strong>
        <MoveToShared teamId={team.id} userId={userId} />
      </li>)}
    </ul>
  </details>
}
