"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, History, MessageSquareText, RotateCcw, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

interface RoadmapActionsMenuProps {
  hasRoadmap: boolean;
  hasHistory: boolean;
  onGenerate: () => void;
  onHistory: () => void;
  onReset: () => void;
  onRemove: () => void;
}

/** The roadmap-wide actions: start over, look back, reset or remove. Changing it goes through the coach button. */
export function RoadmapActionsMenu({ hasRoadmap, hasHistory, onGenerate, onHistory, onReset, onRemove }: RoadmapActionsMenuProps) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; edge: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The header stack scrolls, which would clip an absolutely positioned popover: pin it to the viewport instead.
  const toggle = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, edge: dir === "rtl" ? rect.left : window.innerWidth - rect.right });
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const items = [
    { key: "generate", icon: Wand2, label: t("roadmap.actions.generate"), hint: t("roadmap.actions.generateHint"), run: onGenerate, show: true },
    { key: "history", icon: History, label: t("roadmap.actions.history"), hint: t("roadmap.actions.historyHint"), run: onHistory, show: hasHistory },
    { key: "reset", icon: RotateCcw, label: t("roadmap.actions.reset"), hint: t("roadmap.actions.resetHint"), run: onReset, show: hasRoadmap },
    { key: "remove", icon: Archive, label: t("roadmap.actions.remove"), hint: t("roadmap.actions.removeHint"), run: onRemove, show: hasRoadmap, danger: true },
  ].filter((item) => item.show);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        {t("roadmap.actions.menu")}<ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      {open && anchor ? (
        <div role="menu" className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-background p-1.5 shadow-xl" style={dir === "rtl" ? { top: anchor.top, left: Math.max(8, anchor.edge) } : { top: anchor.top, right: Math.max(8, anchor.edge) }}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" role="menuitem" onClick={() => { setOpen(false); item.run(); }} className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-start outline-none hover:bg-muted focus-visible:bg-muted", "danger" in item && item.danger && "text-destructive")}>
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0"><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs font-normal text-muted-foreground">{item.hint}</span></span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AskCoachButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <MessageSquareText className="size-3.5" aria-hidden="true" />{t("roadmap.actions.askCoach")}
    </button>
  );
}
