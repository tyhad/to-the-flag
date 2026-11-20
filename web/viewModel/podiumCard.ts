/**
 * The podium card: P1, P2 and P3 on three steps, for a prediction or a race result. Pure: data in, drawing
 * commands out, no DOM and no canvas. Drawn by the same renderer as the other cards (`web/exportCard.ts`).
 *
 *   - The picks start empty in the page; this file only lays out three codes.
 *   - P2 is on the left, P1 in the centre and tallest, P3 on the right and lowest.
 *   - Each block has a team color strip, the place, the driver code and the team name when the data has one.
 *   - Prediction is the owner's own guess, so the picture never says "Model estimate".
 *   - A sprint weekend is named on the picture; the flag comes from the data (`RoundInfo.hasSprint`).
 */
import { activeDrivers, teamCars } from "../../engine";
import type { SeasonState } from "../../engine";
import { teamColor } from "../theme/teams";
import { buildCreditCommand, type DrawCommand } from "./card";

export type PodiumMode = "prediction" | "result";

export interface PodiumPick {
  position: 1 | 2 | 3;
  code: string;
  teamId: string;
  teamName: string;
}

export interface PodiumCardView {
  season: number;
  round: number;
  /** The name of the race, when the schedule has it. */
  raceName: string | null;
  hasSprint: boolean;
  mode: PodiumMode;
  /** P1, P2 and P3, in place order. */
  picks: PodiumPick[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PodiumBlock extends Rect {
  position: 1 | 2 | 3;
  code: string;
  teamId: string;
  teamName: string;
}

export interface PodiumHeaderLine {
  text: string;
  x: number;
  y: number;
  font: string;
  fill: string;
}

export interface PodiumCardLayout {
  width: number;
  height: number;
  panel: Rect;
  header: PodiumHeaderLine[];
  /** The label in the top right corner. */
  mode: PodiumHeaderLine;
  /** Left to right: P2, P1, P3. */
  blocks: PodiumBlock[];
  creditY: number;
}

/** The label in the top right corner. The prediction carries the brand; a result is just a result. */
export const PODIUM_MODE_LABEL: Record<PodiumMode, string> = {
  prediction: "Tyhad | F1 Watchalong's Prediction",
  result: "Race result",
};

export const SPRINT_WEEKEND_NOTE = "Sprint weekend";

/** The round the picture is about: the next one for a prediction, the last completed one for a result. */
export function podiumRound(state: SeasonState, mode: PodiumMode): number | null {
  if (mode === "result") return state.asOfRound > 0 ? state.asOfRound : null;
  const next = state.asOfRound + 1;
  return next <= state.rounds.length ? next : null;
}

/** The line under the controls: which race the picture is about, or why there is none. */
export function podiumRaceLine(state: SeasonState, mode: PodiumMode): string {
  const round = podiumRound(state, mode);
  if (round === null) return mode === "prediction" ? "The season is complete." : "No race has finished yet.";
  const info = state.rounds.find((r) => r.round === round);
  return `${info?.name || `Round ${round}`} · Round ${round}${info?.hasSprint ? ` · ${SPRINT_WEEKEND_NOTE}` : ""}`;
}

export interface PodiumDriverOption {
  code: string;
  /** "" when the data has no team for the driver yet (before the first race). */
  teamId: string;
  teamName: string;
}

/** The drivers the pickers offer: the active ones, sorted by code. A season with no result yet offers everyone. */
export function podiumDriverOptions(state: SeasonState): PodiumDriverOption[] {
  const teamOf = new Map<string, string>();
  for (const [team, codes] of teamCars(state)) for (const code of codes) teamOf.set(code, team);
  const names = new Map(state.teams.map((t) => [t.id, t.name]));
  const active = activeDrivers(state);
  const codes = active.length > 0 ? active : state.drivers.map((d) => d.code);
  return [...codes].sort().map((code) => {
    const teamId = teamOf.get(code) ?? "";
    return { code, teamId, teamName: names.get(teamId) ?? teamId };
  });
}

/** The picture's data, or null when there is no race for the mode or a pick is not a driver of this season. */
export function buildPodiumView(
  state: SeasonState,
  mode: PodiumMode,
  codes: readonly string[],
): PodiumCardView | null {
  const round = podiumRound(state, mode);
  if (round === null || codes.length !== 3 || new Set(codes).size !== 3) return null;
  const options = new Map(podiumDriverOptions(state).map((d) => [d.code, d]));
  const picks: PodiumPick[] = [];
  for (let i = 0; i < 3; i++) {
    const option = options.get(codes[i]!);
    if (!option) return null;
    picks.push({ position: (i + 1) as 1 | 2 | 3, ...option });
  }
  const info = state.rounds.find((r) => r.round === round);
  return {
    season: state.season,
    round,
    raceName: info?.name || null,
    hasSprint: info?.hasSprint ?? false,
    mode,
    picks,
  };
}

/** `podium-prediction-2026-r17.png` / `podium-result-2026-r16.png`. */
export function podiumFilename(view: PodiumCardView): string {
  return `podium-${view.mode}-${view.season}-r${view.round}.png`;
}

const MARGIN = 36;
const WIDTH = 1080;
const HEIGHT = 1080;

/** The step heights, as a share of the space there is. P1 is the tallest. */
const HEIGHT_RATIO: Record<1 | 2 | 3, number> = { 1: 0.92, 2: 0.78, 3: 0.66 };
const LEFT_TO_RIGHT: (1 | 2 | 3)[] = [2, 1, 3];

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}

/** Where everything goes. The drawing is made from this, and so are the bounds tests. */
export function layoutPodiumCard(view: PodiumCardView): PodiumCardLayout {
  const panel: Rect = { x: MARGIN, y: MARGIN, w: WIDTH - MARGIN * 2, h: HEIGHT - MARGIN * 2 };
  const leftX = MARGIN + 32;
  const rightX = MARGIN + panel.w - 32;
  const creditY = HEIGHT - MARGIN - 12;

  const lines: { text: string; font: string; fill: string; step: number }[] = [
    { text: "Formula 1", font: "700 34px var(--font-display)", fill: "var(--color-text)", step: 40 },
    {
      text: `Season ${view.season} · Round ${view.round}`,
      font: "600 26px var(--font-display)",
      fill: "var(--color-text)",
      step: 32,
    },
  ];
  if (view.raceName) {
    lines.push({
      text: truncate(view.raceName, 44),
      font: "500 20px var(--font-ui)",
      fill: "var(--color-text-2)",
      step: 28,
    });
  }
  if (view.hasSprint) {
    lines.push({
      text: SPRINT_WEEKEND_NOTE,
      font: "600 17px var(--font-ui)",
      fill: "var(--color-text-2)",
      step: 28,
    });
  }
  let y = MARGIN + 36;
  const header: PodiumHeaderLine[] = lines.map((line) => {
    const placed = { text: line.text, x: leftX, y, font: line.font, fill: line.fill };
    y += line.step;
    return placed;
  });

  const areaTop = y + 8;
  const baseY = creditY - 26;
  const areaH = baseY - areaTop;
  const gap = 24;
  const blockW = Math.floor((rightX - leftX - gap * 2) / 3);

  const blocks = LEFT_TO_RIGHT.map((position, index) => {
    const pick = view.picks.find((p) => p.position === position)!;
    const h = Math.round(areaH * HEIGHT_RATIO[position]);
    return {
      position,
      code: pick.code,
      teamId: pick.teamId,
      teamName: pick.teamName,
      x: leftX + index * (blockW + gap),
      y: baseY - h,
      w: blockW,
      h,
    };
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    panel,
    header,
    mode: {
      text: PODIUM_MODE_LABEL[view.mode],
      x: rightX,
      y: MARGIN + 36,
      font: "600 17px var(--font-ui)",
      fill: "var(--color-text-2)",
    },
    blocks,
    creditY,
  };
}

/** One step: its panel, the team color strip and the three lines of text. */
function blockCommands(block: PodiumBlock): DrawCommand[] {
  const centerX = block.x + block.w / 2;
  const commands: DrawCommand[] = [
    { type: "rect", x: block.x, y: block.y, width: block.w, height: block.h, fill: "var(--color-s0)", radius: 12 },
    { type: "rect", x: block.x, y: block.y, width: block.w, height: 8, fill: teamColor(block.teamId), radius: 3 },
    {
      type: "text",
      text: `P${block.position}`,
      x: centerX,
      y: block.y + 54,
      font: "700 46px var(--font-display)",
      fill: "var(--color-text-2)",
      align: "center",
      baseline: "middle",
    },
    {
      type: "text",
      text: block.code,
      x: centerX,
      y: block.y + Math.round(block.h * 0.5),
      font: "700 76px var(--font-display)",
      fill: "var(--color-text)",
      align: "center",
      baseline: "middle",
    },
  ];
  if (block.teamName) {
    commands.push({
      type: "text",
      text: truncate(block.teamName, 24),
      x: centerX,
      y: block.y + block.h - 36,
      font: "500 21px var(--font-ui)",
      fill: "var(--color-text-2)",
      align: "center",
      baseline: "middle",
    });
  }
  return commands;
}

/** The podium card (1080×1080) as drawing commands. */
export function buildPodiumCard(view: PodiumCardView): DrawCommand[] {
  const layout = layoutPodiumCard(view);
  const commands: DrawCommand[] = [
    { type: "rect", x: 0, y: 0, width: layout.width, height: layout.height, fill: "var(--color-s0)" },
    { type: "rect", x: layout.panel.x, y: layout.panel.y, width: layout.panel.w, height: layout.panel.h, fill: "var(--color-s1)", radius: 12 },
  ];
  for (const line of layout.header) {
    commands.push({ type: "text", text: line.text, x: line.x, y: line.y, font: line.font, fill: line.fill, align: "left", baseline: "middle" });
  }
  commands.push({
    type: "text",
    text: layout.mode.text,
    x: layout.mode.x,
    y: layout.mode.y,
    font: layout.mode.font,
    fill: layout.mode.fill,
    align: "right",
    baseline: "middle",
  });
  for (const block of layout.blocks) commands.push(...blockCommands(block));
  commands.push(buildCreditCommand(layout.width / 2, layout.creditY));
  return commands;
}
