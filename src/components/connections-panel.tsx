"use client"

import { Check, ExternalLink, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { api, hermesRequestParts, modelsFor, saveHermesModel, saveHermesProvider, type HermesProvider } from "@/lib/waypoint-api"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

type Source = "env_file" | "environment" | "none"
type EngineChoice = "auto" | "jev" | "laya"

interface Connection {
  id: string
  env: string
  set: boolean
  source: Source
  hint: string | null
  settable: boolean
  apply: "live" | "restart"
  url: string
  testable: boolean
}

interface ConnectionsStatus {
  can_edit: boolean
  env_file: { name: string; exists: boolean }
  connections: Connection[]
  local_model: { available: boolean; reason: string; loaded: boolean }
  models: { feature: string; provider: string | null; model: string | null }[]
  hermes: { provider: HermesProvider; model: string; key_connection: string; key_env: string }
  decision_engine: {
    choice: EngineChoice
    choices: EngineChoice[]
    engines: { id: string; label: string; available: boolean; selected: boolean }[]
  }
}

interface TestResult { ok: boolean; code: string; detail: string; latency_ms: number | null }

const SOURCE_KEY = { env_file: "connections.keys.sourceEnvFile", environment: "connections.keys.sourceEnvironment", none: "connections.keys.sourceNone" } as const
const ENGINE_OPTIONS: EngineChoice[] = ["jev", "laya", "auto"]

/** Models & connections, embedded as a section of the Settings dialog. */
export function ConnectionsPanel() {
  const { t } = useI18n()
  const [status, setStatus] = useState<ConnectionsStatus | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setError(false)
    api<ConnectionsStatus>("/api/settings/connections").then(setStatus).catch(() => setError(true))
  }, [])
  useEffect(load, [load])

  return (
    <div>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{t("connections.subtitle")}</p>
      {error ? (
        <div role="alert" className="mt-6 text-sm text-destructive">
          {t("connections.loadFailed")}{" "}
          <button type="button" onClick={load} className="font-medium underline underline-offset-4">{t("connections.retry")}</button>
        </div>
      ) : !status ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("connections.loading")}</p>
      ) : (
        <Body status={status} reload={load} />
      )}
    </div>
  )
}

