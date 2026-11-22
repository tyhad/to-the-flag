/**
 * The Weekend schedule block of the Race tab, rendered on the server.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeasonState } from "../engine";
import { ScheduleExport } from "../web/components/ScheduleExport";
import { makeState } from "./helpers";

const base = makeState({
  rounds: 22,
  sprints: [22],
  completed: 1,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
  results: { "1:race": ["AAA", "BBB", "CCC", "DDD"] },
});

const withSessions: SeasonState = {
  ...base,
  weekendSessions: [
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
      sessionType: "Race",
      startTimeUtc: "2026-11-29T16:00:00Z",
      circuitName: "Lusail International Circuit",
      countryFlag: "🇶🇦",
      relation: "next",
    },
  ],
};

describe("ScheduleExport", () => {
  test("renders heading, current/next selector, and enabled export button when sessions exist", () => {
    const html = renderToStaticMarkup(<ScheduleExport state={withSessions} />);
    expect(html).toContain('aria-label="Export weekend schedule"');
    expect(html).toContain(">Weekend schedule</h3>");
    expect(html).toContain('aria-label="Weekend schedule target"');
    expect(html).toContain(">Current weekend</option>");
    expect(html).toContain(">Next weekend</option>");
    expect(html).toContain("Las Vegas Grand Prix · Round 21");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Export picture<\/button>/);
  });

  test("disables export button when no sessions are available", () => {
    const html = renderToStaticMarkup(<ScheduleExport state={base} />);
    expect(html).toContain("No next race weekend in the data.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export picture<\/button>/);
  });
});
