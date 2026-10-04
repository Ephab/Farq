import { useState, type ReactNode } from "react"
import { Plus, Settings2 } from "lucide-react"
import { Sheet } from "./ui"
import { ClassesSection } from "./ClassesSection"
import { ClassPage } from "./ClassPage"
import { ProjectsSection } from "./ProjectsSection"
import { StartPanel } from "./StartPanel"
import { TeamClientContext } from "./team-client-context"
import { TeamWorkspace } from "./TeamWorkspace"
import { cleanCode, type StartMode } from "@/lib/gp-format"
import { errorMessage, type TeamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

type Route = { kind: "home" } | { kind: "class"; id: string } | { kind: "team"; id: string }

/** Shared navigation and views; the injected client owns all reads and writes. */
export function GroupProjectsBrowser({ client, settings, notice }: { client: TeamClient; settings: ReactNode; notice?: ReactNode }) {
  const { t } = useI18n()
  const [route, setRoute] = useState<Route>({ kind: "home" })
  const [revision, setRevision] = useState(0)
  const [homeTab, setHomeTab] = useState<"projects" | "classes">("projects")
  const [dialog, setDialog] = useState<"start" | "settings" | null>(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const refresh = () => setRevision(value => value + 1)
  const openTeam = (id: string) => setRoute({ kind: "team", id })
  const openClass = (id: string) => setRoute({ kind: "class", id })
  const home = () => { setRoute({ kind: "home" }); refresh() }
  const start = async (mode: StartMode, value: string): Promise<boolean> => {
    setBusy(true); setStartError(null)
    try {
      if (mode === "project") openTeam((await client.createRoom(value)).id)
      else if (mode === "class") openClass((await client.createClass(value)).id)
      else {
        const joined = await client.redeemCode(cleanCode(value))
        if (joined.team_id) openTeam(joined.team_id)
        else if (joined.class_id) openClass(joined.class_id)
        else refresh()
      }
      setDialog(null); return true
    } catch (reason) { setStartError(errorMessage(reason)); return false }
    finally { setBusy(false) }
  }
  return <div className={`fq tm-page gp-page${route.kind === "team" ? " gp-page-wide" : ""}`}>
    <TeamClientContext.Provider value={client}>
      {notice}
      {route.kind === "team" ? <TeamWorkspace key={`${client.userId}:${route.id}`} teamId={route.id} onBack={home} />
        : route.kind === "class" ? <ClassPage key={`${client.userId}:${route.id}`} id={route.id} onBack={home} onOpenTeam={openTeam} onChanged={refresh} />
          : <div className="gp-home">
            <header className="gp-head">
              <div><h1 className="gp-title">{t("teams.page.title")}</h1><p className="gp-sub">{t("teams.gp.subtitle")}</p></div>
              <div className="gp-head-actions">
                <button type="button" className="tm-btn tm-btn-primary" onClick={() => { setStartError(null); setDialog("start") }}><Plus className="size-4" aria-hidden="true" />{t("teams.ui.createJoin")}</button>
                <button type="button" className="tm-icon-btn" onClick={() => setDialog("settings")} aria-label={t("teams.ui.settings")} title={t("teams.ui.settings")}><Settings2 className="size-5" aria-hidden="true" /></button>
              </div>
            </header>
            <nav className="gp-tabs" aria-label={t("teams.page.title")}>
              {(["projects", "classes"] as const).map(tab => <button type="button" key={tab} className="gp-tab" aria-current={homeTab === tab ? "page" : undefined} onClick={() => setHomeTab(tab)}>{t(`teams.ui.${tab}`)}</button>)}
            </nav>
            {homeTab === "projects" ? <ProjectsSection key={`p:${client.userId}:${revision}`} onOpenTeam={openTeam} />
              : <ClassesSection key={`c:${client.userId}:${revision}`} onOpenClass={openClass} />}
          </div>}
      {dialog === "start" ? <Sheet title={t("teams.ui.createJoin")} onClose={() => setDialog(null)}><StartPanel busy={busy} error={startError} onSubmit={start} /></Sheet> : null}
      {dialog === "settings" ? <Sheet title={t("teams.ui.settings")} onClose={() => setDialog(null)}>{settings}</Sheet> : null}
    </TeamClientContext.Provider>
  </div>
}
