"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { useTeamClient } from "@/components/teams/team-client-context"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import type { TeamStore } from "@/lib/team-store"
import { useI18n } from "@/lib/i18n/context"

interface TeamSettingsProps { store: TeamStore; update: StoreUpdate; onError: (reason: unknown) => void }

/** Lead-only: rename the team and choose its size within the course limits. */
export function TeamSettings({ store, update, onError }: TeamSettingsProps) {
  const teams = useTeamClient()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(store.team.name)
  const [size, setSize] = useState(store.team.size_limit)
  const [busy, setBusy] = useState(false)
  if (store.team.viewer_role !== "lead") return null
  const { assignment, members } = store.team
  const low = Math.max(members.length, assignment.team_size_min)
  const sizes = Array.from({ length: Math.max(0, assignment.team_size_max - low + 1) }, (_, index) => low + index)

  const save = async () => {
    setBusy(true)
    try {
      const team = await teams.updateTeam(store.team.id, { name: name.trim(), size_limit: size })
      update((current) => ({ ...current, team: { ...current.team, name: team.name, size_limit: team.size_limit } }))
      setOpen(false)
    } catch (reason) {
      onError(reason)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="tm-back" onClick={() => { setName(store.team.name); setSize(store.team.size_limit); setOpen(true) }}>
        <Pencil className="size-3.5" aria-hidden="true" /> {t("teams.settings.edit")}
      </button>
    )
  }
  return (
    <form className="tm-team-edit" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="tm-field">{t("teams.settings.name")}
        <input className="tm-input" dir="auto" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="tm-field">{t("teams.settings.size")}
        <select className="tm-select" value={size} onChange={(event) => setSize(Number(event.target.value))}>
          {sizes.map((value) => <option key={value} value={value}>{t("teams.settings.sizeOption", { count: value })}</option>)}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="tm-btn tm-btn-sm" onClick={() => setOpen(false)}>{t("teams.common.cancel")}</button>
        <button type="submit" className="tm-btn tm-btn-sm tm-btn-primary" disabled={busy || name.trim().length < 2}>{t("teams.common.save")}</button>
      </div>
    </form>
  )
}
