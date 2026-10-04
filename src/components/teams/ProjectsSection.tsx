"use client"

import { useCallback, useEffect, useState } from "react"
import { InviteRow, NeedsTeamRow } from "@/components/teams/TeamsHome"
import { TeamCover } from "@/components/teams/TeamCover"
import { useTeamClient } from "@/components/teams/team-client-context"
import { errorMessage, type TeamsHomeData } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Invitations, compact project rows, and assignments that still need a team. */
export function ProjectsSection({ onOpenTeam }: { onOpenTeam: (teamId: string) => void }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [home, setHome] = useState<TeamsHomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => { api.home().then(data => { setHome(data); setError(null) }).catch(reason => setError(errorMessage(reason))) }, [api])
  useEffect(() => { load() }, [load])
  if (error) return <div className="gp-inline-error" role="alert"><p>{error}</p><button type="button" className="tm-btn" onClick={load}>{t("teams.gp.retry")}</button></div>
  if (!home) return <p className="gp-muted" role="status">{t("teams.common.loading")}</p>
  const empty = !home.teams.length && !home.invites.length && !home.needs_team.length
  return <>
    {home.invites.length ? <section className="gp-section">
      <h2 className="gp-h2">{t("teams.gp.invitations")}</h2>
      {home.invites.map(invite => <InviteRow key={invite.id} invite={invite} onJoined={onOpenTeam} onChanged={load} />)}
    </section> : null}
    <section className="gp-section">
      <h2 className="gp-h2">{t("teams.gp.projects")}</h2>
      {home.teams.length ? <div className="tm-cover-grid">
        {home.teams.map(card => <TeamCover key={card.id} card={card} onOpen={() => onOpenTeam(card.id)} />)}
      </div> : null}
      {empty ? <div className="gp-empty"><strong>{t("teams.gp.noProjectsTitle")}</strong><p>{t("teams.gp.noProjectsBody")}</p></div> : null}
    </section>
    {home.needs_team.length ? <section className="gp-section">
      <h2 className="gp-h2">{t("teams.gp.assignmentsNeedTeam")}</h2>
      {home.needs_team.map(item => <NeedsTeamRow key={item.assignment_id} item={item} onCreated={onOpenTeam} />)}
    </section> : null}
  </>
}
