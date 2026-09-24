import { API_BASE, HERMES_API_KEY_HEADER, HERMES_GEMINI_MODELS, HERMES_HF_MODELS, HERMES_NIM_MODELS, getHermesApiKey } from "./farq-api";

// ─────────────────────────────────────────────────────────────
// quiz-ai.ts — THE swappable AI backbone for SmartLearn quizzes.
//
// Hermes backend: the browser POSTs slide text to the Farq API, which runs
// the quiz prompt on the local Hermes gateway (server-side keys only).
// UI code must only import the types + `generateQuiz` + `getMockQuiz`
// from this file.
//
// Contract:
//   input:  source slide text + options
//   output: QuizQuestion[] (validated, UI-ready)
// ─────────────────────────────────────────────────────────────

export type QuizQuestionType = "mcq" | "true_false" | "short_answer";

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  /** MCQ: 4 options. true_false: ["True","False"]. short_answer: undefined. */
  options?: string[];
  /** MCQ: exact option text. true_false: "True"|"False". short_answer: reference answer. */
  answer: string;
  explanation?: string;
  source?: string;
}

export type QuizDifficulty = "Easy" | "Medium" | "Hard" | "Mixed";

export interface QuizGenerationOptions {
  count: number;
  difficulty: QuizDifficulty;
  types: QuizQuestionType[];
  model?: string;
  /** Optional AbortSignal so the UI can cancel a slow generation. */
  signal?: AbortSignal;
  /** Real progress events while the response streams in. */
  onProgress?: (p: QuizProgress) => void;
}

/** Live stage of a streaming generation. */
export type QuizLiveStage = "waiting" | "receiving" | "validating" | "done";

/** Genuine transfer progress: bytes actually received + questions actually parsed. */
export interface QuizProgress {
  /** 0–100 */
  percent: number;
  stage: QuizLiveStage;
  /** Raw characters received so far (includes reasoning traces). */
  charsReceived: number;
  /** Complete question objects parsed from the content so far. */
  parsedQuestions: number;
  /** Questions requested. */
  totalQuestions: number;
}

/** Quiz models served through the Hermes gateway (allowlisted server-side).
 * Used for display labels only — generation uses the server's Hermes model
 * unless a fallback override is passed per-run. */
export const QUIZ_MODELS = [...HERMES_GEMINI_MODELS, ...HERMES_NIM_MODELS, ...HERMES_HF_MODELS];

/** Max chars of slide text sent for generation — keeps it fast + cheap. */
export const MAX_SOURCE_CHARS = 12_000;

export class QuizAIError extends Error {
  status?: number;
  /** True when retrying later (or with another model) may succeed. */
  retryable?: boolean;
  constructor(message: string, status?: number, retryable?: boolean) {
    super(message);
    this.name = "QuizAIError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** Small, fast model used as the escape hatch when the big models are saturated. */
export const NIM_FALLBACK_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

/** Strip ```json fences etc. then JSON.parse. Throws QuizAIError on failure. */
/** First 200 chars of raw output, for diagnosable error messages. */
function outputSnippet(raw: string): string {
  const oneLine = raw.trim().replace(/\s+/g, " ");
  if (!oneLine) return "(empty response)";
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

function parseQuizJson(raw: string): QuizQuestion[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  if (!cleaned) {
    throw new QuizAIError(
      "Model returned an empty answer — it likely ran out of tokens. Try fewer questions or a smaller deck.",
    );
  }
  // 1) Pristine JSON.
  try {
    const parsed = JSON.parse(cleaned) as { questions?: unknown };
    if (Array.isArray(parsed.questions)) return sanitizeQuestions(parsed.questions);
  } catch {
    // Fall through to salvage strategies.
  }
  // 2) Prose wrapper: isolate the outermost {...} block.
  const block = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (block) {
    try {
      const parsed = JSON.parse(block) as { questions?: unknown };
      if (Array.isArray(parsed.questions)) return sanitizeQuestions(parsed.questions);
    } catch {
      // Fall through: possibly truncated — try brace repair.
    }
    // 3) Truncated output: close open brackets/braces and retry.
    const repaired = repairTruncatedJson(block);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as { questions?: unknown };
        if (Array.isArray(parsed.questions)) {
          const salvaged = sanitizeQuestions(parsed.questions);
          if (salvaged.length > 0) return salvaged;
        }
      } catch {
        // Fall through to per-question salvage.
      }
    }
  }
  // 4) Last resort: parse each complete question object on its own.
  // Question objects contain no nested braces, so flat matching works.
  const singles: unknown[] = [];
  for (const m of cleaned.matchAll(/\{[^{}]*"type"\s*:\s*"(mcq|true_false|short_answer)"[^{}]*\}/g)) {
    try {
      singles.push(JSON.parse(m[0]));
    } catch {
      // Skip the broken one, keep the rest.
    }
  }
  const salvaged = sanitizeQuestions(singles);
  if (salvaged.length > 0) return salvaged;
  throw new QuizAIError(
    `Model returned non-JSON output. Received: ${outputSnippet(raw)}`,
  );
}

/**
 * Close unterminated arrays/objects/strings in truncated model output.
 * Returns null when the text is too broken to repair.
 */
function repairTruncatedJson(block: string): string | null {
  let text = block;
  // Drop a trailing partial string value: ..."key": "partial
  const lastQuote = text.lastIndexOf('"');
  const lastColon = text.lastIndexOf(":");
  const lastBrace = Math.max(text.lastIndexOf("{"), text.lastIndexOf("["));
  if (lastQuote > lastColon && lastQuote > lastBrace) {
    text = text.slice(0, lastQuote);
    // Remove the now-dangling key (..."key":) or comma separator.
    text = text.replace(/,\s*"[^"]*$|"[^"]*:\s*$/, "");
  }
  // Balance brackets outside of strings, closing innermost-first.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if ((ch === "}" || ch === "]") && stack.length > 0) stack.pop();
  }
  if (inString || stack.length === 0 || stack.length > 20) return null;
  let closers = "";
  while (stack.length > 0) {
    const open = stack.pop();
    closers += open === "{" ? "}" : "]";
  }
  return `${text}${closers}`;
}

