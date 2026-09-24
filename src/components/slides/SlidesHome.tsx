"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  FileText,
  Loader2,
  Presentation,
  Route,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { SlidesLength, SlidesProgress, SuggestedTopic } from "@/lib/slides-ai";
import type { SavedExtension, SlideDeck } from "@/lib/quiz-store";
import { formatDeckDate } from "@/lib/quiz-store";
import { DeckPreview } from "./DeckPreview";
import type { ViewerSlide } from "@/lib/deck-viewer";
import type { DeckVisualStatus } from "./SlidesView";
import { cn } from "@/lib/utils";

// Shape lock for the Slides tab (preserve mode, matches app tokens):
// cards rounded-2xl (16px), controls/inputs rounded-xl (12px),
// badges and pills rounded-full. No mixing outside this rule.
const LENGTH_META: { id: SlidesLength; label: string; hint: string }[] = [
  { id: "short", label: "Short", hint: "2-3 slides" },
  { id: "medium", label: "Medium", hint: "4-6 slides" },
  { id: "long", label: "Long", hint: "7-10 slides" },
];

function stageLabel(stage: SlidesProgress["stage"]): string {
  if (stage === "waiting") return "Waiting for model";
  if (stage === "receiving") return "Hermes is analyzing";
  if (stage === "validating") return "Validating";
  return "Done";
}

