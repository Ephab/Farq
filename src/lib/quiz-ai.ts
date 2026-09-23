// ─────────────────────────────────────────────────────────────
// quiz-ai.ts — THE swappable AI backbone for SmartLearn quizzes.
//
// Prototype implementation: NVIDIA NIM (hosted, OpenAI-compatible).
// Future: replace `generateQuiz` body with the Hermes agent call.
// UI code must only import the types + `generateQuiz` + `getMockQuiz`
// from this file, so the swap is a one-file change.
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

/**
 * NVIDIA NIM sends no CORS headers, so browsers block direct calls
 * (Safari surfaces this as TypeError "Load failed").
 * Under `npm run dev`, vite.config.ts proxies /api/nim → NIM.
 */
const NIM_PROXY_PATH = "/api/nim/v1/chat/completions";
const NIM_DIRECT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export const NIM_MODELS = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B (recommended)" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Llama Nemotron Ultra 253B" },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B (fast)" },
] as const;

export const DEFAULT_NIM_MODEL = NIM_MODELS[0].id;

/** Max chars of slide text sent to NIM — keeps prototype fast + cheap. */
export const MAX_SOURCE_CHARS = 12_000;

interface NimChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

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

function typeList(types: QuizQuestionType[]): string {
  const names: Record<QuizQuestionType, string> = {
    mcq: "multiple-choice (4 options, exactly 1 correct)",
    true_false: "true/false",
    short_answer: "short-answer (1-2 sentence reference answer)",
  };
  return types.map((t) => names[t]).join(", ");
}

function buildMessages(sourceText: string, opts: QuizGenerationOptions) {
  const source =
    sourceText.length > MAX_SOURCE_CHARS
      ? sourceText.slice(0, MAX_SOURCE_CHARS)
      : sourceText;

  const system = [
    "You generate study quizzes from lecture slides.",
    "Return ONLY a JSON object: {\"questions\": [...]}. No markdown, no prose.",
    "Each question: {\"id\":\"q1\",\"type\":\"mcq|true_false|short_answer\",\"question\":\"...\",\"options\":[...],\"answer\":\"...\",\"explanation\":\"one sentence\",\"source\":\"Slide N or Page N\"}.",
    "Rules: mcq has exactly 4 distinct options with answer matching one option verbatim.",
    "true_false answer is exactly \"True\" or \"False\".",
    "short_answer has no options field and a concise reference answer.",
    "Explanations reference the slide content. No trick questions beyond the material.",
  ].join(" ");

  const user = [
    `Generate ${opts.count} questions. Difficulty: ${opts.difficulty}.`,
    `Question types to mix: ${typeList(opts.types)}.`,
    "Distribute types evenly across the set.",
    "",
    "--- SLIDE TEXT START ---",
    source,
    "--- SLIDE TEXT END ---",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

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

function requestFailed(status: number): QuizAIError {
  if (status === 401)
    return new QuizAIError(
      "Invalid NIM API key (401). Grab a fresh nvapi- key from build.nvidia.com.",
      status,
      false,
    );
  if (status === 403)
    return new QuizAIError(
      "Key rejected (403). Your NVIDIA account needs “Public API Endpoints” enabled for this model.",
      status,
      false,
    );
  if (status === 404)
    return new QuizAIError(
      "Model not found (404). Pick another model from the list.",
      status,
      false,
    );
  if (status === 429)
    return new QuizAIError(
      "Rate limited (429). NVIDIA is throttling this key right now — wait a minute, or switch to the Lightning model.",
      status,
      true,
    );
  if (status === 503)
    return new QuizAIError(
      "Model overloaded (503). NVIDIA's servers are saturated for this model — it's transient, not your key or files. Wait a bit, or switch to the Lightning model.",
      status,
      true,
    );
  if (status === 502 || status === 504)
    return new QuizAIError(
      `NVIDIA gateway hiccup (${status}). Transient — retry in a few seconds.`,
      status,
      true,
    );
  return new QuizAIError(`NIM request failed (${status}).`, status);
}

/** Abort-aware sleep for retry backoff. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function postQuiz(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // User-cancelled — let it propagate so the UI can exit quietly.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // Browsers hide the real cause (CORS looks identical to offline).
    // Safari reports this as TypeError "Load failed".
    const detail = e instanceof Error ? e.message : "network error";
    throw new QuizAIError(
      `Couldn't reach NVIDIA (${detail}). If you're opening a built file directly, run “npm run dev” instead so the /api/nim proxy is active — and check VPN / ad-blocker.`,
    );
  }
  return res;
}

/** Rough expected output size: max_tokens ≈ 4 chars each. */
const EXPECTED_CHARS = 12000;

/** Count complete question objects in streamed content via their "type" field. */
function countParsedQuestions(content: string): number {
  const matches = content.match(/"type"\s*:\s*"(mcq|true_false|short_answer)"/g);
  return matches ? matches.length : 0;
}

/**
 * Read an SSE chat-completion stream, accumulating content while emitting
 * genuine progress: bytes received + questions parsed so far.
 * Reasoning traces count toward activity (charsReceived) but never toward
 * parsed questions, so the count stays honest.
 */
async function readStream(
  res: Response,
  opts: { signal?: AbortSignal; totalQuestions: number; onProgress?: (p: QuizProgress) => void },
): Promise<string> {
  const startedAt = Date.now();
  const total = Math.max(1, opts.totalQuestions);
  const emit = (chars: number, parsed: number, stage: QuizLiveStage) => {
    const tokenFrac = Math.min(1, chars / EXPECTED_CHARS);
    const questionFrac = Math.min(1, parsed / total);
    const percent =
      stage === "done"
        ? 100
        : stage === "validating"
          ? 96
          : stage === "waiting"
            ? Math.min(10, 3 + (Date.now() - startedAt) / 3000)
            : Math.min(92, 12 + 80 * Math.max(tokenFrac * 0.9, questionFrac));
    opts.onProgress?.({
      percent: Math.round(percent),
      stage,
      charsReceived: chars,
      parsedQuestions: Math.min(parsed, opts.totalQuestions),
      totalQuestions: opts.totalQuestions,
    });
  };

  emit(0, 0, "waiting");

  // No streaming body (old browser) — fall back to one-shot read.
  if (!res.body) {
    const text = await res.text();
    const data = JSON.parse(text) as NimChatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    emit(content.length, countParsedQuestions(content), "receiving");
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let activityChars = 0;
  let gotFirstByte = false;
  // Nudge the waiting stage while TTFT stretches out.
  const waitTimer = window.setInterval(() => {
    if (!gotFirstByte) emit(activityChars, 0, "waiting");
  }, 1000);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      gotFirstByte = true;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as NimChatResponse & {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string; reasoning?: string };
                message?: { content?: string };
              }>;
            };
            const delta = json.choices?.[0]?.delta;
            const text =
              delta?.content ??
              delta?.reasoning_content ??
              delta?.reasoning ??
              json.choices?.[0]?.message?.content ??
              "";
            if (!text) continue;
            activityChars += text.length;
            // Only real answer content counts toward parsed questions.
            if (delta?.content ?? json.choices?.[0]?.message?.content) {
              content += delta?.content ?? json.choices?.[0]?.message?.content ?? "";
            }
          } catch {
            // Partial JSON split across chunks — more bytes will complete it.
          }
        }
      }
      emit(activityChars, countParsedQuestions(content), "receiving");
    }
  } finally {
    window.clearInterval(waitTimer);
    try {
      reader.releaseLock();
    } catch {
      // Stream already closed — nothing to release.
    }
  }

  emit(activityChars, countParsedQuestions(content), "receiving");
  return content;
}

