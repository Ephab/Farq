"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getCurrentStudentId } from "@/lib/waypoint-api";
import { extractSource } from "@/lib/quiz-extract";
import {
  combineDeckTexts,
  deckFromSource,
  loadLibrary,
  makeId,
  updateLibrary,
  type QuizLibrary,
  type SavedExtension,
} from "@/lib/quiz-store";
import {
  exportExtensionPptx,
  extendSlides,
  fileToBase64,
  suggestTopics,
  SlidesAIError,
  type ExtendedSlide,
  type SlidesLength,
  type SlidesProgress,
  type SuggestedTopic,
} from "@/lib/slides-ai";
import { parsePptxDesign, type ParsedPptx } from "@/lib/pptx-design";
import { renderPdfPages } from "@/lib/pdf-pages";
import { NEUTRAL_THEME, type ViewerSlide } from "@/lib/deck-viewer";
import { useI18n, type MessageKey } from "@/lib/i18n/context";
import { SlidesHome } from "./SlidesHome";

export type DeckVisualStatus = "loading" | "ready" | "unavailable" | "error";

export interface DeckVisuals {
  status: DeckVisualStatus;
  parsed?: ParsedPptx;
  pdfImages?: string[];
  pdfWidth?: number;
  pdfHeight?: number;
  error?: string;
}

