"use client";

// Quizzes shape scale (documented rule, Section 4.4 lock):
// controls rounded-xl (12px), cards rounded-2xl (16px),
// expanded question/review rounded-3xl (24px), status pills
// rounded-full, checkboxes rounded-md/lg. No other radii here.

import { useCallback, useRef, useState } from "react";
import {
  generateQuiz,
  getMockQuiz,
  MAX_SOURCE_CHARS,
  QuizAIError,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizQuestionType,
} from "@/lib/quiz-ai";
import { currentModel, modelLabel, useModelCatalog } from "@/lib/models";
import { extractSource, QuizExtractError } from "@/lib/quiz-extract";
import { useI18n, type MessageKey } from "@/lib/i18n/context";
import {
  combineDeckTexts,
  deckFromSource,
  decksLabel,
  loadLibrary,
  makeId,
  updateLibrary,
  type QuizLibrary,
  type SavedQuiz,
} from "@/lib/quiz-store";
import { QuizConfigure, type QuizShape } from "./QuizConfigure";
import { QuizHome } from "./QuizHome";
import type { GenJob } from "./QuizJobList";
import { QuizResults } from "./QuizResults";
import { QuizRunner, type QuizAnswer } from "./QuizRunner";

type Phase = "home" | "generate" | "running" | "finished";

function modelLabelFor(id: string): string {
  return modelLabel(id);
}

type Translate = ReturnType<typeof useI18n>["t"];

/** UI text for a quiz error: coded lib errors are translated; server detail stays verbatim. */
function errorText(e: unknown, t: Translate, fallback: MessageKey): string {
  if (e instanceof QuizExtractError) return t(`quiz.errors.extract.${e.code}` as MessageKey, e.params);
  if (e instanceof QuizAIError) return e.code ? t(`quiz.errors.ai.${e.code}` as MessageKey, e.params) : e.message;
  if (e instanceof Error) return e.message;
  return t(fallback);
}

