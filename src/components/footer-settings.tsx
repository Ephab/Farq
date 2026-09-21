"use client"

import { Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { useAnimatedSidebar } from "@/components/motion/animated-sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/motion/popover"
import { useTheme } from "@/lib/theme-context"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"

export function FooterSettings() {
  const { themeId, setThemeId } = useTheme()
  const { open: sidebarOpen } = useAnimatedSidebar()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const activeTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]

  // The sidebar width animates when toggled, which moves the gear without
  // resizing it — the popover can't track that, so close it instead of
  // leaving it stranded at stale coordinates.
  useEffect(() => {
    setPopoverOpen(false)
  }, [sidebarOpen])

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen} side="top" align="end">
      <PopoverTrigger>
        <button
          type="button"
          aria-label="Open settings"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-data-[state=collapsed]/sidebar:hidden [&[data-state=open]_svg]:rotate-90 [&_svg]:transition-transform"
        >
          <Settings className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/* Remount on every open so the trigger position is measured fresh —
          otherwise a sidebar expand/collapse leaves stale coordinates and the
          panel clips off-screen. */}
      <PopoverContent key={String(popoverOpen)} className="w-56 border border-border p-3">
        <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Settings
        </p>

        <p className="mt-3 px-1 text-xs font-medium text-foreground">
          Appearance
        </p>
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          {THEMES.map((theme) => {
            const selected = theme.id === themeId
            return (
              <button
                key={theme.id}
                type="button"
                title={theme.name}
                aria-label={`Use ${theme.name} theme`}
                aria-pressed={selected}
                onClick={() => setThemeId(theme.id)}
                style={{ background: theme.tokens.background }}
                className={cn(
                  "grid size-8 place-items-center rounded-full border transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                  selected
                    ? "border-transparent ring-2 ring-ring"
                    : "border-border",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ background: theme.tokens.primary }}
                />
              </button>
            )
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {activeTheme.name} — {activeTheme.description}
        </p>
      </PopoverContent>
    </Popover>
  )
}
