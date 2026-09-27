"use client"

import { useEffect, useState } from "react"
import { FileText, Lock, PencilLine, Sparkles } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { DocTitle, ExportMenu, SectionTools } from "@/components/teams/DocTools"
import { ProposalCard } from "@/components/teams/ProposalCard"
import { Avatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { memberName, upsertDocument, upsertMessage, upsertSection, type TeamStore } from "@/lib/team-store"
import { errorMessage, type DocSectionInfo, type DocumentKind } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

const DOC_KINDS: { kind: DocumentKind; label: string; full: string }[] = [
  { kind: "srs", label: "SRS", full: "Software Requirements Specification" },
  { kind: "sds", label: "SDS", full: "Software Design Specification" },
  { kind: "spmp", label: "SPMP", full: "Software Project Management Plan" },
]

function lockedByOther(section: DocSectionInfo, me: string): boolean {
  return Boolean(
    section.lock_user_id && section.lock_user_id !== me && section.lock_expires_at && new Date(section.lock_expires_at).getTime() > Date.now(),
  )
}

interface DocStudioProps { store: TeamStore; canEdit: boolean; update: StoreUpdate; onFocus: (focus: string | null) => void }

export function DocStudio({ store, canEdit, update, onFocus }: DocStudioProps) {
  const teams = useTeamClient()
  const me = teams.userId
  const docs = Object.values(store.documents).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const [docId, setDocId] = useState<string | null>(null)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const doc = (docId ? store.documents[docId] : undefined) ?? docs[0]
  const section = doc?.sections.find((item) => item.id === sectionId) ?? doc?.sections.find((item) => item.key.includes(".")) ?? doc?.sections[0]
  const sectionKey = section?.id ?? null

  useEffect(() => { onFocus(sectionKey ? `section:${sectionKey}` : null) }, [sectionKey, onFocus])

  // Keep the 90 s lock alive while editing; release it when editing ends or the section changes.
  useEffect(() => {
    if (!editing || !sectionKey) return
    const heartbeat = window.setInterval(() => { teams.lockSection(sectionKey).catch(() => undefined) }, 30_000)
    return () => {
      window.clearInterval(heartbeat)
      teams.unlockSection(sectionKey).catch(() => undefined)
    }
  }, [editing, sectionKey])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const [customTitle, setCustomTitle] = useState<string | null>(null)
  const create = (kind: DocumentKind, title?: string) => run(async () => {
    const created = await teams.createDocument(
      store.team.id, kind, kind === "custom" ? { title: title ?? "Document", sections: [{ key: "1", title: "Introduction" }] } : undefined,
    )
    setCustomTitle(null)
    update((current) => upsertDocument(current, created))
    setDocId(created.id)
    setSectionId(null)
  })
  const startEdit = (target: DocSectionInfo) => run(async () => {
    const locked = await teams.lockSection(target.id)
    update((current) => upsertSection(current, locked))
    setText(locked.content_md)
    setVersion(locked.version)
    setEditing(true)
  })
  const save = (target: DocSectionInfo) => run(async () => {
    const saved = await teams.saveSection(target.id, text, version)
    update((current) => upsertSection(current, saved))
    setEditing(false)
  })
  const setOwner = (target: DocSectionInfo, ownerId: string) => run(async () => {
    const saved = await teams.updateSection(target.id, { owner_user_id: ownerId || null })
    update((current) => upsertSection(current, saved))
  })
  const select = (id: string) => {
    setEditing(false)
    setSectionId(id)
  }

  const expected = new Set(store.team.assignment.deliverables)
  const customForm = customTitle === null ? null : (
    <form className="tm-section-tools" onSubmit={(event) => { event.preventDefault(); void create("custom", customTitle.trim()) }}>
      <span>New custom document</span>
      <input className="tm-input" dir="auto" aria-label="Document title" placeholder="e.g. Test plan" value={customTitle} maxLength={160} autoFocus onChange={(event) => setCustomTitle(event.target.value)} />
      <button type="button" className="tm-btn tm-btn-sm" onClick={() => setCustomTitle(null)}>Cancel</button>
      <button type="submit" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy || !customTitle.trim()}>Create</button>
    </form>
  )
  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="tm-h2" style={{ marginBottom: 0 }}>Documents</h2>
        <p className="tm-muted">Start a deliverable. Each one gets the standard IEEE outline, and every section can have an owner.</p>
        {error ? <p className="tm-banner">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {DOC_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={expected.has(item.kind) ? "tm-btn tm-btn-primary" : "tm-btn"}
              disabled={!canEdit || busy}
              onClick={() => void create(item.kind)}
            >
              <FileText className="size-4" aria-hidden="true" /> {item.full}
            </button>
          ))}
          <button type="button" className="tm-btn" disabled={!canEdit || busy} onClick={() => setCustomTitle("")}>
            <FileText className="size-4" aria-hidden="true" /> Custom document…
          </button>
        </div>
        {customForm}
      </div>
    )
  }

  const missing = DOC_KINDS.filter((item) => !docs.some((existing) => existing.kind === item.kind))
  const blocked = section ? lockedByOther(section, me) : false
  const pendingDraft = section
    ? Object.values(store.proposals).find((item) => item.kind === "doc_section" && item.status === "pending" && item.payload.section_id === section.id)
    : undefined
  const draft = (target: DocSectionInfo) => run(async () => {
    const message = await teams.postMessage(store.team.id, { content: `/draft ${doc.kind} ${target.key}` })
    update((current) => upsertMessage(current, message))
  })
  return (
    <div className="tm-docstudio flex min-h-0 flex-1 flex-col gap-3">
      <div className="tm-board-head">
        <div className="tm-doc-tabs">
          {docs.map((item) => (
            <button key={item.id} type="button" aria-current={item.id === doc.id} onClick={() => { setDocId(item.id); setSectionId(null); setEditing(false) }}>
              {DOC_KINDS.find((kind) => kind.kind === item.kind)?.label ?? item.title}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <ExportMenu doc={doc} teamName={store.team.name} run={run} />
        {canEdit ? (
          <select
            className="tm-select"
            style={{ width: "auto" }}
            aria-label="New document"
            value=""
            disabled={busy}
            onChange={(event) => {
              const kind = event.target.value as DocumentKind | ""
              if (kind === "custom") setCustomTitle("")
              else if (kind) void create(kind)
            }}
          >
            <option value="">+ New document</option>
            {missing.map((item) => <option key={item.kind} value={item.kind}>{item.full}</option>)}
            <option value="custom">Custom document…</option>
          </select>
        ) : null}
        </div>
      </div>
      {customForm}
      <DocTitle key={doc.id} doc={doc} canEdit={canEdit} run={run} update={update} />
      {error ? <p className="tm-banner">{error}</p> : null}
      <div className="tm-docs">
        <nav className="tm-outline" aria-label={`${doc.title} outline`}>
          {doc.sections.map((item) => (
            <button
              key={item.id}
              type="button"
              data-top={item.key.includes(".") ? undefined : ""}
              aria-current={item.id === section?.id}
              onClick={() => select(item.id)}
            >
              <span className="tm-status" data-status={item.status} aria-label={item.status} role="img" />
              <span className="min-w-0 flex-1 truncate">{item.key} {item.title}</span>
              {lockedByOther(item, me) ? <Lock className="size-3" aria-label="Being edited" /> : null}
              {item.owner_user_id ? <Avatar userId={item.owner_user_id} name={memberName(store, item.owner_user_id)} size={18} /> : null}
            </button>
          ))}
        </nav>
        {section ? (
          <section className="tm-section">
            <div className="tm-section-head">
              <h3>{section.key} {section.title}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="tm-select"
                  style={{ width: "auto" }}
                  aria-label="Section owner"
                  value={section.owner_user_id ?? ""}
                  disabled={!canEdit || busy}
                  onChange={(event) => void setOwner(section, event.target.value)}
                >
                  <option value="">No owner</option>
                  {store.team.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
                </select>
                {canEdit && editing ? (
                  <>
                    <button type="button" className="tm-btn" onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="tm-btn tm-btn-primary" disabled={busy} onClick={() => void save(section)}>Save</button>
                  </>
                ) : null}
                {canEdit && !editing ? (
                  <button type="button" className="tm-btn" disabled={busy || blocked || Boolean(pendingDraft)} onClick={() => void draft(section)}>
                    <Sparkles className="size-4" aria-hidden="true" /> Draft this
                  </button>
                ) : null}
                {canEdit && !editing ? (
                  <button type="button" className="tm-btn" disabled={busy || blocked} onClick={() => void startEdit(section)}>
                    <PencilLine className="size-4" aria-hidden="true" /> Edit
                  </button>
                ) : null}
              </div>
            </div>
            {canEdit && !editing ? (
              <SectionTools key={section.id} doc={doc} section={section} busy={busy || blocked} run={run} update={update} onSelect={setSectionId} />
            ) : null}
            {blocked ? (
              <p className="tm-muted"><Lock className="mr-1 inline size-3.5" aria-hidden="true" />{memberName(store, section.lock_user_id)} is editing this section.</p>
            ) : null}
            {pendingDraft ? <ProposalCard proposal={pendingDraft} store={store} update={update} /> : null}
            {editing ? (
              <textarea className="tm-textarea" style={{ minHeight: 320 }} dir="auto" autoFocus value={text} onChange={(event) => setText(event.target.value)} />
            ) : (
              <div className="tm-section-body" dir="auto">
                {section.content_md.trim() ? <MarkdownText text={section.content_md} /> : <p className="tm-muted">Nobody has written this section yet.</p>}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
