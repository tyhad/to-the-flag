/**
 * The race weekend schedule card (web/viewModel/scheduleCard.ts). Pure: timezone resolution, dual-time formatting,
 * current/next target selection, and 1080×1080 canvas bounds.
 */
import { describe, expect, test } from "bun:test";
import type { SeasonState, WeekendSession } from "../engine";
import type { DrawCommand } from "../web/viewModel/card";
import {
  buildScheduleCard,
  buildScheduleView,
  defaultScheduleTarget,
  layoutScheduleCard,
  resolveCircuitTimeZone,
  scheduleFilename,
  scheduleRaceLine,
} from "../web/viewModel/scheduleCard";
import { makeState } from "./helpers";

const base = makeState({
  rounds: 24,
  sprints: [22],
  completed: 1,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
  results: { "1:race": ["AAA", "BBB", "CCC", "DDD"] },
});

const weekendSessions: WeekendSession[] = [
  {
    round: 21,
    raceName: "Las Vegas Grand Prix",
    sessionType: "FP1",
    startTimeUtc: "2026-11-20T00:30:00Z",
    circuitName: "Las Vegas Strip Street Circuit",
    countryFlag: "🇺🇸",
    relation: "now",
  },
  {
    round: 21,
    raceName: "Las Vegas Grand Prix",
    sessionType: "Qualifying",
    startTimeUtc: "2026-11-21T04:00:00Z",
    circuitName: "Las Vegas Strip Street Circuit",
    countryFlag: "🇺🇸",
    relation: "now",
  },
  {
    round: 21,
    raceName: "Las Vegas Grand Prix",
    sessionType: "Race",
    startTimeUtc: "2026-11-22T04:00:00Z",
    circuitName: "Las Vegas Strip Street Circuit",
    countryFlag: "🇺🇸",
    relation: "now",
  },
  {
    round: 22,
    raceName: "Qatar Grand Prix",
    sessionType: "FP1",
    startTimeUtc: "2026-11-27T13:30:00Z",
    circuitName: "Lusail International Circuit",
    countryFlag: "🇶🇦",
    relation: "next",
  },
  {
    round: 22,
    raceName: "Qatar Grand Prix",
    sessionType: "Sprint Qualifying",
    startTimeUtc: "2026-11-27T17:30:00Z",
    circuitName: "Lusail International Circuit",
    countryFlag: "🇶🇦",
    relation: "next",
  },
  {
    round: 22,
    raceName: "Qatar Grand Prix",
    sessionType: "Sprint",
    startTimeUtc: "2026-11-28T14:00:00Z",
    circuitName: "Lusail International Circuit",
    countryFlag: "🇶🇦",
    relation: "next",
  },
  {
    round: 22,
    raceName: "Qatar Grand Prix",
    sessionType: "Qualifying",
    startTimeUtc: "2026-11-28T18:00:00Z",
    circuitName: "Lusail International Circuit",
    countryFlag: "🇶🇦",
    relation: "next",
  },
  {
    round: 22,
    raceName: "Qatar Grand Prix",
    sessionType: "Race",
    startTimeUtc: "2026-11-29T16:00:00Z",
    circuitName: "Lusail International Circuit",
    countryFlag: "🇶🇦",
    relation: "next",
  },
];

const season: SeasonState = { ...base, weekendSessions };

describe("scheduleCard", () => {
  test("resolves known circuit and race timezones, falling back to UTC", () => {
    expect(resolveCircuitTimeZone("Las Vegas Strip Street Circuit")).toBe("America/Los_Angeles");
    expect(resolveCircuitTimeZone("Lusail International Circuit")).toBe("Asia/Qatar");
    expect(resolveCircuitTimeZone("Autódromo José Carlos Pace")).toBe("America/Sao_Paulo");
    expect(resolveCircuitTimeZone("Unknown Track", "Unknown GP")).toBe("UTC");
  });

  test("defaults to current ('now') when present, otherwise 'next'", () => {
    expect(defaultScheduleTarget(season)).toBe("now");
    const nextOnly: SeasonState = { ...base, weekendSessions: weekendSessions.filter((s) => s.relation === "next") };
    expect(defaultScheduleTarget(nextOnly)).toBe("next");
  });

  test("formats both track local time and user local time deterministically", () => {
    const view = buildScheduleView(season, "now", "Asia/Jakarta")!;
    expect(view.round).toBe(21);
    expect(view.raceName).toBe("Las Vegas Grand Prix");
    expect(view.hasSprint).toBe(false);
    // 2026-11-20T00:30:00Z = Thu 19 Nov 16:30 PST (UTC-8) and Fri 20 Nov 07:30 WIB (UTC+7)
    expect(view.rows[0]!.trackTime).toBe("Thu 19 Nov · 16:30");
    expect(view.rows[0]!.myTime).toBe("Fri 20 Nov · 07:30");
    expect(view.rows[2]!.isMain).toBe(true);
    expect(scheduleFilename(view)).toBe("schedule-2026-r21.png");
  });

  test("builds next weekend including sprint flag and handles missing targets", () => {
    const nextView = buildScheduleView(season, "next", "Asia/Jakarta")!;
    expect(nextView.round).toBe(22);
    expect(nextView.hasSprint).toBe(true);
    expect(scheduleRaceLine(season, "next")).toBe("Qatar Grand Prix · Round 22 · Sprint weekend");
    expect(buildScheduleView(base, "now", "Asia/Jakarta")).toBeNull();
    expect(scheduleRaceLine(base, "now")).toBe("No current race weekend in the data.");
  });

  test("every layout box and text stays inside the 1080×1080 canvas without overlap", () => {
    const view = buildScheduleView(season, "next", "Asia/Jakarta")!;
    const layout = layoutScheduleCard(view);
    const commands = buildScheduleCard(view);

    expect(layout.width).toBe(1080);
    expect(layout.height).toBe(1080);
    for (let i = 0; i < layout.rows.length; i++) {
      const r = layout.rows[i]!;
      expect(r.x).toBeGreaterThanOrEqual(layout.panel.x);
      expect(r.x + r.w).toBeLessThanOrEqual(layout.panel.x + layout.panel.w);
      expect(r.y + r.h).toBeLessThan(layout.creditY);
      if (i > 0) expect(r.y).toBeGreaterThanOrEqual(layout.rows[i - 1]!.y + layout.rows[i - 1]!.h);
    }
    const texts = commands.filter((c): c is Extract<DrawCommand, { type: "text" }> => c.type === "text");
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(1080);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(1080);
    }
  });
});
