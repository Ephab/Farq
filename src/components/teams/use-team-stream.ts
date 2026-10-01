import { useCallback, useEffect, useRef, useState } from "react"
import { TEAM_EVENT_TYPES, applyEvent, fromSnapshot, rebase, type TeamStore } from "@/lib/team-store"
import { errorMessage, type PresenceEntry, type TeamEvent } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

export type StoreUpdate = (fn: (store: TeamStore) => TeamStore) => void

/** Snapshot, then one EventSource from its cursor. The browser resends
 * Last-Event-ID on reconnect, and applyEvent drops anything already seen. */
export function useTeamStream(teamId: string) {
  const teams = useTeamClient()
  const [store, setStore] = useState<TeamStore | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  // Recent stream events, so a reload can re-apply anything that arrived
  // while its /state request was in flight (see rebase).
  const recent = useRef<TeamEvent[]>([])

  const reload = useCallback(async () => {
    const next = fromSnapshot(await teams.state(teamId))
    setStore((current) => rebase(next, recent.current, current?.presence ?? []))
    setError(null)
    return next
  }, [teams, teamId])

  useEffect(() => {
    let source: EventSource | null = null
    let cancelled = false
    reload()
      .then((initial) => {
        if (cancelled) return
        source = new EventSource(teams.eventsUrl(teamId, initial.lastSeq))
        // One malformed frame is skipped instead of throwing out of the listener.
        const parse = <T,>(raw: Event): T | null => {
          try { return JSON.parse((raw as MessageEvent<string>).data) as T } catch { return null }
        }
        const onEvent = (raw: Event) => {
          const event = parse<TeamEvent>(raw)
          if (!event) return
          recent.current = [...recent.current.slice(-199), event]
          setStore((current) => (current ? applyEvent(current, event) : current))
        }
        for (const type of TEAM_EVENT_TYPES) source.addEventListener(type, onEvent)
        source.addEventListener("presence", (raw) => {
          const presence = parse<PresenceEntry[]>(raw)
          if (!presence) return
          setStore((current) => (current ? { ...current, presence } : current))
        })
        source.onopen = () => setLive(true)
        source.onerror = () => setLive(false)
      })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => {
      cancelled = true
      source?.close()
    }
  }, [teams, teamId, reload])

  const update = useCallback<StoreUpdate>((fn) => setStore((current) => (current ? fn(current) : current)), [])
  return { store, error, live, reload, update }
}

/** Tell teammates what this member is looking at, every 20 s while open. */
export function usePresence(teamId: string, enabled: boolean, focus: string | null) {
  const teams = useTeamClient()
  useEffect(() => {
    if (!enabled) return
    const send = () => { teams.presence(teamId, focus).catch(() => undefined) }
    send()
    const timer = window.setInterval(send, 20_000)
    return () => window.clearInterval(timer)
  }, [teams, teamId, enabled, focus])
}

/** Advance the member's read pointer shortly after new events arrive. */
export function useMarkSeen(teamId: string, store: TeamStore | null, update: StoreUpdate) {
  const teams = useTeamClient()
  const lastSeq = store?.lastSeq ?? 0
  const lastSeen = store?.lastSeenSeq ?? null
  useEffect(() => {
    if (lastSeen === null || lastSeq <= lastSeen) return
    const timer = window.setTimeout(() => {
      teams.markSeen(teamId, lastSeq)
        .then((result) => update((current) => ({ ...current, lastSeenSeq: result.last_seen_seq })))
        .catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [teams, teamId, lastSeq, lastSeen, update])
}
