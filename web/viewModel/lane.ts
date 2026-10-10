/**
 * Finish Lane model (DESIGN.md section 6). Pure: no DOM.
 *
 * One lane per contender. Distance along a lane is points. The dot is the projected total, a thin
 * extension runs on to the most the driver can still reach, and a chequered line marks the total at
 * which the leader clinches the title. Arithmetic only: no model, no probabilities.
 */
import {
  computeDriverStandings,
  driverStatus,
  type Scenario,
  type SeasonState,
} from "../../engine";
import { defaultContenders } from "./contenders";
import { buildTowerRows, formatPoints } from "./tower";

export interface Lane {
  driver: string;
  /** Points from real results only. */
  base: number;
  /** Points including the locked sessions. */
  projected: number;
  /** The most the driver can reach: projected plus every unlocked session at its maximum. */
  ceiling: number;
}

export interface LaneModel {
  axisMin: number;
  axisMax: number;
  /** The leader's total at which the title is clinched: the best rival's ceiling plus one. */
  finishAt: number;
  /** In projected table order. */
  lanes: Lane[];
}

/** A margin of at least ten points below the lowest value and above the highest, on whole tens. Never below zero. */
export function axisBounds(minValue: number, maxValue: number): { axisMin: number; axisMax: number } {
  return {
    axisMin: Math.max(0, (Math.floor(minValue / 10) - 1) * 10),
    axisMax: (Math.floor(maxValue / 10) + 1) * 10,
  };
}

const TICK_STEPS = [10, 20, 25, 50, 100, 200, 250, 500];
const MAX_TICKS = 7;

/** Whole-number labels for the axis: the finest step that still gives at most seven. */
export function axisTicks(axisMin: number, axisMax: number): number[] {
  const count = (step: number) => Math.floor(axisMax / step) - Math.ceil(axisMin / step) + 1;
  const step = TICK_STEPS.find((s) => count(s) <= MAX_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let t = Math.ceil(axisMin / step) * step; t <= axisMax; t += step) ticks.push(t);
  return ticks;
}

/** Horizontal position of a points value on a track that runs from `left` to `width - right`. Stays on the track. */
export function laneX(
  value: number,
  axis: { axisMin: number; axisMax: number },
  width: number,
  left: number,
  right: number,
): number {
  const span = axis.axisMax - axis.axisMin;
  if (span <= 0) return left;
  const share = Math.min(1, Math.max(0, (value - axis.axisMin) / span));
  return left + share * (width - left - right);
}

/**
 * The lanes for a scenario. `contenders` defaults to the usual top five. The line does not depend on
 * which drivers are shown: it is always the leader's clinch total against every other driver.
 */
export function laneModel(state: SeasonState, scenario?: Scenario, contenders?: readonly string[]): LaneModel {
  const wanted = new Set(contenders ?? defaultContenders(state));
  const table = computeDriverStandings(state, scenario);
  const status = new Map(driverStatus(state, scenario).map((s) => [s.driver, s]));

  const leader = table[0];
  const rivalCeilings = table
    .filter((row) => row.id !== leader?.id)
    .map((row) => status.get(row.id)?.maxPossible ?? row.points);
  const finishAt = rivalCeilings.length > 0 ? Math.max(...rivalCeilings) + 1 : (leader?.points ?? 0);

  const lanes: Lane[] = table
    .filter((row) => wanted.has(row.id))
    .map((row) => ({
      driver: row.id,
      base: row.basePoints,
      projected: row.points,
      ceiling: status.get(row.id)?.maxPossible ?? row.points,
    }));

  const lowest = lanes.length > 0 ? Math.min(...lanes.map((l) => l.base)) : 0;
  const highest = Math.max(finishAt, ...lanes.map((l) => l.ceiling));
  return { ...axisBounds(lowest, highest), finishAt, lanes };
}

const points = (n: number): string => `${formatPoints(n)} ${n === 1 ? "point" : "points"}`;

/** One lane in words, for screen readers and keyboard focus. */
export function describeLane(name: string, lane: Lane, finishAt: number): string {
  const gain = lane.projected !== lane.base ? `, up from ${formatPoints(lane.base)} with locked results` : "";
  const line =
    lane.projected >= finishAt
      ? "Past the finish line, so the title is clinched."
      : `${points(finishAt - lane.projected)} from the finish line at ${formatPoints(finishAt)}.`;
  return `${name}: ${formatPoints(lane.projected)} points${gain}. Most they can reach: ${formatPoints(lane.ceiling)}. ${line}`;
}

export interface LaneRowView extends Lane {
  name: string;
  /** Constructor id for the color strip and dot (`teamColor`). */
  teamId: string;
  summary: string;
}

export interface LaneView {
  model: LaneModel;
  rows: LaneRowView[];
  /** One sentence on the leader and the line. */
  caption: string;
}

/** The model plus names, teams and sentences, ready to draw. */
export function buildLaneView(state: SeasonState, scenario?: Scenario, contenders?: readonly string[]): LaneView {
  const model = laneModel(state, scenario, contenders);
  const towers = buildTowerRows(state, scenario, "wdc");
  const info = new Map(towers.map((r) => [r.id, r]));
  const rows = model.lanes.map((lane) => {
    const row = info.get(lane.driver);
    const name = row?.name ?? lane.driver;
    return { ...lane, name, teamId: row?.teamId ?? "", summary: describeLane(name, lane, model.finishAt) };
  });

  const leader = towers[0];
  let caption = "";
  if (leader) {
    caption =
      leader.points >= model.finishAt
        ? `${leader.name} has passed the finish line at ${formatPoints(model.finishAt)} points.`
        : `The finish line is at ${formatPoints(model.finishAt)} points: ${leader.name} needs ${formatPoints(model.finishAt - leader.points)} more to clinch.`;
  }
  return { model, rows, caption };
}
