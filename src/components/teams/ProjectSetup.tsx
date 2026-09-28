"use client"

import { useI18n } from "@/lib/i18n/context"

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, FileUp, Loader2, Send, Sparkles, Trash2 } from "lucide-react"
import { useTeamClient } from "@/components/teams/team-client-context"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { fromDateInput } from "@/lib/team-format"
import { memberName, upsertImport, upsertProposal, type TeamStore } from "@/lib/team-store"
import { errorMessage, type ImportRow, type TeamImportInfo } from "@/lib/teams-api"

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Deliverables and milestones need a real calendar date; Hermes never invents one. */
function needsDate(row: ImportRow): boolean {
  return (row.kind === "deliverable" || row.kind === "milestone") && !DATE.test(String(row.data.due ?? ""))
}

interface ProjectSetupProps { store: TeamStore; update: StoreUpdate }

/** Import a project description, review what Hermes extracted, and send the ticked rows to the team as one vote. */
export function ProjectSetup({ store, update }: ProjectSetupProps) {
  const { t } = useI18n()
  const teams = useTeamClient()
  const pending = Object.values(store.imports)
  const mine = pending.find((item) => item.uploaded_by === teams.userId)
  const others = pending.filter((item) => item.uploaded_by !== teams.userId)
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="tm-h2">{t("teams.setup.title")}</h2>
        <p className="tm-muted m-0 text-sm">{t("teams.setup.subtitle")}</p>
      </div>
      {mine?.status === "review" ? <ImportReview key={mine.id} item={mine} update={update} />
        : mine?.status === "reading" ? <ImportReading item={mine} />
          : mine?.status === "failed" ? <ImportFailed item={mine} update={update} />
            : <ImportForm teamId={store.team.id} update={update} />}
      {others.map((item) => (
        <OtherImport key={item.id} item={item} name={memberName(store, item.uploaded_by)} canDiscard={teams.userId === store.team.lead_user_id} update={update} />
      ))}
    </section>
  )
}

function ImportForm({ teamId, update }: { teamId: string; update: StoreUpdate }) {
  const { t } = useI18n()
  const teams = useTeamClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = async (source: { file: File } | { text: string }) => {
    setBusy(true)
    setError(null)
    try {
      const item = await teams.importProject(teamId, source)
      update((current) => upsertImport(current, item))
      setText("")
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  if (busy) {
    return (
      <div className="tm-card tm-import-busy" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("teams.setup.uploading")}
      </div>
    )
  }
  return (
    <div className="tm-card flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="tm-btn tm-btn-primary" onClick={() => fileInput.current?.click()}>
          <FileUp className="size-4" aria-hidden="true" /> {t("teams.setup.upload")}
        </button>
        <button type="button" className="tm-btn" aria-expanded={pasting} onClick={() => setPasting((value) => !value)}>{t("teams.setup.paste")}</button>
        <small className="tm-muted">{t("teams.setup.formats")}</small>
        <input
          ref={fileInput} type="file" accept={ACCEPT} className="sr-only" aria-label={t("teams.setup.upload")}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void read({ file }) }}
        />
      </div>
      {pasting ? (
        <div className="flex flex-col gap-2">
          <textarea className="tm-input min-h-32" dir="auto" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("teams.setup.pastePlaceholder")} />
          <div>
            <button type="button" className="tm-btn tm-btn-primary" disabled={text.trim().length < 80} onClick={() => void read({ text })}>
              <Sparkles className="size-4" aria-hidden="true" /> {t("teams.setup.read")}
            </button>
          </div>
        </div>
      ) : null}
      <small className="tm-muted">{t("teams.setup.privacy")}</small>
      {error ? <p className="tm-banner m-0">{error}</p> : null}
    </div>
  )
}

