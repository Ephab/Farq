"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

interface RoadmapDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small modal for the two actions that replace or remove a whole roadmap. Escape cancels. */
export function RoadmapDialog({ title, children, confirmLabel, danger, busy, error, onConfirm, onCancel }: RoadmapDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => { if (!busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="h-9 rounded-lg border border-border px-4 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{t("common.cancel")}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={cn("inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", danger ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
