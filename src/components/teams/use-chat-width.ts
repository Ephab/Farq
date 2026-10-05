import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react"
import { DOCK_DEFAULT, DOCK_MIN, clampWorkspaceChatWidth, readDockWidth, saveDockWidth, workspaceChatMax } from "@/lib/team-layout"

/** Keep the preferred width independent of the viewport, so temporarily narrowing the
 * window/sidebar doesn't overwrite it. Only deliberate resize actions are persisted. */
export function useChatWidth(container: RefObject<HTMLDivElement | null>, enabled: boolean, dir: "ltr" | "rtl") {
  const [preferred, setPreferred] = useState(readDockWidth)
  const [available, setAvailable] = useState(0)
  const [dragging, setDragging] = useState(false)
  const current = useRef(preferred)
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null)
  const width = available ? clampWorkspaceChatWidth(preferred, available) : preferred
  const max = available ? workspaceChatMax(available) : width

  useLayoutEffect(() => {
    const element = container.current
    if (!enabled || !element) return
    const measure = () => setAvailable(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [container, enabled])

  const clearDrag = () => {
    drag.current = null
    delete document.body.dataset.teamChatResizing
  }
  useEffect(() => {
    const onBlur = () => {
      if (!drag.current) return
      saveDockWidth(current.current)
      drag.current = null; delete document.body.dataset.teamChatResizing; setDragging(false)
    }
    window.addEventListener("blur", onBlur)
    return () => { window.removeEventListener("blur", onBlur); drag.current = null; delete document.body.dataset.teamChatResizing }
  }, [])

  const change = (requested: number, remember = true) => {
    const next = clampWorkspaceChatWidth(requested, container.current?.clientWidth ?? available)
    current.current = next
    setPreferred(next)
    if (remember) saveDockWidth(next)
  }
  const finish = (event: PointerEvent<HTMLDivElement>, remember: boolean) => {
    if (drag.current?.pointer !== event.pointerId) return
    if (remember) saveDockWidth(current.current)
    clearDrag(); setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    width, dragging,
    separator: {
      role: "separator" as const, tabIndex: 0, "aria-orientation": "vertical" as const,
      "aria-valuemin": DOCK_MIN, "aria-valuemax": max, "aria-valuenow": width,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault(); event.currentTarget.focus()
        current.current = width
        drag.current = { pointer: event.pointerId, x: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
        document.body.dataset.teamChatResizing = ""
        setDragging(true)
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current
        if (!start || start.pointer !== event.pointerId) return
        change(start.width + (start.x - event.clientX) * (dir === "rtl" ? -1 : 1), false)
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onDoubleClick: () => change(DOCK_DEFAULT),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 80 : 24
        const delta = event.key === "ArrowLeft" ? (dir === "rtl" ? -step : step)
          : event.key === "ArrowRight" ? (dir === "rtl" ? step : -step) : 0
        if (delta) { event.preventDefault(); change(width + delta) }
        else if (["Home", "End", "Enter"].includes(event.key)) {
          event.preventDefault(); change(event.key === "Home" ? DOCK_MIN : event.key === "End" ? max : DOCK_DEFAULT)
        }
      },
    },
  }
}