/** Hermes reads on the server, so this survives switching views, teams or reloading. */
function ImportReading({ item }: { item: TeamImportInfo }) {
  const { t } = useI18n()
  return (
    <div className="tm-card flex flex-col gap-1" role="status">
      <span className="tm-import-busy"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("teams.setup.reading")}</span>
      <small className="tm-muted"><span className="ltr-value">{item.filename}</span> · {t("teams.setup.readingHint")}</small>
    </div>
  )
}

function ImportFailed({ item, update }: { item: TeamImportInfo; update: StoreUpdate }) {
  const { t } = useI18n()
  const teams = useTeamClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dismiss = async () => {
    setBusy(true)
    try {
      const result = await teams.discardImport(item.id)
      update((current) => upsertImport(current, result))
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }
  return (
    <div className="tm-card flex flex-col gap-2">
      <span className="tm-import-warn flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> {t("teams.setup.failed")}</span>
      <small className="tm-muted"><span className="ltr-value">{item.filename}</span>{item.error ? <> · <span dir="auto">{item.error}</span></> : null}</small>
      <div>
        <button type="button" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy} onClick={() => void dismiss()}>{t("teams.setup.tryAgain")}</button>
      </div>
      {error ? <p className="tm-banner m-0">{error}</p> : null}
    </div>
  )
}

