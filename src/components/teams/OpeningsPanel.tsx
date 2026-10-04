import { useCallback, useEffect, useState } from "react"
import { useTeamClient } from "./team-client-context"
import { errorMessage, type JoinRequestInfo, type TeamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

export function ClassOpenings({ classId, onOpenTeam }: { classId: string; onOpenTeam: (id: string) => void }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [openings, setOpenings] = useState<Awaited<ReturnType<TeamClient["openings"]>>>([])
  const [requests, setRequests] = useState<JoinRequestInfo[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [openings, requests] = await Promise.all([api.openings(classId), api.myJoinRequests()])
    setOpenings(openings); setRequests(requests)
  }, [api, classId])
  useEffect(() => {
    let cancelled = false
    const refresh = () => { void load().catch(reason => { if (!cancelled) setError(errorMessage(reason)) }) }
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [load])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action(); await load() } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <section className="tm-list">
    <h4>{t("teams.openings.heading")}</h4>
    <p className="tm-muted">{t("teams.openings.hint")}</p>
    {error ? <p role="alert">{error}</p> : null}
    {openings.length === 0 ? <p>{t("teams.openings.empty")}</p> : null}
    {openings.map(opening => <div className="tm-card" key={opening.team_id}>
      <h5><bdi>{opening.team_name}</bdi> · <bdi>{opening.assignment_title}</bdi></h5>
      <small>{t("teams.openings.places", { count: opening.places })}</small>
      {opening.request ? <p>{t(`teams.openings.status.${opening.request.status}`)}</p> : <form onSubmit={event => { event.preventDefault(); void act(() => api.requestJoin(opening.team_id, notes[opening.team_id] ?? "")) }}>
        <label className="tm-field">{t("teams.openings.note")}<textarea className="tm-input" value={notes[opening.team_id] ?? ""} maxLength={500} onChange={event => setNotes(values => ({ ...values, [opening.team_id]: event.target.value }))} /></label>
        <button className="tm-btn" disabled={busy}>{t("teams.openings.request")}</button>
      </form>}
    </div>)}
    <h4>{t("teams.openings.mine")}</h4>
    {requests.map(request => <div className="tm-member" key={request.id}>
      <span className="flex-1"><bdi>{request.team_name}</bdi> · {t(`teams.openings.status.${request.status}`)}</span>
      {request.status === "pending" ? <button className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(() => api.decideJoin(request.id, "cancel"))}>{t("teams.openings.cancel")}</button> : null}
      {request.status === "accepted" ? <button className="tm-btn tm-btn-sm" onClick={() => onOpenTeam(request.team_id)}>{t("teams.openings.openProject")}</button> : null}
    </div>)}
  </section>
}

export function ManageOpening({ teamId }: { teamId: string }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState<JoinRequestInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setRequests(await api.joinRequests(teamId)), [api, teamId])
  useEffect(() => {
    void api.opening(teamId).then(value => { setOpen(value.open) }).catch(reason => setError(errorMessage(reason)))
    const refresh = () => { void load().catch(reason => setError(errorMessage(reason))) }
    refresh(); const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [api, teamId, load])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action(); await load() } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <section className="tm-list">
    <h3>{t("teams.openings.manage")}</h3>
    {error ? <p role="alert">{error}</p> : null}
    <form onSubmit={event => { event.preventDefault(); void act(async () => {
      await api.publishOpening(teamId, { summary: "", roles: [], commitment: "" }); setOpen(true)
    }) }}>
      <button className="tm-btn" disabled={busy}>{t("teams.openings.publish")}</button>
      {open ? <button type="button" className="tm-btn" disabled={busy} onClick={() => void act(async () => { await api.closeOpening(teamId); setOpen(false) })}>{t("teams.openings.close")}</button> : null}
    </form>
    <h4>{t("teams.openings.requests")}</h4>
    {requests.map(request => <div className="tm-card" key={request.id}>
      <bdi>{request.display_name}</bdi><p dir="auto">{request.note}</p><small>{t(`teams.openings.status.${request.status}`)}</small>
      {request.status === "pending" ? <div className="flex gap-2">
        <button className="tm-btn" disabled={busy} onClick={() => void act(() => api.decideJoin(request.id, "accept"))}>{t("teams.openings.accept")}</button>
        <button className="tm-btn" disabled={busy} onClick={() => void act(() => api.decideJoin(request.id, "decline"))}>{t("teams.openings.decline")}</button>
      </div> : null}
    </div>)}
  </section>
}
