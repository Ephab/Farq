import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { CircleAlert } from "lucide-react"

/** Extra info lives behind this (!) icon as a hover/focus tooltip instead of inline text. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [shift, setShift] = useState(0)
  const [above, setAbove] = useState(false)

  // Measure while the bubble is laid out but still invisible, then reveal it
  // in its final spot before paint, so it never jumps on screen.
  useLayoutEffect(() => {
    if (!open) {
      setPlaced(false)
      return
    }
    const bubble = bubbleRef.current
    const icon = iconRef.current
    if (!bubble || !icon) return
    const rect = bubble.getBoundingClientRect()
    if (!rect.width) return
    // clientWidth excludes the scrollbar; innerWidth would let the bubble
    // slide a scrollbar-width off screen.
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const margin = 8
    let dx = 0
    if (rect.right > vw - margin) dx = vw - margin - rect.right
    if (rect.left + dx < margin) dx = margin - rect.left
    setShift(dx)
    const iconRect = icon.getBoundingClientRect()
    setAbove(rect.bottom > vh - margin && iconRect.top > rect.height + margin * 2)
    setPlaced(true)
  }, [open ])

  return (
    <span
      className="relative inline-flex shrink-0 align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { setOpen(false); setShift(0); setAbove(false) }}
      onFocus={() => setOpen(true)}
      onBlur={() => { setOpen(false); setShift(0); setAbove(false) }}
    >
      <span ref={iconRef} tabIndex={0} role="img" aria-label={label} className="grid size-3.5 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <CircleAlert className="size-3.5" />
      </span>
      <span ref={bubbleRef} role="tooltip" style={{ transform: shift ? `translateX(${shift}px)` : undefined }} className={`pointer-events-none absolute start-0 z-20 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-5 text-popover-foreground shadow-md ${open ? "block" : "hidden"} ${placed ? "visible" : "invisible"} ${above ? "bottom-full mb-1" : "top-full mt-1"}`}>
        {children}
      </span>
    </span>
  )
}
