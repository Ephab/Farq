"use client";

import { useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

const STORAGE_KEY = "waypoint.roadmap-explainer-closed";

function readClosed(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

/** "How your roadmap works" in plain words. Open the first time, then remembers that it was closed. */
export function RoadmapExplainer() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !readClosed());
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? "0" : "1"); } catch { /* the explainer still works without storage */ }
  };
  const steps = [
    { title: t("roadmap.explainer.suggestTitle"), body: t("roadmap.explainer.suggestBody") },
    { title: t("roadmap.explainer.reviewTitle"), body: t("roadmap.explainer.reviewBody") },
    { title: t("roadmap.explainer.applyTitle"), body: t("roadmap.explainer.applyBody") },
    { title: t("roadmap.explainer.protectTitle"), body: t("roadmap.explainer.protectBody") },
  ];
  return (
    <section className="shrink-0 border-b border-border px-4 py-2 sm:px-6">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-2 rounded-md text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <CircleHelp className="size-4" aria-hidden="true" />{t("roadmap.explainer.title")}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mt-3 pb-1">
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums" aria-hidden="true">{index + 1}</span>
                <span><span className="block font-medium">{step.title}</span><span className="block text-[13px] leading-relaxed text-muted-foreground">{step.body}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{t("roadmap.explainer.footer")}</p>
        </div>
      ) : null}
    </section>
  );
}
