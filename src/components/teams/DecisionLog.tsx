"use client"

import { MessageSquare } from "lucide-react"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { timeAgo } from "@/lib/team-format"
import { memberName, removeDecision, type TeamStore } from "@/lib/team-store"
import { useTeamClient } from "@/components/teams/team-client-context"
import { useI18n } from "@/lib/i18n/context"

interface DecisionLogProps {
  store: TeamStore
  canEdit: boolean
  update: StoreUpdate
  onError: (reason: unknown) => void
  /** Show the pinned message in the chat (members only; instructors never see chat). */
  onJump?: (messageId: string) => void
}

export function DecisionLog({ store, canEdit, update, onError, onJump }: DecisionLogProps) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const decisions = Object.values(store.decisions).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const unpin = async (decisionId: string) => {
    try {
      await teams.unpin(decisionId)
      update((current) => removeDecision(current, decisionId))
    } catch (reason) {
      onError(reason)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>{t("teams.decisions.title")}</h2>
      {decisions.length === 0 ? (
        <p className="tm-muted">{t("teams.decisions.empty")}</p>
      ) : (
        <div className="tm-list">
          {decisions.map((decision) => (
            <div key={decision.id} className="tm-card flex items-start justify-between gap-3">
              {onJump && decision.source_message_id ? (
                <button type="button" className="tm-decision-link" title={t("teams.decisions.showInChat")} onClick={() => onJump(decision.source_message_id as string)}>
                  <p className="m-0" dir="auto">{decision.text}</p>
                  <small>{t("teams.decisions.pinnedBy", { name: memberName(store, decision.pinned_by), time: timeAgo(decision.created_at, t) })} · <MessageSquare className="inline size-3" aria-hidden="true" /> {t("teams.decisions.showInChat")}</small>
                </button>
              ) : (
                <div>
                  <p className="m-0" dir="auto">{decision.text}</p>
                  <small>{t("teams.decisions.pinnedBy", { name: memberName(store, decision.pinned_by), time: timeAgo(decision.created_at, t) })}</small>
                </div>
              )}
              {canEdit ? <button type="button" className="tm-btn tm-btn-sm" onClick={() => void unpin(decision.id)}>{t("teams.decisions.unpin")}</button> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
