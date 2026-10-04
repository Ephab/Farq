"use client"

import { useCallback, useEffect, useState } from "react"
import { Sparkles, UserPlus, Users } from "lucide-react"
import { TeamCover } from "@/components/teams/TeamCover"
import { coverFor } from "@/lib/team-cover"
import { briefingLines, dueLabel } from "@/lib/team-format"
import { errorMessage, type NeedsTeam, type TeamInvite, type TeamsHomeData } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"
import { useI18n } from "@/lib/i18n/context"

export function TeamsHome({ onOpenTeam }: { onOpenTeam: (teamId: string) => void }) {
  const teams = useTeamClient()
  const { t } = useI18n()
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
        <button type="button" className="tm-btn" onClick={load}>{t("teams.common.tryAgain")}</button>
      </div>
    )
  }
  if (!home) return <div className="tm-empty">{t("teams.home.loading")}</div>
  const instructor = home.user.role === "instructor"
  return (
    <div className="tm-home tm-home-split">
      <div className="tm-home-main">
      {home.invites.length > 0 ? (
        <section>
          <h2 className="tm-h2">{t("teams.home.invites")}</h2>
          {home.invites.map((invite) => <InviteRow key={invite.id} invite={invite} onJoined={onOpenTeam} onChanged={load} />)}
        </section>
      ) : null}
      <section>
        <h2 className="tm-h2">{instructor ? t("teams.home.courseTeams") : t("teams.home.yourTeams")}</h2>
        {home.teams.length > 0 ? (
          <div className="tm-cover-grid">
            {home.teams.map((card) => <TeamCover key={card.id} card={card} onOpen={() => onOpenTeam(card.id)} />)}
          </div>
        ) : (
          <p className="tm-muted">{instructor ? t("teams.briefing.instructorNone") : home.needs_team.length ? t("teams.home.noTeamsStudent") : t("teams.home.noTeamsNoAssignment")}</p>
        )}
      </section>
      {home.needs_team.length > 0 ? (
        <section>
          <h2 className="tm-h2">{t("teams.home.needsTeam")}</h2>
          {home.needs_team.map((item) => <NeedsTeamRow key={item.assignment_id} item={item} onCreated={onOpenTeam} />)}
        </section>
      ) : null}
      </div>
      <aside className="tm-briefing-side" aria-label={t("teams.home.insights")}>
        <h2 className="tm-h2">{t("teams.home.insights")}</h2>
        <div className="tm-briefing">
          <Sparkles className="size-4 shrink-0 text-[var(--fq-accent)]" aria-hidden="true" />
          <ul>{briefingLines(home, t).map((line) => <li key={line} dir="auto">{line}</li>)}</ul>
        </div>
      </aside>
    </div>
  )
}

/** First-strong isolate, so a name of either direction cannot reorder the sentence around it. */
const isolate = (text: string) => `\u2068${text}\u2069`

interface InviteRowProps { invite: TeamInvite; onJoined: (teamId: string) => void; onChanged: () => void }

export function InviteRow({ invite, onJoined, onChanged }: InviteRowProps) {
  const teams = useTeamClient()
  const { t } = useI18n()
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
        <strong>{t("teams.home.invitedYou", { inviter: isolate(invite.invited_by_name), team: isolate(invite.team_name) })}</strong>
        <span dir="auto">{error ?? invite.assignment_title}</span>
      </div>
      <button type="button" className="tm-btn" disabled={busy} onClick={() => void act(false)}>{t("teams.home.decline")}</button>
      <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void act(true)}>{t("teams.home.join")}</button>
    </div>
  )
}

export function NeedsTeamRow({ item, onCreated }: { item: NeedsTeam; onCreated: (teamId: string) => void }) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const due = dueLabel(item.deadline, t)
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
        <strong><bdi>{item.course.code}</bdi> · <bdi>{item.title}</bdi></strong>
        <span>{error ?? [t("teams.home.teamSize", { min: item.team_size_min, max: item.team_size_max }), due, t("teams.home.classmatesWithoutTeam", { count: item.open_classmates })].filter(Boolean).join(" · ")}</span>
      </div>
      {naming ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <input className="tm-input" style={{ width: 180 }} autoFocus dir="auto" placeholder={t("teams.home.teamNamePlaceholder")} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="tm-btn tm-btn-primary" disabled={busy || name.trim().length < 2}>{t("teams.common.create")}</button>
        </form>
      ) : (
        <>
          <button type="button" className="tm-btn" disabled title={t("teams.home.findTeammatesSoon")}>
            <Users className="size-4" aria-hidden="true" /> {t("teams.home.findTeammates")}
          </button>
          <button type="button" className="tm-btn tm-btn-primary" onClick={() => setNaming(true)}>{t("teams.home.createTeam")}</button>
        </>
      )}
    </div>
  )
}
