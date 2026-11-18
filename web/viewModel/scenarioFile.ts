/**
 * Words for exporting and importing scenarios (Phase 10, Step 3, D58). Pure: no DOM, no fetch.
 * The server does the checking; this reads its answer and says it in plain words.
 */

/** The file size limit, as the server enforces it. The page checks it first so a big file is never uploaded. */
export const MAX_IMPORT_BYTES = 1024 * 1024;

const MAX_DETAILS_SHOWN = 8;

export interface ImportSummary {
  imported: number;
  skipped: number;
  skippedItems: { index: number; name: string; reason: string }[];
  renamed: { from: string; to: string }[];
}

export interface ImportReport {
  /** "Imported 3, skipped 2." */
  headline: string;
  /** One line per skipped or renamed scenario (the first few). */
  details: string[];
  tone: "info" | "warn" | "error";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The server's answer to an import, or null when it is not in the expected shape. */
export function parseImportSummary(body: unknown): ImportSummary | null {
  if (!isRecord(body) || typeof body.imported !== "number" || typeof body.skipped !== "number") return null;
  const skippedItems = Array.isArray(body.skippedItems)
    ? body.skippedItems.flatMap((item) =>
        isRecord(item) && typeof item.reason === "string"
          ? [{ index: typeof item.index === "number" ? item.index : 0, name: typeof item.name === "string" ? item.name : "", reason: item.reason }]
          : [],
      )
    : [];
  const renamed = Array.isArray(body.renamed)
    ? body.renamed.flatMap((item) =>
        isRecord(item) && typeof item.from === "string" && typeof item.to === "string" ? [{ from: item.from, to: item.to }] : [],
      )
    : [];
  return { imported: body.imported, skipped: body.skipped, skippedItems, renamed };
}

function skippedLine(item: ImportSummary["skippedItems"][number]): string {
  const who = item.name !== "" ? `"${item.name}"` : item.index > 0 ? `Scenario ${item.index}` : "A scenario";
  return `${who} was skipped. ${item.reason}`;
}

/** "Imported N, skipped M" with the reasons. */
export function describeImport(summary: ImportSummary): ImportReport {
  const { imported, skipped } = summary;
  const headline = `Imported ${imported}, skipped ${skipped}.`;
  const lines = [
    ...summary.skippedItems.map(skippedLine),
    ...summary.renamed.map((r) => `"${r.from}" is already saved, so the new one is called "${r.to}".`),
  ];
  const shown = lines.slice(0, MAX_DETAILS_SHOWN);
  if (lines.length > shown.length) shown.push(`And ${lines.length - shown.length} more.`);
  return { headline, details: shown, tone: skipped > 0 || imported === 0 ? "warn" : "info" };
}

/** A refused file (HTTP 413 or 422 with a message), or any other failure, in plain words. */
export function importErrorMessage(status: number | null, body: unknown): string {
  if (status === null) return "Could not reach the server. Check that it is running.";
  if (status === 413) return "That file is larger than 1 MB. A scenario file is much smaller than that.";
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") return body.message;
  return `The server returned an error (${status}). Try again.`;
}

/** Checked before anything is sent. Null when the file may be read. */
export function importFileProblem(file: { size: number }): string | null {
  return file.size > MAX_IMPORT_BYTES ? importErrorMessage(413, null) : null;
}

/** Why the Export button does nothing, or null. */
export function exportDisabledReason(savedCount: number): string | null {
  return savedCount === 0 ? "No saved scenarios to export yet." : null;
}

/** The text on the Import button's tooltip when writing is not possible, or the usual hint. */
export const IMPORT_HINT =
  "Reads a file made by Export scenarios. Only scenarios of this season are kept, and a name already saved gets a number.";
