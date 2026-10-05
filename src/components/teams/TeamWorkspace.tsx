"use client"

import { useRef, useState, type CSSProperties } from "react"
import { ArrowLeft, CalendarRange, FileText, Gavel, History, LayoutGrid, MessageSquare, ScrollText, Users, type LucideIcon } from "lucide-react"
import { ActivityLog } from "@/components/teams/ActivityLog"
import { CharterView } from "@/components/teams/CharterView"
import { DecisionLog } from "@/components/teams/DecisionLog"
import { DocStudio } from "@/components/teams/DocStudio"
import { InstructorPanel } from "@/components/teams/InstructorPanel"
import { MemberList } from "@/components/teams/MemberList"
import { TaskBoard } from "@/components/teams/TaskBoard"
import { TaskSheet, type TaskSheetState } from "@/components/teams/TaskSheet"
import { TaskTimeline } from "@/components/teams/TaskTimeline"
import { TeamChat } from "@/components/teams/TeamChat"
import { TeamSettings } from "@/components/teams/TeamSettings"
import { Avatar, Banner, Sheet } from "@/components/teams/ui"
import { useMarkSeen, usePresence, useTeamStream } from "@/components/teams/use-team-stream"
import { coverFor } from "@/lib/team-cover"
import { errorMessage } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"
import { useTeamClient } from "./team-client-context"
import { useChatWidth } from "./use-chat-width"

type View = "board" | "timeline" | "docs" | "decisions" | "activity" | "charter"

const VIEWS: { id: View; icon: LucideIcon }[] = [
  { id: "board", icon: LayoutGrid },
  { id: "timeline", icon: CalendarRange },
  { id: "docs", icon: FileText },
  { id: "decisions", icon: Gavel },
  { id: "activity", icon: History },
  { id: "charter", icon: ScrollText },
]