/** Determinate progress bar driven by the agent-run ticker. */
function SlidesProgressBar({ progress, label }: { progress: SlidesProgress; label: string }) {
  const pct = Math.max(2, Math.min(99, Math.round(progress.percent)));
  return (
    <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}: {stageLabel(progress.stage)}
      </p>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${pct} percent`}
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">{pct}%: this can take up to a minute on large decks</p>
    </div>
  );
}

interface SlidesHomeProps {
  modelLabel: string;
  decks: SlideDeck[];
  selectedDeckId: string | null;
  onSelectDeck: (id: string) => void;
  onDeleteDeck: (id: string) => void;
  uploading: boolean;
  onUpload: (file: File) => void;
  error: string | null;
  topics: SuggestedTopic[];
  topicsLoading: boolean;
  topicsProgress: SlidesProgress | null;
  topicsError: string | null;
  selectedTopic: string;
  onSelectTopic: (title: string) => void;
  customTopic: string;
  onCustomTopic: (value: string) => void;
  extensionLength: SlidesLength;
  onExtensionLength: (l: SlidesLength) => void;
  extending: boolean;
  extendProgress: SlidesProgress | null;
  extendError: string | null;
  onExtend: () => void;
  previewTopic: string;
  hasPreview: boolean;
  /** Originals + unsaved AI slides (null while visuals load or unavailable). */
  workbenchSlides: ViewerSlide[] | null;
  deckWidthPx: number;
  deckAspect: number;
  visualStatus: DeckVisualStatus;
  visualError: string | null;
  getExtensionSlides: (ext: SavedExtension) => ViewerSlide[];
  onSavePreview: () => void;
  onDiscardPreview: () => void;
  extensions: SavedExtension[];
  newExtensionIds: string[];
  onDeleteExtension: (id: string) => void;
  exportingId: string | null;
  onExport: (ext: SavedExtension) => void;
}

import { useEffect, useRef } from "react";

export function SlidesHome(props: SlidesHomeProps) {
  const {
    modelLabel,
    decks,
    selectedDeckId,
    onSelectDeck,
    onDeleteDeck,
    uploading,
    onUpload,
    error,
    topics,
    topicsLoading,
    topicsProgress,
    topicsError,
    selectedTopic,
    onSelectTopic,
    customTopic,
    onCustomTopic,
    extensionLength,
    onExtensionLength,
    extending,
    extendProgress,
    extendError,
    onExtend,
    previewTopic,
    hasPreview,
    workbenchSlides,
    deckWidthPx,
    deckAspect,
    visualStatus,
    visualError,
    getExtensionSlides,
    onSavePreview,
    onDiscardPreview,
    extensions,
    newExtensionIds,
    onDeleteExtension,
    exportingId,
    onExport,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, []);
  const askConfirm = (key: string, action: () => void) => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    if (confirmKey === key) {
      setConfirmKey(null);
      action();
      return;
    }
    setConfirmKey(key);
    confirmTimer.current = window.setTimeout(() => setConfirmKey(null), 4000);
  };

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;
  const effectiveTopic = customTopic.trim() || selectedTopic;
  const deckExtensions = selectedDeck ? extensions.filter((e) => e.deckId === selectedDeck.id) : [];
  const hasRoadmapTopics = topics.some((t) => t.source === "roadmap");

  return (
    <div className="w-full px-4 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI slide extensions
          </span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Extend your slides</h1>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
            Upload a deck, pick a topic, and Hermes writes new slides in your style.
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2"
          aria-label="Hermes slides model"
          title="Extensions use the server Hermes model"
        >
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Hermes
          </span>
          <span className="max-w-40 truncate text-[13px] font-medium sm:max-w-56">{modelLabel}</span>
        </div>
      </div>

      <div className="mx-auto mt-6 flex w-full max-w-7xl flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : null}
          {uploading ? "Reading slides…" : "Upload slides"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.pptx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      {error ? (
        <div role="alert" className="mx-auto mt-3 w-full max-w-7xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] leading-relaxed">
          {error}
        </div>
      ) : null}

      {/* Decks: card grid family (only grid on this tab) */}
      <section aria-label="Your slide decks" className="mx-auto mt-10 w-full max-w-7xl">
        <h2 className="text-lg font-semibold tracking-tight">
          Your slides <span className="text-sm font-medium tabular-nums text-muted-foreground">{decks.length}</span>
        </h2>
        {decks.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center outline-none transition-colors hover:border-muted-foreground/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-muted">
              <Presentation className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="mt-3 text-[15px] font-medium">No slides yet. Upload your first deck.</span>
            <span className="mt-1 text-[13px] text-muted-foreground">PDF or PPTX, up to 25MB, parsed in your browser</span>
          </button>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {decks.map((deck) => {
              const selected = deck.id === selectedDeckId;
              return (
                <div
                  key={deck.id}
                  role="radio"
                  tabIndex={0}
                  aria-checked={selected}
                  aria-label={`Extend ${deck.fileName}`}
                  onClick={() => onSelectDeck(deck.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectDeck(deck.id);
                    }
                  }}
                  className={cn(
                    "group cursor-pointer rounded-2xl border bg-background p-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary ring-1 ring-primary/20"
                      : "border-border hover:border-muted-foreground/50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted">
                      {deck.kind === "pdf" ? (
                        <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <Presentation className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">{deck.fileName}</p>
                      <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                        {deck.units} {deck.kind === "pdf" ? "pages" : "slides"}, {(deck.chars / 1000).toFixed(1)}k chars
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        askConfirm(`deck:${deck.id}`, () => onDeleteDeck(deck.id));
                      }}
                      aria-label={confirmKey === `deck:${deck.id}` ? `Confirm delete ${deck.fileName}` : `Delete ${deck.fileName}`}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {confirmKey === `deck:${deck.id}` ? (
                        <span className="rounded-md bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">Sure?</span>
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{formatDeckDate(deck.uploadedAt)}</span>
                    {selected ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Selected</span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        Select to extend
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Workbench: viewer + control stack (two-column on desktop, stacked on mobile) */}
      {selectedDeck ? (
        <section aria-label="Extension workbench" className="mx-auto mt-10 w-full max-w-7xl rounded-2xl border border-border bg-background p-5 sm:p-6">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {selectedDeck.fileName}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Exports keep your original slides first, with AI slides appended.
          </p>

          <div className="mt-5 grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            {/* Preview column */}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Deck preview</h3>
              {visualStatus === "loading" ? (
                <div className="mt-2 rounded-2xl border border-border bg-muted/40 p-4" role="status" aria-live="polite">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Rendering your slides…
                  </p>
                  <div className="mt-3 aspect-video w-full animate-pulse rounded-xl bg-muted" aria-hidden="true" />
                </div>
              ) : visualStatus === "error" ? (
                <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">
                  {visualError ?? "Could not preview these slides."}
                </p>
              ) : workbenchSlides ? (
                <div className="mt-2">
                  <DeckPreview slides={workbenchSlides} deckWidthPx={deckWidthPx} aspect={deckAspect} />
                </div>
              ) : (
                <p className="mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Re-upload the file for visual preview. Text is still available for generation.
                </p>
              )}

              {hasPreview && workbenchSlides ? (
                <div className="mt-4 rounded-2xl border border-primary/30 bg-muted/30 p-4">
                  <h3 className="text-sm font-semibold">
                    Full deck preview: {previewTopic}
                  </h3>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {workbenchSlides.length} slides total, new ones marked AI. Review above, then save or discard.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onSavePreview}
                      className="flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                    >
                      Save extension
                    </button>
                    <button
                      type="button"
                      onClick={onDiscardPreview}
                      className="flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Controls column: vertical list family (deliberately not cards grid) */}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Suggested topics</h3>
              {hasRoadmapTopics ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Roadmap topics link this deck to your roadmap. Deck topics come from these slides alone.
                </p>
              ) : null}
              {topicsLoading ? (
                topicsProgress ? (
                  <SlidesProgressBar progress={topicsProgress} label="Hermes is reading your deck" />
                ) : (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Hermes is reading your deck…
                  </p>
                )
              ) : topicsError ? (
                <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">
                  {topicsError}
                </p>
              ) : topics.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Analyzing deck. Suggestions will appear here.</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Suggested topics">
                  {topics.map((topic) => {
                    const active = selectedTopic === topic.title && !customTopic.trim();
                    const roadmapLinked = topic.source === "roadmap";
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => onSelectTopic(topic.title)}
                        role="radio"
                        aria-checked={active}
                        aria-label={`${topic.title}${roadmapLinked ? " (for your roadmap)" : ""}`}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
                          active
                            ? "border-primary bg-muted"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                            active ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
                          )}
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[14px] font-semibold leading-snug">
                            {roadmapLinked ? <Route className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
                            <span className="truncate">{topic.title}</span>
                          </span>
                          {topic.rationale ? <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{topic.rationale}</span> : null}
                          {roadmapLinked && topic.roadmapNode ? (
                            <span className="mt-0.5 block text-xs font-medium text-primary">
                              Links to roadmap: {topic.roadmapNode}
                            </span>
                          ) : null}
                          {topic.relatedSlides ? <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">{topic.relatedSlides}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="mt-4 block text-sm font-semibold" htmlFor="slides-custom-topic">
                Or describe your own topic
              </label>
              <input
                id="slides-custom-topic"
                value={customTopic}
                onChange={(e) => onCustomTopic(e.target.value)}
                placeholder="e.g. Attention mechanisms in transformers"
                maxLength={300}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />

              <div className="mt-4">
                <span id="slides-length-label" className="text-sm font-semibold">Length</span>
                <div className="mt-2 flex gap-1 rounded-xl bg-muted p-1" role="group" aria-labelledby="slides-length-label">
                  {LENGTH_META.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onExtensionLength(l.id)}
                      aria-pressed={extensionLength === l.id}
                      title={l.hint}
                      className={cn(
                        "h-9 flex-1 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        extensionLength === l.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {l.label} <span className="font-normal opacity-70">{l.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={onExtend}
                disabled={extending || !effectiveTopic}
                className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-40"
              >
                {extending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {extending ? "Writing slides…" : <>Extend slides <ArrowRight className="size-4" aria-hidden="true" /></>}
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                Hermes picks the exact slide count for {extensionLength} length.
              </p>
              {extending && extendProgress ? (
                <SlidesProgressBar progress={extendProgress} label="Hermes is writing slides" />
              ) : null}
              {extendError ? (
                <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px]">
                  {extendError}
                </p>
              ) : null}
            </div>
          </div>

          {deckExtensions.length > 0 ? (
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Saved extensions for this deck ({deckExtensions.length})</h3>
              <div className="mt-3 flex flex-col gap-4">
                {deckExtensions.map((ext) => {
                  const exporting = exportingId === ext.id;
                  const fullSlides = getExtensionSlides(ext);
                  const originalCount = fullSlides.length - ext.slides.length;
                  return (
                    <div key={ext.id} className="rounded-2xl border border-border bg-background px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                          {ext.topic}
                          {newExtensionIds.includes(ext.id) ? (
                            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                              New
                            </span>
                          ) : null}
                        </p>
                        <button
                          type="button"
                          onClick={() => onExport(ext)}
                          disabled={exporting}
                          title="Download one .pptx with your slides first and AI slides appended"
                          className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-medium text-primary-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
                        >
                          {exporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
                          {exporting ? "Exporting…" : "Full deck .pptx"}
                        </button>
                        <button
                          type="button"
                          onClick={() => askConfirm(`ext:${ext.id}`, () => onDeleteExtension(ext.id))}
                          className="grid size-9 place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={confirmKey === `ext:${ext.id}` ? `Confirm delete extension ${ext.topic}` : `Delete extension ${ext.topic}`}
                        >
                          {confirmKey === `ext:${ext.id}` ? (
                            <span className="rounded-md bg-red-500 px-1.5 py-0.5 text-[11px] font-bold text-white">Sure?</span>
                          ) : (
                            <Trash2 className="size-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                        {originalCount > 0 ? `${originalCount} original plus ` : ""}{ext.slides.length} new, {formatDeckDate(ext.createdAt)}
                      </p>
                      {originalCount === 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Original file not in memory (re-upload to see it here). Showing new slides in deck style.
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <DeckPreview slides={fullSlides} deckWidthPx={deckWidthPx} aspect={deckAspect} initialIndex={Math.max(0, originalCount - 1)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
