"use client"

import { ArrowUpRight, LayoutGrid } from "lucide-react"
import { coverFor } from "@/lib/team-cover"
import { dueLabel } from "@/lib/team-format"
import type { TeamCard } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

function ProgressRing({ value }: { value: number }) {
  const { t, fmt } = useI18n()
  const radius = 13
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <svg className="tm-ring" width="38" height="38" viewBox="0 0 38 38" role="img" aria-label={t("teams.cover.percentDone", { percent: fmt.percent(clamped / 100) })}>
      <circle cx="19" cy="19" r={radius} fill="none" stroke="var(--fq-surface-strong)" strokeWidth="4" />
      <circle
        cx="19" cy="19" r={radius} fill="none" stroke="var(--fq-accent)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} transform="rotate(-90 19 19)"
      />
      <text x="19" y="23" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--fq-text)">{fmt.percent(clamped / 100)}</text>
    </svg>
  )
}

export function TeamCover({ card, onOpen }: { card: TeamCard; onOpen: () => void }) {
  const { t } = useI18n()
  const cover = coverFor(card.cover_seed)
  const due = dueLabel(card.assignment.deadline, t)
  // A project made on its own has no course or assignment, so say what it is instead of showing blanks.
  const solo = !card.assignment.id
  return (
    <button
      type="button"
      className="gp-project-row"
      onClick={onOpen}
      aria-label={t("teams.cover.open", { name: card.name })}
    >
      <span className="gp-project-mark" style={{ backgroundColor: cover.color }} aria-hidden="true"><LayoutGrid className="size-5" /></span>
      <span className="gp-project-info"><strong dir="auto">{card.name}</strong><small dir="auto">{solo ? t("teams.gp.projectLabel") : <>{card.course.code} · {card.assignment.title}</>}</small></span>
      <span className="gp-project-meta"><span>{t("teams.cover.members", { count: card.members.length })}</span>{due ? <small>{due}</small> : null}</span>
      {card.unread ? <span className="gp-project-unread">{t("teams.cover.unread", { count: card.unread })}</span> : null}
      {card.risk ? <span className="gp-project-risk" title={card.risk}>{t("teams.cover.atRisk")}</span> : null}
      <ProgressRing value={card.progress} />
      <ArrowUpRight className="size-4 rtl:-scale-x-100 gp-project-arrow" aria-hidden="true" />
    </button>
  )
}
