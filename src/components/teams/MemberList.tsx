import { ProfilePanel } from "./ProfilePanel"
"use client"

import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import type { TeamStore } from "@/lib/team-store"
import type { Classmate } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"
import { useI18n } from "@/lib/i18n/context"
import { ManageOpening } from "./OpeningsPanel"
import { MoveToShared } from "./MoveToShared"
import { InviteCode } from "./InviteCode"

interface MemberListProps { store: TeamStore; canInvite: boolean; onError: (reason: unknown) => void }

export function MemberList({ store, canInvite, onError }: MemberListProps) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const [picking, setPicking] = useState(false)
  const [classmates, setClassmates] = useState<Classmate[] | null>(null)
  const [invited, setInvited] = useState<string[]>([])
  const [inviteId, setInviteId] = useState("")
  const team = store.team
  const online = new Map(store.presence.map((entry) => [entry.user_id, entry]))
  const full = team.members.length >= team.size_limit
  const candidates = (classmates ?? []).filter((person) => !team.members.some((member) => member.user_id === person.user_id))

  const open = async () => {
    setPicking(true)
    try {
      if (!team.assignment.id && teams.central) { setClassmates([]); return }
      setClassmates(await teams.classmates(team.assignment.id))
    } catch (reason) {
      onError(reason)
      setPicking(false)
    }
  }
  const invite = async (userId: string) => {
    try {
      await teams.invite(team.id, userId)
      setInvited((ids) => [...ids, userId])
      return true
    } catch (reason) {
      onError(reason)
      return false
    }
  }

  return (
    <section className="tm-members">
      <h2 className="gp-h3" style={{ marginBottom: 0 }}>{team.assignment.id ? t("teams.members.heading", { count: team.members.length, limit: team.size_limit }) : `${t("teams.gp.people2")} · ${team.members.length}`}</h2>
      {team.members.map((member) => {
        const entry = online.get(member.user_id)
        return (
          <div key={member.user_id} className="tm-member">
            <Avatar userId={member.user_id} name={member.display_name} size={28} online={Boolean(entry)} typing={Boolean(entry?.typing)} />
            <div className="min-w-0">
              <span className="block truncate"><bdi>{member.display_name}</bdi>{member.is_lead ? ` · ${t("teams.members.lead")}` : ""}</span>
              <small className="truncate" dir="auto">{entry?.typing ? t("teams.members.typing") : (member.is_lead && member.role_label === "Lead" ? "" : member.role_label) || (entry ? t("teams.members.online") : "")}</small>
            </div>
            {teams.central && team.lead_user_id === teams.userId && member.user_id !== teams.userId ? <button className="tm-btn tm-btn-sm" onClick={() => void teams.transferLead(team.id, member.user_id).catch(onError)}>{t("teams.classes.transfer")}</button> : null}
          </div>
        )
      })}
      {teams.central && team.lead_user_id === teams.userId ? <div className="gp-rail-actions">
        <InviteCode kind="teams" id={team.id} label={t("teams.gp.invite")} compact />
        <details className="gp-details gp-details-tight">
          <summary>{t("teams.gp.projectSettings")}</summary>
          <div className="gp-rail-actions">
            {team.assignment.id ? <ManageOpening key={team.id} teamId={team.id} /> : null}
            {!team.assignment.id && !full && !picking ? <div><button type="button" className="tm-btn tm-btn-sm" onClick={() => void open()}>{t("teams.gp.inviteById")}</button></div> : null}
            <p className="gp-muted">{t("teams.classes.archiveHint")}</p>
            <div><button className="tm-btn tm-btn-sm" onClick={() => void teams.archiveProject(team.id, "archive").catch(onError)}>{t("teams.classes.archiveProject")}</button></div>
          </div>
        </details>
      </div> : null}
      {!teams.central && team.lead_user_id === teams.userId ? <MoveToShared teamId={team.id} userId={teams.userId} /> : null}
      {canInvite && !full && !picking && !(teams.central && !team.assignment.id) ? (
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => void open()}>
          <UserPlus className="size-4" aria-hidden="true" /> {t("teams.members.invite")}
        </button>
      ) : null}
      {picking ? (
        <div className="tm-list">
          {!team.assignment.id && teams.central ? <form onSubmit={event => { event.preventDefault(); void invite(inviteId.trim()).then(sent => { if (sent) setInviteId("") }) }}>
            <label className="tm-field">{t("teams.connected.inviteId")}<input className="tm-input" value={inviteId} onChange={event => setInviteId(event.target.value)} maxLength={36} /></label>
            <small>{t("teams.connected.inviteIdHint")}</small>
            <button className="tm-btn tm-btn-sm" disabled={inviteId.trim().length !== 36}>{t("teams.members.invite")}</button>
          </form> : null}
          {classmates === null ? <small className="tm-muted">{t("teams.members.loadingClassmates")}</small> : null}
          {classmates !== null && candidates.length === 0 && (!teams.central || Boolean(team.assignment.id)) ? <small className="tm-muted">{t("teams.members.everyoneOnTeam")}</small> : null}
          {candidates.map((person) => {
            const sent = invited.includes(person.user_id)
            return (
              <div key={person.user_id} className="tm-member">
                <Avatar userId={person.user_id} name={person.display_name} size={24} />
                <span className="min-w-0 flex-1 truncate" dir="auto">{person.display_name}</span>
                <button type="button" className="tm-btn tm-btn-sm" disabled={person.has_team || sent} onClick={() => void invite(person.user_id)}>
                  {person.has_team ? t("teams.members.hasTeam") : sent ? t("teams.members.invited") : t("teams.members.invite")}
                </button>
              </div>
            )
          })}
          <button type="button" className="tm-back" onClick={() => setPicking(false)}>{t("teams.common.done")}</button>
        </div>
      ) : null}
      {teams.central && team.members.some(member => member.user_id === teams.userId) ? <details className="gp-details gp-details-tight">
        <summary>{t("teams.gp.teamSummary")}</summary>
        <ProfilePanel key={team.id} teamId={team.id} classProject={Boolean(team.assignment.id)} />
      </details> : null}
    </section>
  )
}
