"use client"

import { avatarColor, coverFor } from "@/lib/team-cover"
import { dueLabel } from "@/lib/team-format"
import type { TeamCard } from "@/lib/teams-api"

function ProgressRing({ value }: { value: number }) {
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <svg className="tm-ring" width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={`${clamped}% done`}>
      <circle cx="22" cy="22" r={radius} fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
      <circle
        cx="22" cy="22" r={radius} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{clamped}%</text>
    </svg>
  )
}

export function TeamCover({ card, onOpen }: { card: TeamCard; onOpen: () => void }) {
  const cover = coverFor(card.cover_seed)
  const due = dueLabel(card.assignment.deadline)
  return (
    <button type="button" className="tm-cover" style={{ backgroundImage: cover.image, backgroundColor: cover.color }} onClick={onOpen}>
      <span className="tm-cover-chip">{card.course.code}{due ? ` · ${due}` : ""}</span>
      {card.unread ? <span className="tm-cover-unread">{card.unread} new</span> : null}
      <span className="tm-cover-name">{card.name}</span>
      <span className="tm-cover-sub">{card.assignment.title}</span>
      {card.risk ? <span className="tm-cover-risk" title={card.risk}>⚠ At risk</span> : null}
      <span className="tm-cover-members" aria-label={`${card.members.length} members`}>
        {card.members.slice(0, 6).map((id) => <span key={id} className="tm-cover-dot" style={{ background: avatarColor(id) }} />)}
      </span>
      {card.next_task ? <span className="tm-cover-next">Next for you: {card.next_task.title}</span> : null}
      <ProgressRing value={card.progress} />
    </button>
  )
}
