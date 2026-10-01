"use client"

import { Database, LoaderCircle, Plug, RotateCcw, Settings, SlidersHorizontal, UserPlus, Users, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ConnectionsPanel } from "@/components/connections-panel"
import { api, clearLocalWaypointState, setCurrentStudentId } from "@/lib/waypoint-api"
import { getActingUserId, setActingUserId } from "@/lib/teams-api"
import { useTheme } from "@/lib/theme-context"
import { THEMES } from "@/lib/themes"
import { useModalFocus } from "@/lib/use-modal-focus"
import { cn } from "@/lib/utils"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { LOCALES, type Locale } from "@/lib/i18n/core"

// Each language is named in itself, so a reader can find theirs whatever the UI language is.
const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" }

type Section = "general" | "connections" | "data"
const SECTIONS: { id: Section; icon: typeof Settings }[] = [
  { id: "general", icon: SlidersHorizontal },
  { id: "connections", icon: Plug },
  { id: "data", icon: Database },
]

/** The sidebar gear. Settings open as one roomy dialog, portalled to the page root so no
 *  sidebar or page stacking context can paint over it. */
export function FooterSettings() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={t("settings.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-[color,background-color,rotate] duration-500 hover:rotate-45 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="size-4" aria-hidden="true" />
      </button>
      {open ? createPortal(<SettingsDialog onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [section, setSection] = useState<Section>("general")
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeHandler = useRef(onClose)
  useEffect(() => { closeHandler.current = onClose }, [onClose])
  useModalFocus(sheetRef, () => closeHandler.current(), closeRef)

  return (
    <div
      className="wp-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="wp-panel flex h-[min(46rem,calc(100dvh-1rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:h-[min(46rem,calc(100dvh-3rem))] md:flex-row"
      >
        <nav aria-label={t("settings.title")} className="flex shrink-0 flex-col gap-1 border-b border-border bg-muted/40 p-3 md:w-60 md:border-b-0 md:border-e md:p-4">
          <div className="flex items-center justify-between gap-2 px-2 pb-2 md:pb-4">
            <h2 id="settings-title" className="text-lg font-semibold">{t("settings.title")}</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("settings.close")} className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={section === id}
                aria-controls="settings-panel"
                onClick={() => setSection(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  section === id ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(`settings.sections.${id}` as MessageKey)}
              </button>
            ))}
          </div>
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="hidden items-center justify-between gap-4 border-b border-border px-8 py-5 md:flex">
            <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">{t(`settings.sections.${section}` as MessageKey)}</h3>
            <button type="button" onClick={onClose} aria-label={t("settings.close")} className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`} key={section} className="wp-view min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-6">
            {section === "general" ? <GeneralSection /> : section === "connections" ? <ConnectionsPanel /> : <DataSection />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Group({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-6 first:pt-0 last:border-0">
      <h4 className="text-[15px] font-semibold">{title}</h4>
      {help ? <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{help}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function GeneralSection() {
  const { themeId, setThemeId } = useTheme()
  const { t, locale, setLocale } = useI18n()
  return (
    <>
      <Group title={t("settings.language")}>
        <div role="radiogroup" aria-label={t("settings.language")} className="inline-grid grid-cols-2 gap-1 rounded-xl border border-border p-1">
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
                "min-w-28 rounded-lg px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                locale === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {LOCALE_NAMES[option]}
            </button>
          ))}
        </div>
      </Group>

      <Group title={t("settings.appearance")} help={t("settings.generalHelp")}>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((theme) => {
            const selected = theme.id === themeId
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t("settings.useTheme", { name: theme.name })}
                onClick={() => setThemeId(theme.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border p-2.5 text-start outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-foreground/60 ring-1 ring-foreground/30" : "border-border hover:border-foreground/30",
                )}
              >
                {/* A tiny preview of the theme: its page, a line of text and the accent. */}
                <span aria-hidden="true" className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border" style={{ background: theme.tokens.background, borderColor: theme.tokens.border }}>
                  <span className="absolute inset-y-0 start-0 w-4" style={{ background: theme.tokens.muted }} />
                  <span className="absolute start-6 top-3 h-1.5 w-7 rounded-full" style={{ background: theme.tokens.foreground }} />
                  <span className="absolute start-6 top-6 h-1.5 w-5 rounded-full opacity-50" style={{ background: theme.tokens.mutedForeground }} />
                  <span className="absolute bottom-2 end-2 size-2.5 rounded-full" style={{ background: theme.tokens.primary }} />
                </span>
                <span className="min-w-0">
                  <bdi className="block truncate text-sm font-medium">{theme.name}</bdi>
                  <span className="block text-xs leading-4 text-muted-foreground">{t(`settings.themeDescriptions.${theme.id}` as MessageKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Group>
    </>
  )
}

function DataSection() {
  const { t } = useI18n()
  const [resetting, setResetting] = useState(false)
  const [resettingTeam, setResettingTeam] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

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

  const restoreFreshWaypoint = async () => {
    if (resetting || !window.confirm(t("settings.restoreConfirm"))) return
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

  const rowButton = "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
  return (
    <>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{t("settings.dataHelp")}</p>
      <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
        <DataRow title={t("settings.switchStudent")} help={t("settings.switchStudentHelp")}>
          <button type="button" onClick={() => { setCurrentStudentId(null); setActingUserId(null); window.location.reload() }} className={cn(rowButton, "border-border hover:bg-muted")}>
            <UserPlus className="size-4" aria-hidden="true" />{t("settings.switchStudent")}
          </button>
        </DataRow>
        <DataRow title={t("settings.resetTeam")} help={t("settings.resetTeamHelp")}>
          <button type="button" disabled={resettingTeam} onClick={() => void resetDemoTeam()} className={cn(rowButton, "border-border hover:bg-muted")}>
            {resettingTeam ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Users className="size-4" aria-hidden="true" />}
            {t(resettingTeam ? "settings.resetting" : "settings.reset")}
          </button>
        </DataRow>
        <DataRow title={t("settings.restoreFresh")} help={t("settings.restoreHelp")}>
          <button type="button" disabled={resetting} onClick={() => void restoreFreshWaypoint()} className={cn(rowButton, "border-destructive/40 text-destructive hover:bg-destructive/10")}>
            {resetting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
            {t(resetting ? "settings.restoring" : "settings.restoreFresh")}
          </button>
        </DataRow>
      </ul>
      {resetError ? <p role="alert" className="mt-3 text-sm text-destructive">{resetError}</p> : null}
    </>
  )
}

function DataRow({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 max-w-[52ch] text-sm text-muted-foreground">{help}</p>
      </div>
      {children}
    </li>
  )
}
