/**
 * web/exportCard.ts – Canvas renderer and PNG download for the standings card.
 * Browser-only: uses OffscreenCanvas / HTMLCanvasElement and the DOM.
 * Resolves design-token CSS vars from the page's computed styles (no raw hex).
 * The share token, write token, and server path never appear in the output.
 */
import { buildCard, runsStartX, type CardSize, type CardView, type DrawCommand } from "./viewModel/card";
import { buildGridCard } from "./viewModel/gridCard";
import { gridExportFilename, type GridCardView } from "./viewModel/gridExport";

export type { CardSize };

/** Reads a CSS custom property from the root element's computed style. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Replaces `var(--foo)` references in a string with the live value from the page. */
function resolveToken(value: string): string {
  return value.replace(/var\((--[^)]+)\)/g, (_, prop: string) => cssVar(prop) || "currentColor");
}

/** Renders a list of DrawCommands onto a 2D canvas context. */
function renderCommands(ctx: CanvasRenderingContext2D, commands: DrawCommand[]): void {
  for (const cmd of commands) {
    if (cmd.type === "rect") {
      ctx.fillStyle = resolveToken(cmd.fill);
      if (cmd.radius && cmd.radius > 0) {
        ctx.beginPath();
        ctx.roundRect(cmd.x, cmd.y, cmd.width, cmd.height, cmd.radius);
        ctx.fill();
      } else {
        ctx.fillRect(cmd.x, cmd.y, cmd.width, cmd.height);
      }
    } else if (cmd.type === "text") {
      ctx.textBaseline = cmd.baseline;
      if (cmd.runs && cmd.runs.length > 0) {
        // Pieces with their own color: measure them all, then draw left to right from the aligned start.
        ctx.textAlign = "left";
        const fonts = cmd.runs.map((run) => resolveToken(run.font ?? cmd.font));
        const widths = cmd.runs.map((run, i) => {
          ctx.font = fonts[i]!;
          return ctx.measureText(run.text).width;
        });
        let x = runsStartX(cmd.align, cmd.x, widths.reduce((sum, w) => sum + w, 0));
        cmd.runs.forEach((run, i) => {
          ctx.font = fonts[i]!;
          ctx.fillStyle = resolveToken(run.fill);
          ctx.fillText(run.text, x, cmd.y);
          x += widths[i]!;
        });
      } else {
        ctx.font = resolveToken(cmd.font);
        ctx.fillStyle = resolveToken(cmd.fill);
        ctx.textAlign = cmd.align;
        ctx.fillText(cmd.text, cmd.x, cmd.y);
      }
    } else if (cmd.type === "line") {
      ctx.strokeStyle = resolveToken(cmd.stroke);
      ctx.lineWidth = cmd.lineWidth;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
    }
  }
}

/** Draws the commands on a canvas of this size and downloads it as a PNG with this file name. */
async function downloadPng(commands: DrawCommand[], width: number, height: number, filename: string): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context from canvas.");

  // Wait for fonts to be ready so text renders with the loaded face.
  await document.fonts.ready;

  renderCommands(ctx, commands);

  // Download via a temporary <a> element.
  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas produced no image."));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      requestAnimationFrame(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      });
    }, "image/png");
  });
}

const dimensions = (size: CardSize) => ({ width: size === "wide" ? 1920 : 1080, height: 1080 });

/**
 * Draws the standings card onto an offscreen canvas and downloads it as a PNG.
 *
 * @param view  The card data (assembled by buildCardView).
 * @param size  "square" (1080×1080) or "wide" (1920×1080).
 */
export async function exportCard(view: CardView, size: CardSize): Promise<void> {
  const { width, height } = dimensions(size);
  const tabPrefix = view.tab === "wcc" ? "wcc-" : "";
  const filename = `standings-${tabPrefix}${size}-${view.season}-r${view.asOfRound}.png`;
  await downloadPng(buildCard(view, size), width, height, filename);
}

/** Draws the starting-grid card (Phase 8) and downloads it as a PNG. */
export async function exportGridCard(view: GridCardView, size: CardSize): Promise<void> {
  const { width, height } = dimensions(size);
  const filename = gridExportFilename("png", { season: view.season, round: view.round, size, range: view.range });
  await downloadPng(buildGridCard(view, size), width, height, filename);
}
