"use client"

import { Eye, EyeOff, KeyRound, LoaderCircle, RotateCcw, Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { useAnimatedSidebar } from "@/components/motion/animated-sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/motion/popover"
import {
  DEFAULT_HERMES_GEMINI_MODEL,
  DEFAULT_HERMES_NIM_MODEL,
  HERMES_GEMINI_MODELS,
  HERMES_NIM_MODELS,
  api,
  clearLocalFarqState,
  getHermesApiKey,
  getHermesModel,
  getHermesProvider,
  saveHermesApiKey,
  saveHermesModel,
  saveHermesProvider,
  type HermesProvider,
} from "@/lib/farq-api"
import { useTheme } from "@/lib/theme-context"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"

export function FooterSettings() {
  const { themeId, setThemeId } = useTheme()
  const { open: sidebarOpen } = useAnimatedSidebar()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [hermesProvider, setHermesProvider] = useState<HermesProvider>("gemini")
  const [hermesModel, setHermesModel] = useState<string>(DEFAULT_HERMES_GEMINI_MODEL)
  const [hermesApiKey, setHermesApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [applyState, setApplyState] = useState<"idle" | "saving" | "waiting" | "live" | "saved" | "error">("idle")
  const [applyError, setApplyError] = useState<string | null>(null)
  const modelOptions = hermesProvider === "nim" ? HERMES_NIM_MODELS : HERMES_GEMINI_MODELS
  const modelChoices =
    hermesModel && !modelOptions.some((m) => m.id === hermesModel)
      ? [{ id: hermesModel, label: hermesModel }, ...modelOptions]
      : modelOptions
  const activeTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]

  // The sidebar width animates when toggled, which moves the gear without
  // resizing it — the popover can't track that, so close it instead of
  // leaving it stranded at stale coordinates.
  useEffect(() => {
    setPopoverOpen(false)
  }, [sidebarOpen])

  const applySettings = async () => {
    const key = hermesApiKey.trim()
    if (key.length < 32) {
      setApplyState("error")
      setApplyError("Key must be at least 32 characters.")
      return
    }
    setApplyState("saving")
    setApplyError(null)
    let pre: number | null = null
    try {
      const health = await api<{ started_at?: number }>("/api/health")
      pre = health.started_at ?? null
    } catch {
      // Backend may be starting; the apply POST below is the real probe.
    }
    try {
      await api("/api/settings/hermes", {
        method: "POST",
        body: JSON.stringify({ key, provider: hermesProvider, model: hermesModel }),
      })
    } catch (reason) {
      setApplyState("error")
      setApplyError(reason instanceof Error ? reason.message : "Could not save settings")
      return
    }
    // The server is authoritative now; drop the tab-only override.
    saveHermesApiKey("")
    setHermesApiKey("")
    setApplyState("waiting")
    const deadline = Date.now() + 45000
    let sawDown = false
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        const health = await api<{ started_at?: number }>("/api/health")
        if (pre === null || (health.started_at !== undefined && health.started_at !== pre)) {
          setApplyState("live")
          return
        }
      } catch {
        sawDown = true
      }
    }
    if (sawDown) {
      setApplyState("error")
      setApplyError("Saved, but the backend did not come back — check the runner terminal.")
    } else {
      setApplyState("saved")
    }
  }

  const restoreFreshFarq = async () => {    if (resetting || !window.confirm("Erase your Farq chat, learned facts, roadmap changes, proposals, and local app data? This cannot be undone.")) return
    setResetting(true)
    setResetError(null)
    try {
      await api("/api/demo/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) })
      clearLocalFarqState()
      window.location.reload()
    } catch (reason) {
      setResetting(false)
      setResetError(reason instanceof Error ? reason.message : "Could not restore Farq")
    }
  }

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => {
        setPopoverOpen(open)
        if (open) {
          const provider = getHermesProvider()
          setHermesProvider(provider)
          setHermesModel(getHermesModel(provider))
          setHermesApiKey(getHermesApiKey())
          setShowKey(false)
        }
      }}
      side="top"
      align="end"
    >
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

        <div className="mt-3 border-t border-border pt-3">
          <label htmlFor="hermes-provider" className="block px-1 text-xs font-medium text-foreground">
            Hermes model
          </label>
          <select
            id="hermes-provider"
            value={hermesProvider}
            onChange={(event) => {
              const provider = event.target.value as HermesProvider
              setHermesProvider(provider)
              saveHermesProvider(provider)
              const nextModel = getHermesModel(provider)
              setHermesModel(nextModel)
            }}
            className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="gemini">Gemini</option>
            <option value="nim">NVIDIA NIM</option>
          </select>

          <label htmlFor="hermes-model" className="mt-3 block px-1 text-xs font-medium text-foreground">
            Model
          </label>
          <select
            id="hermes-model"
            value={hermesModel}
            onChange={(event) => {
              setHermesModel(event.target.value)
              saveHermesModel(hermesProvider, event.target.value)
            }}
            className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {modelChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <label htmlFor="hermes-api-key" className="mt-3 block px-1 text-xs font-medium text-foreground">
            Hermes API key
          </label>
          <div className="mt-2 flex items-center gap-1 rounded-lg border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              id="hermes-api-key"
              type={showKey ? "text" : "password"}
              value={hermesApiKey}
              onChange={(event) => {
                setHermesApiKey(event.target.value)
                saveHermesApiKey(event.target.value)
              }}
              placeholder={hermesProvider === "nim" ? "Farq Hermes key (nvapi-… lives server-side)" : "Farq Hermes key"}
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {hermesApiKey ? (
              <button
                type="button"
                onClick={() => {
                  setHermesApiKey("")
                  saveHermesApiKey("")
                }}
                aria-label="Clear Hermes API key"
                className="grid size-7 shrink-0 place-items-center rounded-md text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                ✕
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide Hermes API key" : "Show Hermes API key"}
              aria-pressed={showKey}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showKey ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
            </button>
          </div>
          {hermesProvider === "nim" ? (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Active model default: {DEFAULT_HERMES_NIM_MODEL}. The NVIDIA provider key stays in Farq&apos;s server env.
            </p>
          ) : (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Active model default: {DEFAULT_HERMES_GEMINI_MODEL}. The Google provider key stays in Farq&apos;s server env.
            </p>
          )}
          <button
            type="button"
            disabled={applyState === "saving" || applyState === "waiting" || hermesApiKey.trim().length < 32}
            onClick={() => void applySettings()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <KeyRound className="size-3.5" aria-hidden="true" />
            {applyState === "saving" ? "Saving…" : applyState === "waiting" ? "Restarting gateway…" : applyState === "live" ? "Live — key applied" : "Apply key + model to server"}
          </button>
          {applyState === "saved" ? <p className="mt-2 px-1 text-[11px] leading-4 text-amber-700">Saved to .env — restart the Farq stack to apply.</p> : null}
          {applyError ? <p role="alert" className="mt-2 px-1 text-[11px] leading-4 text-destructive">{applyError}</p> : null}
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Reset
          </p>
          <p className="mt-1 px-1 text-[11px] leading-4 text-muted-foreground">
            Erase your coach memory, chat, roadmap changes, proposals, and local app data.
          </p>
          <button
            type="button"
            disabled={resetting}
            onClick={() => void restoreFreshFarq()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 px-2 py-2 text-xs font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {resetting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
            {resetting ? "Restoring…" : "Restore fresh Farq"}
          </button>
          {resetError ? <p role="alert" className="mt-2 px-1 text-[11px] leading-4 text-destructive">{resetError}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
