"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Avatar } from "@/components/teams/ui"
import { shortId } from "@/lib/gp-format"
import { useI18n } from "@/lib/i18n/context"

/** Who you are on the shared server: your name and a short form of your unique ID, with a one-click copy of the full ID. */
export function AccountChip({ id, name }: { id: string; name: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* the clipboard can be blocked; the short ID stays readable */ }
  }
  return (
    <div className="gp-account">
      <Avatar userId={id} name={name} size={36} />
      <div className="gp-account-text">
        <strong dir="auto">{name}</strong>
        <span>{t("teams.gp.idLabel")} <bdi dir="ltr" className="gp-id" title={id}>{shortId(id)}</bdi></span>
      </div>
      <button type="button" className="gp-icon-btn" onClick={() => void copy()} aria-label={t("teams.gp.copyId")} title={t("teams.gp.copyId")}>
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      </button>
      <span className="gp-sr" role="status">{copied ? t("teams.gp.copied") : ""}</span>
    </div>
  )
}
