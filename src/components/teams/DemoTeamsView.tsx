import { useMemo, useState } from "react"
import { RotateCcw } from "lucide-react"
import { GroupProjectsBrowser } from "./GroupProjectsBrowser"
import { demoTeamSandbox } from "@/lib/demo-team-transport"
import { DEMO_TEAM_USER } from "@/lib/demo-teams-seed"
import { teamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

export function DemoTeamsView() {
  const { t } = useI18n()
  const client = useMemo(() => teamClient(DEMO_TEAM_USER), [])
  const [revision, setRevision] = useState(0)
  const reset = () => { demoTeamSandbox().reset(); setRevision(value => value + 1) }
  return <GroupProjectsBrowser key={revision} client={client}
    notice={<div className="gp-demo-notice"><span><strong>{t("teams.demo.student")}</strong><span>{t("teams.demo.localEdits")}</span></span>
      <button type="button" className="tm-btn tm-btn-sm" onClick={reset}><RotateCcw className="size-3.5" aria-hidden="true" />{t("teams.demo.reset")}</button></div>}
    settings={<div className="gp-stackv"><strong>{t("teams.demo.student")}</strong><p className="gp-muted">{t("teams.demo.explanation")}</p>
      <p className="gp-muted">{t("teams.demo.capabilities")}</p><p className="gp-muted">{t("teams.demo.codeHint")}</p>
      <button type="button" className="tm-btn" onClick={reset}>{t("teams.demo.reset")}</button></div>} />
}