function sanitizeQuestions(input: unknown[]): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  input.forEach((q, i) => {
    const r = q as Record<string, unknown>;
    const type = r.type as QuizQuestionType;
    const question = String(r.question ?? "").trim();
    const answer = String(r.answer ?? "").trim();
    if (!question || !answer) return;
    if (type === "mcq") {
      const options = Array.isArray(r.options)
        ? (r.options as unknown[]).map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
        : [];
      if (options.length < 2) return;
      if (!options.includes(answer)) options[0] = answer; // keep answer selectable
      out.push({
        id: String(r.id ?? `q${i + 1}`),
        type: "mcq",
        question,
        options,
        answer,
        explanation: String(r.explanation ?? "").trim() || undefined,
        source: String(r.source ?? "").trim() || undefined,
      });
    } else if (type === "true_false") {
      const norm = answer.toLowerCase().startsWith("t") ? "True" : "False";
      out.push({
        id: String(r.id ?? `q${i + 1}`),
        type: "true_false",
        question,
        options: ["True", "False"],
        answer: norm,
        explanation: String(r.explanation ?? "").trim() || undefined,
        source: String(r.source ?? "").trim() || undefined,
      });
    } else if (type === "short_answer") {
      out.push({
        id: String(r.id ?? `q${i + 1}`),
        type: "short_answer",
        question,
        answer,
        explanation: String(r.explanation ?? "").trim() || undefined,
        source: String(r.source ?? "").trim() || undefined,
      });
    }
  });
  // Re-id sequentially so UI keys are stable.
  return out.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

// ── Public API ────────────────────────────────────────────────

function hermesRequestFailed(status: number, detail: string): QuizAIError {
  if (status === 401)
    return new QuizAIError(
      "Hermes rejected the gateway key (401). Press Apply in footer Settings to save this tab's key to the server, or clear it to use the server key.",
      status,
      false,
    );
  if (status === 422) return new QuizAIError(detail || "Invalid quiz request.", status, false);
  if (status === 502 || status === 503 || status === 504)
    return new QuizAIError(
      detail || "Hermes is unavailable or timed out — transient, retry in a bit.",
      status,
      true,
    );
  return new QuizAIError(detail || `Quiz request failed (${status}).`, status);
}

/**
 * Time-based progress for an opaque agent run: the gateway gives no
 * byte stream, so percent ramps with elapsed time (capped), and the
 * stage transitions are the honest signal. Parsed counts only update
 * once the full output validates.
 */
function startRunTicker(options: QuizGenerationOptions): () => void {
  const startedAt = Date.now();
  const emit = (stage: QuizLiveStage) => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const percent =
      stage === "waiting" ? Math.min(8, 2 + elapsed) : Math.min(90, 10 + 80 * (1 - Math.exp(-elapsed / 60)));
    options.onProgress?.({
      percent: Math.round(percent),
      stage,
      charsReceived: 0,
      parsedQuestions: 0,
      totalQuestions: options.count,
    });
  };
  emit("waiting");
  const timer = window.setInterval(() => emit("receiving"), 1000);
  return () => window.clearInterval(timer);
}

