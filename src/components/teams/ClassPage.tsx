"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import { InviteCode } from "@/components/teams/InviteCode"
import { ClassOpenings } from "@/components/teams/OpeningsPanel"
import { useTeamClient } from "@/components/teams/team-client-context"
import { errorMessage, type TeamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

type Detail = Awaited<ReturnType<TeamClient["classDetail"]>>
type Tab = "overview" | "teams" | "people"
const TABS: Tab[] = ["overview", "teams", "people"]

/** One class on its own page: what it is, who is in it, open teams to join, and finding teammates. */
export function ClassPage({ id, onBack, onOpenTeam, onChanged }: { id: string; onBack: () => void; onOpenTeam: (teamId: string) => void; onChanged: () => void }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [tab, setTab] = useState<Tab>("overview")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [assignment, setAssignment] = useState("")
  const [newOrganizer, setNewOrganizer] = useState("")
  const load = useCallback(async () => { setDetail(await api.classDetail(id)) }, [api, id])
  useEffect(() => { setDetail(null); setTab("overview"); load().catch(reason => setError(errorMessage(reason))) }, [load])
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await action(); await load(); onChanged() } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  if (error && !detail) return <div className="gp-inline-error" role="alert"><p>{error}</p><button type="button" className="tm-btn" onClick={onBack}>{t("teams.gp.back")}</button></div>
  if (!detail) return <p className="gp-muted" role="status">{t("teams.common.loading")}</p>
  const live = !detail.archived
  const others = detail.members.filter(member => member.id !== api.userId)
  const visible = TABS.filter(item => live || item === "overview" || item === "people")
  return <div className="gp-class">
    <button type="button" className="gp-back" onClick={onBack}><ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {t("teams.gp.back")}</button>
    <header className="gp-class-head">
      <div className="gp-class-title">
        <h1 dir="auto"><bdi>{detail.title}</bdi></h1>
        <p className="gp-muted">{t("teams.gp.peopleCount", { count: detail.members.length })} · {detail.archived ? t("teams.gp.archived") : detail.organizer ? t("teams.gp.classMeta.organizer") : t("teams.gp.classMeta.member")}</p>
        <div className="gp-stack">{detail.members.slice(0, 6).map(member => <Avatar key={member.id} userId={member.id} name={member.display_name} size={30} />)}</div>
      </div>
      {detail.organizer && live ? <InviteCode kind="classes" id={detail.id} label={t("teams.gp.inviteClass")} /> : null}
    </header>
    {error ? <p className="gp-error" role="alert">{error}</p> : null}
    <nav className="gp-tabs" aria-label={detail.title}>
      {visible.map(item => <button key={item} type="button" aria-current={tab === item ? "page" : undefined} className="gp-tab" onClick={() => setTab(item)}>{t(`teams.gp.tabs.${item}`)}</button>)}
    </nav>
    <div className="gp-tabpanel">
      {tab === "overview" ? <section className="gp-stackv">
        <h2 className="gp-h2">{t("teams.gp.assignments")}</h2>
        {detail.assignments.length ? <ul className="gp-rows">{detail.assignments.map(item => <li key={item.id} className="gp-row gp-row-static"><span className="gp-row-main"><strong dir="auto"><bdi>{item.title}</bdi></strong></span></li>)}</ul>
          : <p className="gp-muted">{t("teams.gp.noAssignments")}</p>}
        {detail.organizer && live ? <form className="gp-inline-form" onSubmit={event => { event.preventDefault(); void act(async () => { await api.createAssignment(detail.id, assignment.trim()); setAssignment("") }) }}>
          <input className="tm-input" dir="auto" value={assignment} maxLength={240} placeholder={t("teams.gp.assignmentPlaceholder")} aria-label={t("teams.gp.assignmentPlaceholder")} onChange={event => setAssignment(event.target.value)} />
          <button className="tm-btn" disabled={busy || assignment.trim().length < 2}>{t("teams.gp.addAssignment")}</button>
        </form> : null}
        <p className="gp-muted">{t("teams.gp.privacy")}</p>
        {detail.organizer ? <details className="gp-details">
          <summary>{t("teams.gp.manage")}</summary>
          <div className="gp-stackv">
            <p className="gp-muted">{t("teams.classes.archiveHint")}</p>
            <div><button type="button" className="tm-btn" disabled={busy} onClick={() => void act(async () => { await api.archiveClass(detail.id, detail.archived ? "restore" : "archive") })}>
              {t(detail.archived ? "teams.classes.restoreClass" : "teams.classes.archiveClass")}</button></div>
            {others.length ? <form className="gp-inline-form" onSubmit={event => { event.preventDefault(); void act(async () => { await api.transferOrganizer(detail.id, newOrganizer); setNewOrganizer("") }) }}>
              <select className="tm-input" value={newOrganizer} aria-label={t("teams.classes.newOrganizer")} onChange={event => setNewOrganizer(event.target.value)}>
                <option value="">{t("teams.classes.chooseMember")}</option>
                {others.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}
              </select>
              <button className="tm-btn" disabled={busy || !newOrganizer}>{t("teams.gp.makeOrganizer")}</button>
            </form> : null}
          </div>
        </details> : null}
      </section> : null}
      {tab === "teams" && live ? <ClassOpenings key={detail.id} classId={detail.id} onOpenTeam={onOpenTeam} /> : null}
      {tab === "people" ? <section className="gp-stackv">
        <ul className="gp-rows">
          {detail.members.map(member => <li key={member.id} className="gp-row gp-row-static">
            <Avatar userId={member.id} name={member.display_name} size={32} />
            <span className="gp-row-main"><strong dir="auto"><bdi>{member.display_name}</bdi></strong>{member.id === api.userId ? <small>{t("teams.gp.you")}</small> : null}</span>
            {detail.organizer && live && member.id !== api.userId ? <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void act(async () => { await api.removeClassMember(detail.id, member.id) })}>{t("teams.gp.removePerson")}</button> : null}
          </li>)}
        </ul>
        {!detail.organizer && live ? <div><button type="button" className="tm-btn" disabled={busy} onClick={() => void act(async () => { await api.removeClassMember(detail.id, api.userId); onBack() })}>{t("teams.gp.leaveClass")}</button></div> : null}
      </section> : null}
    </div>
  </div>
}
