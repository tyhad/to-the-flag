/**
 * Building blocks of GET /api/feed/odds (Phase 3, Step 7): the cache key, a small LRU cache, and the payload.
 * The simulation itself lives in engine/odds.ts; nothing here knows about HTTP.
 */
import { formatProbability, type OddsResult, type OddsRow } from "../engine/odds";
import type { OddsParams } from "../engine/simulate";
import type { SeasonState } from "../engine/types";

export interface FeedOddsRow {
  rank: number;
  id: string;
  name: string;
  /** probability in percent, two decimals. Show `display`, which never claims 0% or 100%. */
  win_pct: number;
  display: string;
  /** the same odds without the active scenario; only present while a scenario is active */
  base_display?: string;
}

export interface ScenarioMeta {
  id: string;
  name: string;
}

export type FlatFields = Record<string, string | number>;

export interface OddsFeedFields {
  updated_at: string;
  as_of_round: number;
  data_status: string;
  season: number;
  available: true;
  model: "estimate";
  label: "Model estimate";
  low_confidence: boolean;
  n_sims: number;
  scenario: ScenarioMeta | null;
  wdc: FeedOddsRow[];
  wcc: FeedOddsRow[];
}

/** The fixed fields, plus the flattened top1_* to top10_* ones. */
export type OddsFeedPayload = OddsFeedFields & Record<string, unknown>;

/** Same data, same key: the season file's ETag, the scenario's id and version, and the model parameters. */
export function oddsCacheKey(
  seasonEtag: string,
  scenario: { id: string; version: string } | null,
  params: Partial<OddsParams>,
): string {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const who = scenario ? `${scenario.id}@${scenario.version}` : "-";
  return `${seasonEtag}|${who}|${JSON.stringify(sorted)}`;
}

/** Keeps the most recently used results, so polling does not resimulate and memory stays bounded. */
export class OddsCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly max = 16) {}

  get size(): number {
    return this.entries.size;
  }

  /** A compute that throws caches nothing. */
  getOrCompute(key: string, compute: () => T): { value: T; hit: boolean } {
    if (this.entries.has(key)) {
      const value = this.entries.get(key) as T;
      this.entries.delete(key); // move to the newest place
      this.entries.set(key, value);
      return { value, hit: true };
    }
    const value = compute();
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return { value, hit: false };
  }
}

function toRows(rows: OddsRow[], names: Map<string, string>, base: OddsRow[] | null): FeedOddsRow[] {
  const baseDisplay = base ? new Map(base.map((r) => [r.id, r.display])) : null;
  return rows.map((r, i) => {
    const row: FeedOddsRow = {
      rank: i + 1,
      id: r.id,
      name: names.get(r.id) ?? r.id,
      win_pct: Math.round(r.probability * 10_000) / 100,
      display: r.display,
    };
    if (baseDisplay) row.base_display = baseDisplay.get(r.id) ?? formatProbability(0);
    return row;
  });
}

/** top1_<prefix>rank ... top10_<prefix>base_display. A place with no row is empty, so the keys never go missing. */
function flatten(prefix: string, rows: FeedOddsRow[], n = 10): FlatFields {
  const out: FlatFields = {};
  for (let i = 1; i <= n; i++) {
    const row = rows[i - 1];
    out[`top${i}_${prefix}rank`] = i;
    out[`top${i}_${prefix}id`] = row?.id ?? "";
    out[`top${i}_${prefix}name`] = row?.name ?? "";
    out[`top${i}_${prefix}win_pct`] = row?.win_pct ?? 0;
    out[`top${i}_${prefix}display`] = row?.display ?? "";
    out[`top${i}_${prefix}base_display`] = row?.base_display ?? "";
  }
  return out;
}

/** `base` is the odds without the scenario; pass it only when a scenario is active. */
export function buildOddsPayload(
  state: SeasonState,
  odds: OddsResult,
  scenario: ScenarioMeta | null,
  base: OddsResult | null,
): OddsFeedPayload {
  const driverNames = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teamNames = new Map(state.teams.map((t) => [t.id, t.name]));
  const wdc = toRows(odds.wdc, driverNames, base ? base.wdc : null);
  const wcc = toRows(odds.wcc, teamNames, base ? base.wcc : null);
  return {
    updated_at: state.health.checkedAt,
    as_of_round: state.asOfRound,
    data_status: state.health.status,
    season: state.season,
    available: true,
    model: "estimate",
    label: "Model estimate",
    low_confidence: odds.lowConfidence,
    n_sims: odds.nSims,
    scenario,
    wdc,
    wcc,
    ...flatten("", wdc),
    ...flatten("wdc_", wdc),
    ...flatten("wcc_", wcc),
  };
}
