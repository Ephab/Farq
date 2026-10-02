import { useCallback, useEffect, useState } from "react"
import { api, type HermesProvider } from "@/lib/waypoint-api"

// The one model choice for every Hermes feature lives on the server (Settings > Models & API keys) and
// applies to the next run. Requests do not carry a model; the server uses the saved choice and falls back
// down its ladder. The catalog (providers, models, notes, whether each key is set) comes from
// GET /api/settings/models, so model lists are defined once, in services/api/app/hermes.py.

export interface ModelOption { id: string; label: string; note: string }
export interface ProviderOption {
  id: HermesProvider
  label: string
  key_env: string
  key_connection: string
  key_set: boolean
  models: ModelOption[]
}
export interface ModelChoice { provider: HermesProvider; model: string; key_connection: string; key_env: string }
export interface ModelCatalog { can_edit: boolean; selected: ModelChoice; providers: ProviderOption[] }

let cached: ModelCatalog | null = null
let pending: Promise<ModelCatalog> | null = null
const listeners = new Set<(catalog: ModelCatalog) => void>()

function publish(catalog: ModelCatalog): ModelCatalog {
  cached = catalog
  listeners.forEach((listener) => listener(catalog))
  return catalog
}

export function loadModelCatalog(force = false): Promise<ModelCatalog> {
  if (!force && cached) return Promise.resolve(cached)
  if (!force && pending) return pending
  pending = api<ModelCatalog>("/api/settings/models").then(publish).finally(() => { pending = null })
  return pending
}

/** Save the model every Hermes feature uses. Local-only on the server. */
export async function saveModelChoice(provider: HermesProvider, model: string): Promise<ModelCatalog> {
  const result = await api<{ catalog: ModelCatalog }>("/api/settings/hermes-model", { method: "PUT", body: JSON.stringify({ provider, model }) })
  return publish(result.catalog)
}

export interface SpeedResult { model: string; first_token?: number; seconds: number; tps?: number; error?: string }

/** Time one tiny prompt on every model of a provider, right now (local-only; uses the server's key). */
export async function checkModelSpeed(provider: HermesProvider): Promise<SpeedResult[]> {
  const result = await api<{ results: SpeedResult[] }>("/api/settings/models/speed", { method: "POST", body: JSON.stringify({ provider }) })
  return result.results
}

/** Display name of a model id, or the id itself when the catalog is not loaded or does not list it. */
export function modelLabel(id: string | null | undefined, catalog: ModelCatalog | null = cached): string {
  if (!id) return ""
  for (const provider of catalog?.providers ?? []) {
    const match = provider.models.find((model) => model.id === id)
    if (match) return match.label
  }
  return id
}

/** The current choice, if the catalog has loaded (for labels recorded alongside generated content). */
export function currentModel(): ModelChoice | null {
  return cached?.selected ?? null
}

export function useModelCatalog() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(cached)
  const [failed, setFailed] = useState(false)
  const reload = useCallback((force = true) => {
    setFailed(false)
    loadModelCatalog(force).catch(() => setFailed(true))
  }, [])
  useEffect(() => {
    listeners.add(setCatalog)
    loadModelCatalog().catch(() => setFailed(true))
    return () => { listeners.delete(setCatalog) }
  }, [])
  return { catalog, failed, reload }
}
