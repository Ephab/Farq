"use client"

import { BookOpen, CircleCheck, CircleAlert, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { api, getCurrentStudentId } from "@/lib/waypoint-api"
import { useI18n, type MessageKey } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"

// Settings > Memory, Skills and Connectors. The API enforces every rule shown here (memory off,
// connector off, local-only skill changes); this UI only reflects and edits that state.

const buttonClass = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
const primaryButton = cn(buttonClass, "border-transparent bg-primary text-primary-foreground hover:bg-primary/90")
const fieldClass = "h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** Load JSON once, expose a setter for mutation responses, and render load/error states. */
function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    api<T>(path).then(setData).catch(() => setFailed(true))
  }, [path])
  const load = useCallback(() => {
    setFailed(false)
    api<T>(path).then(setData).catch(() => setFailed(true))
  }, [path])
  return { data, setData, failed, load }
}

function Loading({ failed, retry }: { failed: boolean; retry: () => void }) {
  const { t } = useI18n()
  return failed ? (
    <p role="alert" className="mt-6 text-sm text-destructive">
      {t("agent.loadFailed")} <button type="button" onClick={retry} className="font-medium underline underline-offset-4">{t("agent.retry")}</button>
    </p>
  ) : (
    <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{t("agent.loading")}</p>
  )
}

function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-[1.125rem] rtl:-translate-x-[1.125rem]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
    </button>
  )
}

function Row({ title, help, children }: { title: ReactNode; help?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {help ? <p className="mt-0.5 max-w-[60ch] text-xs leading-5 text-muted-foreground">{help}</p> : null}
      </div>
      {children}
    </div>
  )
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <p role="alert" className="mt-3 text-xs text-destructive">{text}</p> : null
}

function formatDate(value: string | null, locale: string) {
  if (!value) return ""
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value))
  } catch {
    return value.slice(0, 10)
  }
}

// --- Memory ---------------------------------------------------------------------------------------

type Category = "preference" | "learning" | "context" | "other"
const CATEGORIES: Category[] = ["preference", "learning", "context", "other"]
// "other" is a plural-form key in the catalogs, so that category's label is stored as "general".
const categoryKey = (id: Category) => `agent.memory.categories.${id === "other" ? "general" : id}` as MessageKey
interface MemoryItem { id: string; content: string; category: Category; origin: "hermes" | "student"; updated_at: string | null }
interface MemoryListing { enabled: boolean; limit: number; items: MemoryItem[] }

