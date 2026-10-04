"use client"

import { ArrowUpRight } from "lucide-react"
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
  const { t, fmt } = useI18n()
  const cover = coverFor(card.cover_seed)
  const due = dueLabel(card.assignment.deadline, t)
  const clamped = Math.max(0, Math.min(100, card.progress))
  // A project made on its own has no course or assignment, so say what it is instead of showing blanks.
  const solo = !card.assignment.id
  return (
    <button
      type="button"
      className="tm-folder"
      onClick={onOpen}
      aria-label={t("teams.cover.open", { name: card.name })}
    >
      <span
        className="tm-folder-cover"
        style={{ backgroundImage: cover.image, backgroundColor: cover.color }}
      >
        <span className="tm-folder-toprow">
          <span className="tm-cover-chip">{solo ? t("teams.gp.projectLabel") : <>{card.course.code}{due ? ` · ${due}` : ""}</>}</span>
          {card.unread ? <span className="tm-cover-unread">{t("teams.cover.unread", { count: card.unread })}</span> : null}
        </span>
        {card.risk ? <span className="tm-folder-risk" title={card.risk}>⚠ {t("teams.cover.atRisk")}</span> : null}
        <span className="tm-folder-info" aria-hidden="true">
          <span className="tm-folder-info-title" dir="auto">{solo ? card.name : card.assignment.title}</span>
          <span className="tm-folder-info-meta">
            {solo ? null : <>{due ?? t("teams.cover.noDueDate")} · </>}{t("teams.cover.members", { count: card.members.length })} · {fmt.percent(clamped / 100)}
          </span>
          <span className="tm-folder-info-bar"><i style={{ width: `${clamped}%` }} /></span>
          {card.next_task ? <span className="tm-folder-info-next" dir="auto">{t("teams.cover.next", { task: card.next_task.title })}</span> : null}
        </span>
      </span>
      <span className="tm-folder-body">
        <span className="tm-folder-tab" aria-hidden="true" />
        <ArrowUpRight className="tm-folder-arrow rtl:-scale-x-100" aria-hidden="true" />
        <span className="tm-folder-title-row">
          <span className="tm-folder-name" dir="auto">{card.name}</span>
        </span>
        <span className="tm-cover-sub tm-folder-sub" dir="auto">{solo ? t("teams.cover.members", { count: card.members.length }) : card.assignment.title}</span>
        <span className="tm-folder-foot">
          <span className="tm-cover-members" aria-label={t("teams.cover.members", { count: card.members.length })}>
            {card.members.slice(0, 6).map((id) => <span key={id} className="tm-cover-dot" />)}
          </span>
          <ProgressRing value={card.progress} />
        </span>
      </span>
    </button>
  )
}
