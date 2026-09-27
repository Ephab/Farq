"use client"

import { useRef, useState, type CSSProperties } from "react"
import { ArrowLeft, CalendarRange, FileText, Gavel, History, LayoutGrid, ScrollText, type LucideIcon } from "lucide-react"
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
import { Banner, DockResizer } from "@/components/teams/ui"
import { useMarkSeen, usePresence, useTeamStream } from "@/components/teams/use-team-stream"
import { coverFor } from "@/lib/team-cover"
import { clampDockWidth, readDockWidth, saveDockWidth } from "@/lib/team-layout"
import { errorMessage } from "@/lib/teams-api"

type View = "board" | "timeline" | "docs" | "decisions" | "activity" | "charter"

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "timeline", label: "Timeline", icon: CalendarRange },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "decisions", label: "Decisions", icon: Gavel },
  { id: "activity", label: "Activity", icon: History },
  { id: "charter", label: "Charter & brief", icon: ScrollText },
]

export function TeamWorkspace({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { store, error, live, reload, update } = useTeamStream(teamId)
  const [view, setView] = useState<View>("board")
  const [jump, setJump] = useState<{ id: string; nonce: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sheet, setSheet] = useState<TaskSheetState | null>(null)
  const studioRef = useRef<HTMLDivElement>(null)
  const [dockWidth, setDockWidth] = useState(readDockWidth)
  const resizeDock = (requested: number) => {
    const next = clampDockWidth(requested, studioRef.current?.clientWidth ?? window.innerWidth)
    setDockWidth(next)
    saveDockWidth(next)
  }
  const role = store?.team.viewer_role
  const member = role === "lead" || role === "member"
  usePresence(teamId, member, focus)
  useMarkSeen(teamId, member ? store : null, update)

  if (error) {
    return (
      <div className="tm-empty">
        <p>{error}</p>
        <button type="button" className="tm-btn" onClick={onBack}>Back to all teams</button>
      </div>
    )
  }
  if (!store) return <div className="tm-empty">Opening the team…</div>

  // Any failed write: say why, then return to server truth (undoes optimistic moves).
  const fail = (reason: unknown) => {
    setNotice(errorMessage(reason))
    reload().catch(() => undefined)
  }
  const cover = coverFor(store.team.cover_seed)

  return (
    <div ref={studioRef} className="tm-studio" style={{ "--tm-dock-width": `${dockWidth}px` } as CSSProperties}>
      <aside className="tm-panel tm-rail" aria-label="Team navigation">
        <button type="button" className="tm-back" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true" /> All teams</button>
        <div className="tm-rail-cover" style={{ backgroundImage: cover.image, backgroundColor: cover.color }}>
          <span>{store.team.course.code} · {store.team.assignment.title}</span>
          <strong>{store.team.name}</strong>
        </div>
        <TeamSettings store={store} update={update} onError={fail} />
        <nav className="tm-views" aria-label="Team views">
          {VIEWS.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className="tm-view" aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
                <Icon className="size-4" aria-hidden="true" /> {item.label}
              </button>
            )
          })}
        </nav>
        <MemberList store={store} canInvite={member} onError={fail} />
        <p className="tm-live" data-live={live ? "" : undefined}><i aria-hidden="true" />{live ? "Live" : "Connecting…"}</p>
      </aside>
      <main className="tm-panel tm-center">
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
          <DecisionLog store={store} canEdit={member} update={update} onError={fail} onJump={member ? (id) => setJump({ id, nonce: Date.now() }) : undefined} />
        ) : view === "activity" ? (
          <ActivityLog store={store} />
        ) : (
          <CharterView store={store} />
        )}
      </main>
      <div className="tm-dock-slot">
        <DockResizer width={dockWidth} onResize={resizeDock} />
        {member ? (
          <TeamChat
            store={store}
            update={update}
            onMakeTask={(title) => setSheet({ mode: "create", title })}
            jumpTo={jump}
            onOpenDecisions={() => setView("decisions")}
          />
        ) : (
          <InstructorPanel store={store} />
        )}
      </div>
      {sheet ? (
        <TaskSheet state={sheet} store={store} canEdit={member} update={update} onError={fail} onClose={() => { setSheet(null); setFocus(null) }} />
      ) : null}
    </div>
  )
}