export function MemorySection() {
  const { t } = useI18n()
  const base = `/api/students/${encodeURIComponent(getCurrentStudentId())}/memory`
  const { data, setData, failed, load } = useResource<MemoryListing>(base)
  const [draft, setDraft] = useState("")
  const [category, setCategory] = useState<Category>("preference")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutate = async (key: string, path: string, init: RequestInit) => {
    setBusy(key)
    setError(null)
    try {
      setData(await api<MemoryListing>(path, init))
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("agent.memory.failed"))
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <Loading failed={failed} retry={load} />
  const full = data.items.length >= data.limit
  return (
    <div>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{t("agent.memory.help")}</p>
      <div className="mt-6 rounded-xl border border-border p-4 sm:p-5">
        <Row title={t("agent.memory.toggle")} help={t("agent.memory.toggleHelp")}>
          <Switch checked={data.enabled} disabled={busy !== null} label={t("agent.memory.toggle")}
            onChange={(enabled) => void mutate("toggle", `${base}/settings`, { method: "PUT", body: JSON.stringify({ enabled }) })} />
        </Row>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          if (await mutate("add", base, { method: "POST", body: JSON.stringify({ content: draft.trim(), category }) })) setDraft("")
        }}
      >
        <label className="min-w-56 flex-1 text-xs font-medium">
          {t("agent.memory.addLabel")}
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} placeholder={t("agent.memory.addPlaceholder")} className={cn(fieldClass, "mt-1 w-full")} />
        </label>
        <label className="text-xs font-medium">
          {t("agent.memory.categoryLabel")}
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)} className={cn(fieldClass, "mt-1 block")}>
            {CATEGORIES.map((id) => <option key={id} value={id}>{t(categoryKey(id))}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!draft.trim() || full || busy !== null} className={cn(primaryButton, "h-9")}>
          {busy === "add" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
          {t(busy === "add" ? "agent.memory.adding" : "agent.memory.add")}
        </button>
      </form>
      <ErrorLine text={error} />

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("agent.memory.count", { count: data.items.length, limit: data.limit })}</p>
        {data.items.length ? (
          <button type="button" disabled={busy !== null} className={cn(buttonClass, "text-destructive")}
            onClick={() => { if (window.confirm(t("agent.memory.clearConfirm"))) void mutate("clear", base, { method: "DELETE" }) }}>
            {t("agent.memory.clear")}
          </button>
        ) : null}
      </div>
      {data.items.length ? (
        <ul className={cn("mt-2 divide-y divide-border rounded-xl border border-border", !data.enabled && "opacity-60")}>
          {data.items.map((item) => (
            <MemoryRow key={item.id} item={item} busy={busy !== null}
              onSave={(content) => mutate(item.id, `${base}/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ content }) })}
              onDelete={() => void mutate(item.id, `${base}/${encodeURIComponent(item.id)}`, { method: "DELETE" })} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("agent.memory.empty")}</p>
      )}
    </div>
  )
}

function MemoryRow({ item, busy, onSave, onDelete }: { item: MemoryItem; busy: boolean; onSave: (content: string) => Promise<boolean>; onDelete: () => void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.content)
  return (
    <li className="p-3.5">
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => { event.preventDefault(); if (await onSave(value.trim())) setEditing(false) }}>
          <input aria-label={t("agent.memory.editLabel")} value={value} maxLength={300} onChange={(event) => setValue(event.target.value)} className={cn(fieldClass, "min-w-56 flex-1")} autoFocus />
          <button type="submit" disabled={busy || !value.trim()} className={primaryButton}>{t("agent.memory.save")}</button>
          <button type="button" onClick={() => { setEditing(false); setValue(item.content) }} className={buttonClass}>{t("agent.memory.cancel")}</button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm">{item.content}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(categoryKey(item.category))} · {t(`agent.memory.origin.${item.origin}` as MessageKey)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" disabled={busy} onClick={() => setEditing(true)} aria-label={t("agent.memory.editLabel")} className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
            <button type="button" disabled={busy} onClick={onDelete} aria-label={t("agent.memory.deleteLabel", { content: item.content })} className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// --- Skills ---------------------------------------------------------------------------------------

interface BuiltinSkill { id: string; name: string; description: string; actions: string[] }
interface LearnedSkill { id: string; name: string; description: string; enabled: boolean; updated_at: string; size: number }
interface SkillsListing {
  can_edit: boolean
  learning: { enabled: boolean; applies_live: boolean }
  gateway: { reachable: boolean }
  builtin: BuiltinSkill[]
  learned: LearnedSkill[]
}

export function SkillsSection() {
  const { t, locale } = useI18n()
  const { data, setData, failed, load } = useResource<SkillsListing>("/api/hermes/skills")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = async <R,>(key: string, request: () => Promise<R>, apply: (result: R) => void) => {
    setBusy(key)
    setError(null)
    try {
      apply(await request())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("agent.skills.failed"))
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <Loading failed={failed} retry={load} />
  const setLearned = (learned: LearnedSkill[]) => setData({ ...data, learned })
  return (
    <div>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{t("agent.skills.help")}</p>
      <p className={cn("mt-3 flex items-center gap-1.5 text-xs", data.gateway.reachable ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
        {data.gateway.reachable ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
        {t(data.gateway.reachable ? "agent.skills.gatewayUp" : "agent.skills.gatewayDown")}
      </p>
      {!data.can_edit ? <p role="note" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("agent.skills.readOnly")}</p> : null}

      <div className="mt-5 rounded-xl border border-border p-4 sm:p-5">
        <Row title={t("agent.skills.learningTitle")} help={t("agent.skills.learningHelp")}>
          <Switch checked={data.learning.enabled} disabled={!data.can_edit || busy !== null} label={t("agent.skills.learningTitle")}
            onChange={(enabled) => void run("learning",
              () => api<{ enabled: boolean; applies_live: boolean }>("/api/hermes/skills/learning", { method: "PUT", body: JSON.stringify({ enabled }) }),
              (learning) => { setData({ ...data, learning }); setNote(t(learning.applies_live ? "agent.skills.learningLive" : "agent.skills.learningRestart")) })} />
        </Row>
        {note ? <p role="status" className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <ErrorLine text={error} />

      <h4 className="mt-7 text-[15px] font-semibold">{t("agent.skills.learnedTitle")}</h4>
      {data.learned.length ? (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {data.learned.map((skill) => (
            <SkillRow key={skill.id} source="learned" id={skill.id} name={skill.name} description={skill.description}
              meta={<>{!skill.enabled ? <span className="me-1.5 rounded-full bg-muted px-2 py-0.5">{t("agent.skills.off")}</span> : null}{t("agent.skills.updated", { date: formatDate(skill.updated_at, locale) })}</>}>
              {data.can_edit ? (
                <>
                  <button type="button" disabled={busy !== null} className={buttonClass}
                    onClick={() => void run(skill.id,
                      () => api<{ learned: LearnedSkill[] }>(`/api/hermes/skills/learned/${skill.enabled ? "archive" : "restore"}`, { method: "POST", body: JSON.stringify({ id: skill.id }) }),
                      (result) => setLearned(result.learned))}>
                    {t(skill.enabled ? "agent.skills.turnOff" : "agent.skills.turnOn")}
                  </button>
                  <button type="button" disabled={busy !== null} className={cn(buttonClass, "text-destructive")}
                    onClick={() => {
                      if (!window.confirm(t("agent.skills.deleteConfirm", { name: skill.name }))) return
                      void run(skill.id, () => api<{ learned: LearnedSkill[] }>(`/api/hermes/skills/learned?id=${encodeURIComponent(skill.id)}`, { method: "DELETE" }), (result) => setLearned(result.learned))
                    }}>
                    {t("agent.skills.delete")}
                  </button>
                </>
              ) : null}
            </SkillRow>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("agent.skills.learnedEmpty")}</p>
      )}

      <h4 className="mt-7 text-[15px] font-semibold">{t("agent.skills.builtinTitle")}</h4>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {data.builtin.map((skill) => (
          <SkillRow key={skill.id} source="builtin" id={skill.id} name={skill.name} description={skill.description}
            meta={t("agent.skills.usedFor", { actions: skill.actions.map((action) => t(`agent.skills.actions.${action}` as MessageKey)).join(", ") })} />
        ))}
      </ul>
    </div>
  )
}

function SkillRow({ source, id, name, description, meta, children }: {
  source: "builtin" | "learned"; id: string; name: string; description: string; meta: ReactNode; children?: ReactNode
}) {
  const { t } = useI18n()
  const [content, setContent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = () => {
    if (!open && content === null) {
      api<{ content: string }>(`/api/hermes/skills/content?source=${source}&id=${encodeURIComponent(id)}`)
        .then((result) => setContent(result.content)).catch(() => setContent(t("agent.loadFailed")))
    }
    setOpen((value) => !value)
  }
  return (
    <li className="p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium"><bdi dir="ltr">{name}</bdi></p>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          <p className="mt-1 text-[11px] text-muted-foreground">{meta}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-expanded={open} onClick={toggle} className={buttonClass}>
            <BookOpen className="size-3.5" aria-hidden="true" />{t(open ? "agent.skills.hide" : "agent.skills.view")}
          </button>
          {children}
        </div>
      </div>
      {open ? (
        <pre dir="ltr" className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs leading-5">
          {content ?? t("agent.loading")}
        </pre>
      ) : null}
    </li>
  )
}

// --- Connectors -----------------------------------------------------------------------------------

type ConnectorId = "learning_reddit" | "learning_x" | "blackboard" | "hackathons" | "coop" | "outlook"
interface Connector {
  id: ConnectorId
  tools: string[]
  switchable: boolean
  enabled: boolean
  available: boolean
  counts: Record<string, number>
  updated_at: string | null
  coach_access?: boolean
}

export function ConnectorsSection() {
  const { t, locale } = useI18n()
  const base = `/api/students/${encodeURIComponent(getCurrentStudentId())}/connectors`
  const { data, setData, failed, load } = useResource<{ connectors: Connector[] }>(base)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (id: ConnectorId, enabled: boolean) => {
    setBusy(id)
    setError(null)
    try {
      setData(await api<{ connectors: Connector[] }>(`${base}/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("agent.connectors.failed"))
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <Loading failed={failed} retry={load} />
  return (
    <div>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{t("agent.connectors.help")}</p>
      <ErrorLine text={error} />
      <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
        {data.connectors.map((item) => {
          const name = t(`agent.connectors.names.${item.id}` as MessageKey)
          const status = item.id === "outlook"
            ? [item.available ? t("agent.connectors.outlookConnected") : t("agent.connectors.notSynced"),
               t(item.coach_access ? "agent.connectors.outlookCoachOn" : "agent.connectors.outlookCoachOff")]
            : item.available
              ? [...Object.entries(item.counts).map(([key, count]) => t(`agent.connectors.counts.${key}` as MessageKey, { count })),
                 ...(item.updated_at ? [t("agent.connectors.updated", { date: formatDate(item.updated_at, locale) })] : [])]
              : [t("agent.connectors.notSynced")]
          return (
            <li key={item.id} className="p-4">
              <Row title={name} help={<>{t(`agent.connectors.descriptions.${item.id}` as MessageKey)}<span className="mt-1 block">{status.join(" · ")}</span>
                {!item.switchable ? <span className="mt-1 block">{t("agent.connectors.outlookManaged")}</span> : null}</>}>
                {item.switchable ? (
                  <Switch checked={item.enabled} disabled={busy !== null} label={t("agent.connectors.allow", { name })} onChange={(next) => void toggle(item.id, next)} />
                ) : null}
              </Row>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
