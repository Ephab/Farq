"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import { useTeamClient } from "@/components/teams/team-client-context"
import { coverFor } from "@/lib/team-cover"
import { errorMessage, type TeamClient } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

type ClassRow = Awaited<ReturnType<TeamClient["classes"]>>[number]
type Archived = Awaited<ReturnType<TeamClient["archivedProjects"]>>[number]

/** Your classes as quiet rows, and archived projects tucked away until you want them. */
export function ClassesSection({ onOpenClass }: { onOpenClass: (id: string) => void }) {
  const api = useTeamClient()
  const { t } = useI18n()
  const [classes, setClasses] = useState<ClassRow[] | null>(null)
  const [archived, setArchived] = useState<Archived[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    Promise.all([api.classes(), api.archivedProjects()]).then(([rows, projects]) => { setClasses(rows); setArchived(projects); setError(null) })
      .catch(reason => setError(errorMessage(reason)))
  }, [api])
  useEffect(() => { load() }, [load])
  const restore = async (id: string) => {
    try { await api.archiveProject(id, "restore"); load() } catch (reason) { setError(errorMessage(reason)) }
  }
  if (!classes?.length && !archived.length) return error ? <p className="gp-error" role="alert">{error}</p> : null
  return <>
    {classes?.length ? <section className="gp-section">
      <h2 className="gp-h2">{t("teams.gp.classes")}</h2>
      <ul className="gp-rows">
        {classes.map(item => {
          const swatch = coverFor(item.id)
          return <li key={item.id}>
            <button type="button" className="gp-row" onClick={() => onOpenClass(item.id)}>
              <span className="gp-row-swatch" style={{ backgroundImage: swatch.image, backgroundColor: swatch.color }} aria-hidden="true" />
              <span className="gp-row-main"><strong dir="auto"><bdi>{item.title}</bdi></strong>
                <small>{item.archived ? t("teams.gp.archived") : item.organizer ? t("teams.gp.organizer") : t("teams.gp.memberRole")}</small></span>
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          </li>
        })}
      </ul>
    </section> : null}
    {archived.length ? <details className="gp-details">
      <summary>{t("teams.gp.archivedProjects")} · {archived.length}</summary>
      <ul className="gp-rows">
        {archived.map(project => <li key={project.id} className="gp-row gp-row-static">
          <span className="gp-row-main"><strong dir="auto"><bdi>{project.name}</bdi></strong></span>
          {project.class_archived ? <small>{t("teams.classes.restoreClassFirst")}</small>
            : project.can_restore ? <button type="button" className="tm-btn tm-btn-sm" onClick={() => void restore(project.id)}>{t("teams.classes.restoreProject")}</button> : null}
        </li>)}
      </ul>
    </details> : null}
    {error ? <p className="gp-error" role="alert">{error}</p> : null}
  </>
}
