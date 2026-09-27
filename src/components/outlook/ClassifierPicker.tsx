import type { DecisionEngine, EngineId } from "@/lib/outlook-api"

import { InfoTip } from "./InfoTip"

const DISCLOSURE: Record<EngineId, string> = {
  jev: "Sends each new email's subject and cleaned text, after best-effort redaction, to TypeSafe. If Jev fails, Span-01 Lite is tried next, then Laya.",
  span: "Sends each new email's subject and cleaned text, after best-effort redaction, to Respan through OpenRouter (free tier, not zero-retention). If it fails, Laya takes over.",
  laya: "Runs on this computer. Email text never leaves it.",
}

interface ClassifierPickerProps {
  engines: DecisionEngine[]
  selected: EngineId
  busy: boolean
  onSelect: (engine: EngineId) => void
}

/** Email classifier choice. Picking a cloud engine is the student's consent to send mail text to it. */
export function ClassifierPicker({ engines, selected, busy, onSelect }: ClassifierPickerProps) {
  return (
    <fieldset className="text-sm">
      <legend className="sr-only">Email classifier</legend>
      <div role="radiogroup" className="mt-2 grid gap-2">
        {engines.map((engine) => {
          // Laya stays selectable when missing: choosing it withdraws cloud consent.
          const disabled = busy || (!engine.available && engine.id !== "laya")
          return (
            <label
              key={engine.id}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${selected === engine.id ? "border-primary bg-primary/5" : "border-border"} ${disabled && selected !== engine.id ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name="email-classifier"
                className="mt-1"
                checked={selected === engine.id}
                disabled={disabled}
                onChange={() => onSelect(engine.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{engine.label}</span>
                  <span className="text-[11px] text-muted-foreground">{engine.location === "local" ? "On this computer" : engine.provider}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${engine.available ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                  >
                    {engine.available ? "Available" : "Not available"}
                  </span>
                  <InfoTip label={`About ${engine.label}`}>{engine.available ? DISCLOSURE[engine.id] : engine.reason}</InfoTip>
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
