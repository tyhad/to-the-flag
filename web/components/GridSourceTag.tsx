import { gridTag, type GridSource } from "../viewModel/grid";
import { AlertIcon } from "./icons";

/**
 * Which grid the numbers use: "Grid: manual", "Grid: OpenF1" or "Grid: qualifying (may differ from the real grid)".
 * A qualifying grid is drawn in the yellow timing color with an icon, and always with the words (never color alone).
 */
export function GridSourceTag({ source }: { source: GridSource }) {
  const tag = gridTag(source);
  const warn = tag.tone === "warn";
  return (
    <span
      className={`type-label rounded-control inline-flex min-h-6 items-center gap-1 border px-2 py-0.5 ${
        warn ? "border-yellow text-yellow" : "border-line text-text-2"
      }`}
    >
      {warn ? <AlertIcon className="shrink-0" /> : null}
      {tag.text}
    </span>
  );
}
