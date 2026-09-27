"use client"

import { useI18n, type MessageKey } from "@/lib/i18n/context"

import { useState } from "react"
import { Check, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { useTeamClient } from "@/components/teams/team-client-context"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { memberName, sectionById, upsertProposal, voteSummary, type TeamStore } from "@/lib/team-store"
import { errorMessage, type SplitTaskPayload, type TeamProposal } from "@/lib/teams-api"


interface ProposalCardProps { proposal: TeamProposal; store: TeamStore; update: StoreUpdate }

const FIELD_KEYS: Record<string, MessageKey> = {
  title: "teams.proposal.fields.title",
  description: "teams.proposal.fields.description",
  assignee_id: "teams.proposal.fields.assignee_id",
  estimate_points: "teams.proposal.fields.estimate_points",
  due: "teams.proposal.fields.due",
  status: "teams.proposal.fields.status",
  milestone_id: "teams.proposal.fields.milestone_id",
  depends_on: "teams.proposal.fields.depends_on",
}

export function ProposalCard({ proposal, store, update }: ProposalCardProps) {
  const { t } = useI18n()
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
        <span className="tm-chip tm-chip-accent"><Sparkles className="size-3" aria-hidden="true" /> {t("teams.proposal.badge")}</span>
        <span className="tm-chip">{t(`teams.proposal.status.${proposal.status}`)}</span>
      </header>
      <strong dir="auto">{proposal.summary}</strong>
      <ProposalBody proposal={proposal} store={store} />
      {proposal.status === "stale" && proposal.reason ? <small className="tm-muted">{proposal.reason}</small> : null}
      {proposal.status === "pending" && proposal.scope === "team" ? (
        <div className="tm-vote">
          <div className="tm-bar"><i style={{ width: `${Math.min(100, (100 * votes.up) / votes.needed)}%` }} /></div>
          <div className="tm-proposal-actions">
            <small className="tm-muted">{t("teams.proposal.agreeCount", { up: votes.up, members: votes.members, needed: votes.needed })}</small>
            {member ? (
              <>
                <button type="button" className="tm-btn tm-btn-sm" aria-pressed={votes.mine === "down"} disabled={busy} onClick={() => void act(() => teams.vote(proposal.id, "down"))}>
                  <ThumbsDown className="size-3.5" aria-hidden="true" /> {t("teams.proposal.no")}
                </button>
                <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" aria-pressed={votes.mine === "up"} disabled={busy} onClick={() => void act(() => teams.vote(proposal.id, "up"))}>
                  <ThumbsUp className="size-3.5" aria-hidden="true" /> {t("teams.proposal.agree")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {proposal.status === "pending" && proposal.scope === "personal" ? (
        me === proposal.affected_user_id ? (
          <div className="tm-proposal-actions">
            <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(() => teams.rejectProposal(proposal.id))}><X className="size-3.5" aria-hidden="true" /> {t("teams.proposal.reject")}</button>
            <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy} onClick={() => void act(() => teams.acceptProposal(proposal.id))}><Check className="size-3.5" aria-hidden="true" /> {t("teams.proposal.accept")}</button>
          </div>
        ) : <small className="tm-muted">{t("teams.proposal.waitingFor", { name: memberName(store, proposal.affected_user_id) })}</small>
      ) : null}
      {proposal.status === "awaiting_lead" ? (
        me === store.team.lead_user_id ? (
          <div className="tm-proposal-actions">
            <small className="tm-muted">{t("teams.proposal.stalledLead")}</small>
            <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(() => teams.rejectProposal(proposal.id))}>{t("teams.proposal.discard")}</button>
            <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy} onClick={() => void act(() => teams.acceptProposal(proposal.id))}>{t("teams.proposal.apply")}</button>
          </div>
        ) : <small className="tm-muted">{t("teams.proposal.stalledWaiting")}</small>
      ) : null}
      {error ? <p className="tm-banner">{error}</p> : null}
    </div>
  )
}

function ProposalBody({ proposal, store }: { proposal: TeamProposal; store: TeamStore }) {
  const { t } = useI18n()
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
                <span dir="auto">{task.title}</span> <span className="tm-chip">{t("teams.common.points", { count: task.estimate_points })}</span>
                <small dir="auto">{task.rationale}</small>
              </div>
            </li>
          ))}
        </ul>
      )
    }
    case "task_delete": {
      const ids = (payload.task_ids ?? []) as string[]
      return (
        <ul className="tm-proposal-tasks">
          {ids.map((id) => <li key={id} className="tm-change-remove" dir="auto">{store.tasks[id]?.title ?? t("teams.proposal.missingTask")}</li>)}
          {payload.rationale ? <li><small dir="auto">{String(payload.rationale)}</small></li> : null}
        </ul>
      )
    }
    case "task_reorganize": {
      const changes = (payload.changes ?? []) as { task_id: string; title?: string; estimate_points?: number; assignee_id?: string | null }[]
      const deletes = (payload.deletes ?? []) as string[]
      const adds = (payload.adds ?? []) as SplitTaskPayload[]
      return (
        <ul className="tm-proposal-tasks">
          {changes.map((change) => {
            const task = store.tasks[change.task_id]
            const parts = [
              "assignee_id" in change ? `${memberName(store, task?.assignee_id ?? null)} \u2192 ${memberName(store, change.assignee_id ?? null)}` : null,
              change.estimate_points !== undefined ? `${task?.estimate_points ?? "?"} → ${t("teams.common.points", { count: change.estimate_points })}` : null,
              change.title !== undefined ? t("teams.proposal.renamedTo", { title: change.title }) : null,
            ].filter(Boolean)
            return <li key={change.task_id} className="tm-change-move" dir="auto"><span>{task?.title ?? t("teams.proposal.aTask")}</span> <small>{parts.join(" · ")}</small></li>
          })}
          {deletes.map((id) => <li key={id} className="tm-change-remove" dir="auto">{store.tasks[id]?.title ?? t("teams.proposal.aTask")}</li>)}
          {adds.map((task, index) => (
            <li key={`add-${index}`} className="tm-change-add">
              <Avatar userId={task.assignee_id} name={memberName(store, task.assignee_id)} size={22} />
              <div className="min-w-0">
                <span dir="auto">{task.title}</span> <span className="tm-chip">{t("teams.common.points", { count: task.estimate_points })}</span>
                <small dir="auto">{task.rationale}</small>
              </div>
            </li>
          ))}
          {payload.rationale ? <li><small dir="auto">{String(payload.rationale)}</small></li> : null}
        </ul>
      )
    }
    case "task_edit": {
      const task = store.tasks[String(payload.task_id)]
      const changes = (payload.changes ?? {}) as Record<string, unknown>
      const described = Object.entries(changes).map(([field, value]) => {
        const label = FIELD_KEYS[field] ? t(FIELD_KEYS[field]) : field
        const display = field === "assignee_id" ? memberName(store, value as string | null)
          : field === "status" && (value === "todo" || value === "doing" || value === "review" || value === "done")
            ? t(`teams.status.${value}`) : String(value)
        return `${label}: ${display}`
      })
      return <p className="m-0" dir="auto">{task?.title ?? t("teams.proposal.aTask")} → {described.join(" · ")}</p>
    }
    case "doc_section": {
      const section = sectionById(store, String(payload.section_id))
      return (
        <div className="tm-proposal-doc">
          <small className="tm-muted">{section ? `${section.key} ${section.title}` : t("teams.proposal.section")}</small>
          <div dir="auto"><MarkdownText text={String(payload.content_md ?? "").slice(0, 900)} /></div>
        </div>
      )
    }
    case "charter":
      return <p className="m-0" dir="auto">{String((payload.charter as { goal?: string } | undefined)?.goal ?? "")}</p>
    case "milestones":
      return <p className="m-0">{((payload.milestones ?? []) as { title: string }[]).map((item) => item.title).join(" · ")}</p>
    case "section_owners":
      return <p className="m-0">{t("teams.proposal.sectionOwners", { count: Object.keys((payload.owners ?? {}) as Record<string, string>).length })}</p>
    default:
      return null
  }
}
