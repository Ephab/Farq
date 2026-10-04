"use client"

import { useId, useState } from "react"
import { readyToStart, type StartMode } from "@/lib/gp-format"
import { useI18n } from "@/lib/i18n/context"

const MODES: StartMode[] = ["project", "class", "join"]

/** The one place to begin: pick what you want to do, type one thing, press Enter. */
export function StartPanel({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (mode: StartMode, value: string) => Promise<boolean> }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<StartMode>("project")
  const [value, setValue] = useState("")
  const inputId = useId()
  const ready = readyToStart(mode, value)
  const submit = async () => {
    if (!ready || busy) return
    if (await onSubmit(mode, value.trim())) setValue("")
  }
  return <form className="gp-start" onSubmit={event => { event.preventDefault(); void submit() }}>
    <div className="gp-modes" role="tablist" aria-label={t("teams.gp.modeLabel")}>
      {MODES.map(item => <button key={item} type="button" role="tab" id={`${inputId}-${item}`} aria-selected={mode === item} aria-controls={inputId}
        className="gp-mode" onClick={() => { setMode(item); setValue("") }}>{t(`teams.gp.modes.${item}`)}</button>)}
    </div>
    <div className="gp-start-row" role="tabpanel" aria-labelledby={`${inputId}-${mode}`}>
      <input id={inputId} className="gp-start-input" dir="auto" autoComplete="off" spellCheck={false} value={value}
        maxLength={mode === "join" ? 40 : mode === "project" ? 80 : 200} placeholder={t(`teams.gp.${mode}.placeholder`)}
        aria-label={t(`teams.gp.${mode}.placeholder`)} onChange={event => setValue(event.target.value)} />
      <button type="submit" className="gp-start-go" disabled={!ready || busy}>{t(`teams.gp.${mode}.action`)}</button>
    </div>
    <p className="gp-start-hint">{error ?? t(`teams.gp.${mode}.hint`)}</p>
    {error ? <span className="gp-sr" role="alert">{error}</span> : null}
  </form>
}
