"use client"

import { useState } from "react"
import { Check, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { useTeamClient } from "@/components/teams/team-client-context"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { memberName, sectionById, upsertProposal, voteSummary, type TeamStore } from "@/lib/team-store"
import { errorMessage, type SplitTaskPayload, type TeamProposal } from "@/lib/teams-api"

const STATUS_LABEL: Record<TeamProposal["status"], string> = {
  pending: "Waiting", applied: "Applied", rejected: "Rejected", stale: "Out of date", awaiting_lead: "Lead decides",
}

interface ProposalCardProps { proposal: TeamProposal; store: TeamStore; update: StoreUpdate }

export function ProposalCard({ proposal, store, update }: ProposalCardProps) {
  const teams = useTeamClient()
  const me = teams.userId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const role = store.team.viewer_role
  const member = role === "lead" || role === "member"
  const votes = voteSummary(store, proposal, me)

  const act = async (work: () => Promise<TeamProposal>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await work()
      update((current) => upsertProposal(current, next))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tm-proposal" data-status={proposal.status}>
      <header>
        <span className="tm-chip tm-chip-accent"><Sparkles className="size-3" aria-hidden="true" /> Hermes proposal</span>
        <span className="tm-chip">{STATUS_LABEL[proposal.status]}</span>
      </header>
      <strong dir="auto">{proposal.summary}</strong>
      <ProposalBody proposal={proposal} store={store} />
      {proposal.status === "stale" && proposal.reason ? <small className="tm-muted">{proposal.reason}</small> : null}
      {proposal.status === "pending" && proposal.scope === "team" ? (
        <div className="tm-vote">
          <div className="tm-bar"><i style={{ width: `${Math.min(100, (100 * votes.up) / votes.needed)}%` }} /></div>
          <div className="tm-proposal-actions">
            <small className="tm-muted">{votes.up} of {votes.members} agree · applies at {votes.needed}</small>
            {member ? (
              <>
                <button type="button" className="tm-btn tm-btn-sm" aria-pressed={votes.mine === "down"} disabled={busy} onClick={() => void act(() => teams.vote(proposal.id, "down"))}>
                  <ThumbsDown className="size-3.5" aria-hidden="true" /> No
                </button>
                <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" aria-pressed={votes.mine === "up"} disabled={busy} onClick={() => void act(() => teams.vote(proposal.id, "up"))}>
                  <ThumbsUp className="size-3.5" aria-hidden="true" /> Agree
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {proposal.status === "pending" && proposal.scope === "personal" ? (
        me === proposal.affected_user_id ? (
          <div className="tm-proposal-actions">
            <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(() => teams.rejectProposal(proposal.id))}><X className="size-3.5" aria-hidden="true" /> Reject</button>
            <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy} onClick={() => void act(() => teams.acceptProposal(proposal.id))}><Check className="size-3.5" aria-hidden="true" /> Accept</button>
          </div>
        ) : <small className="tm-muted">Waiting for {memberName(store, proposal.affected_user_id)}</small>
      ) : null}
      {proposal.status === "awaiting_lead" ? (
        me === store.team.lead_user_id ? (
          <div className="tm-proposal-actions">
            <small className="tm-muted">The vote stalled for 48 hours. You decide as lead.</small>
            <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(() => teams.rejectProposal(proposal.id))}>Discard</button>
            <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy} onClick={() => void act(() => teams.acceptProposal(proposal.id))}>Apply</button>
          </div>
        ) : <small className="tm-muted">The vote stalled; waiting for the team lead.</small>
      ) : null}
      {error ? <p className="tm-banner">{error}</p> : null}
    </div>
  )
}

function ProposalBody({ proposal, store }: { proposal: TeamProposal; store: TeamStore }) {
  const payload = proposal.payload
  switch (proposal.kind) {
    case "task_split": {
      const tasks = (payload.tasks ?? []) as SplitTaskPayload[]
      return (
        <ul className="tm-proposal-tasks">
          {tasks.map((task, index) => (
            <li key={`${task.title}-${index}`}>
              <Avatar userId={task.assignee_id} name={memberName(store, task.assignee_id)} size={22} />
              <div className="min-w-0">
                <span dir="auto">{task.title}</span> <span className="tm-chip">{task.estimate_points} pt</span>
                <small dir="auto">{task.rationale}</small>
              </div>
            </li>
          ))}
        </ul>
      )
    }
    case "task_edit": {
      const task = store.tasks[String(payload.task_id)]
      const changes = (payload.changes ?? {}) as Record<string, unknown>
      const described = Object.entries(changes).map(([field, value]) => `${field.replace("_id", "")}: ${field === "assignee_id" ? memberName(store, value as string | null) : String(value)}`)
      return <p className="m-0" dir="auto">{task?.title ?? "A task"} → {described.join(" · ")}</p>
    }
    case "doc_section": {
      const section = sectionById(store, String(payload.section_id))
      return (
        <div className="tm-proposal-doc">
          <small className="tm-muted">{section ? `${section.key} ${section.title}` : "Section"}</small>
          <div dir="auto"><MarkdownText text={String(payload.content_md ?? "").slice(0, 900)} /></div>
        </div>
      )
    }
    case "charter":
      return <p className="m-0" dir="auto">{String((payload.charter as { goal?: string } | undefined)?.goal ?? "")}</p>
    case "milestones":
      return <p className="m-0">{((payload.milestones ?? []) as { title: string }[]).map((item) => item.title).join(" · ")}</p>
    case "section_owners":
      return <p className="m-0">{Object.keys((payload.owners ?? {}) as Record<string, string>).length} sections get owners</p>
    default:
      return null
  }
}
