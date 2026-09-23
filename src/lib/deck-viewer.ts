import type { ExtendedSlide } from "./slides-ai";
import type { PptxShape, PptxSlideImage, PptxTheme } from "./pptx-design";

/** One slide in the unified viewer: original (vector/raster) or AI extension. */
export interface ViewerSlide {
  key: string;
  label: string;
  isNew: boolean;
  background: string;
  shapes?: PptxShape[];
  images?: PptxSlideImage[];
  rasterSrc?: string;
  ai?: ExtendedSlide;
  theme: PptxTheme;
}

export const NEUTRAL_THEME: PptxTheme = {
  background: "#FFFFFF",
  titleColor: "#111111",
  bodyColor: "#333333",
  accent: "#2563EB",
  titleFont: "Arial",
  bodyFont: "Arial",
  dark: false,
};
