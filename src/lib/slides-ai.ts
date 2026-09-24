import { API_BASE, HERMES_API_KEY_HEADER, getHermesApiKey } from "./farq-api";

// ─────────────────────────────────────────────────────────────
// slides-ai.ts — AI backbone for slide extension (mirrors quiz-ai.ts).
//
// Browser POSTs slide text to the Farq API, which runs JSON-only prompts
// on the local Hermes gateway (server-side keys only). Nothing is written
// to SQLite: slide text is not an explicit student statement.
// ─────────────────────────────────────────────────────────────

export interface SuggestedTopic {
  id: string;
  title: string;
  rationale?: string;
  relatedSlides?: string;
  /** "roadmap" = linked to the student's roadmap/profile, "deck" = deck-only. */
  source?: "deck" | "roadmap";
  /** Roadmap node title this topic links to (only when source is roadmap). */
  roadmapNode?: string;
}

export type SlideLayout = "bullets" | "steps" | "two-column" | "stats" | "quote" | "takeaway";

export const SLIDE_LAYOUTS: SlideLayout[] = ["bullets", "steps", "two-column", "stats", "quote", "takeaway"];

export interface SlideColumn {
  heading?: string;
  bullets: string[];
}

export interface SlideStat {
  value: string;
  label: string;
}

export interface ExtendedSlide {
  title: string;
  bullets: string[];
  speakerNotes?: string;
  /** Visual structure from the farq-slides skill; unknown values render as bullets. */
  layout?: SlideLayout;
  kicker?: string;
  columns?: SlideColumn[];
  stats?: SlideStat[];
  /** One concrete visual idea, rendered as a placeholder block in preview. */
  visual?: string;
  quoteCite?: string;
}

export type SlidesLiveStage = "waiting" | "receiving" | "validating" | "done";

export interface SlidesProgress {
  percent: number;
  stage: SlidesLiveStage;
  charsReceived: number;
}

export const MAX_SLIDES_SOURCE_CHARS = 12_000;

export class SlidesAIError extends Error {
  status?: number;
  retryable?: boolean;
  constructor(message: string, status?: number, retryable?: boolean) {
    super(message);
    this.name = "SlidesAIError";
    this.status = status;
    this.retryable = retryable;
  }
}

function outputSnippet(raw: string): string {
  const oneLine = raw.trim().replace(/\s+/g, " ");
  if (!oneLine) return "(empty response)";
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
}

function sanitizeTopics(input: unknown[]): SuggestedTopic[] {
  const out: SuggestedTopic[] = [];
  input.forEach((t, i) => {
    const r = t as Record<string, unknown>;
    const title = String(r.title ?? "").trim();
    if (!title) return;
    const rawSource = String(r.source ?? "").trim().toLowerCase();
    const source: SuggestedTopic["source"] = rawSource === "roadmap" ? "roadmap" : "deck";
    const roadmapNode = String(r.roadmap_node ?? r.roadmapNode ?? "").trim().slice(0, 120) || undefined;
    out.push({
      id: String(r.id ?? `t${i + 1}`),
      title: title.slice(0, 160),
      rationale: String(r.rationale ?? "").trim().slice(0, 300) || undefined,
      relatedSlides: String(r.related_slides ?? r.relatedSlides ?? "").trim().slice(0, 120) || undefined,
      source,
      // Keep the linked node only on roadmap topics so deck topics stay clean.
      ...(source === "roadmap" && roadmapNode ? { roadmapNode } : {}),
    });
  });
  return out.map((t, i) => ({ ...t, id: t.id || `t${i + 1}` })).slice(0, 8);
}

