"use client"

import { LoaderCircle } from "lucide-react"
import { useState } from "react"
import { saveModelChoice, useModelCatalog } from "@/lib/models"
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
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("mt-1 text-xs", message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{message.text}</p>
      ) : null}
    </div>
  )
}
