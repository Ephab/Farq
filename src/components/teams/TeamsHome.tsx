"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, UserPlus, Users } from "lucide-react"
import { TeamCover } from "@/components/teams/TeamCover"
import { coverFor } from "@/lib/team-cover"
import { briefingLines, dueLabel } from "@/lib/team-format"
import { errorMessage, type NeedsTeam, type TeamInvite, type TeamsHomeData } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

export function TeamsHome({ onOpenTeam }: { onOpenTeam: (teamId: string) => void }) {
  const teams = useTeamClient()
  const [home, setHome] = useState<TeamsHomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    teams.home().then((data) => { setHome(data); setError(null) }).catch((reason) => setError(errorMessage(reason)))
  }, [teams])
  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="tm-empty">
        <p>{error}</p>
        <button type="button" className="tm-btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!home) return <div className="tm-empty">Loading your teams…</div>
  const instructor = home.user.role === "instructor"
  return (
    <div className="tm-home">
      <div className="tm-briefing">
        <Sparkles className="size-4 shrink-0 text-[var(--fq-accent)]" aria-hidden="true" />
        <ul>{briefingLines(home).map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
      {home.invites.length > 0 ? (
        <section>
          <h2 className="tm-h2">Invites</h2>
          {home.invites.map((invite) => <InviteRow key={invite.id} invite={invite} onJoined={onOpenTeam} onChanged={load} />)}
        </section>
      ) : null}
      <section>
        <h2 className="tm-h2">{instructor ? "Teams in your courses" : "Your teams"}</h2>
        {home.teams.length > 0 ? (
          <div className="tm-cover-grid">
            {home.teams.map((card) => <TeamCover key={card.id} card={card} onOpen={() => onOpenTeam(card.id)} />)}
          </div>
        ) : (
          <p className="tm-muted">{instructor ? "No teams have formed in your courses yet." : "You're not on a team yet. Create one below."}</p>
        )}
      </section>
      {home.needs_team.length > 0 ? (
        <section>
          <h2 className="tm-h2">Needs a team</h2>
          {home.needs_team.map((item) => <NeedsTeamRow key={item.assignment_id} item={item} onCreated={onOpenTeam} />)}
        </section>
      ) : null}
    </div>
  )
}

interface InviteRowProps { invite: TeamInvite; onJoined: (teamId: string) => void; onChanged: () => void }

function InviteRow({ invite, onJoined, onChanged }: InviteRowProps) {
  const teams = useTeamClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (accept: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (accept) {
        const team = await teams.acceptInvite(invite.id)
        onJoined(team.id)
      } else {
        await teams.declineInvite(invite.id)
        onChanged()
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tm-row">
      <UserPlus className="size-5 text-[var(--fq-accent)]" aria-hidden="true" />
      <div className="tm-row-main">
        <strong>{invite.invited_by_name} invited you to {invite.team_name}</strong>
        <span>{error ?? invite.assignment_title}</span>
      </div>
      <button type="button" className="tm-btn" disabled={busy} onClick={() => void act(false)}>Decline</button>
      <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void act(true)}>Join team</button>
    </div>
  )
}

function NeedsTeamRow({ item, onCreated }: { item: NeedsTeam; onCreated: (teamId: string) => void }) {
  const teams = useTeamClient()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const due = dueLabel(item.deadline)
  const swatch = coverFor(item.assignment_id)
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const team = await teams.createTeam(item.assignment_id, name.trim())
      onCreated(team.id)
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }
  return (
    <div className="tm-row">
      <span className="tm-row-swatch" style={{ backgroundImage: swatch.image, backgroundColor: swatch.color }} aria-hidden="true" />
      <div className="tm-row-main">
        <strong>{item.course.code} · {item.title}</strong>
        <span>{error ?? `Teams of ${item.team_size_min}–${item.team_size_max}${due ? ` · ${due}` : ""} · ${item.open_classmates} classmates without a team`}</span>
      </div>
      {naming ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <input className="tm-input" style={{ width: 180 }} autoFocus placeholder="Team name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="tm-btn tm-btn-primary" disabled={busy || name.trim().length < 2}>Create</button>
        </form>
      ) : (
        <>
          <button type="button" className="tm-btn" disabled title="Coming soon: Hermes suggests classmates who complement you">
            <Users className="size-4" aria-hidden="true" /> Find teammates
          </button>
          <button type="button" className="tm-btn tm-btn-primary" onClick={() => setNaming(true)}>Create team</button>
        </>
      )}
    </div>
  )
}
