"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { avatarColor, initials } from "@/lib/team-cover"
import { DOCK_DEFAULT, DOCK_MIN } from "@/lib/team-layout"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/context"

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
  const { t } = useI18n()
  return (
    <span className="tm-avatar tm-hermes" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-label={t("teams.common.hermes")} role="img">
      ✦
    </span>
  )
}

export function Banner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { t } = useI18n()
  return (
    <div className="tm-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="tm-icon-btn" onClick={onDismiss} aria-label={t("teams.common.dismiss")}><X className="size-4" /></button>
    </div>
  )
}

interface SheetProps { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }

export function Sheet({ title, onClose, children, footer }: SheetProps) {
  const { t } = useI18n()
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
          <button type="button" className="tm-icon-btn" onClick={onClose} aria-label={t("teams.common.close")}><X className="size-4" /></button>
        </header>
        <div className="tm-sheet-body">{children}</div>
        {footer ? <footer className="tm-sheet-foot">{footer}</footer> : null}
      </aside>
    </div>
  )
}


interface DockResizerProps { width: number; onResize: (width: number) => void }

/** Drag handle on the chat's inline-start edge: drag away from the chat to widen, arrow keys step,
 * double-click resets. In RTL the chat sits on the left, so pointer and arrow deltas flip. */
export function DockResizer({ width, onResize }: DockResizerProps) {
  const { t, dir } = useI18n()
  const sign = dir === "rtl" ? -1 : 1
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  return (
    <div
      className="tm-dock-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("teams.workspace.resize")}
      aria-valuenow={width}
      aria-valuemin={DOCK_MIN}
      tabIndex={0}
      title={t("teams.workspace.resizeHint")}
      onPointerDown={(event) => {
        drag.current = { startX: event.clientX, startWidth: width }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already gone */ }
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(drag.current.startWidth + sign * (drag.current.startX - event.clientX))
      }}
      onPointerUp={(event) => {
        drag.current = null
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onResize(width + sign * 24) }
        if (event.key === "ArrowRight") { event.preventDefault(); onResize(width - sign * 24) }
      }}
      onDoubleClick={() => onResize(DOCK_DEFAULT)}
    />
  )
}
