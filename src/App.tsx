"use client"

import { LearningUpdatesView } from "@/components/learning/LearningUpdatesView"

import { Bot, BriefcaseBusiness, Command, Database, FileText, FolderKanban, Home, ListChecks, Mail, PanelLeft, Presentation, Route, Square, Users } from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { AnimatePresence, useReducedMotion } from "motion/react"
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
} from "@/components/motion/animated-sidebar"
import { FooterSettings } from "@/components/footer-settings"
import { TodayView } from "@/components/dashboard/TodayView"
import { ProjectsView } from "@/components/projects/ProjectsView"
import { TeamsView } from "@/components/teams/TeamsView"
import { QuizView } from "@/components/quiz/QuizView"
import { SlidesView } from "@/components/slides/SlidesView"
import { RoadmapView } from "@/components/roadmap/RoadmapView"
import { HermesCoach } from "@/components/hermes/HermesCoach"
import { CoachPortalIntro, type PortalPhase } from "@/components/animation/CoachPortalIntro"
import { useActiveRun } from "@/components/hermes/use-hermes-chat"
import { MyDataView } from "@/components/onboarding/MyDataView"
import { EmailsView } from "@/components/emails/EmailsView"
import { CoopView } from "@/components/coop/CoopView"
import { CvView } from "@/components/cv/CvView"
import { GenerationPanel } from "@/components/onboarding/GenerationPanel"
import { GenerationBanner } from "@/components/onboarding/GenerationBanner"
import { OnboardingView } from "@/components/onboarding/OnboardingView"
import { useGenerationStatus } from "@/hooks/use-generation-status"
import { LoaderCircle } from "lucide-react"
import { api, getCurrentStudentId, hasChosenStudent, type StudentProfile } from "@/lib/waypoint-api"
import { getActingUserId, type TeamsHomeData } from "@/lib/teams-api"
import { cn } from "@/lib/utils"
import { ThemeProvider } from "@/lib/theme-context"
import { useI18n, type MessageKey } from "@/lib/i18n/context"

// View ids stay English (other views navigate by them); only their labels are translated.
const VIEW_LABELS: Record<string, MessageKey> = {
  "Home": "nav.items.home",
  "Hermes Coach": "nav.items.coach",
  "Roadmap": "nav.items.roadmap",
  "Projects": "nav.items.projects",
  "Quizzes": "nav.items.quizzes",
  "Group Projects": "nav.items.teams",
  "Emails": "nav.items.emails",
  "Co-op": "nav.items.coop",
  "Learning updates": "nav.items.learning",
  "CV": "nav.items.cv",
  "Slides": "nav.items.slides",
  "My data": "nav.items.myData",
}

// Gentle app-wide startup veil, once per page load. It lives outside the view
// branches below so loading -> onboarding -> app swaps never remount (and so
// replay) it: loading (0.8s) -> leave (0.85s) -> done, skippable with Esc/click.
function AppIntro() {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<PortalPhase | "done">(() => (reduceMotion ? "done" : "loading"))
  const dismiss = useCallback(() => setPhase("done"), [])
  useEffect(() => {
    if (reduceMotion || phase === "done") return
    const timer = window.setTimeout(
      () => setPhase((previous) => (previous === "loading" ? "leave" : "done")),
      phase === "loading" ? 800 : 850,
    )
    return () => window.clearTimeout(timer)
  }, [phase, reduceMotion])
  useEffect(() => {
    if (phase === "done") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, dismiss])
  return (
    <AnimatePresence>
      {phase !== "done" ? (
        <div className="fixed inset-0 z-[70]">
          <CoachPortalIntro phase={phase} speed={1.1} word={t("common.appName")} tone="gentle" onSkip={dismiss} />
        </div>
      ) : null}
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <>
      <AppShell />
      <AppIntro />
    </>
  )
}

const ACTIVE_VIEW_KEY = "waypoint.active-view"