export function TeamWorkspace({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const teams = useTeamClient()
  const { t, dir } = useI18n()
  const { store, error, live, reload, update, unseenChat } = useTeamStream(teamId)
  const [view, setView] = useState<View>("board")
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheet, setSheet] = useState<TaskSheetState | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const chatTrigger = useRef<HTMLButtonElement>(null)
  const selectView = (next: View) => {
    setView(next)
    if (window.matchMedia("(max-width: 900px)").matches) setChatOpen(false)
  }
  const closeChat = () => {
    setChatOpen(false)
    chatTrigger.current?.focus()
  }
  const role = store?.team.viewer_role
  const member = role === "lead" || role === "member"
  const bodyRef = useRef<HTMLDivElement>(null)
  const chatSize = useChatWidth(bodyRef, Boolean(store) && member && chatOpen, dir)
  usePresence(teamId, member, focus)
  // Chat is optional now: visiting the board must not mark hidden messages as read.
  useMarkSeen(teamId, member && chatOpen ? store : null, update)

  if (error) {
    return (
      <div className="tm-empty">
        <p>{error}</p>
        <button type="button" className="tm-btn" onClick={onBack}>{t("teams.workspace.backToAll")}</button>
      </div>
    )
  }
  if (!store) return <div className="tm-empty">{t("teams.workspace.opening")}</div>

  // Any failed write: say why, then return to server truth (undoes optimistic moves).
  const fail = (reason: unknown) => {
    setNotice(errorMessage(reason))
    reload().catch(() => undefined)
  }
  const cover = coverFor(store.team.cover_seed)

  return (
    <div className="gp-workspace">
      <header className="gp-workspace-head">
        <button type="button" className="gp-workspace-back tm-icon-btn" onClick={onBack} aria-label={t("teams.gp.backShort")} title={t("teams.gp.backShort")}><ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden="true" /></button>
        <span className="gp-project-mark" style={{ backgroundColor: cover.color }} aria-hidden="true"><LayoutGrid className="size-5" /></span>
        <div className="gp-workspace-title">
          <h1 dir="auto">{store.team.name}</h1>
          <p>{store.team.assignment.id ? <><bdi>{store.team.course.code}</bdi> · <bdi>{store.team.assignment.title}</bdi></> : t("teams.gp.projectLabel")}</p>
        </div>
        <div className="gp-workspace-actions">
          <p className="tm-live" data-live={live ? "" : undefined} role="status"><i aria-hidden="true" />{teams.demo ? t("teams.demo.local") : live ? t("teams.workspace.live") : t("teams.workspace.connecting")}</p>
          <button type="button" className="tm-btn gp-people-trigger" onClick={() => setPeopleOpen(true)} aria-label={t("teams.ui.peopleSettings")}>
            <span className="gp-avatar-stack" aria-hidden="true">{store.team.members.slice(0, 3).map(person => <Avatar key={person.user_id} userId={person.user_id} name={person.display_name} size={24} />)}</span>
            <Users className="size-4 gp-people-icon" aria-hidden="true" /><span>{t("teams.gp.people")}</span>
          </button>
          {member ? <button ref={chatTrigger} type="button" className="tm-btn" aria-label={t("teams.chat.title")} aria-pressed={chatOpen} aria-controls="gp-project-chat" onClick={() => setChatOpen(value => !value)}><MessageSquare className="size-4" aria-hidden="true" />{t("teams.chat.title")}{unseenChat && !chatOpen ? <span className="gp-chat-unread" role="status" aria-label={t("teams.ui.newMessages")} /> : null}</button>
            : <button type="button" className="tm-btn" onClick={() => setOverviewOpen(true)}>{t("teams.instructor.title")}</button>}
        </div>
      </header>
      <nav className="gp-workspace-tabs" aria-label={t("teams.workspace.viewsLabel")}>
          {VIEWS.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className="gp-workspace-tab" aria-current={view === item.id ? "page" : undefined} onClick={() => selectView(item.id)}>
                <Icon className="size-4" aria-hidden="true" /> {t(`teams.workspace.views.${item.id}`)}
              </button>
            )
          })}
      </nav>
      <div ref={bodyRef} className="gp-workspace-body" data-chat={chatOpen && member ? "" : undefined} style={{ "--gp-chat-width": `${chatSize.width}px` } as CSSProperties}>
      <main className="gp-workspace-content" aria-label={t(`teams.workspace.views.${view}`)}>
        {notice ? <Banner message={notice} onDismiss={() => setNotice(null)} /> : null}
        {view === "board" ? (
          <TaskBoard
            store={store}
            canEdit={member}
            update={update}
            onError={fail}
            onOpenTask={(task) => { setFocus(`task:${task.id}`); setSheet({ mode: "edit", task }) }}
            onNewTask={() => setSheet({ mode: "create" })}
          />
        ) : view === "timeline" ? (
          <TaskTimeline store={store} canEdit={member} update={update} onError={fail} />
        ) : view === "docs" ? (
          <DocStudio store={store} canEdit={member} update={update} onFocus={setFocus} />
        ) : view === "decisions" ? (
          <DecisionLog store={store} canEdit={member} update={update} onError={fail} onJump={member ? (id) => { setChatOpen(true); setJump({ id, nonce: Date.now() }) } : undefined} />
        ) : view === "activity" ? (
          <ActivityLog store={store} />
        ) : (
          <CharterView store={store} canEdit={member} update={update} />
        )}
      </main>
      {member ? <div id="gp-project-chat" className="gp-chat-panel" hidden={!chatOpen}>
          <div {...chatSize.separator} className="gp-chat-resizer" data-dragging={chatSize.dragging ? "" : undefined}
            aria-label={t("teams.workspace.resize")} aria-controls="gp-project-chat" title={t("teams.workspace.resizeHint")} />
          <TeamChat
            store={store}
            update={update}
            onMakeTask={(title) => setSheet({ mode: "create", title })}
            jumpTo={jump}
            active={chatOpen}
            onClose={closeChat}
            onOpenDecisions={() => selectView("decisions")}
          />
      </div> : null}
      </div>
      {peopleOpen ? <Sheet title={t("teams.ui.peopleSettings")} onClose={() => setPeopleOpen(false)}>
        {notice ? <Banner message={notice} onDismiss={() => setNotice(null)} /> : null}
        <MemberList store={store} canInvite={member} onError={fail} onLeft={onBack} />
        <TeamSettings store={store} update={update} onError={fail} />
      </Sheet> : null}
      {overviewOpen && !member ? <Sheet title={t("teams.instructor.title")} onClose={() => setOverviewOpen(false)}><InstructorPanel store={store} /></Sheet> : null}
      {sheet ? (
        <TaskSheet state={sheet} store={store} canEdit={member} update={update} onError={fail} onClose={() => { setSheet(null); setFocus(null) }} />
      ) : null}
    </div>
  )
}
