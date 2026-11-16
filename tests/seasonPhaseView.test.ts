/**
 * Phase 10, Step 1 (D60): the words and rules of the two edge states in the web layer. View-models and the markup
 * of the panels; what a real browser shows (layout, focus) is not covered here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOdds, type SeasonState } from "../engine";
import { Header } from "../web/components/Header";
import { SessionsRail } from "../web/components/SessionsRail";
import { StandingsPanel } from "../web/components/StandingsPanel";
import { buildCard, type DrawCommand } from "../web/viewModel/card";
import { buildCardView } from "../web/viewModel/cardView";
import { emptyGridMessage } from "../web/viewModel/gridEditor";
import { headerLabel } from "../web/viewModel/health";
import { buildOddsView } from "../web/viewModel/odds";
import { buildPathView } from "../web/viewModel/path";
import { buildChips, type SavedScenario } from "../web/viewModel/scenarios";
import {
  analysisMessage,
  finalHeadline,
  lockDisabledReason,
  phaseHeaderLabel,
  seasonPhase,
  sessionsMessage,
  standingsHint,
  standingsMessage,
} from "../web/viewModel/seasonPhase";
import { buildTeamPathView } from "../web/viewModel/teamPath";
import { initialWorkspace } from "../web/viewModel/workspace";
import { completeSeasonFrom, notStartedFrom } from "./helpers";

const real = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const complete = completeSeasonFrom(real);
const notStarted = notStartedFrom(real);

const texts = (commands: DrawCommand[]) => commands.flatMap((c) => (c.type === "text" ? [c.text] : []));

describe("copy", () => {
  test("header: one plain line per edge state, none while the season runs", () => {
    expect(phaseHeaderLabel(2026, "complete")).toBe("Season 2026 · Season complete");
    expect(phaseHeaderLabel(2026, "not-started")).toBe("Season 2026 · Season not started");
    expect(phaseHeaderLabel(2026, "running")).toBeNull();
    const ready = { status: "ready", season: 2026, asOfRound: 23, dataStatus: "ok" } as const;
    expect(headerLabel(ready, "complete")).toBe("Season 2026 · Season complete");
    expect(headerLabel(ready)).toBe("Season 2026 · as of Round 23");
    expect(headerLabel({ status: "loading" }, "complete")).toBe("Loading season data");
  });

  test("messages exist only for the edge states", () => {
    expect(sessionsMessage("running")).toBeNull();
    expect(sessionsMessage("complete")?.title).toBe("Season complete");
    expect(sessionsMessage("not-started")?.title).toBe("Season not started");
    expect(standingsMessage("complete")).toBeNull();
    expect(standingsMessage("not-started")?.title).toBe("Season not started");
    expect(analysisMessage("not-started")?.title).toBe("Season not started");
    expect(analysisMessage("complete")).toBeNull();
    expect(lockDisabledReason("running")).toBeNull();
    expect(lockDisabledReason("complete")).toContain("nothing left to lock");
  });

  test("the table hint says final for a complete season and keeps the old line otherwise", () => {
    expect(standingsHint("complete", false)).toBe("Season complete. These standings are final.");
    expect(standingsHint("running", false)).toBe("Lock a result to see the table change.");
    expect(standingsHint("running", true)).toBeNull();
  });

  test("the Race tab says there is no race left, with the season complete", () => {
    const message = emptyGridMessage({
      status: "ready",
      info: { round: null, effective: null, data: null, override: null, differs: false },
    });
    expect(message?.title).toBe("No race left");
    expect(message?.text).toContain("Season complete");
  });

  test("no strike-through, no markup in any copy", () => {
    const all = [
      sessionsMessage("complete"),
      sessionsMessage("not-started"),
      standingsMessage("not-started"),
      analysisMessage("not-started"),
    ].flatMap((m) => [m!.title, m!.text]);
    for (const text of all) expect(text).not.toMatch(/[~<>]|\u0336/);
  });
});

describe("Possible?: the final result", () => {
  test("the driver who won says so, the others say where they finished", () => {
    const champion = buildPathView(complete, undefined, "ANT");
    expect(champion.headline).toBe("Final: Andrea Kimi Antonelli won the drivers' title with 369 points.");
    expect(champion.meter).toBeNull();
    expect(champion.conditions).toEqual([]);
    expect(champion.rivals).toEqual([]);
    expect(champion.easiest).toBeNull();
    const other = buildPathView(complete, undefined, "HAM");
    expect(other.headline).toBe("Final: Lewis Hamilton finished P2 with 271 points. The drivers' title is decided.");
  });

  test("the constructors say the same", () => {
    const winner = buildTeamPathView(complete, undefined, "mercedes");
    expect(winner.headline).toBe("Final: Mercedes won the constructors' title with 605 points.");
    expect(buildTeamPathView(complete, undefined, "ferrari").headline).toContain("finished P2");
  });

  test("a running season keeps its old sentences", () => {
    expect(buildPathView(real, undefined, "ANT").headline).not.toContain("Final");
  });

  test("a singular point is said in the singular", () => {
    expect(finalHeadline("X", "driver", 1, 1)).toBe("Final: X won the drivers' title with 1 point.");
  });
});

describe("Likely?: the final odds", () => {
  const final = computeOdds(complete, undefined, { nSims: 100 });
  const view = buildOddsView({ result: final, base: null, state: complete, table: "wdc", formPercent: 50, hasLocks: false });

  test("one row with 100%, a full bar, labeled Final and not as a model estimate", () => {
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]!.display).toBe("100%");
    expect(view.rows[0]!.widthPercent).toBe(100);
    expect(view.estimateLabel).toBe("Final");
    expect(view.asOf).toBe("Season complete");
    expect(view.lowConfidence).toBeNull();
    expect(view.clinched).toEqual([]);
    expect(view.outLine).toBeNull();
    expect(view.tableNote).toContain("final result");
    expect(view.howItWorks).toContain("nothing is simulated");
  });

  test("the constructors table is final too", () => {
    const teams = buildOddsView({ result: final, base: null, state: complete, table: "wcc", formPercent: 50, hasLocks: false });
    expect(teams.rows.map((r) => r.display)).toEqual(["100%"]);
  });

  test("a running season is still a model estimate", () => {
    const running = buildOddsView({
      result: computeOdds(real, undefined, { nSims: 100 }),
      base: null,
      state: real,
      table: "wdc",
      formPercent: 50,
      hasLocks: false,
    });
    expect(running.estimateLabel).toBe("Model estimate");
    expect(running.asOf).toBe("as of Round 16");
  });
});

describe("PNG card", () => {
  const workspace = initialWorkspace(complete);

  test("the view of a complete season is final", () => {
    const view = buildCardView(complete, workspace, [], null, computeOdds(complete, undefined, { nSims: 100 }));
    expect(view.isFinal).toBe(true);
    expect(view.isSimulation).toBe(false);
    expect(view.hasOdds).toBe(true);
  });

  test("it says Final instead of Round N, has no simulation line and labels odds Final", () => {
    const view = buildCardView(complete, workspace, [], null, computeOdds(complete, undefined, { nSims: 100 }));
    for (const size of ["square", "wide"] as const) {
      const lines = texts(buildCard(view, size));
      expect(lines).toContain("Season 2026 · Final");
      expect(lines.some((t) => /Round \d+/.test(t))).toBe(false);
      expect(lines.some((t) => t.startsWith("Simulation"))).toBe(false);
      expect(lines).toContain("Final");
      expect(lines).not.toContain("Model estimate");
    }
  });

  test("a running season keeps Round N and Model estimate", () => {
    const view = buildCardView(real, initialWorkspace(real), [], null, computeOdds(real, undefined, { nSims: 100 }));
    expect(view.isFinal).toBeUndefined();
    const lines = texts(buildCard(view, "square"));
    expect(lines).toContain("Season 2026 · Round 16");
    expect(lines).toContain("Model estimate");
  });
});

describe("saved scenarios of a complete season", () => {
  const saved: SavedScenario = {
    id: "a",
    name: "Late title",
    season: 2026,
    asOfRound: 16,
    locks: { "17:race": { fixed: { ANT: 1 } } },
    contenders: null,
    valid: false,
    stale: true,
    createdAt: "",
    updatedAt: "",
  } as unknown as SavedScenario;

  test("the chip says the season is complete and that it can only be renamed or deleted", () => {
    const chip = buildChips(23, [saved], null, null, true)[1]!;
    expect(chip.valid).toBe(false);
    expect(chip.note).toContain("season is complete");
    expect(chip.note).toContain("rename or delete");
  });

  test("while the season runs the old note is kept", () => {
    expect(buildChips(16, [saved], null, null, false)[1]!.note).toContain("no longer fits the current data");
  });
});

describe("panels, as markup", () => {
  const dispatch = () => {};

  test("header", () => {
    const html = renderToStaticMarkup(
      createElement(Header, { health: { status: "ready", season: 2026, asOfRound: 23, dataStatus: "ok" }, phase: "complete" }),
    );
    expect(html).toContain("Season 2026 · Season complete");
  });

  test("sessions rail: a complete season says so, shows no session card and no contender bar", () => {
    const html = renderToStaticMarkup(
      createElement(SessionsRail, { state: complete, workspace: initialWorkspace(complete), dispatch }),
    );
    expect(html).toContain("Season complete");
    expect(html).toContain("No session is left to lock");
    expect(html).not.toContain("Remaining sessions");
    expect(html).toContain("nothing left to lock");
  });

  test("sessions rail: before the first race there are no cards either", () => {
    const html = renderToStaticMarkup(
      createElement(SessionsRail, { state: notStarted, workspace: initialWorkspace(notStarted), dispatch }),
    );
    expect(html).toContain("Season not started");
    expect(html).not.toContain("Remaining sessions");
  });

  test("standings: complete keeps the final table with its hint; not started has a plain line, no table", () => {
    const done = renderToStaticMarkup(
      createElement(StandingsPanel, { season: { status: "ready", state: complete }, scenario: initialWorkspace(complete).scenario }),
    );
    expect(done).toContain("These standings are final.");
    expect(done).not.toContain("Lock a result to see the table change.");
    expect(done).toContain("ANT");

    const fresh = renderToStaticMarkup(
      createElement(StandingsPanel, { season: { status: "ready", state: notStarted }, scenario: initialWorkspace(notStarted).scenario }),
    );
    expect(fresh).toContain("Season not started");
    expect(fresh).toContain("once the first race has a result");
    expect(fresh).not.toContain("Lock a result to see the table change.");
  });
});

describe("seasonPhase through the web module", () => {
  test("is the engine's answer", () => {
    expect(seasonPhase(complete)).toBe("complete");
    expect(seasonPhase(notStarted)).toBe("not-started");
    expect(seasonPhase(real)).toBe("running");
  });
});
