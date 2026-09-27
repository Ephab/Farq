"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Download, FileDown, FileText, Pencil, Plus, Printer, Trash2 } from "lucide-react"
import { useTeamClient } from "@/components/teams/team-client-context"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { nextSectionKey } from "@/lib/team-format"
import { upsertDocument, upsertSection } from "@/lib/team-store"
import type { DocSectionInfo, ExportFormat, ExportStyle, TeamDocumentInfo } from "@/lib/teams-api"

type Run = (work: () => Promise<void>) => Promise<void>

/** Document title, renamable inline by any member. */
export function DocTitle({ doc, canEdit, run, update }: { doc: TeamDocumentInfo; canEdit: boolean; run: Run; update: StoreUpdate }) {
  const teams = useTeamClient()
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <div className="tm-doc-title">
        <h2 dir="auto">{doc.title}</h2>
        {canEdit ? (
          <button type="button" className="tm-icon-btn" aria-label="Rename document" title="Rename document" onClick={() => setDraft(doc.title)}>
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )
  }
  const save = () => run(async () => {
    const renamed = await teams.renameDocument(doc.id, draft.trim())
    update((current) => upsertDocument(current, renamed))
    setDraft(null)
  })
  return (
    <form className="tm-doc-title" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <input className="tm-input" dir="auto" aria-label="Document title" value={draft} maxLength={160} autoFocus onChange={(event) => setDraft(event.target.value)} />
      <button type="button" className="tm-btn tm-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
      <button type="submit" className="tm-btn tm-btn-sm tm-btn-primary" disabled={!draft.trim()}>Save</button>
    </form>
  )
}

const FORMATS: { format: ExportFormat | "pdf"; label: string; hint: string; Icon: typeof FileText }[] = [
  { format: "docx", label: "Word", hint: ".docx, editable", Icon: FileText },
  { format: "pdf", label: "PDF", hint: "opens the print dialog", Icon: Printer },
  { format: "md", label: "Markdown", hint: ".md, plain text", Icon: FileDown },
]

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Export with a cover page and contents, in the formal IEEE look or a modern one. */
export function ExportMenu({ doc, teamName, run }: { doc: TeamDocumentInfo; teamName: string; run: Run }) {
  const teams = useTeamClient()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<ExportStyle>("ieee")
  const exportAs = (format: ExportFormat | "pdf") => run(async () => {
    // Open the print window before awaiting, while the click still counts as a user gesture.
    const printWindow = format === "pdf" ? window.open("", "_blank") : null
    const blob = await teams.exportDocument(doc.id, format === "pdf" ? "html" : format, style)
    const base = `${teamName} - ${doc.title}`.replace(/[\\/:*?"<>|]/g, "-")
    if (format === "pdf" && printWindow) printWindow.location.href = URL.createObjectURL(blob)
    else saveBlob(blob, `${base}.${format === "pdf" ? "html" : format}`)
    setOpen(false)
  })
  return (
    <div className="tm-export">
      <button type="button" className="tm-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Download className="size-4" aria-hidden="true" /> Export
      </button>
      {open ? (
        <div className="tm-export-menu" role="dialog" aria-label="Export document">
          <div className="tm-seg" role="radiogroup" aria-label="Style">
            {(["ieee", "modern"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={style === value} onClick={() => setStyle(value)}>
                {value === "ieee" ? "IEEE formal" : "Modern"}
              </button>
            ))}
          </div>
          <p className="tm-muted">Includes a cover page (team, course, members, date) and a table of contents.</p>
          {FORMATS.map(({ format, label, hint, Icon }) => (
            <button key={format} type="button" className="tm-export-option" onClick={() => void exportAs(format)}>
              <Icon className="size-4" aria-hidden="true" />
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface SectionToolsProps {
  doc: TeamDocumentInfo
  section: DocSectionInfo
  busy: boolean
  run: Run
  update: StoreUpdate
  onSelect: (sectionId: string | null) => void
}

type Mode = { kind: "idle" } | { kind: "rename" | "add"; key: string; title: string } | { kind: "delete" }

/** Reorder, renumber/rename, delete, or add a section after this one. */
export function SectionTools({ doc, section, busy, run, update, onSelect }: SectionToolsProps) {
  const teams = useTeamClient()
  const [mode, setMode] = useState<Mode>({ kind: "idle" })
  const index = doc.sections.findIndex((item) => item.id === section.id)
  const replace = (next: TeamDocumentInfo) => update((current) => upsertDocument(current, next))
  const move = (direction: "up" | "down") => run(async () => replace(await teams.moveSection(section.id, direction)))
  const remove = () => run(async () => {
    replace(await teams.deleteSection(section.id))
    setMode({ kind: "idle" })
    onSelect(null)
  })
  const submit = () => run(async () => {
    if (mode.kind === "rename") {
      const saved = await teams.updateSection(section.id, { key: mode.key.trim(), title: mode.title.trim() })
      update((current) => upsertSection(current, saved))
    } else if (mode.kind === "add") {
      const added = await teams.addSection(doc.id, { key: mode.key.trim(), title: mode.title.trim(), after_section_id: section.id })
      const next = [...doc.sections]
      next.splice(index + 1, 0, added)
      replace({ ...doc, sections: next.map((item, position) => ({ ...item, position })) })
      onSelect(added.id)
    }
    setMode({ kind: "idle" })
  })

  if (mode.kind === "delete") {
    return (
      <div className="tm-section-tools" role="alert">
        <span>Delete {section.key} {section.title} and its text?</span>
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => setMode({ kind: "idle" })}>Keep</button>
        <button type="button" className="tm-btn tm-btn-sm tm-btn-danger" disabled={busy} onClick={() => void remove()}>Delete</button>
      </div>
    )
  }
  if (mode.kind === "rename" || mode.kind === "add") {
    return (
      <form className="tm-section-tools" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <span>{mode.kind === "add" ? "New section after this one" : "Number and title"}</span>
        <input className="tm-input tm-key-input" aria-label="Section number" value={mode.key} maxLength={16} onChange={(event) => setMode({ ...mode, key: event.target.value })} />
        <input className="tm-input" dir="auto" aria-label="Section title" value={mode.title} maxLength={160} autoFocus onChange={(event) => setMode({ ...mode, title: event.target.value })} />
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => setMode({ kind: "idle" })}>Cancel</button>
        <button type="submit" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy || !mode.key.trim() || !mode.title.trim()}>
          {mode.kind === "add" ? "Add" : "Save"}
        </button>
      </form>
    )
  }
  return (
    <div className="tm-section-tools" data-idle="">
      <button type="button" className="tm-icon-btn" aria-label="Move section up" title="Move up" disabled={busy || index <= 0} onClick={() => void move("up")}>
        <ArrowUp className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="tm-icon-btn" aria-label="Move section down" title="Move down" disabled={busy || index >= doc.sections.length - 1} onClick={() => void move("down")}>
        <ArrowDown className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="tm-icon-btn" aria-label="Rename section" title="Rename or renumber" onClick={() => setMode({ kind: "rename", key: section.key, title: section.title })}>
        <Pencil className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tm-icon-btn"
        aria-label="Add a section after this one"
        title="Add section after"
        onClick={() => setMode({ kind: "add", key: nextSectionKey(section.key, doc.sections.map((item) => item.key)), title: "" })}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="tm-icon-btn" aria-label="Delete section" title="Delete section" disabled={busy || doc.sections.length <= 1} onClick={() => setMode({ kind: "delete" })}>
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
