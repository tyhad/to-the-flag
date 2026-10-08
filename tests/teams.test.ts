import { describe, expect, test } from "bun:test";
import { FALLBACK_TEAM_COLOR, TEAM_COLORS, teamColor } from "../web/theme/teams";

interface FixtureTeam {
  id: string;
  name: string;
}

const fixture = (await Bun.file(new URL("./fixtures/season-2026-r16.json", import.meta.url)).json()) as {
  teams: FixtureTeam[];
};

// Panel surfaces from DESIGN.md: s1 and s2.
const SURFACES = ["#1e2124", "#282c30"] as const;

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("team colors", () => {
  const fixtureIds = fixture.teams.map((t) => t.id);

  test("every team in the real fixture has a color", () => {
    expect(fixtureIds.filter((id) => !(id in TEAM_COLORS))).toEqual([]);
  });

  test("every entry matches a team in the 2026 fixture (catches a mistyped id; update with the fixture)", () => {
    expect(Object.keys(TEAM_COLORS).filter((id) => !fixtureIds.includes(id))).toEqual([]);
  });

  test("brand and display are 6-digit hex colors", () => {
    for (const [id, team] of Object.entries(TEAM_COLORS)) {
      expect(team.brand, id).toMatch(/^#[0-9a-f]{6}$/);
      expect(team.display, id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("display colors reach 3:1 contrast on both panel surfaces", () => {
    for (const [id, team] of Object.entries(TEAM_COLORS)) {
      for (const surface of SURFACES) {
        expect(contrast(team.display, surface), `${id} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("teamColor returns the display color; unknown ids fall back to the line color", () => {
    expect(teamColor("ferrari")).toBe(TEAM_COLORS.ferrari?.display);
    expect(teamColor("not_a_team")).toBe(FALLBACK_TEAM_COLOR);
  });
});
