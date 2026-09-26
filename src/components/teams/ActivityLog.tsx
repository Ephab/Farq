"use client"

import { useEffect, useState } from "react"
import { useTeamClient } from "@/components/teams/team-client-context"
import { Avatar, HermesAvatar } from "@/components/teams/ui"
import { timeAgo } from "@/lib/team-format"
import type { TeamStore } from "@/lib/team-store"
import { errorMessage, type ActivityEntry } from "@/lib/teams-api"

/** Important actions (tasks, reassignments, proposals, members, documents), newest first. */
export function ActivityLog({ store }: { store: TeamStore }) {
  const teams = useTeamClient()
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const teamId = store.team.id
  const seq = store.lastSeq

  // Refresh the first page whenever the team changes; older pages are appended on demand.
  useEffect(() => {
    let cancelled = false
    teams.activity(teamId)
      .then((page) => { if (!cancelled) { setEntries(page.entries); setNextBefore(page.next_before); setError(null) } })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [teams, teamId, seq])

  const loadMore = async () => {
    if (nextBefore === null) return
    setLoading(true)
    try {
      const page = await teams.activity(teamId, nextBefore)
      setEntries((current) => [...(current ?? []), ...page.entries])
      setNextBefore(page.next_before)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="tm-h2" style={{ marginBottom: 0 }}>Activity</h2>
      {error ? <p className="tm-banner">{error}</p> : null}
      {entries === null && !error ? <p className="tm-muted">Loading…</p> : null}
      {entries !== null && entries.length === 0 ? <p className="tm-muted">Nothing has happened yet.</p> : null}
      <ol className="tm-activity">
        {(entries ?? []).map((entry) => (
          <li key={entry.seq}>
            {entry.actor_user_id ? <Avatar userId={entry.actor_user_id} name={entry.actor} size={24} /> : <HermesAvatar size={24} />}
            <p dir="auto"><strong>{entry.actor}</strong> {entry.text}</p>
            <time dateTime={entry.at ?? undefined}>{entry.at ? timeAgo(entry.at) : ""}</time>
          </li>
        ))}
      </ol>
      {nextBefore !== null ? (
        <button type="button" className="tm-btn tm-btn-sm self-start" disabled={loading} onClick={() => void loadMore()}>Load older activity</button>
      ) : null}
    </div>
  )
}
