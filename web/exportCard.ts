/**
 * web/exportCard.ts – Canvas renderer and PNG download for the standings card.
 * Browser-only: uses OffscreenCanvas / HTMLCanvasElement and the DOM.
 * Resolves design-token CSS vars from the page's computed styles (no raw hex).
 * The share token, write token, and server path never appear in the output.
 */
import { buildCard, type CardSize, type CardView, type DrawCommand } from "./viewModel/card";

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
      ctx.font = resolveToken(cmd.font);
      ctx.fillStyle = resolveToken(cmd.fill);
      ctx.textAlign = cmd.align;
      ctx.textBaseline = cmd.baseline;
      ctx.fillText(cmd.text, cmd.x, cmd.y);
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

/**
 * Draws the standings card onto an offscreen canvas and downloads it as a PNG.
 *
 * @param view  The card data (assembled by buildCardView).
 * @param size  "square" (1080×1080) or "wide" (1920×1080).
 */
export async function exportCard(view: CardView, size: CardSize): Promise<void> {
  const isWide = size === "wide";
  const width = isWide ? 1920 : 1080;
  const height = 1080;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context from canvas.");

  // Wait for fonts to be ready so text renders with the loaded face.
  await document.fonts.ready;

  const commands = buildCard(view, size);
  renderCommands(ctx, commands);

  const filename = `standings-${size}-${view.season}-r${view.asOfRound}.png`;

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
