"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader,
  MapPin,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { NodeStatus, RoadmapNodeData } from "@/data/computer-vision-roadmap";
import { RoadmapNodeIcon } from "@/components/roadmap/RoadmapNode";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n/context";

interface NodeDetailPanelProps {
  node: RoadmapNodeData | null;
  /** The roadmap this node belongs to (prerequisites are looked up here, not in the demo seed). */
  nodeMap: Record<string, RoadmapNodeData>;
  status: NodeStatus;
  /** Which statuses may be chosen; the onboarding preview only allows toggling evidence-backed done. */
  allowedStatuses?: NodeStatus[];
  hasPrev: boolean;
  hasNext: boolean;
  onStatus: (status: NodeStatus) => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

const STATUS_OPTIONS: { value: NodeStatus; label: MessageKey; icon: typeof Check }[] = [
  { value: "not-started", label: "roadmap.status.not-started", icon: X },
  { value: "in-progress", label: "roadmap.detail.doing", icon: Loader },
  { value: "done", label: "roadmap.status.done", icon: Check },
];

export function NodeDetailPanel({
  node,
  nodeMap,
  status,
  allowedStatuses,
  hasPrev,
  hasNext,
  onStatus,
  onClose,
  onNavigate,
  onPrev,
  onNext,
}: NodeDetailPanelProps) {
  const { t, dir } = useI18n();
  const slide = dir === "rtl" ? -32 : 32;
  const panelRef = useRef<HTMLElement>(null);
  // Focus the panel when a different node opens, not after every status click
  // (an inline ref callback re-ran on each render and yanked focus off the buttons).
  const nodeId = node?.id;
  useEffect(() => {
    if (nodeId) panelRef.current?.focus({ preventScroll: true });
  }, [nodeId]);
  return (
    <AnimatePresence>
      {node ? (
        <motion.aside
          key={node.id}
          initial={{ opacity: 0, x: slide }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: slide }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          role="dialog"
          aria-modal="false"
          aria-label={t("roadmap.detail.ariaLabel", { title: node.title })}
          tabIndex={-1}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}
          ref={panelRef}
          className="absolute bottom-4 end-4 top-4 z-20 flex w-[min(340px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl outline-none"
        >
          <DetailBody
            node={node}
            nodeMap={nodeMap}
            status={status}
            allowedStatuses={allowedStatuses}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onStatus={onStatus}
            onClose={onClose}
            onNavigate={onNavigate}
            onPrev={onPrev}
            onNext={onNext}
          />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function DetailBody({
  node,
  nodeMap,
  status,
  allowedStatuses,
  hasPrev,
  hasNext,
  onStatus,
  onClose,
  onNavigate,
  onPrev,
  onNext,
}: {
  node: RoadmapNodeData;
  nodeMap: Record<string, RoadmapNodeData>;
  status: NodeStatus;
  allowedStatuses?: NodeStatus[];
  hasPrev: boolean;
  hasNext: boolean;
  onStatus: (s: NodeStatus) => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, fmt } = useI18n();
  const prereqs = node.deps
    .map((id) => nodeMap[id])
    .filter((n) => n !== undefined);

  return (
    <>
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
          <RoadmapNodeIcon icon={node.icon} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t(`roadmap.levels.${node.level}`)}
          </p>
          <h2 dir="auto" className="truncate text-base font-semibold">{node.title}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" /> <bdi>{node.duration}</bdi>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("roadmap.detail.close")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p dir="auto" className="text-sm leading-relaxed text-foreground/90">
          {node.description}
        </p>
        {node.rationale ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{t("roadmap.detail.why")}</span>
            <bdi>{node.rationale}</bdi>
          </p>
        ) : null}

        {node.nodeType === "opportunity" && node.opportunity ? (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t("roadmap.detail.opportunity")}</span><span className="text-muted-foreground">{t("roadmap.detail.checked", { date: fmt.date(node.opportunity.fetched_at) })}</span></div>
            {node.opportunity.source_date ? <p className="mt-2 flex items-center gap-1.5"><CalendarDays className="size-3.5 text-amber-600" /><bdi>{node.opportunity.date_label ?? t("roadmap.detail.dateBySource")}</bdi>: <bdi>{node.opportunity.source_date}</bdi></p> : null}
            {node.opportunity.locations.length ? <p className="mt-1 flex items-center gap-1.5"><MapPin className="size-3.5 text-amber-600" /><bdi>{node.opportunity.locations.join(" · ")}</bdi>{node.opportunity.virtual ? ` · ${t("roadmap.detail.virtual")}` : ""}</p> : null}
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("roadmap.detail.confirm")}</p>
          </div>
        ) : null}

        <div
          className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
          role="group"
          aria-label={t("roadmap.detail.markProgress")}
        >
          {STATUS_OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            const active = status === opt.value;
            const allowed = !allowedStatuses || allowedStatuses.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={!allowed}
                onClick={() => onStatus(opt.value)}
                aria-pressed={active}
                className={cn(
                  "flex h-8 items-center justify-center gap-1 rounded-lg text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? opt.value === "done"
                      ? "bg-emerald-500 text-white"
                      : opt.value === "in-progress"
                        ? "bg-amber-500 text-white"
                        : "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground",
                )}
              >
                <OptIcon className="size-3.5" aria-hidden="true" />
                {t(opt.label)}
              </button>
            );
          })}
        </div>

        <h3 className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("roadmap.detail.whatToLearn")}
        </h3>
        <ul className="mt-2 space-y-1.5">
          {node.subtopics.map((topic) => (
            <li key={topic} dir="auto" className="flex items-start gap-2 text-sm">
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              {topic}
            </li>
          ))}
        </ul>

        {prereqs.length > 0 ? (
          <>
            <h3 className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t("roadmap.detail.prerequisites")}
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prereqs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onNavigate(p.id)}
                  className="rounded-full border border-border px-2.5 py-1 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <bdi>{p.title}</bdi>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <h3 className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("roadmap.detail.resources")}
        </h3>
        <ul className="mt-2 space-y-1.5">
          {node.resources.map((r) => (
            <li key={r.url}>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-1.5 text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span dir="auto" className="truncate">{r.label}</span>
                <ExternalLink
                  className="size-3 shrink-0 opacity-60"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border p-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {t("roadmap.detail.prev")}
        </button>
        <span dir="auto" className="text-xs text-muted-foreground">{node.tagline}</span>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("roadmap.detail.next")} <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
