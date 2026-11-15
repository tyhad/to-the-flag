/**
 * Building blocks of the race weekend feeds (Phase 8, Step 6):
 *
 *   GET /api/feed/grid            the effective starting grid of the next race
 *   GET /api/feed/race-forecast   the model's forecast for that race, from that grid
 *
 * Pure: plain `SeasonState` and model output in, payload out. Nothing here knows about HTTP, and the numbers come
 * from the same functions the web app uses, so the overlay and the page agree.
 */
import type { GridSourceKind } from "../engine/grid";
import { formatProbability } from "../engine/odds";
import type { RaceForecast } from "../engine/simulate";
import { teamCars } from "../engine/teams";
import type { SeasonState } from "../engine/types";

/** One row of GET /api/feed/grid. Snake_case keys, as the other feeds use. */
export interface FeedGridRow {
  /** starting place, 1-based; pit-lane starters come after everyone else */
  position: number;
  driver: string;
  name: string;
  team: string;
  /** true for a pit-lane start (only a manual grid knows which drivers those are) */
  pit: boolean;
  source: GridSourceKind;
}

/** One row of GET /api/feed/race-forecast, best chance to win first. */
export interface FeedForecastRow {
  rank: number;
  driver: string;
  name: string;
  team: string;
  /** the starting place the model used */
  grid: number;
  win_display: string;
  podium_display: string;
  points_display: string;
  /** the average finishing place (a retirement counts as last), two decimals */
  mean_position: number;
  source: GridSourceKind;
}

export type FlatFields = Record<string, string | number | boolean>;

export interface GridFeedFields {
  updated_at: string;
  as_of_round: number;
  data_status: string;
  season: number;
  available: true;
  /** the round of the race this grid is for */
  round: number;
  source: GridSourceKind;
  rows: FeedGridRow[];
}

export interface ForecastFeedFields {
  updated_at: string;
  as_of_round: number;
  data_status: string;
  season: number;
  available: true;
  model: "estimate";
  label: "Model estimate";
  /** the round of the race this forecast is for */
  round: number;
  /** where the grid came from */
  source: GridSourceKind;
  n_sims: number;
  rows: FeedForecastRow[];
}

/** The fixed fields, plus the flattened p1_* / top1_* ones. */
export type GridFeedPayload = GridFeedFields & Record<string, unknown>;
export type ForecastFeedPayload = ForecastFeedFields & Record<string, unknown>;

/** The standard fields of every feed response. The `available: false` answer uses these too. */
export function feedMeta(state: SeasonState) {
  return {
    updated_at: state.health.checkedAt,
    as_of_round: state.asOfRound,
    data_status: state.health.status,
    season: state.season,
  };
}

/** Driver code -> name, and driver code -> constructor id (the latest team, via `teamCars`). */
function identities(state: SeasonState): { names: Map<string, string>; teams: Map<string, string> } {
  const names = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teams = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teams.set(code, team);
  return { names, teams };
}

/**
 * The effective grid as rows, pole first. The order is everyone on the grid, then the pit-lane starters, in the order
 * given: positions 1..N, exactly as the app shows them.
 */
export function buildGridRows(
  state: SeasonState,
  effective: { order: readonly string[]; pit: readonly string[]; source: GridSourceKind },
): FeedGridRow[] {
  const { names, teams } = identities(state);
  const row = (code: string, position: number, pit: boolean): FeedGridRow => ({
    position,
    driver: code,
    name: names.get(code) ?? code,
    team: teams.get(code) ?? "",
    pit,
    source: effective.source,
  });

  return [
    ...effective.order.map((code, i) => row(code, i + 1, false)),
    ...effective.pit.map((code, i) => row(code, effective.order.length + i + 1, true)),
  ];
}