function sanitizeSlides(input: unknown[]): ExtendedSlide[] {
  const out: ExtendedSlide[] = [];
  for (const s of input) {
    const r = s as Record<string, unknown>;
    const title = String(r.title ?? "").trim();
    const bullets = Array.isArray(r.bullets)
      ? (r.bullets as unknown[]).map((b) => String(b).trim()).filter(Boolean).slice(0, 8)
      : [];
    if (!title || bullets.length === 0) continue;
    const notes = String(r.speaker_notes ?? r.speakerNotes ?? "").trim().slice(0, 1000);
    const rawLayout = String(r.layout ?? "bullets").trim().toLowerCase();
    const layout: SlideLayout = (SLIDE_LAYOUTS as string[]).includes(rawLayout) ? (rawLayout as SlideLayout) : "bullets";
    const kicker = String(r.kicker ?? "").trim().slice(0, 60) || undefined;
    const visual = String(r.visual ?? r.visual_idea ?? r.visualIdea ?? "").trim().slice(0, 200) || undefined;
    const quoteCite = String(r.quote_cite ?? r.quoteCite ?? "").trim().slice(0, 120) || undefined;
    let columns: SlideColumn[] | undefined;
    if (Array.isArray(r.columns)) {
      const cols = (r.columns as unknown[])
        .filter((c) => c && typeof c === "object")
        .map((c) => {
          const col = c as Record<string, unknown>;
          return {
            heading: String(col.heading ?? "").trim().slice(0, 120) || undefined,
            bullets: (Array.isArray(col.bullets) ? col.bullets : []).map((b) => String(b).trim()).filter(Boolean).slice(0, 4),
          };
        })
        .filter((c) => c.bullets.length > 0)
        .slice(0, 2);
      if (cols.length > 0) columns = cols;
    }
    let stats: SlideStat[] | undefined;
    if (Array.isArray(r.stats)) {
      const figures = (r.stats as unknown[])
        .filter((st) => st && typeof st === "object")
        .map((st) => {
          const row = st as Record<string, unknown>;
          return {
            value: String(row.value ?? "").trim().slice(0, 60),
            label: String(row.label ?? "").trim().slice(0, 120),
          };
        })
        .filter((st) => st.value && st.label)
        .slice(0, 3);
      if (figures.length > 0) stats = figures;
    }
    out.push({
      title: title.slice(0, 160),
      bullets,
      ...(notes ? { speakerNotes: notes } : {}),
      ...(layout !== "bullets" ? { layout } : {}),
      ...(kicker ? { kicker } : {}),
      ...(columns ? { columns } : {}),
      ...(stats ? { stats } : {}),
      ...(visual ? { visual } : {}),
      ...(quoteCite ? { quoteCite } : {}),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function parseTopicsJson(raw: string): SuggestedTopic[] {
  const cleaned = stripFences(raw);
  if (!cleaned) throw new SlidesAIError("Model returned an empty answer. Try a smaller deck.");
  try {
    const parsed = JSON.parse(cleaned) as { topics?: unknown };
    if (Array.isArray(parsed.topics)) {
      const topics = sanitizeTopics(parsed.topics);
      if (topics.length > 0) return topics;
    }
  } catch {
    // fall through
  }
  const block = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (block) {
    try {
      const parsed = JSON.parse(block) as { topics?: unknown };
      if (Array.isArray(parsed.topics)) {
        const topics = sanitizeTopics(parsed.topics);
        if (topics.length > 0) return topics;
      }
    } catch {
      // fall through
    }
  }
  // Last resort: pick out individual topic objects.
  const singles: unknown[] = [];
  for (const m of cleaned.matchAll(/\{[^{}]*"title"\s*:\s*"[^"]+"[^{}]*\}/g)) {
    try {
      singles.push(JSON.parse(m[0]));
    } catch {
      // skip
    }
  }
  const salvaged = sanitizeTopics(singles);
  if (salvaged.length > 0) return salvaged;
  throw new SlidesAIError(`Model returned non-JSON output. Received: ${outputSnippet(raw)}`);
}

function parseSlidesJson(raw: string): ExtendedSlide[] {
  const cleaned = stripFences(raw);
  if (!cleaned) throw new SlidesAIError("Model returned an empty answer. Try again.");
  try {
    const parsed = JSON.parse(cleaned) as { slides?: unknown };
    if (Array.isArray(parsed.slides)) {
      const slides = sanitizeSlides(parsed.slides);
      if (slides.length > 0) return slides;
    }
  } catch {
    // fall through
  }
  const block = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (block) {
    try {
      const parsed = JSON.parse(block) as { slides?: unknown };
      if (Array.isArray(parsed.slides)) {
        const slides = sanitizeSlides(parsed.slides);
        if (slides.length > 0) return slides;
      }
    } catch {
      // fall through
    }
  }
  const singles: unknown[] = [];
  for (const m of cleaned.matchAll(/\{[^{}]*"bullets"\s*:[^{}]*\}/g)) {
    try {
      singles.push(JSON.parse(m[0]));
    } catch {
      // skip
    }
  }
  const salvaged = sanitizeSlides(singles);
  if (salvaged.length > 0) return salvaged;
  throw new SlidesAIError(`Model returned non-JSON output. Received: ${outputSnippet(raw)}`);
}

function requestFailed(status: number, detail: string, what: string): SlidesAIError {
  if (status === 401)
    return new SlidesAIError(
      "Hermes rejected the gateway key (401). Press Apply in footer Settings to save this tab's key to the server, or clear it to use the server key.",
      status,
      false,
    );
  if (status === 422) return new SlidesAIError(detail || `Invalid ${what} request.`, status, false);
  if (status === 502 || status === 503 || status === 504)
    return new SlidesAIError(detail || "Hermes is unavailable or timed out. Transient, retry in a bit.", status, true);
  return new SlidesAIError(detail || `${what} request failed (${status}).`, status);
}

function startTicker(total: number, onProgress?: (p: SlidesProgress) => void): () => void {
  const startedAt = Date.now();
  void total;
  const emit = (stage: SlidesLiveStage) => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const percent =
      stage === "waiting" ? Math.min(8, 2 + elapsed) : Math.min(90, 10 + 80 * (1 - Math.exp(-elapsed / 60)));
    onProgress?.({ percent: Math.round(percent), stage, charsReceived: 0 });
  };
  emit("waiting");
  const timer = window.setInterval(() => emit("receiving"), 1000);
  return () => window.clearInterval(timer);
}

async function postSlides(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ output: string; model: string; provider: string }> {
  let res: Response;
  try {
    const gatewayKey = getHermesApiKey().trim();
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(gatewayKey ? { [HERMES_API_KEY_HEADER]: gatewayKey } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const detail = e instanceof Error ? e.message : "network error";
    throw new SlidesAIError(`Couldn't reach the Farq backend (${detail}). Is the stack running?`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      // non-JSON error
    }
    throw requestFailed(res.status, detail, path.includes("suggest") ? "suggestion" : "extension");
  }
  let payload: { output?: unknown; model?: unknown; provider?: unknown };
  try {
    payload = (await res.json()) as { output?: unknown; model?: unknown; provider?: unknown };
  } catch {
    throw new SlidesAIError("Backend returned an unreadable answer. Retry.");
  }
  const output = payload.output;
  if (typeof output !== "string" || !output.trim()) throw new SlidesAIError("Backend returned an empty answer. Retry.");
  return {
    output,
    model: typeof payload.model === "string" ? payload.model : "",
    provider: typeof payload.provider === "string" ? payload.provider : "",
  };
}

export interface SuggestOptions {
  count?: number;
  /** Current student id — enables roadmap-aware suggestions server-side. */
  studentId?: string;
  signal?: AbortSignal;
  onProgress?: (p: SlidesProgress) => void;
}

export async function suggestTopics(sourceText: string, options: SuggestOptions = {}): Promise<SuggestedTopic[]> {
  if (!sourceText.trim()) throw new SlidesAIError("No slide text to suggest from.");
  const source = sourceText.length > MAX_SLIDES_SOURCE_CHARS ? sourceText.slice(0, MAX_SLIDES_SOURCE_CHARS) : sourceText;
  const stop = startTicker(options.count ?? 5, options.onProgress);
  try {
    const studentId = options.studentId?.trim();
    const { output } = await postSlides(
      "/api/slides/suggest",
      { source_text: source, count: options.count ?? 5, ...(studentId ? { student_id: studentId } : {}) },
      options.signal,
    );
    options.onProgress?.({ percent: 96, stage: "validating", charsReceived: output.length });
    const topics = parseTopicsJson(output);
    options.onProgress?.({ percent: 100, stage: "done", charsReceived: output.length });
    return topics;
  } finally {
    stop();
  }
}

export type SlidesLength = "short" | "medium" | "long";

export interface ExtendOptions {
  length?: SlidesLength;
  /** Rich design summary from the original deck (fonts, colors, layout, visuals). */
  designHint?: string;
  signal?: AbortSignal;
  onProgress?: (p: SlidesProgress) => void;
}

export async function extendSlides(
  sourceText: string,
  topic: string,
  options: ExtendOptions = {},
): Promise<ExtendedSlide[]> {
  if (!sourceText.trim()) throw new SlidesAIError("No slide text to extend from.");
  if (!topic.trim()) throw new SlidesAIError("Pick or type a topic first.");
  const length: SlidesLength = options.length ?? "medium";
  const source = sourceText.length > MAX_SLIDES_SOURCE_CHARS ? sourceText.slice(0, MAX_SLIDES_SOURCE_CHARS) : sourceText;
  const stop = startTicker(5, options.onProgress);
  try {
    const { output } = await postSlides(
      "/api/slides/extend",
      {
        source_text: source,
        topic: topic.trim().slice(0, 300),
        length,
        design_hint: (options.designHint ?? "").slice(0, 2000),
      },
      options.signal,
    );
    options.onProgress?.({ percent: 96, stage: "validating", charsReceived: output.length });
    const slides = parseSlidesJson(output);
    options.onProgress?.({ percent: 100, stage: "done", charsReceived: output.length });
    return slides;
  } finally {
    stop();
  }
}

/** Download one .pptx: original slides first, AI slides appended. */
export async function exportExtensionPptx(args: {
  originalFilename: string;
  topic: string;
  slides: ExtendedSlide[];
  originalPptxBase64?: string;
  /** Rendered original pages (PNG data URLs) for PDF decks. */
  originalImagesBase64?: string[];
  signal?: AbortSignal;
}): Promise<Blob> {
  const gatewayKey = getHermesApiKey().trim();
  void gatewayKey;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/slides/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_filename: args.originalFilename,
        topic: args.topic,
        slides: args.slides.map((s) => ({
          title: s.title,
          bullets: s.bullets,
          speaker_notes: s.speakerNotes ?? "",
          layout: s.layout ?? "bullets",
          kicker: s.kicker ?? "",
          columns: (s.columns ?? []).map((c) => ({ heading: c.heading ?? "", bullets: c.bullets })),
          stats: s.stats ?? [],
          visual: s.visual ?? "",
          quote_cite: s.quoteCite ?? "",
        })),
        ...(args.originalPptxBase64 ? { original_pptx_base64: args.originalPptxBase64 } : {}),
        ...(args.originalImagesBase64?.length ? { original_images_base64: args.originalImagesBase64 } : {}),
      }),
      signal: args.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new SlidesAIError("Couldn't reach the Farq backend for export.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      // binary error unlikely
    }
    throw new SlidesAIError(detail || `Export failed (${res.status}).`, res.status);
  }
  return await res.blob();
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Couldn't read “${file.name}” for export.`));
    reader.readAsDataURL(file);
  });
}
