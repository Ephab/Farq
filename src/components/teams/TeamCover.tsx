"use client"

import { ArrowUpRight } from "lucide-react"
import { avatarColor, coverFor } from "@/lib/team-cover"
import { dueLabel } from "@/lib/team-format"
import type { TeamCard } from "@/lib/teams-api"

function ProgressRing({ value }: { value: number }) {
  const radius = 13
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <svg className="tm-ring" width="38" height="38" viewBox="0 0 38 38" role="img" aria-label={`${clamped}% done`}>
      <circle cx="19" cy="19" r={radius} fill="none" stroke="var(--fq-surface-strong)" strokeWidth="4" />
      <circle
        cx="19" cy="19" r={radius} fill="none" stroke="var(--fq-accent)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} transform="rotate(-90 19 19)"
      />
      <text x="19" y="23" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--fq-text)">{clamped}%</text>
    </svg>
  )
}

export function TeamCover({ card, onOpen }: { card: TeamCard; onOpen: () => void }) {
  const cover = coverFor(card.cover_seed)
  const due = dueLabel(card.assignment.deadline)
  const clamped = Math.max(0, Math.min(100, card.progress))
  return (
    <button
      type="button"
      className="tm-folder"
      onClick={onOpen}
      aria-label={`Open team ${card.name}`}
    >
      <span
        className="tm-folder-cover"
        style={{ backgroundImage: cover.image, backgroundColor: cover.color }}
      >
        <span className="tm-folder-toprow">
          <span className="tm-cover-chip">{card.course.code}{due ? ` · ${due}` : ""}</span>
          {card.unread ? <span className="tm-cover-unread">{card.unread} new</span> : null}
        </span>
        {card.risk ? <span className="tm-folder-risk" title={card.risk}>⚠ At risk</span> : null}
        <span className="tm-folder-info" aria-hidden="true">
          <span className="tm-folder-info-title">{card.assignment.title}</span>
          <span className="tm-folder-info-meta">
            {due ?? "No due date"} · {card.members.length} member{card.members.length === 1 ? "" : "s"} · {clamped}%
          </span>
          <span className="tm-folder-info-bar"><i style={{ width: `${clamped}%` }} /></span>
          {card.next_task ? <span className="tm-folder-info-next">Next: {card.next_task.title}</span> : null}
        </span>
      </span>
      <span className="tm-folder-body">
        <span className="tm-folder-tab" aria-hidden="true" />
        <ArrowUpRight className="tm-folder-arrow" aria-hidden="true" />
        <span className="tm-folder-title-row">
          <span className="tm-folder-name">{card.name}</span>
        </span>
        <span className="tm-cover-sub tm-folder-sub">{card.assignment.title}</span>
        <span className="tm-folder-foot">
          <span className="tm-cover-members" aria-label={`${card.members.length} members`}>
            {card.members.slice(0, 6).map((id) => <span key={id} className="tm-cover-dot" style={{ background: avatarColor(id) }} />)}
          </span>
          <ProgressRing value={card.progress} />
        </span>
      </span>
    </button>
  )
}
