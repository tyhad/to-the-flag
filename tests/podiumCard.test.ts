/**
 * The podium card (web/viewModel/podiumCard.ts). Pure: where the blocks go, what is written on them, and which
 * race the picture is about. The drawing itself and the fonts need a browser.
 */
import { describe, expect, test } from "bun:test";
import type { SeasonState } from "../engine";
import type { DrawCommand } from "../web/viewModel/card";
import {
  PODIUM_MODE_LABEL,
  SPRINT_WEEKEND_NOTE,
  buildPodiumCard,
  buildPodiumView,
  layoutPodiumCard,
  podiumDriverOptions,
  podiumFilename,
  podiumRaceLine,
  podiumRound,
  type Rect,
} from "../web/viewModel/podiumCard";
import { teamColor } from "../web/theme/teams";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];

/** Round 4 is a sprint weekend; rounds 1 to 3 are done. */
const season: SeasonState = makeState({
  rounds: 5,
  sprints: [4],
  completed: 3,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
  results: { "1:race": six, "2:race": six, "3:race": six, "4:sprint": six },
});

const picks = ["AAA", "BBB", "CCC"] as const;
const view = buildPodiumView(season, "prediction", picks)!;

const texts = (commands: DrawCommand[]) =>
  commands.filter((c): c is Extract<DrawCommand, { type: "text" }> => c.type === "text");
const textOf = (commands: DrawCommand[]) => texts(commands).map((t) => t.text);
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("which race the picture is about", () => {
  test("a prediction is the next round, a result is the last completed one", () => {
    expect(podiumRound(season, "prediction")).toBe(4);
    expect(podiumRound(season, "result")).toBe(3);
  });

  test("a finished season has no next round; a season before its first race has no result", () => {
    expect(podiumRound({ ...season, asOfRound: 5 }, "prediction")).toBeNull();
    expect(podiumRound({ ...season, asOfRound: 5 }, "result")).toBe(5);
    expect(podiumRound({ ...season, asOfRound: 0 }, "prediction")).toBe(1);
    expect(podiumRound({ ...season, asOfRound: 0 }, "result")).toBeNull();
  });

  test("the line under the controls names the race, or says why there is none", () => {
    expect(podiumRaceLine(season, "prediction")).toBe("Round 4 · Round 4 · Sprint weekend");
    expect(podiumRaceLine(season, "result")).toBe("Round 3 · Round 3");
    expect(podiumRaceLine({ ...season, asOfRound: 5 }, "prediction")).toBe("The season is complete.");
    expect(podiumRaceLine({ ...season, asOfRound: 0 }, "result")).toBe("No race has finished yet.");
  });
});

describe("the data", () => {
  test("the pickers offer the active drivers, sorted, with their team", () => {
    const options = podiumDriverOptions(season);
    expect(options.map((d) => d.code)).toEqual(six);
    expect(options.find((d) => d.code === "AAA")).toEqual({ code: "AAA", teamId: "red", teamName: "red" });
  });

  test("the picks are P1 to P3, and the race name and the sprint flag come from the data", () => {
    expect(view.picks.map((p) => [p.position, p.code])).toEqual([
      [1, "AAA"],
      [2, "BBB"],
      [3, "CCC"],
    ]);
    expect(view.raceName).toBe("Round 4");
    expect(view.hasSprint).toBe(true);
    expect(view.mode).toBe("prediction");
  });

  test("a repeated pick or a driver of another season makes no picture", () => {
    expect(buildPodiumView(season, "prediction", ["AAA", "AAA", "BBB"])).toBeNull();
    expect(buildPodiumView(season, "prediction", ["AAA", "BBB", "ZZZ"])).toBeNull();
    expect(buildPodiumView({ ...season, asOfRound: 5 }, "prediction", picks)).toBeNull();
  });

  test("the file name says the mode and the round", () => {
    expect(podiumFilename(view)).toBe("podium-prediction-2026-r4.png");
    expect(podiumFilename(buildPodiumView(season, "result", picks)!)).toBe("podium-result-2026-r3.png");
  });
});

describe("the layout", () => {
  const layout = layoutPodiumCard(view);

  test("everything stays inside the card", () => {
    const canvas: Rect = { x: 0, y: 0, w: layout.width, h: layout.height };
    expect(inside(layout.panel, canvas)).toBe(true);
    for (const block of layout.blocks) expect(inside(block, layout.panel)).toBe(true);
    for (const line of [...layout.header, layout.mode]) {
      expect(line.x).toBeGreaterThanOrEqual(0);
      expect(line.x).toBeLessThanOrEqual(layout.width);
      expect(line.y).toBeGreaterThan(0);
      expect(line.y).toBeLessThan(layout.height);
    }
  });

  test("P2 is on the left, P1 in the centre and P3 on the right, on one base line", () => {
    expect(layout.blocks.map((b) => b.position)).toEqual([2, 1, 3]);
    expect(layout.blocks[0]!.x).toBeLessThan(layout.blocks[1]!.x);
    expect(layout.blocks[1]!.x).toBeLessThan(layout.blocks[2]!.x);
    for (const block of layout.blocks) expect(block.y + block.h).toBe(layout.blocks[0]!.y + layout.blocks[0]!.h);
  });

  test("P1 is the tallest and P3 the shortest, and no two blocks overlap", () => {
    const [p2, p1, p3] = layout.blocks;
    expect(p1!.h).toBeGreaterThan(p2!.h);
    expect(p2!.h).toBeGreaterThan(p3!.h);
    for (let i = 0; i < layout.blocks.length; i++) {
      for (let j = i + 1; j < layout.blocks.length; j++) expect(overlap(layout.blocks[i]!, layout.blocks[j]!)).toBe(false);
    }
  });

  test("the header names the season, the round, the race and the sprint weekend", () => {
    expect(layout.header.map((l) => l.text)).toEqual(["Formula 1", "Season 2026 · Round 4", "Round 4", SPRINT_WEEKEND_NOTE]);
    expect(layout.mode.text).toBe(PODIUM_MODE_LABEL.prediction);
  });

  test("a race without a sprint has no sprint line", () => {
    const result = buildPodiumView(season, "result", picks)!;
    expect(layoutPodiumCard(result).header.map((l) => l.text)).not.toContain(SPRINT_WEEKEND_NOTE);
    expect(layoutPodiumCard(result).mode.text).toBe("Race result");
  });
});

describe("the drawing commands", () => {
  const commands = buildPodiumCard(view);

  test("each step has its place, its code and its team color", () => {
    const written = textOf(commands);
    for (const text of ["P1", "P2", "P3", "AAA", "BBB", "CCC"]) expect(written).toContain(text);
    const strips = commands.filter(
      (c): c is Extract<DrawCommand, { type: "rect" }> => c.type === "rect" && c.height === 8,
    );
    expect(strips.map((s) => s.fill)).toEqual([teamColor("red"), teamColor("red"), teamColor("blue")]);
  });

  test("the credit line is the shared one", () => {
    expect(textOf(commands).some((t) => t.includes("Tyhad | F1 Watchalong"))).toBe(true);
  });

  test("a long team name is shortened, never left to overflow", () => {
    const long = { ...season, teams: season.teams.map((t) => ({ ...t, name: "A very long constructor name that does not fit" })) };
    const written = textOf(buildPodiumCard(buildPodiumView(long, "prediction", picks)!));
    expect(written).toContain("A very long constructor…");
  });
});