/** p1_* .. p22_*. A place with no driver is empty ("", 0, false), never missing. */
export function flattenGrid(rows: readonly FeedGridRow[], n = 22): FlatFields {
  const out: FlatFields = {};
  for (let i = 1; i <= n; i++) {
    const r = rows[i - 1];
    out[`p${i}_position`] = r?.position ?? i;
    out[`p${i}_driver`] = r?.driver ?? "";
    out[`p${i}_name`] = r?.name ?? "";
    out[`p${i}_team`] = r?.team ?? "";
    out[`p${i}_pit`] = r?.pit ?? false;
    out[`p${i}_source`] = r?.source ?? "";
  }
  return out;
}

/**
 * The forecast as rows, sorted like the "Race" tab: by the chance to win, then the podium chance, then the grid
 * place, then the code. A driver the grid does not list starts last, which is what the model assumed too.
 */
export function buildForecastRows(
  state: SeasonState,
  forecast: RaceForecast,
  field: readonly string[],
  grid: Readonly<Record<string, number>>,
  source: GridSourceKind,
): FeedForecastRow[] {
  const { names, teams } = identities(state);
  const placeOf = (code: string) => grid[code] ?? field.length;

  return [...field]
    .sort(
      (a, b) =>
        (forecast.win[b] ?? 0) - (forecast.win[a] ?? 0) ||
        (forecast.podium[b] ?? 0) - (forecast.podium[a] ?? 0) ||
        placeOf(a) - placeOf(b) ||
        (a < b ? -1 : a > b ? 1 : 0),
    )
    .map((code, i) => ({
      rank: i + 1,
      driver: code,
      name: names.get(code) ?? code,
      team: teams.get(code) ?? "",
      grid: placeOf(code),
      win_display: formatProbability(forecast.win[code] ?? 0),
      podium_display: formatProbability(forecast.podium[code] ?? 0),
      points_display: formatProbability(forecast.top10[code] ?? 0),
      mean_position: Math.round((forecast.meanPosition[code] ?? field.length) * 100) / 100,
      source,
    }));
}

/** top1_* .. top10_*. A place with no row is empty ("", 0), never missing. */
export function flattenForecast(rows: readonly FeedForecastRow[], n = 10): FlatFields {
  const out: FlatFields = {};
  for (let i = 1; i <= n; i++) {
    const r = rows[i - 1];
    out[`top${i}_rank`] = r?.rank ?? i;
    out[`top${i}_driver`] = r?.driver ?? "";
    out[`top${i}_name`] = r?.name ?? "";
    out[`top${i}_team`] = r?.team ?? "";
    out[`top${i}_grid`] = r?.grid ?? 0;
    out[`top${i}_win_display`] = r?.win_display ?? "";
    out[`top${i}_podium_display`] = r?.podium_display ?? "";
    out[`top${i}_points_display`] = r?.points_display ?? "";
    out[`top${i}_mean_position`] = r?.mean_position ?? 0;
    out[`top${i}_source`] = r?.source ?? "";
  }
  return out;
}

/** The grid feed: metadata, the grid in use, the rows, and p1_* .. p22_*. */
export function buildGridFeedPayload(
  state: SeasonState,
  round: number,
  effective: { order: readonly string[]; pit: readonly string[]; source: GridSourceKind },
): GridFeedPayload {
  const rows = buildGridRows(state, effective);
  return {
    ...feedMeta(state),
    available: true,
    round,
    source: effective.source,
    rows,
    ...flattenGrid(rows),
  };
}

/** The forecast feed: metadata, the labels, the rows, and top1_* .. top10_*. */
export function buildForecastFeedPayload(
  state: SeasonState,
  forecast: RaceForecast,
  field: readonly string[],
  grid: Readonly<Record<string, number>>,
  source: GridSourceKind,
  round: number,
): ForecastFeedPayload {
  const rows = buildForecastRows(state, forecast, field, grid, source);
  return {
    ...feedMeta(state),
    available: true,
    model: "estimate",
    label: "Model estimate",
    round,
    source,
    n_sims: forecast.nSims,
    rows,
    ...flattenForecast(rows),
  };
}
