import { useEffect, useState } from "react"
import { COLLABORATION_CONSENT_EVENT, collaborationStatus } from "@/lib/collaboration-auth"
import { ACTING_USER_EVENT } from "@/lib/teams-api"

/** `local`: no shared server is set up. `ask`: one is, but this student has not agreed to connect yet. */
export type CollaborationMode =
  | { kind: "loading" } | { kind: "local" } | { kind: "ask"; server: string } | { kind: "connected"; server: string }

/** Which Group Projects experience applies right now. The agreement itself is kept and enforced by the local API. */
export function useCollaborationMode(): CollaborationMode {
  const [mode, setMode] = useState<CollaborationMode>({ kind: "loading" })
  useEffect(() => {
    let current = true
    const load = () => {
      collaborationStatus()
        .then((status) => {
          if (!current) return
          if (!status.configured) setMode({ kind: "local" })
          else setMode({ kind: status.consented ? "connected" : "ask", server: status.server })
        })
        .catch(() => { if (current) setMode({ kind: "local" }) })
    }
    load()
    window.addEventListener(COLLABORATION_CONSENT_EVENT, load)
    window.addEventListener(ACTING_USER_EVENT, load)
    return () => { current = false; window.removeEventListener(COLLABORATION_CONSENT_EVENT, load); window.removeEventListener(ACTING_USER_EVENT, load) }
  }, [])
  return mode
}
