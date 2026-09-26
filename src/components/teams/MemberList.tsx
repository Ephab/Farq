"use client"

import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import type { TeamStore } from "@/lib/team-store"
import type { Classmate } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

interface MemberListProps { store: TeamStore; canInvite: boolean; onError: (reason: unknown) => void }

export function MemberList({ store, canInvite, onError }: MemberListProps) {
  const teams = useTeamClient()
  const [picking, setPicking] = useState(false)
  const [classmates, setClassmates] = useState<Classmate[] | null>(null)
  const [invited, setInvited] = useState<string[]>([])
  const team = store.team
  const online = new Map(store.presence.map((entry) => [entry.user_id, entry]))
  const full = team.members.length >= team.assignment.team_size_max
  const candidates = (classmates ?? []).filter((person) => !team.members.some((member) => member.user_id === person.user_id))

  const open = async () => {
    setPicking(true)
    try {
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
    } catch (reason) {
      onError(reason)
    }
  }

  return (
    <section className="tm-members">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>Team · {team.members.length}/{team.assignment.team_size_max}</h2>
      {team.members.map((member) => {
        const entry = online.get(member.user_id)
        return (
          <div key={member.user_id} className="tm-member">
            <Avatar userId={member.user_id} name={member.display_name} size={28} online={Boolean(entry)} typing={Boolean(entry?.typing)} />
            <div className="min-w-0">
              <span className="block truncate">{member.display_name}{member.is_lead ? " · Lead" : ""}</span>
              <small className="truncate">{entry?.typing ? "typing…" : member.role_label || (entry ? "online" : "")}</small>
            </div>
          </div>
        )
      })}
      {canInvite && !full && !picking ? (
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => void open()}>
          <UserPlus className="size-4" aria-hidden="true" /> Invite
        </button>
      ) : null}
      {picking ? (
        <div className="tm-list">
          {classmates === null ? <small className="tm-muted">Loading classmates…</small> : null}
          {classmates !== null && candidates.length === 0 ? <small className="tm-muted">Everyone in this course is on a team.</small> : null}
          {candidates.map((person) => {
            const sent = invited.includes(person.user_id)
            return (
              <div key={person.user_id} className="tm-member">
                <Avatar userId={person.user_id} name={person.display_name} size={24} />
                <span className="min-w-0 flex-1 truncate">{person.display_name}</span>
                <button type="button" className="tm-btn tm-btn-sm" disabled={person.has_team || sent} onClick={() => void invite(person.user_id)}>
                  {person.has_team ? "Has a team" : sent ? "Invited" : "Invite"}
                </button>
              </div>
            )
          })}
          <button type="button" className="tm-back" onClick={() => setPicking(false)}>Done</button>
        </div>
      ) : null}
    </section>
  )
}
