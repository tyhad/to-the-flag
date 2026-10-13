/**
 * "Likely?" panel view-model (DESIGN.md sections 6 and 8). Pure.
 * Turns the model's odds into the rows, sentences and states the panel shows. The panel always says these are a
 * model estimate, never shows 0% or 100%, and states clinched and eliminated drivers in words.
 */
import { LOW_CONFIDENCE_ROUNDS, formatProbability, type OddsResult, type OddsRow, type SeasonState } from "../../engine";
import { FORM_WEIGHT_DEFAULT, FORM_WEIGHT_STEP, ODDS_BANDS, type OddsBands } from "../config";
import type { OddsErrorKind, OddsState, OddsStatus } from "./oddsRequests";

export type OddsTable = "wdc" | "wcc";
export type ProbabilityBand = "green" | "yellow" | "orange";

export function probabilityBand(probability: number, bands: OddsBands = ODDS_BANDS): ProbabilityBand {
  if (probability >= bands.green) return "green";
  if (probability >= bands.yellow) return "yellow";
  return "orange";
}

/** Bar fill in percent. Never empty and never full: a simulation can show neither "nothing" nor "certain". */
export function barWidth(probability: number): number {
  return Math.min(99, Math.max(1, Math.round(probability * 100)));
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ---------- change against the odds without locks ----------

export interface PpDelta {
  text: string;
  tone: "up" | "down" | "none";
  description: string;
}

/**
 * A change in percentage points ("▲ 12 pp"). A change that rounds to nothing, or is smaller than `noisePp` (the
 * sampling noise of the two estimates), is shown as "●": two runs of the model never agree to the last decimal.
 */
export function formatPpDelta(diffPp: number, noisePp = 0): PpDelta {
  const points = Math.round(Math.abs(diffPp));
  if (points === 0 || Math.abs(diffPp) < noisePp) {
    return { text: "●", tone: "none", description: "No clear change compared with no locks" };
  }
  const unit = plural(points, "percentage point", "percentage points");
  return diffPp > 0
    ? { text: `▲ ${points} pp`, tone: "up", description: `Up ${unit} compared with no locks` }
    : { text: `▼ ${points} pp`, tone: "down", description: `Down ${unit} compared with no locks` };
}

/** The change from `baseP` to `p`, in percentage points, with two standard errors of the difference as the noise limit. */
export function probabilityDelta(p: number, baseP: number, nSims: number): PpDelta {
  // The change is measured on what the reader sees: "<1%" next to "<1%" is not a change, however far apart the
  // underlying estimates are.
  if (formatProbability(p) === formatProbability(baseP)) return formatPpDelta(0);
  const noisePp = 2 * Math.sqrt((p * (1 - p) + baseP * (1 - baseP)) / nSims) * 100;
  return formatPpDelta((p - baseP) * 100, noisePp);
}

// ---------- the form-weight slider ----------

/** Snaps a slider value to the nearest step, between 0 and 100. */
export function snapFormPercent(value: number): number {
  if (!Number.isFinite(value)) return FORM_WEIGHT_DEFAULT;
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped / FORM_WEIGHT_STEP) * FORM_WEIGHT_STEP;
}

/** The `formWeight` the model takes (0 to 1) for a slider value. */
export function formWeightFor(percent: number): number {
  return snapFormPercent(percent) / 100;
}

export function whatIfNote(percent: number): string | null {
  const snapped = snapFormPercent(percent);
  return snapped === FORM_WEIGHT_DEFAULT ? null : `What-if: form weight ${snapped}%.`;
}

// ---------- states ----------

export interface OddsErrorCopy {
  title: string;
  body: string;
}

/** What failed and how to fix it, in plain words. The technical message stays out of the panel. */
export function oddsErrorCopy(kind: OddsErrorKind | null): OddsErrorCopy {
  if (kind === "invalid_scenario") {
    return {
      title: "The locks do not fit the season data",
      body: "A locked session may already have been run. Reset the scenario, or unlock the sessions that now have results.",
    };
  }
  return {
    title: "The odds could not be calculated",
    body: "Reload the page to try again. If it keeps failing, check that the data file is up to date.",
  };
}

export interface OddsPanelState {
  status: OddsStatus;
  /** The odds to show. The previous ones while a new calculation runs, so they can be dimmed. */
  result: OddsResult | null;
  /** The odds without locks, for the change column. Null when there are none to compare with. */
  base: OddsResult | null;
  errorKind: OddsErrorKind | null;
}

