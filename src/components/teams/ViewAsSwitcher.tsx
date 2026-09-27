"use client"

import { useEffect, useState } from "react"
import { demoUsers, setActingUserId, type TeamUser } from "@/lib/teams-api"
import { useI18n } from "@/lib/i18n/context"

/** Demo-only identity switch for team features; Microsoft sign-in replaces it. */
export function ViewAsSwitcher({ value }: { value: string }) {
  const { t } = useI18n()
  const [users, setUsers] = useState<TeamUser[]>([])
  useEffect(() => {
    demoUsers().then(setUsers).catch(() => setUsers([]))
  }, [])
  if (users.length === 0) return null
  const known = users.some((user) => user.id === value)
  return (
    <label className="tm-viewas">
      <span>{t("teams.viewAs.label")}</span>
      <select value={value} onChange={(event) => setActingUserId(event.target.value)}>
        {!known ? <option value={value}>{value}</option> : null}
        {users.map((user) => (
          <option key={user.id} value={user.id}>{user.role === "instructor" ? t("teams.viewAs.instructor", { name: user.display_name }) : user.display_name}</option>
        ))}
      </select>
    </label>
  )
}
