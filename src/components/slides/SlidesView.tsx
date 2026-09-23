"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/farq-api";
import { extractSource } from "@/lib/quiz-extract";
import {
  combineDeckTexts,
  deckFromSource,
  loadLibrary,
  makeId,
  saveLibrary,
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
  const [library, setLibrary] = useState<QuizLibrary>(loadLibrary);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hermesModel, setHermesModel] = useState({ id: "", label: "Hermes" });

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
  const visualReq = useRef(0);

  const libraryRef = useRef(library);
  // Original files kept in memory only (never localStorage).
  const originalFiles = useRef(new Map<string, File>());
  const suggestCtrl = useRef<AbortController | null>(null);
  const extendCtrl = useRef<AbortController | null>(null);

  const persist = useCallback((next: QuizLibrary) => {
    libraryRef.current = next;
    setLibrary(next);
    if (!saveLibrary(next)) {
      setError("Browser storage is full — delete old decks or extensions to free space.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ model?: string }>("/api/health")
      .then((health) => {
        if (cancelled || !health.model) return;
        setHermesModel({ id: health.model, label: health.model });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const deck = deckFromSource(await extractSource(file));
        originalFiles.current.set(deck.id, file);
        persist({ ...libraryRef.current, decks: [deck, ...libraryRef.current.decks] });
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
        setError(e instanceof Error ? e.message : "Could not read that file.");
      } finally {
        setUploading(false);
      }
    },
    [persist],
  );

  /** Selecting a deck immediately shows the analyzing state (no empty flash). */
  const handleSelectDeck = useCallback((id: string) => {
    setSelectedDeckId((prev) => {
      if (prev !== id) {
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
  }, []);

  const deleteDeck = useCallback(
    (id: string) => {
      originalFiles.current.delete(id);
      persist({
        ...libraryRef.current,
        decks: libraryRef.current.decks.filter((d) => d.id !== id),
        extensions: libraryRef.current.extensions.filter((e) => e.deckId !== id),
      });
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
    suggestTopics(combineDeckTexts([deck]), {
      count: 5,
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
        setTopicsError(
          e instanceof SlidesAIError ? e.message : e instanceof Error ? e.message : "Suggestion failed.",
        );
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setTopicsLoading(false);
          setTopicsProgress(null);
        }
      });
    return () => ctrl.abort();
  }, [selectedDeckId]);

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
    const req = ++visualReq.current;
    setVisuals((prev) => ({ ...prev, [deck.id]: { status: "loading" } }));
    (async () => {
      try {
        if (deck.kind === "pptx") {
          const parsed = await parsePptxDesign(file);
          if (visualReq.current !== req) return;
          setVisuals((prev) => ({ ...prev, [deck.id]: { status: "ready", parsed } }));
        } else {
          const rendered = await renderPdfPages(file);
          if (visualReq.current !== req) return;
          setVisuals((prev) => ({
            ...prev,
            [deck.id]: { status: "ready", pdfImages: rendered.images, pdfWidth: rendered.width, pdfHeight: rendered.height },
          }));
        }
      } catch (e) {
        if (visualReq.current !== req) return;
        setVisuals((prev) => ({
          ...prev,
          [deck.id]: { status: "error", error: e instanceof Error ? e.message : "Could not preview these slides." },
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
          label: `Slide ${i + 1}`,
          isNew: false,
          background: slide.background ?? theme.background,
          shapes: slide.shapes,
          images: slide.images,
          theme,
        }));
      }
      return (visual.pdfImages ?? []).map((src, i) => ({
        key: `${deckId}-page-${i}`,
        label: `Page ${i + 1}`,
        isNew: false,
        background: "#FFFFFF",
        rasterSrc: src,
        theme: NEUTRAL_THEME,
      }));
    },
    [library.decks, visuals],
  );

  const buildAiSlides = useCallback(
    (deckId: string, slides: ExtendedSlide[], startIndex: number): ViewerSlide[] => {
      const visual = visuals[deckId];
      const theme = visual?.parsed?.theme ?? NEUTRAL_THEME;
      const background = theme.background;
      return slides.map((slide, i) => ({
        key: `${deckId}-new-${startIndex + i}`,
        label: `New ${startIndex + i + 1}`,
        isNew: true,
        background,
        shapes: [],
        images: [],
        ai: slide,
        theme,
      }));
    },
    [visuals],
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
      if (deck?.kind === "pdf") return `PDF document with ${deck.units} pages; use clean light slides with short titles`;
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
      const slides = await extendSlides(combineDeckTexts([deck]), topic, {
        length: extensionLength,
        designHint: designHintFor(deck.id),
        signal: ctrl.signal,
        onProgress: (p) => {
          if (!ctrl.signal.aborted) setExtendProgress(p);
        },
      });
      if (ctrl.signal.aborted) return;
      setPreviewSlides(slides);
      setPreviewTopic(topic);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setExtendError(e instanceof SlidesAIError ? e.message : e instanceof Error ? e.message : "Extension failed.");
    } finally {
      if (!ctrl.signal.aborted) {
        setExtending(false);
        setExtendProgress(null);
      }
    }
  }, [selectedDeckId, customTopic, selectedTopic, extensionLength, designHintFor]);

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
    persist({ ...libraryRef.current, extensions: [saved, ...libraryRef.current.extensions] });
    setNewExtensionIds((prev) => [saved.id, ...prev]);
    setPreviewSlides([]);
    setPreviewTopic("");
  }, [persist, previewSlides, previewTopic, selectedDeckId]);

  const deleteExtension = useCallback(
    (id: string) => {
      persist({ ...libraryRef.current, extensions: libraryRef.current.extensions.filter((e) => e.id !== id) });
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
        if (ext.deckKind === "pptx" && file) {
          originalPptxBase64 = await fileToBase64(file);
        } else if (ext.deckKind === "pdf") {
          // Reuse the rendered page images (full deck = pages + AI slides).
          const visual = visuals[ext.deckId];
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
        setError(e instanceof SlidesAIError ? e.message : e instanceof Error ? e.message : "Export failed.");
      } finally {
        setExportingId(null);
      }
    },
    [visuals],
  );

  return (
    <SlidesHome
      modelLabel={hermesModel.label}
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