/**
 * Folds the two calculations behind the panel (the odds to show, and the odds without locks for the comparison)
 * into one state. Pass `base: null` when there are no locks, so the comparison is not needed.
 */
export function combineOddsStates(current: OddsState, base: OddsState | null): OddsPanelState {
  const baseResult = base && base.status !== "error" ? base.result : null;
  let status: OddsStatus = "idle";
  if (current.status === "error") status = "error";
  else if (current.status === "calculating" || base?.status === "calculating") status = "calculating";
  else if (current.status === "ready") status = "ready";
  return { status, result: current.result, base: baseResult, errorKind: current.status === "error" ? current.errorKind : null };
}

// ---------- the view ----------

export interface OddsBarRow {
  id: string;
  /** A driver's code, or a team's name. */
  title: string;
  /** A driver's name; null for a team. */
  subtitle: string | null;
  probability: number;
  /** `formatProbability` of the probability: "<1%", "3.4%", "47%", ">99%". */
  display: string;
  widthPercent: number;
  band: ProbabilityBand;
  /** Change against the odds without locks; null when there are no locks or nothing to compare with. */
  delta: PpDelta | null;
}

export interface OddsView {
  table: OddsTable;
  estimateLabel: string;
  asOf: string;
  lowConfidence: { tag: string; note: string } | null;
  rows: OddsBarRow[];
  /** Drivers who have won the title, in words (drivers' table only). */
  clinched: string[];
  /** "3 drivers are out of the title fight." (drivers' table only). */
  outLine: string | null;
  tableNote: string | null;
  scenarioNote: string | null;
  whatIf: string | null;
  howItWorks: string;
}

export interface BuildOddsViewInput {
  result: OddsResult;
  /** The odds without locks, when there are locks. */
  base: OddsResult | null;
  state: SeasonState;
  table: OddsTable;
  formPercent: number;
  hasLocks: boolean;
  bands?: OddsBands;
}

export function buildOddsView({ result, base, state, table, formPercent, hasLocks, bands = ODDS_BANDS }: BuildOddsViewInput): OddsView {
  const driverNames = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teamNames = new Map(state.teams.map((t) => [t.id, t.name]));
  const isDrivers = table === "wdc";

  const source: OddsRow[] = isDrivers ? result.wdc : result.wcc;
  const baseRows = base ? new Map((isDrivers ? base.wdc : base.wcc).map((r) => [r.id, r.probability])) : null;
  const listed = isDrivers ? source.filter((r) => r.status === "alive") : source;

  const rows: OddsBarRow[] = listed.map((r) => ({
    id: r.id,
    title: isDrivers ? r.id : (teamNames.get(r.id) ?? r.id),
    subtitle: isDrivers ? (driverNames.get(r.id) ?? r.id) : null,
    probability: r.probability,
    display: r.display,
    widthPercent: barWidth(r.probability),
    band: probabilityBand(r.probability, bands),
    delta: hasLocks && baseRows ? probabilityDelta(r.probability, baseRows.get(r.id) ?? 0, result.nSims) : null,
  }));

  const clinched = isDrivers
    ? source.filter((r) => r.status === "clinched").map((r) => `${driverNames.get(r.id) ?? r.id} has clinched the title.`)
    : [];
  const out = isDrivers ? state.drivers.length - source.length : 0;

  return {
    table,
    estimateLabel: "Model estimate",
    asOf: `as of Round ${result.asOfRound}`,
    lowConfidence: result.lowConfidence
      ? { tag: "Low confidence", note: `Fewer than ${LOW_CONFIDENCE_ROUNDS} rounds are complete, so these numbers can move a lot.` }
      : null,
    rows,
    clinched,
    outLine: out > 0 ? `${plural(out, "driver is", "drivers are")} out of the title fight.` : null,
    tableNote: isDrivers ? null : "Only teams that won at least one simulated season are listed.",
    scenarioNote: hasLocks
      ? baseRows
        ? "With your locked results. The change is against the odds with nothing locked."
        : "With your locked results."
      : null,
    whatIf: whatIfNote(formPercent),
    howItWorks:
      "The model uses this season's results: where drivers finish and how often they retire. " +
      "It does not know about upgrades, tracks or weather. " +
      `The number comes from ${result.nSims.toLocaleString("en-US")} simulated seasons. ` +
      "Drivers you did not set in a locked session still race.",
  };
}
