"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

// A4 at 96dpi. The inner page is always laid out at this true size (so print gets real mm/pt
// values); on screen it's scaled down with a CSS transform to fit whatever width the panel has.
const PAGE_WIDTH_PX = 794
const PAGE_HEIGHT_PX = 1123

/** Scales an A4 page to fit its container on screen; printing ignores the scale (see index.css). */
export function A4Frame({ children, className }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [pageHeight, setPageHeight] = useState(PAGE_HEIGHT_PX)

  useEffect(() => {
    const container = containerRef.current
    const page = pageRef.current
    if (!container || !page) return
    const measure = () => {
      const width = container.clientWidth
      setScale(width > 0 ? Math.min(1, width / PAGE_WIDTH_PX) : 1)
      setPageHeight(Math.max(PAGE_HEIGHT_PX, page.scrollHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(page)
    return () => observer.disconnect()
  }, [children])

  return (
    <div ref={containerRef} className={className} style={{ height: pageHeight * scale }}>
      <div
        ref={pageRef}
        className="cv-page origin-top-left bg-white text-[#17181c] shadow-[0_1px_3px_rgba(0,0,0,0.15),0_12px_32px_rgba(0,0,0,0.1)]"
        style={{
          width: PAGE_WIDTH_PX,
          minHeight: PAGE_HEIGHT_PX,
          transform: `scale(${scale})`,
          // Chrome/Edge drop background/border colors when printing unless told otherwise; this
          // keeps the chosen accent (rules, Compact's sidebar border) intact on paper.
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}
