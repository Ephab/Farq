"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { API_BASE, httpErrorMessage } from "@/lib/waypoint-api"

export type VoiceStatus = "idle" | "recording" | "transcribing"

/** True when the browser can record audio at all. */
export function isVoiceSupported(): boolean {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== "undefined"
}

/** ~3 minutes; the backend also caps uploads at ~10 MB. */
const MAX_RECORD_MS = 180_000

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // isTypeSupported can throw on some mobile browsers; try the next.
    }
  }
  return ""
}

function extensionFor(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase()
  if (base.includes("mp4")) return "m4a"
  if (base.includes("ogg") || base.includes("opus")) return "ogg"
  if (base.includes("wav")) return "wav"
  return "webm"
}

function denialKey(reason: unknown): string {
  if (reason instanceof DOMException && reason.name === "NotAllowedError") return "coach.thread.voice.errors.denied"
  if (reason instanceof DOMException && (reason.name === "NotFoundError" || reason.name === "OverconstrainedError")) {
    return "coach.thread.voice.errors.noMic"
  }
  return "coach.thread.voice.errors.failed"
}

/** Record-then-transcribe dictation: fills the composer, never auto-sends. */
export function useVoiceInput(onTranscribed: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle")
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  // Live level meter for the recording waveform. Null when not recording
  // (or when the browser has no WebAudio); recording works without it.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const callbackRef = useRef(onTranscribed)
  callbackRef.current = onTranscribed

  const setupAnalyser = useCallback((stream: MediaStream) => {
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      // getUserMedia's await can drop the click gesture; resume so levels flow.
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined)
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
    } catch {
      // Visualization unavailable: recording and transcription continue.
    }
  }, [])

  const releaseAudio = useCallback(() => {
    analyserRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => undefined)
  }, [])

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null }
    if (stopTimerRef.current !== null) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null }
  }, [])

  const releaseStream = useCallback(() => {
    releaseAudio()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [releaseAudio])

  useEffect(() => () => {
    clearTimers()
    releaseAudio()
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [clearTimers, releaseAudio])

  const finish = useCallback(async (blob: Blob) => {
    setStatus("transcribing")
    setError(null)
    try {
      const form = new FormData()
      form.append("audio", blob, `voice.${extensionFor(blob.type || "audio/webm")}`)
      const response = await fetch(`${API_BASE}/api/transcribe`, { method: "POST", body: form })
      if (!response.ok) {
        let message = httpErrorMessage(response.status)
        try {
          const payload = await response.json() as { detail?: string }
          if (payload.detail) message = payload.detail
        } catch {
          // Keep the HTTP status when the server did not return JSON.
        }
        throw new Error(message)
      }
      const { text } = await response.json() as { text?: string }
      if (!text?.trim()) throw new Error("coach.thread.voice.errors.empty")
      callbackRef.current(text.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "coach.thread.voice.errors.failed")
    } finally {
      setStatus("idle")
      setSeconds(0)
    }
  }, [])

  const start = useCallback(async () => {
    if (status !== "idle") return
    if (!isVoiceSupported()) {
      setError("coach.thread.voice.errors.unsupported")
      return
    }
    setError(null)
    chunksRef.current = []
    cancelledRef.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (reason) {
      setError(denialKey(reason))
      return
    }
    const mimeType = pickMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setError("coach.thread.voice.errors.unsupported")
      return
    }
    streamRef.current = stream
    recorderRef.current = recorder
    setupAnalyser(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      clearTimers()
      releaseStream()
      if (cancelledRef.current) {
        cancelledRef.current = false
        chunksRef.current = []
        setStatus("idle")
        setSeconds(0)
        return
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" })
      chunksRef.current = []
      if (blob.size === 0) {
        setStatus("idle")
        setSeconds(0)
        setError("coach.thread.voice.errors.empty")
        return
      }
      void finish(blob)
    }
    recorder.start(250)
    setStatus("recording")
    setSeconds(0)
    const startedAt = Date.now()
    timerRef.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500)
    stopTimerRef.current = window.setTimeout(() => {
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop()
    }, MAX_RECORD_MS)
  }, [status, finish, clearTimers, releaseStream, setupAnalyser])

  /** Stop recording and transcribe the clip into the composer. */
  const stop = useCallback(() => {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop()
  }, [])

  /** Discard the recording without transcribing. */
  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop()
    else {
      cancelledRef.current = false
      chunksRef.current = []
      clearTimers()
      releaseStream()
      setStatus("idle")
      setSeconds(0)
    }
  }, [clearTimers, releaseStream])

  return { status, seconds, error, start, stop, cancel, setError, analyserRef }
}
