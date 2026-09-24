"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ExtendedSlide } from "@/lib/slides-ai";
import type {
  PptxParagraph,
  PptxShape,
  PptxSlideImage,
  PptxTheme,
} from "@/lib/pptx-design";
import type { ViewerSlide } from "@/lib/deck-viewer";
import { cn } from "@/lib/utils";

/** pt size → cqw so text scales with the slide frame at any size. */
function cqw(pt: number, deckWidthPx: number): number {
  return ((pt * 96) / 72 / deckWidthPx) * 100;
}

function Runs({ para, deckWidthPx, baseColor }: { para: PptxParagraph; deckWidthPx: number; baseColor: string }) {
  const firstText = para.runs.map((r) => r.text).join("").trimStart();
  const showBullet = para.bullet && !firstText.startsWith(para.bullet);
  return (
    <span>
      {showBullet ? <span>{para.bullet} </span> : null}
      {para.runs.map((run, i) => {
        const parts = run.text.split("\n");
        return (
          <span key={i}>
            {parts.map((part, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                <span
                  style={{
                    fontSize: `${cqw(run.sizePt, deckWidthPx)}cqw`,
                    fontWeight: run.bold ? 700 : 400,
                    fontStyle: run.italic ? "italic" : "normal",
                    color: run.color || baseColor,
                  }}
                >
                  {part}
                </span>
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function VectorShapes({
  shapes,
  images,
  deckWidthPx,
  titleFont,
  bodyFont,
}: {
  shapes: PptxShape[];
  images: PptxSlideImage[];
  deckWidthPx: number;
  titleFont: string;
  bodyFont: string;
}) {
  return (
    <>
      {images.map((img, i) => (
        <img
          key={`img-${i}`}
          src={img.src}
          alt=""
          draggable={false}
          className="absolute select-none"
          style={{ left: `${img.x * 100}%`, top: `${img.y * 100}%`, width: `${img.w * 100}%`, height: `${img.h * 100}%`, objectFit: "fill" }}
        />
      ))}
      {shapes.map((shape, i) => (
        <div
          key={`sh-${i}`}
          className="absolute overflow-hidden"
          style={{
            left: `${shape.x * 100}%`,
            top: `${shape.y * 100}%`,
            width: `${shape.w * 100}%`,
            height: `${shape.h * 100}%`,
            background: shape.fill ?? "transparent",
            fontFamily: shape.isTitle ? titleFont : bodyFont,
          }}
        >
          {shape.paragraphs.map((para, j) => {
            const first = para.runs.find((r) => r.text.trim());
            const color = first?.color ?? (shape.isTitle ? undefined : undefined);
            return (
              <div
                key={j}
                style={{
                  textAlign: para.align,
                  marginLeft: para.level > 0 ? `${para.level * 4}%` : undefined,
                  fontFamily: "inherit",
                  lineHeight: 1.25,
                }}
              >
                <Runs para={para} deckWidthPx={deckWidthPx} baseColor={color ?? "inherit"} />
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function AiKicker({ text, theme, deckWidthPx }: { text: string; theme: PptxTheme; deckWidthPx: number }) {
  return (
    <div
      style={{
        fontFamily: theme.bodyFont,
        fontWeight: 700,
        color: theme.accent,
        fontSize: `${cqw(11, deckWidthPx)}cqw`,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: "1%",
      }}
    >
      {text}
    </div>
  );
}

function AiVisual({ idea, theme, deckWidthPx }: { idea: string; theme: PptxTheme; deckWidthPx: number }) {
  return (
    <div
      className="absolute"
      style={{ left: "7%", bottom: "4%", width: "86%", border: `1px dashed ${theme.accent}`, borderRadius: 6, padding: "1.2% 2%" }}
    >
      <span
        style={{
          fontFamily: theme.bodyFont,
          fontWeight: 700,
          color: theme.accent,
          fontSize: `${cqw(10, deckWidthPx)}cqw`,
          letterSpacing: "0.12em",
          marginRight: "0.8em",
        }}
      >
        VISUAL
      </span>
      <span style={{ fontFamily: theme.bodyFont, color: theme.bodyColor, fontSize: `${cqw(12, deckWidthPx)}cqw`, lineHeight: 1.35 }}>
        {idea}
      </span>
    </div>
  );
}

function AiBullets({ bullets, theme, deckWidthPx }: { bullets: string[]; theme: PptxTheme; deckWidthPx: number }) {
  return (
    <>
      {bullets.map((bullet, i) => (
        <div
          key={i}
          style={{
            fontFamily: theme.bodyFont,
            color: theme.bodyColor,
            fontSize: `${cqw(18, deckWidthPx)}cqw`,
            lineHeight: 1.4,
            marginBottom: "1.2%",
            display: "flex",
            gap: "0.6em",
          }}
        >
          <span style={{ color: theme.accent, flexShrink: 0 }}>•</span>
          <span>{bullet}</span>
        </div>
      ))}
    </>
  );
}

function AiContent({ slide, theme, deckWidthPx }: { slide: ExtendedSlide; theme: PptxTheme; deckWidthPx: number }) {
  const layout = slide.layout ?? "bullets";
  const hasVisual = !!slide.visual?.trim();
  const bodyBottom = hasVisual ? "22%" : "6%";

  if (layout === "takeaway") {
    return (
      <>
        <div className="absolute" style={{ left: "10%", top: "20%", width: "80%", textAlign: "center" }}>
          {slide.kicker?.trim() ? <AiKicker text={slide.kicker} theme={theme} deckWidthPx={deckWidthPx} /> : null}
          <div
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 700,
              color: theme.titleColor,
              fontSize: `${cqw(36, deckWidthPx)}cqw`,
              lineHeight: 1.15,
            }}
          >
            {slide.title}
          </div>
          <div style={{ background: theme.accent, height: 3, width: "12%", margin: "2.5% auto 0", borderRadius: 2 }} />
          {slide.bullets[0] ? (
            <div
              style={{
                fontFamily: theme.bodyFont,
                color: theme.bodyColor,
                fontSize: `${cqw(18, deckWidthPx)}cqw`,
                lineHeight: 1.45,
                marginTop: "2.5%",
              }}
            >
              {slide.bullets[0]}
            </div>
          ) : null}
        </div>
        {hasVisual ? <AiVisual idea={slide.visual!} theme={theme} deckWidthPx={deckWidthPx} /> : null}
      </>
    );
  }

  if (layout === "quote") {
    return (
      <>
        <div className="absolute" style={{ left: "10%", top: "16%", width: "80%" }}>
          {slide.kicker?.trim() ? <AiKicker text={slide.kicker} theme={theme} deckWidthPx={deckWidthPx} /> : null}
          <div
            style={{
              fontFamily: theme.titleFont,
              fontStyle: "italic",
              fontWeight: 700,
              color: theme.titleColor,
              fontSize: `${cqw(26, deckWidthPx)}cqw`,
              lineHeight: 1.3,
            }}
          >
            &ldquo;{slide.bullets[0]}&rdquo;
          </div>
          {slide.quoteCite?.trim() ? (
            <div
              style={{
                fontFamily: theme.bodyFont,
                color: theme.bodyColor,
                fontSize: `${cqw(15, deckWidthPx)}cqw`,
                marginTop: "2%",
              }}
            >
              &mdash; {slide.quoteCite}
            </div>
          ) : null}
        </div>
        {hasVisual ? <AiVisual idea={slide.visual!} theme={theme} deckWidthPx={deckWidthPx} /> : null}
      </>
    );
  }

  if (layout === "stats") {
    const figures = slide.stats?.length ? slide.stats : null;
    return (
      <>
        <div className="absolute" style={{ left: "7%", top: "6%", width: "86%" }}>
          {slide.kicker?.trim() ? <AiKicker text={slide.kicker} theme={theme} deckWidthPx={deckWidthPx} /> : null}
          <div
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 700,
              color: theme.titleColor,
              fontSize: `${cqw(30, deckWidthPx)}cqw`,
              lineHeight: 1.15,
            }}
          >
            {slide.title}
          </div>
          <div style={{ background: theme.accent, height: 3, width: "12%", marginTop: "1.5%", borderRadius: 2 }} />
        </div>
        <div className="absolute" style={{ left: "7%", top: "34%", width: "86%", display: "flex", gap: "4%" }}>
          {figures ? (
            figures.map((stat, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: theme.titleFont,
                    fontWeight: 700,
                    color: theme.accent,
                    fontSize: `${cqw(34, deckWidthPx)}cqw`,
                    lineHeight: 1.1,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontFamily: theme.bodyFont,
                    color: theme.bodyColor,
                    fontSize: `${cqw(14, deckWidthPx)}cqw`,
                    lineHeight: 1.4,
                    marginTop: "1%",
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))
          ) : (
            <AiBullets bullets={slide.bullets} theme={theme} deckWidthPx={deckWidthPx} />
          )}
        </div>
        {hasVisual ? <AiVisual idea={slide.visual!} theme={theme} deckWidthPx={deckWidthPx} /> : null}
      </>
    );
  }

  if (layout === "two-column") {
    const cols = slide.columns?.length === 2
      ? slide.columns
      : [
          { heading: undefined, bullets: slide.bullets.filter((_, i) => i % 2 === 0) },
          { heading: undefined, bullets: slide.bullets.filter((_, i) => i % 2 === 1) },
        ];
    return (
      <>
        <div className="absolute" style={{ left: "7%", top: "6%", width: "86%" }}>
          {slide.kicker?.trim() ? <AiKicker text={slide.kicker} theme={theme} deckWidthPx={deckWidthPx} /> : null}
          <div
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 700,
              color: theme.titleColor,
              fontSize: `${cqw(30, deckWidthPx)}cqw`,
              lineHeight: 1.15,
            }}
          >
            {slide.title}
          </div>
          <div style={{ background: theme.accent, height: 3, width: "12%", marginTop: "1.5%", borderRadius: 2 }} />
        </div>
        <div className="absolute" style={{ left: "7%", top: "34%", width: "86%", display: "flex", gap: "6%" }}>
          {cols.map((col, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              {col.heading ? (
                <div
                  style={{
                    fontFamily: theme.titleFont,
                    fontWeight: 700,
                    color: theme.titleColor,
                    fontSize: `${cqw(17, deckWidthPx)}cqw`,
                    lineHeight: 1.3,
                    marginBottom: "2%",
                  }}
                >
                  {col.heading}
                </div>
              ) : null}
              {col.bullets.map((bullet, j) => (
                <div
                  key={j}
                  style={{
                    fontFamily: theme.bodyFont,
                    color: theme.bodyColor,
                    fontSize: `${cqw(16, deckWidthPx)}cqw`,
                    lineHeight: 1.4,
                    marginBottom: "2%",
                    display: "flex",
                    gap: "0.6em",
                  }}
                >
                  <span style={{ color: theme.accent, flexShrink: 0 }}>•</span>
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {hasVisual ? <AiVisual idea={slide.visual!} theme={theme} deckWidthPx={deckWidthPx} /> : null}
      </>
    );
  }

  // bullets + steps share the header; steps render numbered.
  return (
    <>
      <div className="absolute" style={{ left: "7%", top: "6%", width: "86%" }}>
        {slide.kicker?.trim() ? <AiKicker text={slide.kicker} theme={theme} deckWidthPx={deckWidthPx} /> : null}
        <div
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 700,
            color: theme.titleColor,
            fontSize: `${cqw(32, deckWidthPx)}cqw`,
            lineHeight: 1.15,
          }}
        >
          {slide.title}
        </div>
        <div style={{ background: theme.accent, height: 3, width: "12%", marginTop: "1.5%", borderRadius: 2 }} />
      </div>
      <div className="absolute" style={{ left: "7%", top: slide.kicker?.trim() ? "34%" : "30%", width: "86%", bottom: bodyBottom, overflow: "hidden" }}>
        {layout === "steps" ? (
          slide.bullets.map((bullet, i) => (
            <div
              key={i}
              style={{
                fontFamily: theme.bodyFont,
                color: theme.bodyColor,
                fontSize: `${cqw(18, deckWidthPx)}cqw`,
                lineHeight: 1.4,
                marginBottom: "1.6%",
                display: "flex",
                gap: "0.7em",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontFamily: theme.titleFont,
                  fontWeight: 700,
                  color: theme.accent,
                  fontSize: `${cqw(20, deckWidthPx)}cqw`,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{bullet}</span>
            </div>
          ))
        ) : (
          <AiBullets bullets={slide.bullets} theme={theme} deckWidthPx={deckWidthPx} />
        )}
      </div>
      {hasVisual ? <AiVisual idea={slide.visual!} theme={theme} deckWidthPx={deckWidthPx} /> : null}
    </>
  );
}

function SlideFrame({
  slide,
  deckWidthPx,
  titleFont,
  bodyFont,
}: {
  slide: ViewerSlide;
  deckWidthPx: number;
  titleFont: string;
  bodyFont: string;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: slide.background,
        containerType: "inline-size",
        fontFamily: bodyFont,
      }}
    >
      {slide.rasterSrc ? (
        <img src={slide.rasterSrc} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" style={{ objectFit: "fill" }} />
      ) : (
        <VectorShapes
          shapes={slide.shapes ?? []}
          images={slide.images ?? []}
          deckWidthPx={deckWidthPx}
          titleFont={titleFont}
          bodyFont={bodyFont}
        />
      )}
      {slide.ai ? <AiContent slide={slide.ai} theme={slide.theme} deckWidthPx={deckWidthPx} /> : null}
    </div>
  );
}

interface DeckPreviewProps {
  slides: ViewerSlide[];
  /** Deck width in px at 96dpi (for font scaling). Defaults to 16:9. */
  deckWidthPx?: number;
  /** Width / height ratio of the deck. Defaults to 16:9. */
  aspect?: number;
  initialIndex?: number;
}

export function DeckPreview({ slides, deckWidthPx = 1219, aspect = 16 / 9, initialIndex = 0 }: DeckPreviewProps) {
  const [index, setIndex] = useState(initialIndex);
  const stripRef = useRef<HTMLDivElement>(null);

  const total = slides.length;
  const current = slides[Math.min(index, total - 1)] ?? null;

  const go = useCallback(
    (next: number) => {
      if (total === 0) return;
      setIndex((next + total) % total);
    },
    [total],
  );

  useEffect(() => {
    setIndex(Math.min(initialIndex, Math.max(0, total - 1)));
  }, [total, initialIndex]);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  if (!current) {
    return <p className="text-sm text-muted-foreground">No slides to preview.</p>;
  }

  const dividerAt = slides.findIndex((s) => s.isNew);

  return (
    <div className="w-full min-w-0">
      {/* Shape lock: viewer rounded-2xl, thumbs rounded-lg, arrows/badges rounded-full */}
      <div className="relative overflow-hidden rounded-2xl border border-border shadow-sm" style={{ aspectRatio: `${aspect}` }}>
        <SlideFrame slide={current} deckWidthPx={deckWidthPx} titleFont={current.theme.titleFont} bodyFont={current.theme.bodyFont} />
        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous slide"
              className="absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white outline-none backdrop-blur transition-transform hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next slide"
              className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white outline-none backdrop-blur transition-transform hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </>
        ) : null}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {current.isNew ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">AI</span>
          ) : null}
          <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {index + 1} / {total}
          </span>
        </div>
      </div>

      {total > 1 ? (
        <div ref={stripRef} className="mt-3 flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Slide thumbnails">
          {slides.map((slide, i) => (
            <div key={slide.key} className="flex shrink-0 items-stretch gap-2">
              {i === dividerAt && dividerAt > 0 ? (
                <div className="flex w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 px-1 text-center text-[10px] font-bold leading-tight text-primary">
                  AI extension
                </div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                data-thumb={i}
                aria-label={`Show ${slide.label}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "relative w-28 shrink-0 overflow-hidden rounded-lg border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  i === index ? "border-primary" : "border-border hover:border-muted-foreground/50",
                )}
                style={{ aspectRatio: `${aspect}`, background: slide.background }}
              >
                <SlideFrame slide={slide} deckWidthPx={deckWidthPx} titleFont={slide.theme.titleFont} bodyFont={slide.theme.bodyFont} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
