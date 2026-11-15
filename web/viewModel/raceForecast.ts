/**
 * The race forecast as the page shows it (Phase 8, Step 5): rows sorted by the chance to win, with the grid place,
 * the chances of the win, the podium and the points, and the expected finish. Pure: it only words what the model
 * returned. Every chance goes through `formatProbability`, so nothing reads "0%" or "100%".
 */
import { formatProbability, gridSourceKind, teamCars, type SeasonState } from "../../engine";
import type { ForecastData, ForecastState } from "./forecastRequests";

/** The note under the table, word for word. */
export const FORECAST_NOTE = "The forecast follows the grid above. Retirements and weather are not known.";

export interface ForecastColumn {
  key: "grid" | "win" | "podium" | "points" | "finish";
  /** The short heading. */
  label: string;
  /** The full words, for a screen reader and a tooltip. */
  title: string;
}

export const FORECAST_COLUMNS: readonly ForecastColumn[] = [
  { key: "grid", label: "Grid", title: "Starting place" },
  { key: "win", label: "Win", title: "Chance to win the race" },
  { key: "podium", label: "Podium", title: "Chance to finish in the top three" },
  { key: "points", label: "Points", title: "Chance to finish in the points (the top ten)" },
  { key: "finish", label: "Exp. finish", title: "Expected finishing place (a retirement counts as last)" },
];

export interface ForecastRow {
  code: string;
  /** For the team color strip; "" when the driver has no team yet. */
  teamId: string;
  grid: string;
  win: string;
  podium: string;
  points: string;
  finish: string;
}

export interface RaceForecastView {
  /** "Model estimate · as of Round 16 · Grid: OpenF1" */
  header: string;
  rows: ForecastRow[];
  note: string;
}

/** The words for where the grid came from: the same sources as the grid tag, short. */
export function forecastGridWord(source: string | null): string {
  if (source === null) return "none";
  if (source === "manual") return "manual";
  return gridSourceKind(source) === "openf1" ? "OpenF1" : "qualifying";
}

/** The expected finish as a plain number with one decimal: "3.4". */
export function formatExpectedFinish(mean: number): string {
  return mean.toFixed(1);
}

/** The view of one forecast. `state` is only used for the team colors. */
export function buildRaceForecastView(data: ForecastData, state: SeasonState): RaceForecastView {
  const teamOf = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teamOf.set(code, team);
  const size = data.field.length;
  // A driver the grid does not have starts last, which is also what the model assumed.
  const placeOf = (code: string) => data.grid?.[code] ?? size;

  const ordered = [...data.field].sort(
    (a, b) => data.win[b]! - data.win[a]! || data.podium[b]! - data.podium[a]! || placeOf(a) - placeOf(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const rows = ordered.map((code): ForecastRow => ({
    code,
    teamId: teamOf.get(code) ?? "",
    grid: String(placeOf(code)),
    win: formatProbability(data.win[code]!),
    podium: formatProbability(data.podium[code]!),
    points: formatProbability(data.top10[code]!),
    finish: formatExpectedFinish(data.meanPosition[code]!),
  }));

  return {
    header: `Model estimate · as of Round ${data.asOfRound} · Grid: ${forecastGridWord(data.gridSource)}`,
    rows,
    note: FORECAST_NOTE,
  };
}

export type ForecastDisplay =
  /** Nothing to show yet and nothing running (no grid, or the tab is not open). */
  | { kind: "none" }
  /** The first calculation is running. */
  | { kind: "calculating" }
  /** The calculation failed and there is nothing older to show. */
  | { kind: "failed"; message: string }
  /** A forecast to show; `updating` is true while a newer one is being calculated, `failed` when the newer one failed. */
  | { kind: "ready"; view: RaceForecastView; updating: boolean; failed: string | null };

/**
 * What the forecast section shows. `pending` is true while the grid itself is being saved or switched, so the numbers
 * on screen are known to be about to change.
 */
export function forecastDisplay(forecast: ForecastState, state: SeasonState, pending = false): ForecastDisplay {
  if (forecast.forecast) {
    return {
      kind: "ready",
      view: buildRaceForecastView(forecast.forecast, state),
      updating: forecast.status === "calculating" || pending,
      failed: forecast.status === "error" ? forecast.error ?? "The forecast could not be calculated." : null,
    };
  }
  if (forecast.status === "calculating") return { kind: "calculating" };
  if (forecast.status === "error") return { kind: "failed", message: forecast.error ?? "The forecast could not be calculated." };
  return { kind: "none" };
}