function AppShell() {
  const { t, fmt } = useI18n()
  const viewLabel = (id: string) => (VIEW_LABELS[id] ? t(VIEW_LABELS[id]) : id)
  // A refresh (or a dev reload) keeps the student on the section they were reading.
  const [active, setActive] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem(ACTIVE_VIEW_KEY)
      return saved && VIEW_LABELS[saved] ? saved : "Home"
    } catch { return "Home" }
  })
  useEffect(() => {
    try { window.sessionStorage.setItem(ACTIVE_VIEW_KEY, active) } catch { /* storage blocked: this page load only */ }
  }, [active])
  const [coachDraft, setCoachDraft] = useState("")
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  // null = still checking; a student who hasn't finished onboarding sees only onboarding.
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [onboarding, setOnboarding] = useState(!hasChosenStudent())
  // The first roadmap generates on the server, so a student mid-onboarding can open the app meanwhile.
  const [exploring, setExploring] = useState(false)
  const generation = useGenerationStatus(exploring ? getCurrentStudentId() : null, exploring)
  // A remembered student's profile decides between the app and onboarding: wait for it instead
  // of flashing the app (and firing its requests) for someone who is still onboarding.
  const [profileChecked, setProfileChecked] = useState(!hasChosenStudent())
  // Live Hermes run for this student's coach thread â€” polled so any section
  // can show that Hermes is still generating after navigating away.
  const activeRun = useActiveRun(profile?.thread_id ?? null)
  const teamUnread = useTeamUnread(active)
  const stopBackgroundRun = useCallback(async () => {
    if (!activeRun) return
    try {
      await api(`/api/agent-runs/${activeRun.id}/cancel`, { method: "POST" })
    } catch {
      // The next poll picks up the terminal state; no banner from here.
    }
  }, [activeRun])
  // One-shot handoff: HermesCoach clears this right after prefilling the
  // composer, so the prompt does not reappear on every later visit.
  const clearCoachDraft = useCallback(() => setCoachDraft(""), [])

  const loadProfile = useCallback(() => {
    if (!hasChosenStudent()) { setOnboarding(true); setProfileChecked(true); return }
    api<StudentProfile>(`/api/students/${getCurrentStudentId()}/profile`)
      .then((next) => { setProfile(next); setOnboarding(next.onboarding_status !== "done") })
      // Onboarding owns recovery: it retries, and forgets the student only if they no longer exist.
      .catch(() => setOnboarding(true))
      .finally(() => setProfileChecked(true))
  }, [])

  useEffect(() => { loadProfile() }, [loadProfile])
  // Stable so OnboardingView's profile load does not re-run on every App render.
  const finishOnboarding = useCallback(() => { setExploring(false); setActive("Roadmap"); loadProfile() }, [loadProfile])
  const startExploring = useCallback(() => { setActive("Home"); setExploring(true); loadProfile() }, [loadProfile])
  const backToGeneration = useCallback(() => { setExploring(false); loadProfile() }, [loadProfile])

  // Home and Roadmap have nothing to show until the first roadmap is accepted: say what is happening instead.
  const showGenerationPanel = exploring && (active === "Home" || active === "Roadmap")

  if (!profileChecked) {
    return (
      <ThemeProvider>
        <div className="grid min-h-svh place-items-center bg-background" role="status" aria-label={t("common.loading")}>
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </ThemeProvider>
    )
  }

  if (onboarding && !exploring) {
    return (
      <ThemeProvider>
        <OnboardingView onDone={finishOnboarding} onExplore={startExploring} />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <AnimatedSidebarProvider className="min-h-screen bg-background">
          <AnimatedSidebar collapsible="icon" ariaLabel={t("nav.ariaLabel")}>
            <AnimatedSidebarHeader>
              <div className="flex min-h-11 items-center gap-3 overflow-hidden px-2">
                <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Command aria-hidden="true" className="size-4" />
                </div>
                <span className="truncate text-sm font-semibold group-data-[state=collapsed]/sidebar:hidden">
                  {t("common.appName")}
                </span>
              </div>
            </AnimatedSidebarHeader>

            <AnimatedSidebarContent className="gap-0">
              <NavSection>
                <NavItem label="Home" text={t("nav.items.home")} icon={<Home className="size-4" />} active={active} onSelect={setActive} />
                <NavItem
                  label="Hermes Coach"
                  text={t("nav.items.coach")}
                  active={active}
                  onSelect={setActive}
                  icon={(
                    <span className="relative grid place-items-center">
                      <Bot className="size-4" />
                      {activeRun ? (
                        <span className="absolute -end-1 -top-1 size-2 animate-pulse rounded-full bg-amber-500 ring-2 ring-background" aria-hidden="true" />
                      ) : null}
                    </span>
                  )}
                  badge={activeRun ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
                      {t("nav.working")}
                    </span>
                  ) : undefined}
                />
              </NavSection>
              <NavSection label={t("nav.sections.learn")}>
                <NavItem label="Roadmap" text={t("nav.items.roadmap")} icon={<Route className="size-4" />} active={active} onSelect={setActive} />
                <NavItem label="Projects" text={t("nav.items.projects")} icon={<FolderKanban className="size-4" />} active={active} onSelect={setActive} />
                <NavItem label="Quizzes" text={t("nav.items.quizzes")} icon={<ListChecks className="size-4" />} active={active} onSelect={setActive} />
              </NavSection>
              <NavSection label={t("nav.sections.collaborate")}>
                <NavItem
                  label="Group Projects"
                  text={t("nav.items.teams")}
                  active={active}
                  onSelect={setActive}
                  icon={(
                    <span className="relative grid place-items-center">
                      <Users className="size-4" />
                      {teamUnread > 0 ? <span className="absolute -end-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden="true" /> : null}
                    </span>
                  )}
                  badge={teamUnread > 0 ? (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground" aria-label={t("nav.unreadTeamMessages", { count: teamUnread })}>
                      {teamUnread > 99 ? `${fmt.number(99)}+` : fmt.number(teamUnread)}
                    </span>
                  ) : undefined}
                />
                <NavItem label="Emails" text={t("nav.items.emails")} icon={<Mail className="size-4" />} active={active} onSelect={setActive} />
              </NavSection>
              <NavSection label={t("nav.sections.career")}>
                <NavItem label="Learning updates" text={t("nav.items.learning")} icon={<ListChecks className="size-4" />} active={active} onSelect={setActive} />
                <NavItem label="Co-op" text={t("nav.items.coop")} icon={<BriefcaseBusiness className="size-4" />} active={active} onSelect={setActive} />
                <NavItem label="CV" text={t("nav.items.cv")} icon={<FileText className="size-4" />} active={active} onSelect={setActive} />
              </NavSection>
              <NavSection label={t("nav.sections.create")}>
                <NavItem label="Slides" text={t("nav.items.slides")} icon={<Presentation className="size-4" />} active={active} onSelect={setActive} />
              </NavSection>
              <NavSection label={t("nav.sections.account")} className="mt-auto">
                <NavItem label="My data" text={t("nav.items.myData")} icon={<Database className="size-4" />} active={active} onSelect={setActive} />
              </NavSection>
            </AnimatedSidebarContent>

            <AnimatedSidebarFooter>
              <div className="flex items-center gap-2 overflow-hidden rounded-xl p-1">
                {/* Collapsed to icons, the settings gear (language, theme, reset) stays reachable instead of the avatar. */}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-foreground group-data-[state=collapsed]/sidebar:hidden" aria-hidden="true">
                  {(profile?.display_name ?? "S").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-start text-sm font-medium group-data-[state=collapsed]/sidebar:hidden">
                  <bdi>{profile?.display_name ?? t("common.user")}</bdi>
                </span>
                <FooterSettings />
              </div>
            </AnimatedSidebarFooter>

            <AnimatedSidebarRail />
          </AnimatedSidebar>

          <AnimatedSidebarInset className="bg-background">
            {exploring && !showGenerationPanel ? <GenerationBanner status={generation} onOpen={backToGeneration} /> : null}
            <header className="flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
              <AnimatedSidebarTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground">
                <PanelLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              </AnimatedSidebarTrigger>
              <div className="h-5 w-px bg-border" />
              {/* Each view has its own h1; this is the shell's section label. */}
              <p className="min-w-0 truncate text-sm font-medium">{viewLabel(active)}</p>
              {activeRun ? (
                <div className="ms-auto flex min-w-0 items-center gap-1.5" role="status" aria-live="polite" aria-label={t("header.hermesGenerating", { stage: activeRun.stage || t("nav.working") })}>
                  <button
                    type="button"
                    onClick={() => setActive("Hermes Coach")}
                    title={activeRun.stage ? t("header.viewRunStage", { stage: activeRun.stage }) : t("header.viewRun")}
                    className="inline-flex min-w-0 max-w-64 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 outline-none hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
                  >
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
                    <span className="truncate">{t("header.hermesWorking")}{activeRun.stage ? <> Â· <bdi>{activeRun.stage}</bdi></> : null}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopBackgroundRun()}
                    title={t("header.stopRun")}
                    aria-label={t("header.stopRun")}
                    className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-500/30 text-amber-700 outline-none hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
                  >
                    <Square className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </header>

            <main className="flex min-h-0 flex-1 flex-col bg-background">
              {/* Each page comes into focus as it opens. Hermes Coach is outside: it never remounts. */}
              <div key={active} className={active === "Hermes Coach" ? "hidden" : "wp-view flex min-h-0 flex-1 flex-col"}>
              {showGenerationPanel ? (
                <GenerationPanel status={generation} onOpen={backToGeneration} />
              ) : active === "Home" ? (
                <TodayView onNavigate={(tab) => setActive(tab)} />
              ) : active === "Roadmap" ? (
                <RoadmapView onOpenProject={(projectId) => { setActiveProjectId(projectId); setActive("Projects") }} onAskCoach={(draft) => { setCoachDraft(draft); setActive("Hermes Coach") }} />
              ) : active === "Hermes Coach" ? null : active === "My data" ? (
                <MyDataView onOpenEmails={() => setActive("Emails")} onAskHermes={(draft) => { setCoachDraft(draft); setActive("Hermes Coach") }} />
              ) : active === "Emails" ? (
                <EmailsView />
              ) : active === "Quizzes" ? (
                <QuizView />
              ) : active === "Slides" ? (
                <SlidesView />
              ) : active === "Group Projects" ? (
                <TeamsView />
              ) : active === "Learning updates" ? (
                <LearningUpdatesView onAskHermes={(draft) => { setCoachDraft(draft); setActive("Hermes Coach") }} />
              ) : active === "Co-op" ? (
                <CoopView onAskHermes={(draft) => { setCoachDraft(draft); setActive("Hermes Coach") }} onNavigate={(tab) => setActive(tab)} />
              ) : active === "CV" ? (
                <CvView />
              ) : active === "Projects" ? (
                <ProjectsView selectedProjectId={activeProjectId} onSelectProject={setActiveProjectId} onAskHermes={(draft) => setCoachDraft(draft)} onNavigate={(tab) => setActive(tab)} />
              ) : null}
              </div>
              {/* Hermes Coach stays mounted while hidden so an in-progress
                  reply survives tab switches instead of unmounting mid-stream. */}
              <div className={active === "Hermes Coach" ? "contents" : "hidden"}>
                <HermesCoach initialDraft={coachDraft} onConsumeDraft={clearCoachDraft} visible={active === "Hermes Coach"} onNavigate={(tab) => setActive(tab)} />
              </div>
            </main>
          </AnimatedSidebarInset>
        </AnimatedSidebarProvider>
      </div>
    </ThemeProvider>
  )
}


/** A titled block of links; collapsed to icons, the title becomes a thin divider. */
function NavSection({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <AnimatedSidebarGroup className={cn("py-1", className)}>
      {label ? (
        <div className="flex h-6 items-center px-2.5" aria-hidden="true">
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground group-data-[state=collapsed]/sidebar:hidden">
            {label}
          </span>
          <span className="mx-1 hidden h-px flex-1 bg-border group-data-[state=collapsed]/sidebar:block" />
        </div>
      ) : null}
      <AnimatedSidebarGroupContent>
        <AnimatedSidebarMenu aria-label={label}>{children}</AnimatedSidebarMenu>
      </AnimatedSidebarGroupContent>
    </AnimatedSidebarGroup>
  )
}

interface NavItemProps { label: string; text: string; icon: ReactNode; active: string; onSelect: (label: string) => void; badge?: ReactNode }

function NavItem({ label, text, icon, active, onSelect, badge }: NavItemProps) {
  return (
    <AnimatedSidebarMenuItem>
      <AnimatedSidebarMenuButton icon={icon} badge={badge} isActive={active === label} onSelect={() => onSelect(label)}>
        {text}
      </AnimatedSidebarMenuButton>
    </AnimatedSidebarMenuItem>
  )
}

/** Unread team chat messages for whoever is acting in Group Projects, refreshed each minute and on navigation. */
function useTeamUnread(active: string): number {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let stopped = false
    const load = () => {
      api<TeamsHomeData>("/api/me/teams-home", { headers: { "X-Waypoint-User": getActingUserId() } })
        .then((home) => { if (!stopped) setUnread(home.teams.reduce((sum, team) => sum + (team.unread ?? 0), 0)) })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [active])
  return unread
}