export function QuizView() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("home");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<QuizLibrary>(loadLibrary);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [shape, setShape] = useState<QuizShape>({
    count: 10,
    difficulty: "Mixed" as QuizDifficulty,
    types: ["mcq", "true_false", "short_answer"] as QuizQuestionType[],
  });
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [genMeta, setGenMeta] = useState({ sourceName: "", model: "", difficulty: "" });
  // The model every Hermes feature runs (Settings > Models & API keys).
  const tabModel = useModelCatalog().catalog?.selected.model ?? "";
  const [jobs, setJobs] = useState<GenJob[]>([]);
  const [newQuizIds, setNewQuizIds] = useState<string[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());
  // Every write starts from what is in storage now (see updateLibrary): Slides shares this
  // library, and a quiz job may finish after this tab was left and reopened.
  const persist = useCallback((change: (lib: QuizLibrary) => QuizLibrary) => {
    const { library: next, saved } = updateLibrary(change);
    setLibrary(next);
    if (!saved) setError(t("quiz.errors.storageFull"));
  }, [t]);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const deck = deckFromSource(await extractSource(file));
        persist((lib) => ({ ...lib, decks: [deck, ...lib.decks] }));
        setSelectedDeckIds((sel) => (sel.includes(deck.id) ? sel : [...sel, deck.id]));
      } catch (e) {
        setError(errorText(e, t, "quiz.errors.readFailed"));
      } finally {
        setUploading(false);
      }
    },
    [persist, t],
  );

  const toggleDeck = useCallback((id: string) => {
    setSelectedDeckIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedDeckIds([]);
  }, []);

  const deleteDeck = useCallback(
    (id: string) => {
      persist((lib) => ({ ...lib, decks: lib.decks.filter((d) => d.id !== id) }));
      setSelectedDeckIds((sel) => sel.filter((x) => x !== id));
    },
    [persist],
  );

  const deleteQuiz = useCallback(
    (id: string) => {
      persist((lib) => ({ ...lib, quizzes: lib.quizzes.filter((q) => q.id !== id) }));
      setNewQuizIds((prev) => prev.filter((x) => x !== id));
    },
    [persist],
  );

  const deleteQuizzes = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      persist((lib) => ({ ...lib, quizzes: lib.quizzes.filter((q) => !gone.has(q.id)) }));
      setNewQuizIds((prev) => prev.filter((x) => !gone.has(x)));
    },
    [persist],
  );

  const openGenerate = useCallback(() => {
    setError(null);
    setPhase("generate");
  }, []);

  // Job tubes are driven by agent-run progress (see generateQuiz's
  // poll ticker) — stages are honest, percent ramps with elapsed time.
  // Elapsed time updates with each event.

  const runJob = useCallback(
    async (job: GenJob, ctrl: AbortController) => {
      const decks = loadLibrary().decks.filter((d) => job.deckIds.includes(d.id));
      if (decks.length === 0) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "failed" as const, error: t("quiz.errors.decksDeleted") }
              : j,
          ),
        );
        return;
      }
      try {
        // Same budget the server applies, shared fairly so every selected deck is covered.
        const result = await generateQuiz(combineDeckTexts(decks, MAX_SOURCE_CHARS).text, {
          count: job.count,
          difficulty: job.difficulty,
          types: job.types,
          signal: ctrl.signal,
          onProgress: (p) => {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id && j.status === "generating"
                  ? {
                      ...j,
                      progress: p.percent,
                      parsed: p.parsedQuestions,
                      total: p.totalQuestions,
                      liveStage: p.stage,
                    }
                  : j,
              ),
            );
          },
        });
        const saved: SavedQuiz = {
          id: makeId(),
          deckIds: job.deckIds,
          deckName: job.label,
          questions: result.questions,
          difficulty: job.difficulty,
          model: modelLabelFor(result.model || job.model),
          createdAt: Date.now(),
        };
        persist((lib) => ({ ...lib, quizzes: [saved, ...lib.quizzes] }));
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        setNewQuizIds((prev) => [saved.id, ...prev]);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setJobs((prev) => prev.filter((j) => j.id !== job.id));
          return;
        }
        const msg = errorText(e, t, "quiz.errors.generationFailed");
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "failed" as const, error: msg }
              : j,
          ),
        );
      } finally {
        abortControllers.current.delete(job.id);
      }
    },
    [persist, t],
  );

  /** Fire a generation job and return straight to home. Safe to call in parallel. */
  const startGeneration = useCallback(() => {
    const decks = library.decks.filter((d) => selectedDeckIds.includes(d.id));
    if (decks.length === 0) {
      setError(t("quiz.errors.selectDeck"));
      return;
    }
    setError(null);
    const job: GenJob = {
      id: makeId(),
      deckIds: decks.map((d) => d.id),
      label: decksLabel(decks, t),
      count: shape.count,
      difficulty: shape.difficulty,
      types: [...shape.types],
      model: currentModel()?.model ?? "",
      modelLabel: modelLabelFor(currentModel()?.model ?? ""),
      status: "generating",
      progress: 3,
      parsed: 0,
      total: shape.count,
      liveStage: "waiting",
      error: null,
      startedAt: Date.now(),
    };
    const ctrl = new AbortController();
    abortControllers.current.set(job.id, ctrl);
    setJobs((prev) => [job, ...prev]);
    setPhase("home");
    void runJob(job, ctrl);
  }, [library, selectedDeckIds, shape, runJob, t]);

  const retryJob = useCallback(
    (job: GenJob) => {
      const ctrl = new AbortController();
      abortControllers.current.set(job.id, ctrl);
      const updated: GenJob = {
        ...job,
        status: "generating",
        progress: 3,
        parsed: 0,
        total: job.count,
        liveStage: "waiting",
        error: null,
        startedAt: Date.now(),
      };
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      void runJob(updated, ctrl);
    },
    [runJob],
  );

  const cancelJob = useCallback((id: string) => {
    abortControllers.current.get(id)?.abort();
  }, []);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const runDemo = useCallback(() => {
    setError(null);
    setQuestions(getMockQuiz());
    setAnswers({});
    setGenMeta({ sourceName: t("quiz.demoSource"), model: t("quiz.demoModel"), difficulty: "Mixed" });
    setPhase("running");
  }, [t]);

  const startSavedQuiz = useCallback((quiz: SavedQuiz) => {
    setError(null);
    setQuestions(quiz.questions);
    setAnswers({});
    setGenMeta({ sourceName: quiz.deckName, model: quiz.model, difficulty: quiz.difficulty });
    setNewQuizIds((prev) => prev.filter((x) => x !== quiz.id));
    setPhase("running");
  }, []);

  const handleAnswer = useCallback((qid: string, a: QuizAnswer) => {
    setAnswers((prev) => ({ ...prev, [qid]: a }));
  }, []);

  const generateDecks =
    phase === "generate"
      ? library.decks.filter((d) => selectedDeckIds.includes(d.id))
      : [];

  if (phase === "generate" && generateDecks.length > 0) {
    return (
      <QuizConfigure
        decks={generateDecks}
        shape={shape}
        onShape={setShape}
        modelLabel={modelLabelFor(tabModel)}
        error={error}
        onGenerate={startGeneration}
        onBack={() => {
          setError(null);
          setPhase("home");
        }}
      />
    );
  }

  if (phase === "running" && questions.length > 0) {
    return (
      <QuizRunner
        questions={questions}
        answers={answers}
        onAnswer={handleAnswer}
        onFinish={() => setPhase("finished")}
        onQuit={() => setPhase("home")}
        sourceName={genMeta.sourceName}
      />
    );
  }

  if (phase === "finished" && questions.length > 0) {
    return (
      <QuizResults
        questions={questions}
        answers={answers}
        sourceName={genMeta.sourceName}
        onRetry={() => {
          setAnswers({});
          setPhase("running");
        }}
        onHome={() => {
          setQuestions([]);
          setAnswers({});
          setPhase("home");
        }}
      />
    );
  }

  return (
    <QuizHome
      modelLabel={modelLabelFor(tabModel)}
      decks={library.decks}
      selectedDeckIds={selectedDeckIds}
      onToggleDeck={toggleDeck}
      onClearSelection={clearSelection}
      onDeleteDeck={deleteDeck}
      uploading={uploading}
      onUpload={uploadFile}
      onGenerate={openGenerate}
      onDemo={runDemo}
      error={error}
      jobs={jobs}
      newQuizIds={newQuizIds}
      onCancelJob={cancelJob}
      onRetryJob={(job) => retryJob(job)}
      onDismissJob={dismissJob}
      quizzes={library.quizzes}
      onStartQuiz={startSavedQuiz}
      onDeleteQuiz={deleteQuiz}
      onDeleteQuizzes={deleteQuizzes}
    />
  );
}
