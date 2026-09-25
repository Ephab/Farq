"use client"

import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { avatarColor, initials } from "@/lib/team-cover"
import { cn } from "@/lib/utils"

interface AvatarProps { userId: string; name: string; size?: number; online?: boolean; typing?: boolean }

export function Avatar({ userId, name, size = 24, online = false, typing = false }: AvatarProps) {
  return (
    <span
      className={cn("tm-avatar", online && "is-online", typing && "is-typing")}
      style={{ width: size, height: size, background: avatarColor(userId), fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={name}
      aria-label={name}
      role="img"
    >
      {initials(name)}
    </span>
  )
}

export function HermesAvatar({ size = 24 }: { size?: number }) {
  return (
    <span className="tm-avatar tm-hermes" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-label="Hermes" role="img">
      ✦
    </span>
  )
}

export function Banner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="tm-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="tm-icon-btn" onClick={onDismiss} aria-label="Dismiss"><X className="size-4" /></button>
    </div>
  )
}

interface SheetProps { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }

export function Sheet({ title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="tm-sheet-backdrop" onClick={onClose}>
      <aside className="tm-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="tm-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="tm-icon-btn" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </header>
        <div className="tm-sheet-body">{children}</div>
        {footer ? <footer className="tm-sheet-foot">{footer}</footer> : null}
      </aside>
    </div>
  )
}