export function SlidesView() {
  const { t } = useI18n();
  /** Translate a library error when it carries a key; server-supplied text passes through. */
  const errorText = useCallback(
    (e: unknown, fallback: MessageKey): string => {
      if (e instanceof SlidesAIError) return e.key ? t(`slides.errors.${e.key}`, e.params) : e.message;
      return e instanceof Error && e.message ? e.message : t(fallback);
    },
    [t],
  );
  const [library, setLibrary] = useState<QuizLibrary>(loadLibrary);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hermesModel, setHermesModel] = useState({ id: "" });

  const [topics, setTopics] = useState<SuggestedTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsProgress, setTopicsProgress] = useState<SlidesProgress | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [extensionLength, setExtensionLength] = useState<SlidesLength>("medium");

  const [extending, setExtending] = useState(false);
  const [extendProgress, setExtendProgress] = useState<SlidesProgress | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [previewSlides, setPreviewSlides] = useState<ExtendedSlide[]>([]);
  const [previewTopic, setPreviewTopic] = useState("");

  const [newExtensionIds, setNewExtensionIds] = useState<string[]>([]);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // In-page slide visuals: parsed PPTX design or rendered PDF pages.
  // Files (and their visuals) live in memory only — a reload keeps the
  // extracted text but needs a re-upload for visual preview/export.
  const [visuals, setVisuals] = useState<Record<string, DeckVisuals>>({});
  // Latest render request per deck: switching decks never discards another deck's result.
  const visualReqs = useRef(new Map<string, number>());
  const [suggestAttempt, setSuggestAttempt] = useState(0);

  const libraryRef = useRef(library);
  const selectedDeckRef = useRef<string | null>(null);
  // Original files kept in memory only (never localStorage).
  const originalFiles = useRef(new Map<string, File>());
  const suggestCtrl = useRef<AbortController | null>(null);
  const extendCtrl = useRef<AbortController | null>(null);

  // Writes merge with storage (Quizzes shares this library; see updateLibrary).
  const persist = useCallback((change: (lib: QuizLibrary) => QuizLibrary) => {
    const { library: next, saved } = updateLibrary(change);
    libraryRef.current = next;
    setLibrary(next);
    if (!saved) setError(t("slides.errors.storageFull"));
  }, [t]);

  useEffect(() => {
    selectedDeckRef.current = selectedDeckId;
  }, [selectedDeckId]);

  useEffect(() => {
    let cancelled = false;
    api<{ model?: string }>("/api/health")
      .then((health) => {
        if (cancelled || !health.model) return;
        // Raw infra ids (nvidia/…) mean nothing to students: show a human label.
        setHermesModel({ id: health.model });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** Stop an in-flight extension: its slides belong to the deck it was started for. */
  const cancelExtend = useCallback(() => {
    extendCtrl.current?.abort();
    extendCtrl.current = null;
    setExtending(false);
    setExtendProgress(null);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const deck = deckFromSource(await extractSource(file));
        originalFiles.current.set(deck.id, file);
        persist((lib) => ({ ...lib, decks: [deck, ...lib.decks] }));
        cancelExtend();
        // Enter loading state synchronously so the workbench never flashes
        // an empty "no suggestions" state before analysis starts.
        setTopics([]);
        setTopicsError(null);
        setTopicsProgress({ percent: 2, stage: "waiting", charsReceived: 0 });
        setTopicsLoading(true);
        setSelectedTopic("");
        setCustomTopic("");
        setPreviewSlides([]);
        setPreviewTopic("");
        setExtendError(null);
        setSelectedDeckId(deck.id);
      } catch (e) {
        setError(errorText(e, "slides.errors.readFile"));
      } finally {
        setUploading(false);
      }
    },
    [persist, errorText, cancelExtend],
  );

  /** Selecting a deck immediately shows the analyzing state (no empty flash). */
  const handleSelectDeck = useCallback((id: string) => {
    setSelectedDeckId((prev) => {
      if (prev !== id) {
        cancelExtend();
        setTopics([]);
        setTopicsError(null);
        setTopicsProgress({ percent: 2, stage: "waiting", charsReceived: 0 });
        setTopicsLoading(true);
        setSelectedTopic("");
        setCustomTopic("");
        setPreviewSlides([]);
        setPreviewTopic("");
        setExtendError(null);
      }
      return id;
    });
  }, [cancelExtend]);

  const deleteDeck = useCallback(
    (id: string) => {
      originalFiles.current.delete(id);
      persist((lib) => ({
        ...lib,
        decks: lib.decks.filter((d) => d.id !== id),
        extensions: lib.extensions.filter((e) => e.deckId !== id),
      }));
      setSelectedDeckId((sel) => (sel === id ? null : sel));
    },
    [persist],
  );

  // Auto-suggest topics whenever the selected deck changes. The loading
  // state is already set synchronously by the selection handlers above, so
  // the workbench shows a progress bar — never an instant empty state.
  useEffect(() => {
    if (!selectedDeckId) {
      suggestCtrl.current?.abort();
      cancelExtend();
      setTopicsLoading(false);
      setTopicsProgress(null);
      setTopics([]);
      setTopicsError(null);
      setSelectedTopic("");
      setPreviewSlides([]);
      setPreviewTopic("");
      setExtendError(null);
      return;
    }
    const deck = libraryRef.current.decks.find((d) => d.id === selectedDeckId);
    if (!deck) {
      setSelectedDeckId(null);
      return;
    }
    suggestCtrl.current?.abort();
    const ctrl = new AbortController();
    suggestCtrl.current = ctrl;
    setTopicsLoading(true);
    suggestTopics(combineDeckTexts([deck]).text, {
      count: 5,
      studentId: getCurrentStudentId(),
      signal: ctrl.signal,
      onProgress: (p) => {
        if (!ctrl.signal.aborted) setTopicsProgress(p);
      },
    })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setTopics(result);
        setSelectedTopic(result[0]?.title ?? "");
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setTopicsError(errorText(e, "slides.errors.suggestFailed"));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setTopicsLoading(false);
          setTopicsProgress(null);
        }
      });
    return () => ctrl.abort();
    // errorText is deliberately omitted: a locale change must not re-run the model call.
    // suggestAttempt re-runs it on Try again.
  }, [selectedDeckId, suggestAttempt, cancelExtend]);

  const retryTopics = useCallback(() => {
    setTopicsError(null);
    setTopicsProgress({ percent: 2, stage: "waiting", charsReceived: 0 });
    setTopicsLoading(true);
    setSuggestAttempt((n) => n + 1);
  }, []);

  // Clear selection state when the deck list changes underneath us.
  useEffect(() => {
    if (selectedDeckId && !library.decks.some((d) => d.id === selectedDeckId)) {
      setSelectedDeckId(null);
    }
  }, [library.decks, selectedDeckId]);

  // Parse/render the selected deck for in-page visual preview. Runs once per
  // deck (cached); re-upload after a reload to restore visuals.
  useEffect(() => {
    if (!selectedDeckId) return;
    const deck = libraryRef.current.decks.find((d) => d.id === selectedDeckId);
    if (!deck) return;
    const cached = visuals[deck.id];
    if (cached && (cached.status === "ready" || cached.status === "loading")) return;
    const file = originalFiles.current.get(deck.id);
    if (!file) {
      setVisuals((prev) => (prev[deck.id]?.status === "unavailable" ? prev : { ...prev, [deck.id]: { status: "unavailable" } }));
      return;
    }
    const req = (visualReqs.current.get(deck.id) ?? 0) + 1;
    visualReqs.current.set(deck.id, req);
    const stale = () => visualReqs.current.get(deck.id) !== req;
    setVisuals((prev) => ({ ...prev, [deck.id]: { status: "loading" } }));
    (async () => {
      try {
        if (deck.kind === "pptx") {
          const parsed = await parsePptxDesign(file);
          if (stale()) return;
          setVisuals((prev) => ({ ...prev, [deck.id]: { status: "ready", parsed } }));
        } else {
          const rendered = await renderPdfPages(file);
          if (stale()) return;
          setVisuals((prev) => ({
            ...prev,
            [deck.id]: { status: "ready", pdfImages: rendered.images, pdfWidth: rendered.width, pdfHeight: rendered.height },
          }));
        }
      } catch (e) {
        if (stale()) return;
        setVisuals((prev) => ({
          ...prev,
          [deck.id]: { status: "error", error: e instanceof Error && e.message ? e.message : undefined },
        }));
      }
    })();
  }, [selectedDeckId, library.decks, visuals]);

  const selectedDeck = library.decks.find((d) => d.id === selectedDeckId) ?? null;
  const deckVisual = selectedDeckId ? visuals[selectedDeckId] : undefined;
  const deckWidthPx = deckVisual?.parsed?.width ?? deckVisual?.pdfWidth ?? 1219;
  const deckAspect =
    deckVisual?.parsed != null
      ? deckVisual.parsed.width / deckVisual.parsed.height
      : deckVisual?.pdfWidth && deckVisual?.pdfHeight
        ? deckVisual.pdfWidth / deckVisual.pdfHeight
        : 16 / 9;

  const buildOriginalSlides = useCallback(
    (deckId: string): ViewerSlide[] | null => {
      const deck = library.decks.find((d) => d.id === deckId);
      const visual = visuals[deckId];
      if (!deck || !visual || visual.status !== "ready") return null;
      if (visual.parsed) {
        const theme = visual.parsed.theme;
        return visual.parsed.slides.map((slide, i) => ({
          key: `${deckId}-orig-${i}`,
          label: t("slides.preview.slideLabel", { n: i + 1 }),
          isNew: false,
          background: slide.background ?? theme.background,
          shapes: slide.shapes,
          images: slide.images,
          theme,
        }));
      }
      return (visual.pdfImages ?? []).map((src, i) => ({
        key: `${deckId}-page-${i}`,
        label: t("slides.preview.pageLabel", { n: i + 1 }),
        isNew: false,
        background: "#FFFFFF",
        rasterSrc: src,
        theme: NEUTRAL_THEME,
      }));
    },
    [library.decks, visuals, t],
  );

  const buildAiSlides = useCallback(
    (deckId: string, slides: ExtendedSlide[], startIndex: number): ViewerSlide[] => {
      const visual = visuals[deckId];
      const theme = visual?.parsed?.theme ?? NEUTRAL_THEME;
      const background = theme.background;
      return slides.map((slide, i) => ({
        key: `${deckId}-new-${startIndex + i}`,
        label: t("slides.preview.newLabel", { n: startIndex + i + 1 }),
        isNew: true,
        background,
        shapes: [],
        images: [],
        ai: slide,
        theme,
      }));
    },
    [visuals, t],
  );

  const workbenchSlides: ViewerSlide[] | null = (() => {
    if (!selectedDeck) return null;
    const originals = buildOriginalSlides(selectedDeck.id);
    if (!originals) return null;
    if (previewSlides.length === 0) return originals;
    return [...originals, ...buildAiSlides(selectedDeck.id, previewSlides, 0)];
  })();

  const getExtensionSlides = useCallback(
    (ext: SavedExtension): ViewerSlide[] => {
      const originals = buildOriginalSlides(ext.deckId);
      const ai = buildAiSlides(ext.deckId, ext.slides, 0);
      if (!originals) return ai;
      return [...originals, ...ai];
    },
    [buildOriginalSlides, buildAiSlides],
  );

  const designHintFor = useCallback(
    (deckId: string): string => {
      const visual = visuals[deckId];
      if (visual?.parsed) return visual.parsed.designHint;
      const deck = library.decks.find((d) => d.id === deckId);
      if (deck?.kind === "pdf") {
        const pages = visual?.pdfImages?.length ?? deck.units;
        // PDF text extraction carries no font/color info, so describe what we
        // do know: page count, image-based pages, and content density from the
        // extracted text. The backend uses this like the PPTX context.
        const charsPerPage = deck.units > 0 ? Math.round(deck.chars / deck.units) : 0;
        return [
          `PDF document with ${deck.units} pages (${pages} rendered as full-page images; visually structured)`,
          "original fonts/colors not extracted, use clean light slides (#FFFFFF backgrounds, short titles, parallel bullets)",
          charsPerPage ? `dense pages (~${charsPerPage} chars/page); keep bullets concise and visual-friendly` : null,
          "suggest one visual idea in speaker_notes where a diagram would help",
        ]
          .filter(Boolean)
          .join("; ");
      }
      return "";
    },
    [library.decks, visuals],
  );

  const runExtend = useCallback(async () => {
    const deck = libraryRef.current.decks.find((d) => d.id === selectedDeckId);
    const topic = customTopic.trim() || selectedTopic;
    if (!deck || !topic) return;
    extendCtrl.current?.abort();
    const ctrl = new AbortController();
    extendCtrl.current = ctrl;
    setExtending(true);
    setExtendError(null);
    setExtendProgress({ percent: 2, stage: "waiting", charsReceived: 0 });
    try {
      const slides = await extendSlides(combineDeckTexts([deck]).text, topic, {
        length: extensionLength,
        designHint: designHintFor(deck.id),
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!ctrl.signal.aborted) setExtendProgress(p);
        },
      });
      // Only show slides on the deck they were made for.
      if (ctrl.signal.aborted || selectedDeckRef.current !== deck.id) return;
      setPreviewSlides(slides);
      setPreviewTopic(topic);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setExtendError(errorText(e, "slides.errors.extendFailed"));
    } finally {
      if (!ctrl.signal.aborted) {
        setExtending(false);
        setExtendProgress(null);
      }
    }
  }, [selectedDeckId, customTopic, selectedTopic, extensionLength, designHintFor, errorText]);

  const savePreview = useCallback(() => {
    const deck = libraryRef.current.decks.find((d) => d.id === selectedDeckId);
    if (!deck || previewSlides.length === 0) return;
    const saved: SavedExtension = {
      id: makeId(),
      deckId: deck.id,
      deckName: deck.fileName,
      deckKind: deck.kind,
      topic: previewTopic,
      slides: previewSlides,
      createdAt: Date.now(),
    };
    persist((lib) => ({ ...lib, extensions: [saved, ...lib.extensions] }));
    setNewExtensionIds((prev) => [saved.id, ...prev]);
    setPreviewSlides([]);
    setPreviewTopic("");
  }, [persist, previewSlides, previewTopic, selectedDeckId]);

  const deleteExtension = useCallback(
    (id: string) => {
      persist((lib) => ({ ...lib, extensions: lib.extensions.filter((e) => e.id !== id) }));
      setNewExtensionIds((prev) => prev.filter((x) => x !== id));
    },
    [persist],
  );

  const exportExtension = useCallback(
    async (ext: SavedExtension) => {
      setError(null);
      setExportingId(ext.id);
      try {
        let originalPptxBase64: string | undefined;
        let originalImagesBase64: string[] | undefined;
        const file = originalFiles.current.get(ext.deckId);
        const visual = visuals[ext.deckId];
        // The original file lives only in this page's memory. Without it the export would
        // silently contain just the new slides, so ask for the file instead.
        if (!file && !(ext.deckKind === "pdf" && visual?.pdfImages?.length)) {
          setError(t("slides.errors.reuploadForExport", { name: ext.deckName }));
          return;
        }
        if (ext.deckKind === "pptx" && file) {
          originalPptxBase64 = await fileToBase64(file);
        } else if (ext.deckKind === "pdf") {
          // Reuse the rendered page images (full deck = pages + AI slides).
          if (visual?.pdfImages?.length) {
            originalImagesBase64 = visual.pdfImages;
          } else if (file) {
            originalImagesBase64 = (await renderPdfPages(file)).images;
          }
        }
        const blob = await exportExtensionPptx({
          originalFilename: ext.deckName,
          topic: ext.topic,
          slides: ext.slides,
          originalPptxBase64,
          originalImagesBase64,
          dividerTitle: t("slides.exportDivider.title", { topic: ext.topic }),
          dividerNote: t("slides.exportDivider.note", { count: ext.slides.length, name: ext.deckName }),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `extended-${ext.deckName.replace(/\.[^.]+$/, "") || "slides"}.pptx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        setNewExtensionIds((prev) => prev.filter((x) => x !== ext.id));
      } catch (e) {
        setError(errorText(e, "slides.errors.exportFailed"));
      } finally {
        setExportingId(null);
      }
    },
    [visuals, errorText, t],
  );

  return (
    <SlidesHome
      modelLabel={hermesModel.id ? t("slides.modelDefault") : "Hermes"}
      decks={library.decks}
      selectedDeckId={selectedDeckId}
      onSelectDeck={handleSelectDeck}
      onDeleteDeck={deleteDeck}
      uploading={uploading}
      onUpload={uploadFile}
      error={error}
      topics={topics}
      topicsLoading={topicsLoading}
      topicsProgress={topicsProgress}
      topicsError={topicsError}
      onRetryTopics={retryTopics}
      selectedTopic={selectedTopic}
      onSelectTopic={(title) => {
        setSelectedTopic(title);
        setCustomTopic("");
      }}
      customTopic={customTopic}
      onCustomTopic={setCustomTopic}
      extensionLength={extensionLength}
      onExtensionLength={setExtensionLength}
      extending={extending}
      extendProgress={extendProgress}
      extendError={extendError}
      onExtend={runExtend}
      previewTopic={previewTopic}
      hasPreview={previewSlides.length > 0}
      workbenchSlides={workbenchSlides}
      deckWidthPx={deckWidthPx}
      deckAspect={deckAspect}
      visualStatus={deckVisual?.status ?? "unavailable"}
      visualError={deckVisual?.error ?? null}
      getExtensionSlides={getExtensionSlides}
      onSavePreview={savePreview}
      onDiscardPreview={() => {
        setPreviewSlides([]);
        setPreviewTopic("");
      }}
      extensions={library.extensions}
      newExtensionIds={newExtensionIds}
      onDeleteExtension={deleteExtension}
      exportingId={exportingId}
      onExport={exportExtension}
    />
  );
}
