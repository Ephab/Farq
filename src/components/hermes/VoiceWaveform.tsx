"use client"

import { useEffect, useRef, type RefObject } from "react"

/** Bars in the level meter; the voice band lives in the lower bins. */
const BARS = 24
const SKELETON_BARS = 16

interface VoiceWaveformProps {
  /** Live mic levels while recording. */
  analyserRef?: RefObject<AnalyserNode | null>
  mode: "live" | "processing"
}

/** Live level meter while recording; indeterminate shimmer while transcribing. */
export function VoiceWaveform({ analyserRef, mode }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (mode !== "live") return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    // Resolve the theme color once so bars match light/dark mode.
    const color = getComputedStyle(canvas).getPropertyValue("--fq-danger").trim() || "#bf3f53"
    const data = new Uint8Array(128)
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const analyser = analyserRef?.current
      const width = canvas.width
      const height = canvas.height
      ctx.clearRect(0, 0, width, height)
      let values: number[]
      if (analyser) {
        analyser.getByteFrequencyData(data)
        // Skip the DC bin; sample the lower half where speech energy sits.
        values = Array.from(
          { length: BARS },
          (_, index) => (data[1 + Math.floor((index * data.length) / BARS / 2)] ?? 0) / 255,
        )
      } else {
        // Flat baseline when WebAudio is unavailable; recording still works.
        values = Array(BARS).fill(0.08)
      }
      const gap = 3
      const barWidth = (width - gap * (BARS - 1)) / BARS
      ctx.fillStyle = color
      values.forEach((value, index) => {
        const barHeight = Math.max(3, value * height)
        const x = index * (barWidth + gap)
        const y = (height - barHeight) / 2
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
          ctx.fill()
        } else {
          ctx.fillRect(x, y, barWidth, barHeight)
        }
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, analyserRef])

  if (mode === "processing") {
    return (
      <span className="voice-skeleton" aria-hidden="true">
        {Array.from({ length: SKELETON_BARS }, (_, index) => (
          <span key={index} style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </span>
    )
  }
  return <canvas ref={canvasRef} width={144} height={36} className="voice-wave" aria-hidden="true" />
}