/**
 * Generate quiz questions through the Farq backend (Hermes gateway).
 * No provider key needed in the browser: auth is the server gateway key,
 * optionally overridden per-tab from Settings (same as the coach).
 * The model is the server's Hermes model unless `options.model` carries a
 * per-run override (e.g. the Lightning fallback after a transient failure).
 * Progress ticks while the agent run is polled; the shared
 * parse/salvage pipeline then validates the output.
 */
export interface QuizGenerationResult {
  questions: QuizQuestion[];
  /** Model the backend actually used. */
  model: string;
  provider: string;
}

export async function generateQuiz(
  sourceText: string,
  options: QuizGenerationOptions,
): Promise<QuizGenerationResult> {
  if (!sourceText.trim()) throw new QuizAIError("No slide text to generate from.");
  if (options.types.length === 0) throw new QuizAIError("Select at least one question type.");

  const source =
    sourceText.length > MAX_SOURCE_CHARS ? sourceText.slice(0, MAX_SOURCE_CHARS) : sourceText;
  const stopTicker = startRunTicker(options);

  let res: Response;
  try {
    const gatewayKey = getHermesApiKey().trim();
    res = await fetch(`${API_BASE}/api/quiz/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(gatewayKey ? { [HERMES_API_KEY_HEADER]: gatewayKey } : {}),
      },
      body: JSON.stringify({
        source_text: source,
        count: options.count,
        difficulty: options.difficulty,
        types: options.types,
        model: options.model,
      }),
      signal: options.signal,
    });
  } catch (e) {
    stopTicker();
    // User-cancelled — let it propagate so the UI can exit quietly.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const detail = e instanceof Error ? e.message : "network error";
    throw new QuizAIError(
      `Couldn't reach the Farq backend (${detail}). Is the stack running (scripts/firas_run_mac.py)?`,
    );
  }
  if (!res.ok) {
    stopTicker();
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      // Non-JSON error body — fall back to the status mapping.
    }
    throw hermesRequestFailed(res.status, detail);
  }
  let payload: { output?: unknown; model?: unknown; provider?: unknown };
  try {
    payload = (await res.json()) as { output?: unknown; model?: unknown; provider?: unknown };
  } catch {
    stopTicker();
    throw new QuizAIError("Backend returned an unreadable answer. Retry.");
  }
  stopTicker();
  const output = payload.output;
  if (typeof output !== "string" || !output.trim()) {
    throw new QuizAIError("Backend returned an empty answer. Retry.");
  }
  options.onProgress?.({
    percent: 96,
    stage: "validating",
    charsReceived: output.length,
    parsedQuestions: 0,
    totalQuestions: options.count,
  });
  const questions = parseQuizJson(output);
  if (questions.length === 0) throw new QuizAIError("Model returned no valid questions. Retry.");
  options.onProgress?.({
    percent: 100,
    stage: "done",
    charsReceived: output.length,
    parsedQuestions: questions.length,
    totalQuestions: options.count,
  });
  return {
    questions,
    model: typeof payload.model === "string" ? payload.model : "",
    provider: typeof payload.provider === "string" ? payload.provider : "",
  };
}

/** Offline demo set so the UI is testable without a key. */
export function getMockQuiz(): QuizQuestion[] {
  return [
    {
      id: "q1",
      type: "mcq",
      question: "Which practice helps a model generalize to unseen data?",
      options: ["Memorizing the training set", "Regularization + validation split", "Removing all dropout", "Training on test data"],
      answer: "Regularization + validation split",
      explanation: "Regularization constrains the model while a held-out split measures generalization.",
      source: "Demo",
    },
    {
      id: "q2",
      type: "true_false",
      question: "A confusion matrix can reveal class-specific errors that accuracy hides.",
      options: ["True", "False"],
      answer: "True",
      explanation: "Per-class precision/recall expose imbalances that top-line accuracy masks.",
      source: "Demo",
    },
    {
      id: "q3",
      type: "short_answer",
      question: "In one sentence, what does a learning-rate schedule control?",
      answer: "How the optimizer step size changes over training to balance speed and stability.",
      explanation: "Large early steps explore fast; decayed steps settle into minima.",
      source: "Demo",
    },
  ];
}