/**
 * Generate quiz questions via NVIDIA NIM.
 * Hermes migration: keep this signature, replace the fetch body
 * with the Hermes agent invocation.
 */
export async function generateQuiz(
  sourceText: string,
  options: QuizGenerationOptions,
  apiKey: string,
): Promise<QuizQuestion[]> {
  const key = apiKey.trim();
  if (!key) throw new QuizAIError("Missing NVIDIA NIM API key.");
  if (!sourceText.trim()) throw new QuizAIError("No slide text to generate from.");
  if (options.types.length === 0) throw new QuizAIError("Select at least one question type.");

  const body = {
    model: options.model || DEFAULT_NIM_MODEL,
    messages: buildMessages(sourceText, options),
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    stream: true,
  };

  // Proxy first (vite dev), direct as fallback. Real NIM errors stop
  // immediately (after retries for transient ones); network-level
  // failures — including mid-stream drops — fall through to the next endpoint.
  // Transient statuses (429/502/503/504) are retried with backoff.
  const backoffMs = [2000, 5000];
  let text: string | null = null;
  let lastNetworkError: QuizAIError | null = null;
  const streamOpts = {
    signal: options.signal,
    totalQuestions: options.count,
    onProgress: options.onProgress,
  };
  for (const url of [NIM_PROXY_PATH, NIM_DIRECT_URL]) {
    let attempts = 0;
    for (;;) {
      let res: Response;
      try {
        res = await postQuiz(url, body, key, options.signal);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        lastNetworkError = e as QuizAIError;
        break; // try next endpoint
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
        break; // SPA fallback, not NIM
      }
      if (!res.ok) {
        const err = requestFailed(res.status);
        if (err.retryable && attempts < backoffMs.length) {
          attempts += 1;
          await sleep(backoffMs[attempts - 1], options.signal); // throws if cancelled
          continue;
        }
        throw err;
      }
      try {
        text = await readStream(res, streamOpts);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        lastNetworkError = new QuizAIError("Connection dropped mid-stream. Retrying…", undefined, true);
        if (attempts < backoffMs.length) {
          attempts += 1;
          await sleep(backoffMs[attempts - 1], options.signal);
          continue;
        }
        break; // try next endpoint
      }
      break;
    }
    if (text !== null) break;
  }
  if (text === null) {
    throw (
      lastNetworkError ??
      new QuizAIError("NIM unreachable from this page. Run “npm run dev” and retry.")
    );
  }
  options.onProgress?.({
    percent: 96,
    stage: "validating",
    charsReceived: text.length,
    parsedQuestions: countParsedQuestions(text),
    totalQuestions: options.count,
  });
  const questions = parseQuizJson(text);
  if (questions.length === 0) throw new QuizAIError("Model returned no valid questions. Retry.");
  options.onProgress?.({
    percent: 100,
    stage: "done",
    charsReceived: text.length,
    parsedQuestions: questions.length,
    totalQuestions: options.count,
  });
  return questions;
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