function Body({ status, reload }: { status: ConnectionsStatus; reload: () => void }) {
  const { t } = useI18n()
  const canSave = status.can_edit && status.env_file.exists
  const jevKeySet = status.connections.find((item) => item.id === "jev")?.set ?? false
  return (
    <>
      {!status.can_edit ? <p role="note" className="mt-4 text-xs text-amber-700 dark:text-amber-400">{t("connections.readOnly")}</p> : null}
      {status.can_edit && !status.env_file.exists ? <p role="note" className="mt-4 text-xs text-amber-700 dark:text-amber-400">{t("connections.noEnvFile")}</p> : null}

      <HermesSection status={status} reload={reload} />

      <EngineSection status={status} jevKeySet={jevKeySet} reload={reload} />

      <section className="mt-4 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="connections-features">
        <h3 id="connections-features" className="text-[15px] font-semibold">{t("connections.features.title")}</h3>
        <dl className="mt-3 grid gap-2 text-sm">
          {status.models.map((item) => (item.feature === "coach" ? { ...item, ...coachUse() } : item)).map((item) => (
            <div key={item.feature} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <dt className="text-muted-foreground">{t(`connections.features.${item.feature}` as MessageKey)}</dt>
              <dd className="text-end font-medium">
                {item.model ? <bdi>{t("connections.features.viaProvider", { model: item.model, provider: providerName(item.provider) })}</bdi> : t("connections.features.none")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="connections-keys">
        <h3 id="connections-keys" className="text-[15px] font-semibold">{t("connections.keys.title")}</h3>
        {canSave ? <p className="mt-1 text-xs text-muted-foreground">{t("connections.envNote")}</p> : null}
        <ul className="mt-2 divide-y divide-border">
          {status.connections.map((item) => <KeyRow key={item.id} item={item} canSave={canSave} local={status.can_edit} reload={reload} />)}
        </ul>
      </section>
    </>
  )
}

const HERMES_PROVIDER_IDS: HermesProvider[] = ["gemini", "nim", "hf", "openrouter"]
const HERMES_KEY_CONNECTION: Record<HermesProvider, string> = { gemini: "gemini", nim: "nvidia", hf: "huggingface", openrouter: "span" }

function HermesSection({ status, reload }: { status: ConnectionsStatus; reload: () => void }) {
  const { t } = useI18n()
  // Every request from this tab carries its own choice, so start from that, not the server default.
  const tab = hermesRequestParts().body
  const [provider, setProvider] = useState<HermesProvider>(tab.provider)
  const [model, setModel] = useState(tab.model)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const options = modelsFor(provider)
  const choices = model && !options.some((option) => option.id === model) ? [{ id: model, label: model }, ...options] : options
  const keyConnection = status.connections.find((item) => item.id === HERMES_KEY_CONNECTION[provider])
  const dirty = provider !== tab.provider || model !== tab.model || provider !== status.hermes.provider || model !== status.hermes.model
  const tabDiffers = tab.provider !== status.hermes.provider || tab.model !== status.hermes.model
  const selectClass = "mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

  const changeProvider = (next: HermesProvider) => {
    setProvider(next)
    setModel(next === tab.provider ? tab.model : next === status.hermes.provider ? status.hermes.model : modelsFor(next)[0].id)
    setMessage(null)
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await api("/api/settings/hermes-model", { method: "PUT", body: JSON.stringify({ provider, model }) })
      // New chats pick the tab's choice immediately; the server default follows after a restart.
      saveHermesProvider(provider)
      saveHermesModel(provider, model)
      setMessage({ tone: "ok", text: t("connections.hermes.saved") })
      reload()
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("connections.hermes.saveFailed") })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="connections-hermes">
      <h3 id="connections-hermes" className="text-[15px] font-semibold">{t("connections.hermes.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("connections.hermes.help")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="hermes-provider" className="text-xs font-medium">{t("connections.hermes.provider")}</label>
          <select id="hermes-provider" value={provider} disabled={!status.can_edit} onChange={(event) => changeProvider(event.target.value as HermesProvider)} className={selectClass}>
            {HERMES_PROVIDER_IDS.map((id) => <option key={id} value={id}>{t(`connections.hermes.providers.${id}` as MessageKey)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hermes-model" className="text-xs font-medium">{t("connections.hermes.model")}</label>
          <select id="hermes-model" value={model} disabled={!status.can_edit} onChange={(event) => { setModel(event.target.value); setMessage(null) }} className={selectClass}>
            {choices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <p className={cn("mt-2 text-xs", keyConnection?.set ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
        {t(keyConnection?.set ? "connections.hermes.keyReady" : "connections.hermes.keyMissing", { env: keyEnvFor(provider) })}
      </p>
      {tabDiffers ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("connections.hermes.tabDiffers", { model: modelLabel(status.hermes.provider, status.hermes.model), provider: providerName(status.hermes.provider) })}
        </p>
      ) : null}
      {status.can_edit ? (
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} className={cn(buttonClass, "mt-3 bg-primary text-primary-foreground hover:bg-primary/90")}>
          {saving ? t("connections.keys.saving") : t("connections.hermes.save")}
        </button>
      ) : null}
      {message ? <p role={message.tone === "error" ? "alert" : "status"} className={cn("mt-2 text-xs", message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{message.text}</p> : null}
    </section>
  )
}

/** What Coach uses in this tab: the tab's own provider and model. */
function coachUse() {
  const { provider, model } = hermesRequestParts().body
  return { provider, model }
}

function modelLabel(provider: HermesProvider, model: string) {
  return modelsFor(provider).find((option) => option.id === model)?.label ?? model
}

const KEY_ENV: Record<HermesProvider, string> = { gemini: "GEMINI_API_KEY", nim: "NVIDIA_API_KEY", hf: "HF_TOKEN", openrouter: "OPENROUTER_API_KEY" }
function keyEnvFor(provider: HermesProvider) { return KEY_ENV[provider] }

const PROVIDER_NAMES: Record<string, string> = { gemini: "Gemini", nim: "NVIDIA NIM", nvidia: "NVIDIA NIM", hf: "Hugging Face", huggingface: "Hugging Face", openrouter: "OpenRouter" }
function providerName(provider: string | null) {
  return provider ? PROVIDER_NAMES[provider] ?? provider : ""
}

function EngineSection({ status, jevKeySet, reload }: { status: ConnectionsStatus; jevKeySet: boolean; reload: () => void }) {
  const { t } = useI18n()
  const [saving, setSaving] = useState<EngineChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const choice = status.decision_engine.choice
  const canEdit = status.can_edit

  const choose = async (engine: EngineChoice) => {
    if (engine === choice || saving) return
    setSaving(engine)
    setError(null)
    try {
      await api("/api/settings/decision-engine", { method: "PUT", body: JSON.stringify({ engine }) })
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("connections.engine.saveFailed"))
    } finally {
      setSaving(null)
    }
  }

  const layaAllowed = choice !== "jev"
  const noteKeys: MessageKey[] = []
  if (choice === "jev" && !jevKeySet) noteKeys.push("connections.engine.needsJevKey")
  if (choice === "jev" && jevKeySet === false && !status.decision_engine.engines.some((e) => e.id === "span" && e.available)) noteKeys.push("connections.engine.cloudKeysMissing")
  if (layaAllowed && !status.local_model.available) noteKeys.push("connections.engine.layaNotInstalled")
  else noteKeys.push(status.local_model.loaded ? "connections.engine.layaLoaded" : "connections.engine.layaIdle")

  return (
    <section className="mt-4 rounded-xl border border-border p-4 sm:p-5" aria-labelledby="connections-engine">
      <h3 id="connections-engine" className="text-[15px] font-semibold">{t("connections.engine.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("connections.engine.help")}</p>
      <div role="radiogroup" aria-labelledby="connections-engine" className="mt-3 grid gap-2 sm:grid-cols-3">
        {ENGINE_OPTIONS.map((option) => {
          const selected = choice === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canEdit || saving !== null}
              onClick={() => void choose(option)}
              className={cn(
                "rounded-xl border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted disabled:hover:bg-transparent",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                <bdi>{t(`connections.engine.${option}` as MessageKey)}</bdi>
                {saving === option ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </span>
              <span className="mt-1 block text-xs leading-4 text-muted-foreground">{t(`connections.engine.${option}Help` as MessageKey)}</span>
            </button>
          )
        })}
      </div>
      <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {noteKeys.map((key) => <li key={key}>{t(key)}</li>)}
      </ul>
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  )
}

// Testing spends a call with the stored key, so the server only allows it from this computer (`local`).
function KeyRow({ item, canSave, local, reload }: { item: Connection; canSave: boolean; local: boolean; reload: () => void }) {
  const { t } = useI18n()
  const name = t(`connections.providers.${item.id}.name` as MessageKey)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null)

  const write = async (next: string) => {
    setBusy("save")
    setMessage(null)
    try {
      const result = await api<{ apply: "live" | "restart" }>(`/api/settings/connections/${item.id}`, { method: "PUT", body: JSON.stringify({ value: next }) })
      setEditing(false)
      setValue("")
      setShow(false)
      setMessage(next ? { tone: result.apply === "live" ? "ok" : "warn", text: t(result.apply === "live" ? "connections.keys.appliedNow" : "connections.keys.restartRequired") } : { tone: "ok", text: t("connections.keys.removed") })
      reload()
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("connections.keys.saveFailed") })
    } finally {
      setBusy(null)
    }
  }

  const runTest = async () => {
    setBusy("test")
    setMessage(null)
    try {
      const result = await api<TestResult>(`/api/settings/connections/${item.id}/test`, { method: "POST" })
      const text = result.ok
        ? t("connections.test.okMs", { ms: result.latency_ms ?? 0 })
        : t(`connections.test.${result.code}` as MessageKey, { detail: result.detail })
      setMessage({ tone: result.ok ? "ok" : "error", text })
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("connections.test.failed") })
    } finally {
      setBusy(null)
    }
  }

  const inputId = `connection-key-${item.id}`
  return (
    <li className="py-4 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <bdi>{name}</bdi>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", item.set ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              {item.set ? t("connections.keys.set") : t("connections.keys.notSet")}
            </span>
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(`connections.providers.${item.id}.purpose` as MessageKey)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <bdi>{item.env}</bdi> · {t(SOURCE_KEY[item.source])}
            {item.hint ? <> · <bdi dir="ltr">{t("connections.keys.hint", { hint: item.hint })}</bdi></> : null}
            {item.settable ? <> · {t(item.apply === "live" ? "connections.keys.applyLive" : "connections.keys.applyRestart")}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.testable ? (
            <button type="button" disabled={!item.set || busy !== null || !local} onClick={() => void runTest()} className={buttonClass}>
              {busy === "test" ? <><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />{t("connections.keys.testing")}</> : t("connections.keys.test")}
            </button>
          ) : null}
          {item.settable && canSave && !editing ? (
            <button type="button" disabled={busy !== null} onClick={() => { setEditing(true); setMessage(null) }} className={buttonClass}>
              {item.set ? t("connections.keys.replace") : t("connections.keys.enter")}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void write(value.trim()) }}>
          <label htmlFor={inputId} className="sr-only">{t("connections.keys.inputLabel", { name })}</label>
          <div className="flex min-w-48 flex-1 items-center gap-1 rounded-lg border border-border bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
            <input
              id={inputId}
              type={show ? "text" : "password"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="h-9 w-full bg-transparent text-xs outline-none"
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={t(show ? "connections.keys.hide" : "connections.keys.show")} aria-pressed={show} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              {show ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
            </button>
          </div>
          <button type="submit" disabled={busy !== null || value.trim().length < 8} className={cn(buttonClass, "bg-primary text-primary-foreground hover:bg-primary/90")}>
            {busy === "save" ? t("connections.keys.saving") : t("connections.keys.save")}
          </button>
          <button type="button" onClick={() => { setEditing(false); setValue(""); setShow(false) }} className={buttonClass}>{t("connections.keys.cancel")}</button>
          {item.set ? (
            <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(t("connections.keys.removeConfirm"))) void write("") }} className={cn(buttonClass, "text-destructive")}>
              {t("connections.keys.remove")}
            </button>
          ) : null}
        </form>
      ) : null}

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t(`connections.providers.${item.id}.how` as MessageKey)}
        {item.url ? (
          <> <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
            {t("connections.keys.getKey")}<ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden="true" />
          </a></>
        ) : null}
      </p>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("mt-2 text-xs leading-5", message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : message.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-destructive")}>
          {message.text}
        </p>
      ) : null}
    </li>
  )
}

const buttonClass = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
