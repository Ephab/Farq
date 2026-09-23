"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateQuiz,
  getMockQuiz,
  NIM_FALLBACK_MODEL,
  QUIZ_MODELS,
  QuizAIError,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizQuestionType,
} from "@/lib/quiz-ai";
import { api } from "@/lib/farq-api";
import { extractSource } from "@/lib/quiz-extract";
import {
  combineDeckTexts,
  deckFromSource,
  decksLabel,
  loadLibrary,
  makeId,
  saveLibrary,
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
  return QUIZ_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function QuizView() {  const [phase, setPhase] = useState<Phase>("home");
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
  // The server's Hermes model (single source of truth — no picker).
  const [hermesModel, setHermesModel] = useState({ id: "", label: "Hermes" });

  useEffect(() => {
    let cancelled = false;
    api<{ model?: string; provider?: string }>("/api/health")
      .then((health) => {
        if (cancelled || !health.model) return;
        setHermesModel({ id: health.model, label: modelLabelFor(health.model) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [jobs, setJobs] = useState<GenJob[]>([]);
  const [newQuizIds, setNewQuizIds] = useState<string[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());
  // Mirror of library for async job completions (avoids stale closures
  // when several jobs finish around the same time).
  const libraryRef = useRef(library);

  const persist = useCallback((next: QuizLibrary) => {
    libraryRef.current = next;
    setLibrary(next);
    if (!saveLibrary(next)) {
      setError("Browser storage is full — delete old decks or quizzes to free space.");
    }
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const deck = deckFromSource(await extractSource(file));
        persist({ ...library, decks: [deck, ...library.decks] });
        setSelectedDeckIds((sel) => (sel.includes(deck.id) ? sel : [...sel, deck.id]));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that file.");
      } finally {
        setUploading(false);
      }
    },
    [library, persist],
  );

  const toggleDeck = useCallback((id: string) => {
    setSelectedDeckIds((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedDeckIds([]);
  }, []);

  const deleteDeck = useCallback(
    (id: string) => {
      persist({ ...library, decks: library.decks.filter((d) => d.id !== id) });
      setSelectedDeckIds((sel) => sel.filter((x) => x !== id));
    },
    [library, persist],
  );

  const deleteQuiz = useCallback(
    (id: string) => {
      persist({ ...library, quizzes: library.quizzes.filter((q) => q.id !== id) });
      setNewQuizIds((prev) => prev.filter((x) => x !== id));
    },
    [library, persist],
  );

  const deleteQuizzes = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      persist({ ...library, quizzes: library.quizzes.filter((q) => !gone.has(q.id)) });
      setNewQuizIds((prev) => prev.filter((x) => !gone.has(x)));
    },
    [library, persist],
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
      const decks = libraryRef.current.decks.filter((d) => job.deckIds.includes(d.id));
      if (decks.length === 0) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "failed" as const, error: "Source decks were deleted.", showFallback: false }
              : j,
          ),
        );
        return;
      }
      try {
        const result = await generateQuiz(combineDeckTexts(decks), {
          count: job.count,
          difficulty: job.difficulty,
          types: job.types,
          // Empty = server Hermes model; set only for the Lightning fallback.
          model: job.model || undefined,
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
          model: modelLabelFor(result.model || hermesModel.id),
          createdAt: Date.now(),
        };
        const lib = libraryRef.current;
        persist({ ...lib, quizzes: [saved, ...lib.quizzes] });
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        setNewQuizIds((prev) => [saved.id, ...prev]);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setJobs((prev) => prev.filter((j) => j.id !== job.id));
          return;
        }
        const msg =
          e instanceof QuizAIError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Generation failed. Try again.";
        const showFallback =
          e instanceof QuizAIError && e.retryable === true && job.model !== NIM_FALLBACK_MODEL;
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "failed" as const, error: msg, showFallback }
              : j,
          ),
        );
      } finally {
        abortControllers.current.delete(job.id);
      }
    },
    [persist, hermesModel],
  );

  /** Fire a generation job and return straight to home. Safe to call in parallel. */
  const startGeneration = useCallback(() => {
    const decks = library.decks.filter((d) => selectedDeckIds.includes(d.id));
    if (decks.length === 0) {
      setError("Select at least one deck first.");
      return;
    }
    setError(null);
    const job: GenJob = {
      id: makeId(),
      deckIds: decks.map((d) => d.id),
      label: decksLabel(decks),
      count: shape.count,
      difficulty: shape.difficulty,
      types: [...shape.types],
      // Empty model = the server's Hermes model.
      model: "",
      modelLabel: hermesModel.label,
      status: "generating",
      progress: 3,
      parsed: 0,
      total: shape.count,
      liveStage: "waiting",
      error: null,
      showFallback: false,
      startedAt: Date.now(),
    };
    const ctrl = new AbortController();
    abortControllers.current.set(job.id, ctrl);
    setJobs((prev) => [job, ...prev]);
    setPhase("home");
    void runJob(job, ctrl);
  }, [library, selectedDeckIds, shape, hermesModel, runJob]);

  const retryJob = useCallback(
    (job: GenJob, modelOverride?: string) => {
      const m = modelOverride ?? job.model;
      const ctrl = new AbortController();
      abortControllers.current.set(job.id, ctrl);
      const updated: GenJob = {
        ...job,
        model: m,
        modelLabel: m ? modelLabelFor(m) : job.modelLabel,
        status: "generating",
        progress: 3,
        parsed: 0,
        total: job.count,
        liveStage: "waiting",
        error: null,
        showFallback: false,
        startedAt: Date.now(),
      };
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      void runJob(updated, ctrl);
    },
    [runJob],
  );

  const retryWithFallback = useCallback(
    (job: GenJob) => {
      retryJob(job, NIM_FALLBACK_MODEL);
    },
    [retryJob],
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
    setGenMeta({ sourceName: "Demo questions", model: "Demo", difficulty: "Mixed" });
    setPhase("running");
  }, []);

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
        modelLabel={hermesModel.label}
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
      modelLabel={hermesModel.label}
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
      onFallbackJob={retryWithFallback}
      onDismissJob={dismissJob}
      quizzes={library.quizzes}
      onStartQuiz={startSavedQuiz}
      onDeleteQuiz={deleteQuiz}
      onDeleteQuizzes={deleteQuizzes}
    />
  );
}
