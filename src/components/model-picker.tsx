"use client"

import { Gauge, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { checkModelSpeed, saveModelChoice, useModelCatalog, type SpeedResult } from "@/lib/models"
import { useI18n } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"
import type { HermesProvider } from "@/lib/waypoint-api"

/** Provider + model for every Hermes feature. A change saves at once and applies to the next run.
 *  Used in Settings > Models & API keys and, compactly, in onboarding. */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { catalog, failed, reload } = useModelCatalog()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [speed, setSpeed] = useState<{ provider: HermesProvider; results: SpeedResult[] } | null>(null)
  const [checking, setChecking] = useState(false)

  if (!catalog) {
    return failed ? (
      <p role="alert" className="text-xs text-destructive">
        {t("connections.loadFailed")} <button type="button" onClick={() => reload()} className="font-medium underline underline-offset-4">{t("connections.retry")}</button>
      </p>
    ) : (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />{t("connections.loading")}</p>
    )
  }

  const { selected } = catalog
  const provider = catalog.providers.find((item) => item.id === selected.provider) ?? catalog.providers[0]
  const model = provider.models.find((item) => item.id === selected.model)
  const choose = async (nextProvider: HermesProvider, nextModel?: string) => {
    const target = catalog.providers.find((item) => item.id === nextProvider)
    if (!target) return
    setSaving(true)
    setMessage(null)
    try {
      await saveModelChoice(nextProvider, nextModel ?? target.models[0].id)
      setMessage({ tone: "ok", text: t("connections.hermes.saved") })
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("connections.hermes.saveFailed") })
    } finally {
      setSaving(false)
    }
  }

  const measure = async () => {
    setChecking(true)
    setMessage(null)
    try {
      setSpeed({ provider: provider.id, results: await checkModelSpeed(provider.id) })
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("connections.hermes.speedFailed") })
    } finally {
      setChecking(false)
    }
  }
  const results = speed?.provider === provider.id ? speed.results : null
  const fastest = results?.filter((item) => item.first_token !== undefined).sort((a, b) => (a.seconds - b.seconds))[0]?.model

  const disabled = !catalog.can_edit || saving
  const selectClass = cn(
    "w-full rounded-lg border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
    compact ? "h-8 text-xs" : "mt-1 h-9 text-sm",
  )
  return (
    <div>
      <div className={compact ? "flex flex-wrap gap-2" : "grid gap-3 sm:grid-cols-2"}>
        <label className={cn("text-xs font-medium", compact && "w-44")}>
          <span className={compact ? "sr-only" : undefined}>{t("connections.hermes.provider")}</span>
          <select value={provider.id} disabled={disabled} onChange={(event) => void choose(event.target.value as HermesProvider)} className={selectClass}>
            {catalog.providers.map((item) => (
              <option key={item.id} value={item.id}>{item.key_set ? item.label : t("connections.hermes.providerNoKey", { provider: item.label })}</option>
            ))}
          </select>
        </label>
        <label className={cn("text-xs font-medium", compact && "w-full max-w-sm sm:w-96")}>
          <span className={compact ? "sr-only" : undefined}>{t("connections.hermes.model")}</span>
          <select value={selected.model} disabled={disabled} onChange={(event) => void choose(provider.id, event.target.value)} className={selectClass}>
            {model ? null : <option value={selected.model}>{selected.model}</option>}
            {provider.models.map((item) => (
              <option key={item.id} value={item.id}>{item.note ? `${item.label} · ${item.note}` : item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className={cn("mt-2 text-xs", provider.key_set ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
        {t(provider.key_set ? "connections.hermes.keyReady" : "connections.hermes.keyMissing", { env: provider.key_env })}
        {saving ? <LoaderCircle className="ms-2 inline size-3 animate-spin" aria-hidden="true" /> : null}
      </p>
      {!catalog.can_edit ? <p className="mt-1 text-xs text-muted-foreground">{t("connections.hermes.readOnly")}</p> : null}
      {!compact && catalog.can_edit && provider.key_set ? (
        <div className="mt-3">
          <button type="button" onClick={() => void measure()} disabled={checking} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">
            {checking ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Gauge className="size-3.5" aria-hidden="true" />}
            {checking ? t("connections.hermes.speedChecking") : t("connections.hermes.speedCheck")}
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("connections.hermes.speedHelp")}</p>
          {results ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-xs" aria-label={t("connections.hermes.speedResults")}>
              {results.map((item) => {
                const label = provider.models.find((option) => option.id === item.model)?.label ?? item.model
                const current = item.model === selected.model && provider.id === selected.provider
                return (
                  <li key={item.model} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-40 flex-1 font-medium">{label}{item.model === fastest ? <span className="ms-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">{t("connections.hermes.speedFastest")}</span> : null}</span>
                    {item.error ? (
                      <span className="text-destructive">{t("connections.hermes.speedError", { error: item.error })}</span>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">{t("connections.hermes.speedRow", { first: item.first_token ?? 0, tps: Math.round(item.tps ?? 0), total: item.seconds })}</span>
                    )}
                    {current ? (
                      <span className="text-muted-foreground">{t("connections.hermes.speedInUse")}</span>
                    ) : !item.error ? (
                      <button type="button" onClick={() => void choose(provider.id, item.model)} disabled={saving} className="h-7 rounded-md border border-border px-2 hover:bg-muted disabled:opacity-60">{t("connections.hermes.speedUse")}</button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("mt-1 text-xs", message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{message.text}</p>
      ) : null}
    </div>
  )
}
