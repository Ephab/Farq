import { createContext, useContext } from "react"
import type { TeamClient } from "@/lib/teams-api"

/** The acting user's bound team client, provided by TeamsView. */
export const TeamClientContext = createContext<TeamClient | null>(null)

export function useTeamClient(): TeamClient {
  const client = useContext(TeamClientContext)
  if (!client) throw new Error("useTeamClient must be used inside TeamClientContext")
  return client
}
