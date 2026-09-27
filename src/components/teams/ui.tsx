"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { avatarColor, initials } from "@/lib/team-cover"
import { DOCK_DEFAULT, DOCK_MIN } from "@/lib/team-layout"
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


interface DockResizerProps { width: number; onResize: (width: number) => void }

/** Drag handle on the chat's left edge: drag left to widen, arrow keys step, double-click resets. */
export function DockResizer({ width, onResize }: DockResizerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  return (
    <div
      className="tm-dock-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuenow={width}
      aria-valuemin={DOCK_MIN}
      tabIndex={0}
      title="Drag to resize the chat (double-click to reset)"
      onPointerDown={(event) => {
        drag.current = { startX: event.clientX, startWidth: width }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(drag.current.startWidth + (drag.current.startX - event.clientX))
      }}
      onPointerUp={(event) => {
        drag.current = null
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onResize(width + 24) }
        if (event.key === "ArrowRight") { event.preventDefault(); onResize(width - 24) }
      }}
      onDoubleClick={() => onResize(DOCK_DEFAULT)}
    />
  )
}