function ImportReview({ item, update }: { item: TeamImportInfo; update: StoreUpdate }) {
  const { t } = useI18n()
  const teams = useTeamClient()
  const [rows, setRows] = useState<ImportRow[]>(item.items)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(item.items.filter((row) => !needsDate(row)).map((row) => row.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = useMemo(() => rows.filter((row) => ticked.has(row.id) && !needsDate(row)), [rows, ticked])

  const toggle = (id: string, on: boolean) =>
    setTicked((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next })
  const edit = (id: string, field: string, value: unknown) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, data: { ...row.data, [field]: value } } : row)))
    // Giving a flagged row its missing date is the reason to include it.
    if (field === "due" && DATE.test(String(value ?? ""))) toggle(id, true)
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }
  const send = () => run(async () => {
    // A picked date means the end of that day in the student's time zone, as everywhere else in Waypoint.
    const items = chosen.map((row) => ({
      kind: row.kind,
      data: "due" in row.data ? { ...row.data, due: fromDateInput(String(row.data.due ?? "")) } : row.data,
    }))
    const result = await teams.proposeImport(item.id, items)
    update((current) => upsertProposal(upsertImport(current, result.import), result.proposal))
  })
  const discard = () => run(async () => {
    const result = await teams.discardImport(item.id)
    update((current) => upsertImport(current, result))
  })

  return (
    <div className="tm-card flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="ltr-value">{item.filename}</strong>
        <small className="tm-muted">{t("teams.setup.reviewHint")}</small>
      </div>
      <ul className="tm-import-rows">
        {rows.map((row) => {
          const undated = needsDate(row)
          return (
            <li key={row.id} data-kind={row.kind} data-off={!ticked.has(row.id) || undated ? "" : undefined}>
              <input
                type="checkbox" checked={ticked.has(row.id) && !undated} disabled={undated || busy}
                aria-label={t("teams.setup.include")} onChange={(event) => toggle(row.id, event.target.checked)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="tm-chip">{t(`teams.setup.kinds.${row.kind}`)}</span>
                  <span className="tm-chip" data-tone={row.confidence}>{t(`teams.setup.confidence.${row.confidence}`)}</span>
                </div>
                <RowFields row={row} onEdit={(field, value) => edit(row.id, field, value)} disabled={busy} />
                {undated ? (
                  <small className="tm-import-warn">
                    {row.data.due_text ? t("teams.setup.needsDateFrom", { text: String(row.data.due_text) }) : t("teams.setup.needsDate")}
                  </small>
                ) : null}
                {row.source_quote ? <blockquote className="tm-import-quote" dir="auto">{row.source_quote}</blockquote> : null}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="tm-proposal-actions">
        <button type="button" className="tm-btn tm-btn-sm" disabled={busy} onClick={() => void discard()}>
          <Trash2 className="size-3.5" aria-hidden="true" /> {t("teams.setup.discard")}
        </button>
        <button type="button" className="tm-btn tm-btn-sm tm-btn-primary ms-auto" disabled={busy || chosen.length === 0} onClick={() => void send()}>
          <Send className="size-3.5 rtl:-scale-x-100" aria-hidden="true" /> {t("teams.setup.send", { count: chosen.length })}
        </button>
      </div>
      {error ? <p className="tm-banner m-0">{error}</p> : null}
    </div>
  )
}

function RowFields({ row, onEdit, disabled }: { row: ImportRow; onEdit: (field: string, value: unknown) => void; disabled: boolean }) {
  const { t } = useI18n()
  const text = (field: string, label: string, multiline = false) => {
    const value = String(row.data[field] ?? "")
    return multiline ? (
      <label className="tm-import-field"><span>{label}</span>
        <textarea className="tm-input" dir="auto" rows={2} value={value} disabled={disabled} onChange={(event) => onEdit(field, event.target.value)} />
      </label>
    ) : (
      <label className="tm-import-field"><span>{label}</span>
        <input className="tm-input" dir="auto" value={value} disabled={disabled} onChange={(event) => onEdit(field, event.target.value)} />
      </label>
    )
  }
  const date = (
    <label className="tm-import-field tm-import-date"><span>{t("teams.setup.fields.due")}</span>
      <input className="tm-input" type="date" dir="ltr" value={String(row.data.due ?? "")} disabled={disabled} onChange={(event) => onEdit("due", event.target.value || null)} />
    </label>
  )
  switch (row.kind) {
    case "brief":
      return (
        <>
          {text("problem", t("teams.setup.fields.problem"), true)}
          {text("objective", t("teams.setup.fields.objective"), true)}
          {text("scope", t("teams.setup.fields.scope"), true)}
        </>
      )
    case "deliverable":
      return (
        <div className="tm-import-inline">
          {text("title", t("teams.setup.fields.title"))}
          {date}
          {row.data.doc_kind ? <span className="tm-chip">{String(row.data.doc_kind).toUpperCase()}</span> : null}
        </div>
      )
    case "milestone":
      return <div className="tm-import-inline">{text("title", t("teams.setup.fields.title"))}{date}</div>
    case "criterion":
      return (
        <div className="tm-import-inline">
          {text("name", t("teams.setup.fields.name"))}
          <label className="tm-import-field tm-import-weight"><span>{t("teams.setup.fields.weight")}</span>
            <input
              className="tm-input" type="number" min={0} max={100} dir="ltr" value={Number(row.data.weight ?? 0)} disabled={disabled}
              onChange={(event) => onEdit("weight", Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
            />
          </label>
        </div>
      )
  }
}

function OtherImport({ item, name, canDiscard, update }: { item: TeamImportInfo; name: string; canDiscard: boolean; update: StoreUpdate }) {
  const { t } = useI18n()
  const teams = useTeamClient()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="tm-card flex flex-wrap items-center gap-2 text-sm">
      <span>
        <bdi>{name}</bdi> {t(item.status === "reading" ? "teams.setup.othersReading" : item.status === "failed" ? "teams.setup.othersFailed" : "teams.setup.othersReviewing")}{" "}
        <span className="ltr-value">{item.filename}</span>
      </span>
      {canDiscard ? (
        <button
          type="button" className="tm-btn tm-btn-sm ms-auto"
          onClick={() => void teams.discardImport(item.id).then((result) => update((current) => upsertImport(current, result)), (reason) => setError(errorMessage(reason)))}
        >
          <Trash2 className="size-3.5" aria-hidden="true" /> {t("teams.setup.discard")}
        </button>
      ) : null}
      {error ? <p className="tm-banner m-0 w-full">{error}</p> : null}
    </div>
  )
}
