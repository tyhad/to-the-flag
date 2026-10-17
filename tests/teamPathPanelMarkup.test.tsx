/**
 * Phase 5 Step 7: the structure of the constructors' "Possible?" panel. Rendered to HTML on the server, so the checks run
 * without a browser. (The interactive parts, such as the switch surviving a trip to "Likely?", need a browser.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Scenario, SeasonState } from "../engine/types";
import { PossiblePanel, type PathSubject } from "../web/components/PossiblePanel";
import { buildTeamPathView } from "../web/viewModel/teamPath";
import { initialWorkspace, type Workspace } from "../web/viewModel/workspace";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const noop = () => {};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

function render(subject: PathSubject, workspace: Workspace = initialWorkspace(state)): string {
  return renderToStaticMarkup(
    <PossiblePanel state={state} workspace={workspace} dispatch={noop} subject={subject} onSubject={noop} />,
  );
}

describe("the Drivers / Constructors switch", () => {
  const html = render("wcc");

  test("is a labelled tab group with two tabs, the chosen one selected", () => {
    expect(html).toMatch(/role="tablist" aria-label="Which title"/);
    expect(count(html, /role="tab"/g)).toBe(2);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(html).toContain(">Drivers</button>");
    expect(html).toContain(">Constructors</button>");
    expect(html).toMatch(/id="path-subject-tab-wcc"[^>]*aria-selected="true"/);
  });

  test("the panel below is linked to the selected tab", () => {
    expect(html).toContain('role="tabpanel" id="path-subject-panel-wcc" aria-labelledby="path-subject-tab-wcc"');
    expect(render("wdc")).toContain('id="path-subject-panel-wdc" aria-labelledby="path-subject-tab-wdc"');
  });

  test("Drivers still shows the driver panel, unchanged", () => {
    const drivers = render("wdc");
    expect(drivers).toContain('id="path-contender"');
    expect(drivers).not.toContain('id="path-team"');
    expect(drivers).toMatch(/can still win the title\.|clinch the title|cannot win the title any more/);
  });
});

describe("the constructors' panel", () => {
  const html = render("wcc");

  test("a team select with a label, teams in the fight first, then the rest", () => {
    expect(html).toMatch(/<label for="path-team"[^>]*>Team<\/label>/);
    expect(html).toContain('<optgroup label="Still in the title fight">');
    expect(html).toContain('<optgroup label="Out of the title fight">');
    expect(html.indexOf("Still in the title fight")).toBeLessThan(html.indexOf("Out of the title fight"));
    expect(html.indexOf(">Mercedes</option>")).toBeLessThan(html.indexOf(">Cadillac F1 Team</option>"));
  });

  test("the default team is Ferrari (second, alive)", () => {
    expect(html).toMatch(/<option value="ferrari" selected="">Ferrari<\/option>/);
    expect(html).toContain("Ferrari can still win the constructors&#x27; title.");
  });

  test("the meter, the one-two line and the rival lines are there", () => {
    expect(html).toContain('role="meter"');
    expect(html).toContain("152 of 316 points (48%)");
    expect(html).toContain("No one-twos needed: P2 and P3 in every session is enough if every rival scores nothing.");
    expect(html).toContain("What the rivals may still score");
    expect(html).toContain("If Ferrari finish 1-2 in every remaining session, Mercedes can score at most");
    expect(html).toContain("Not a probability");
  });

  test("no probabilities and no model anywhere", () => {
    expect(html).not.toMatch(/chance|likely|odds|simulat|model estimate/i);
  });

  test("the load button is a plain button", () => {
    expect(html).toContain("Load easiest path into sandbox");
    expect(count(html, /<button type="button" class="type-label h-10/g)).toBe(1);
    expect(html).not.toContain("<form");
  });

  test("once the path is loaded every open session is locked: the team has clinched and there is nothing left to load", () => {
    const easiest = buildTeamPathView(state, undefined, "ferrari").easiest as Scenario;
    const loaded = render("wcc", { ...initialWorkspace(state), scenario: easiest });
    expect(loaded).toContain("Ferrari has clinched the constructors&#x27; title.");
    expect(loaded).not.toContain("Load easiest path");
    expect(loaded).not.toContain('role="meter"');
  });
});

describe("other teams", () => {
  test("the leader sees the clinch copy", () => {
    const html = render("wcc", { ...initialWorkspace(state), team: "mercedes" });
    expect(html).toContain("Mercedes lead. 166 more points clinch the constructors&#x27; title, if every rival scores the maximum.");
    expect(html).not.toContain("needs 0");
  });

  test("an eliminated team: the sentence, and nothing to load", () => {
    const html = render("wcc", { ...initialWorkspace(state), team: "rb" });
    expect(html).toContain("RB F1 Team cannot win the constructors&#x27; title any more.");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("Load easiest path");
    expect(html).not.toContain("What the rivals may still score");
  });
});

describe("a notice from loading", () => {
  const easiest = buildTeamPathView(state, undefined, "ferrari").easiest as Scenario;
  const note = "You can follow up to 8 contenders, so Lewis Hamilton was not added. Remove one to make room.";

  test("an info notice (after a successful load) is shown calmly", () => {
    const html = render("wcc", {
      ...initialWorkspace(state),
      scenario: easiest,
      notice: { scope: "path", message: note, tone: "info" },
    });
    expect(html).toContain('role="status"');
    expect(html).toContain("Remove one to make room.");
    expect(html).not.toContain('role="alert"');
  });

  test("a refusal is shown as an alert", () => {
    const html = render("wcc", { ...initialWorkspace(state), notice: { scope: "path", message: "That did not work." } });
    expect(html).toContain('role="alert"');
  });

  test("a notice for another place is not shown here", () => {
    const html = render("wcc", { ...initialWorkspace(state), notice: { scope: "contenders", message: "Elsewhere." } });
    expect(html).not.toContain("Elsewhere.");
  });
});
