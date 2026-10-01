"use client"

import { LoaderCircle, Plug, RotateCcw, Settings, UserPlus, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { ConnectionsDialog } from "@/components/connections-dialog"
import { useAnimatedSidebar } from "@/components/motion/animated-sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/motion/popover"
import { api, clearLocalWaypointState, setCurrentStudentId } from "@/lib/waypoint-api"
import { getActingUserId, setActingUserId } from "@/lib/teams-api"
import { useTheme } from "@/lib/theme-context"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { LOCALES, type Locale } from "@/lib/i18n/core"

// Each language is named in itself, so a reader can find theirs whatever the UI language is.
const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" }

export function FooterSettings() {
  const { themeId, setThemeId } = useTheme()
  const { t, locale, setLocale } = useI18n()
  const { open: sidebarOpen } = useAnimatedSidebar()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resettingTeam, setResettingTeam] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const activeTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]

  // The sidebar width animates when toggled, which moves the gear without
  // resizing it — the popover can't track that, so close it instead of
  // leaving it stranded at stale coordinates.
  useEffect(() => {
    setPopoverOpen(false)
  }, [sidebarOpen])

  const resetDemoTeam = async () => {
    if (resettingTeam || !window.confirm(t("settings.resetTeamConfirm"))) return
    setResettingTeam(true)
    setResetError(null)
    try {
      await api("/api/demo/reset-team", {
        method: "POST",
        body: JSON.stringify({ confirm: "RESET" }),
        headers: { "X-Waypoint-User": getActingUserId() },
      })
      window.location.reload()
    } catch (reason) {
      setResettingTeam(false)
      setResetError(reason instanceof Error ? reason.message : t("settings.resetTeamFailed"))
    }
  }

  const restoreFreshWaypoint = async () => {    if (resetting || !window.confirm(t("settings.restoreConfirm"))) return
    setResetting(true)
    setResetError(null)
    try {
      await api("/api/demo/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) })
      clearLocalWaypointState()
      window.location.reload()
    } catch (reason) {
      setResetting(false)
      setResetError(reason instanceof Error ? reason.message : t("settings.restoreFailed"))
    }
  }

  return (
    <>
    {connectionsOpen ? <ConnectionsDialog onClose={() => setConnectionsOpen(false)} /> : null}
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => {
        setPopoverOpen(open)
      }}
      side="top"
      align="end"
    >
      <PopoverTrigger>
        <button
          type="button"
          aria-label={t("settings.open")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]_svg]:rotate-90 [&_svg]:transition-transform"
        >
          <Settings className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/* Remount on every open so the trigger position is measured fresh —
          otherwise a sidebar expand/collapse leaves stale coordinates and the
          panel clips off-screen. */}
      <PopoverContent key={String(popoverOpen)} className="max-h-[calc(100dvh-6rem)] w-56 overflow-y-auto overscroll-contain border border-border p-3">
        <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("settings.title")}
        </p>

        <p id="settings-language" className="mt-3 px-1 text-xs font-medium text-foreground">
          {t("settings.language")}
        </p>
        <div role="radiogroup" aria-labelledby="settings-language" className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-border p-0.5">
          {LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={locale === option}
              lang={option}
              dir={option === "ar" ? "rtl" : "ltr"}
              onClick={() => setLocale(option)}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                locale === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {LOCALE_NAMES[option]}
            </button>
          ))}
        </div>

        <p className="mt-3 px-1 text-xs font-medium text-foreground">
          {t("settings.appearance")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          {THEMES.map((theme) => {
            const selected = theme.id === themeId
            return (
              <button
                key={theme.id}
                type="button"
                title={theme.name}
                aria-label={t("settings.useTheme", { name: theme.name })}
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
          <bdi>{activeTheme.name}</bdi> — {t(`settings.themeDescriptions.${activeTheme.id}` as MessageKey)}
        </p>

        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => { setPopoverOpen(false); setConnectionsOpen(true) }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plug className="size-3.5" aria-hidden="true" />
            {t("connections.open")}
          </button>
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("settings.reset")}
          </p>
          <p className="mt-1 px-1 text-[11px] leading-4 text-muted-foreground">
            {t("settings.resetHelp")}
          </p>
          <button
            type="button"
            onClick={() => { setCurrentStudentId(null); setActingUserId(null); window.location.reload() }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            {t("settings.switchStudent")}
          </button>
          <button
            type="button"
            disabled={resetting}
            onClick={() => void restoreFreshWaypoint()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 px-2 py-2 text-xs font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {resetting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
            {t(resetting ? "settings.restoring" : "settings.restoreFresh")}
          </button>
          <button
            type="button"
            disabled={resettingTeam}
            onClick={() => void resetDemoTeam()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {resettingTeam ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Users className="size-3.5" aria-hidden="true" />}
            {t(resettingTeam ? "settings.resetting" : "settings.resetTeam")}
          </button>
          {resetError ? <p role="alert" className="mt-2 px-1 text-[11px] leading-4 text-destructive">{resetError}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
    </>
  )
}
