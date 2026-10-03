import { useEffect, useState } from "react"
import { CalendarClock, ExternalLink } from "lucide-react"
import { api, getCurrentStudentId, type BlackboardDeadline } from "@/lib/waypoint-api"
import { useI18n } from "@/lib/i18n/context"
import { parseServerTime } from "@/lib/server-time"

/** Today: the next graded work from Blackboard. Renders nothing until a sync has stored deadlines. */
export function BlackboardDeadlines() {
  const { t, fmt } = useI18n()
  const [items, setItems] = useState<BlackboardDeadline[] | null>(null)

  useEffect(() => {
    let alive = true
    api<{ items: BlackboardDeadline[] }>(`/api/students/${getCurrentStudentId()}/blackboard/deadlines`)
      .then((data) => { if (alive) setItems(data.items) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [])

  if (!items || items.length === 0) return null
  return (
    <section aria-label={t("blackboard.deadlines.title")} className="rounded-3xl border border-border bg-background p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight"><CalendarClock className="size-[18px]" aria-hidden="true" />{t("blackboard.deadlines.title")}</h2>
      <ul className="mt-4 grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium"><bdi>{item.title}</bdi></p>
              <p className="truncate text-[12px] text-muted-foreground"><bdi>{item.course}</bdi> · {item.overdue ? <span className="font-semibold text-destructive">{t("blackboard.deadlines.overdue")}</span> : t("blackboard.deadlines.due", { when: fmt.dateTime(parseServerTime(item.due_at) ?? item.due_at) })}</p>
            </div>
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" aria-label={t("blackboard.deadlines.open")} className="shrink-0 rounded-full p-2 hover:bg-muted"><ExternalLink className="size-4" aria-hidden="true" /></a> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
