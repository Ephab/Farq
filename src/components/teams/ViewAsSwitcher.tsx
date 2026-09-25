"use client"

import { useEffect, useState } from "react"
import { setActingUserId, teams, type TeamUser } from "@/lib/teams-api"

/** Demo-only identity switch for team features; Microsoft sign-in replaces it. */
export function ViewAsSwitcher({ value }: { value: string }) {
  const [users, setUsers] = useState<TeamUser[]>([])
  useEffect(() => {
    teams.demoUsers().then(setUsers).catch(() => setUsers([]))
  }, [])
  if (users.length === 0) return null
  const known = users.some((user) => user.id === value)
  return (
    <label className="tm-viewas">
      <span>Viewing as</span>
      <select value={value} onChange={(event) => setActingUserId(event.target.value)}>
        {!known ? <option value={value}>{value}</option> : null}
        {users.map((user) => (
          <option key={user.id} value={user.id}>{user.display_name}{user.role === "instructor" ? " (instructor)" : ""}</option>
        ))}
      </select>
    </label>
  )
}
