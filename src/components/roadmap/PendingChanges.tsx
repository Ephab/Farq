"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronDown, LoaderCircle, Minus, Pencil, Plus, ShieldAlert, Sparkles, Waypoints, X } from "lucide-react";
import type { RoadmapNodeData, RoadmapStage } from "@/data/computer-vision-roadmap";
import { PROTECTED, type RoadmapOperation, type RoadmapProposalData } from "@/components/roadmap/roadmap-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

type Tone = "add" | "remove" | "edit" | "move";

interface DiffLine {
  tone: Tone;
  text: string;
  detail?: string;
  nodeId: string;
  /** The coach asked to change work that is done or in progress; the server will refuse it. */
  protectedNode: boolean;
}

const FIELD_KEYS = ["title", "icon", "tagline", "description", "subtopics", "resources", "duration", "level", "rationale"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const SHORT_FIELDS = new Set(["title", "tagline", "duration", "level"]);

function clip(value: unknown, max = 60): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function describeOperations(
  operations: RoadmapOperation[],
  nodeMap: Record<string, RoadmapNodeData>,
  stages: RoadmapStage[],
  t: ReturnType<typeof useI18n>["t"],
): DiffLine[] {
  const stageTitle = (id?: string | null) => stages.find((stage) => stage.id === id)?.title.replace(/^\s*(?:stage|المرحلة)\s*[\d٠-٩]+\s*[·:\-–—]\s*/i, "") ?? id ?? "";
  return operations.map((op) => {
    const current = nodeMap[op.node_id];
    const title = current?.title ?? op.node?.title ?? op.node_id;
    const protectedNode = current !== undefined && PROTECTED.has(current.status ?? "not-started");
    switch (op.type) {
      case "add_node":
        return { tone: "add", text: t("roadmap.pending.add", { title, stage: stageTitle(op.node?.stageId) }), nodeId: op.node_id, protectedNode: false };
      case "remove_node":
        return { tone: "remove", text: t("roadmap.pending.remove", { title }), nodeId: op.node_id, protectedNode };
      case "move_node":
        return { tone: "move", text: t("roadmap.pending.move", { title, stage: stageTitle(op.stage_id) }), nodeId: op.node_id, protectedNode };
      case "set_dependencies": {
        const names = (op.dependencies ?? []).map((id) => nodeMap[id]?.title ?? id);
        return { tone: "move", text: t("roadmap.pending.dependencies", { title }), detail: names.length ? names.join(" · ") : t("roadmap.pending.noDependencies"), nodeId: op.node_id, protectedNode };
      }
      default: {
        const changes = op.changes ?? {};
        const fields = Object.keys(changes).map((key) => ((FIELD_KEYS as readonly string[]).includes(key) ? t(`roadmap.pending.fields.${key as FieldKey}`) : key));
        const lines = Object.entries(changes)
          .filter(([key]) => SHORT_FIELDS.has(key))
          .map(([key, value]) => `${clip((current as unknown as Record<string, unknown> | undefined)?.[key] ?? "")} → ${clip(value)}`);
        return { tone: "edit", text: t("roadmap.pending.edit", { title, fields: fields.join(", ") }), detail: lines.join("   ") || undefined, nodeId: op.node_id, protectedNode };
      }
    }
  });
}

const TONE: Record<Tone, { icon: typeof Plus; box: string }> = {
  add: { icon: Plus, box: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  remove: { icon: Minus, box: "bg-red-500/15 text-red-700 dark:text-red-400" },
  edit: { icon: Pencil, box: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  move: { icon: ArrowRight, box: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

interface PendingChangesProps {
  proposals: RoadmapProposalData[];
  currentVersionId: string | null;
  nodeMap: Record<string, RoadmapNodeData>;
  stages: RoadmapStage[];
  busyId: string | null;
  error: string | null;
  onAccept: (proposal: RoadmapProposalData) => void;
  onReject: (proposal: RoadmapProposalData) => void;
  onReview: (proposal: RoadmapProposalData) => void;
  onSelectNode: (id: string) => void;
}

/** Coach suggestions waiting for the student, each with the exact changes it would make. */
export function PendingChanges({ proposals, currentVersionId, nodeMap, stages, busyId, error, onAccept, onReject, onReview, onSelectNode }: PendingChangesProps) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!proposals.length) return null;
  return (
    <section aria-label={t("roadmap.pending.title")} className="shrink-0 border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-amber-500" aria-hidden="true" />{t("roadmap.pending.title")}<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{fmt.number(proposals.length)}</span></h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("roadmap.pending.hint")}</p>
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      <ul className="mt-3 space-y-2">
        {proposals.map((proposal) => {
          const stale = currentVersionId !== null && proposal.base_version_id !== currentVersionId;
          const initial = proposal.kind === "initial";
          const lines = initial ? [] : describeOperations(proposal.operations, nodeMap, stages, t);
          const blocked = lines.some((line) => line.protectedNode);
          const expanded = open[proposal.id] ?? lines.length <= 4;
          const busy = busyId === proposal.id;
          return (
            <li key={proposal.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="text-sm font-medium">{proposal.summary}</p>
                  {proposal.reasoning ? <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">{proposal.reasoning}</p> : null}
                  {stale ? <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><ShieldAlert className="size-3.5" aria-hidden="true" />{t("roadmap.pending.stale")}</p> : null}
                  {blocked && !stale ? <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><ShieldAlert className="size-3.5" aria-hidden="true" />{t("roadmap.pending.protected")}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onReject(proposal)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" aria-hidden="true" />{stale ? t("roadmap.pending.dismiss") : t("roadmap.pending.reject")}</button>
                  {initial ? (
                    <button type="button" onClick={() => onReview(proposal)} disabled={busy || stale} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Waypoints className="size-3.5" aria-hidden="true" />{t("roadmap.pending.review")}</button>
                  ) : (
                    <button type="button" onClick={() => onAccept(proposal)} disabled={busy || stale || blocked} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}{t("roadmap.pending.accept")}</button>
                  )}
                </div>
              </div>
              {initial ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("roadmap.pending.initialBody", { title: proposal.snapshot?.title ?? "", topics: t("roadmap.node.topics", { count: proposal.snapshot?.nodes.length ?? 0 }) })}</p>
              ) : lines.length ? (
                <div className="mt-2">
                  {lines.length > 4 ? (
                    <button type="button" onClick={() => setOpen((current) => ({ ...current, [proposal.id]: !expanded }))} aria-expanded={expanded} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />{t("roadmap.pending.changes", { count: lines.length })}
                    </button>
                  ) : null}
                  {expanded ? (
                    <ul className="space-y-1">
                      {lines.map((line, index) => {
                        const tone = TONE[line.tone];
                        const Icon = tone.icon;
                        const known = nodeMap[line.nodeId] !== undefined;
                        return (
                          <li key={index} className="flex items-start gap-2 text-xs">
                            <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded", tone.box)}><Icon className="size-3" aria-hidden="true" /></span>
                            <span className="min-w-0 flex-1">
                              {known ? <button type="button" onClick={() => onSelectNode(line.nodeId)} dir="auto" className="text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{line.text}</button> : <span dir="auto">{line.text}</span>}
                              {line.protectedNode ? <span className="ms-1.5 text-amber-700 dark:text-amber-400">· {t("roadmap.pending.protectedTag")}</span> : null}
                              {line.detail ? <span dir="auto" className="mt-0.5 block text-muted-foreground">{line.detail}</span> : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
