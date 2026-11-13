/**
 * Phase 8, Step 3: the grid source tag and the notice, rendered on the server. (Colors, focus ring and layout need a
 * real browser; these checks cover what the HTML promises.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOdds, type SeasonState } from "../engine";
import { GridNotice } from "../web/components/GridNotice";
import { GridSourceTag } from "../web/components/GridSourceTag";
import { OddsPanel } from "../web/components/OddsPanel";
import { GRID_NOTICE_TEXT, gridNotice, type GridInfo } from "../web/viewModel/grid";
import type { OddsPanelState } from "../web/viewModel/odds";

const noop = () => {};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
// The disabled ATTRIBUTE: Tailwind class names such as "disabled:bg-s2" also contain the word.
const DISABLED_ATTR = /\sdisabled=""/;
const buttonLabelled = (html: string, label: string): string => html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];

describe("GridSourceTag", () => {
  test("a qualifying grid has the yellow color, an icon and the words", () => {
    const html = renderToStaticMarkup(<GridSourceTag source="qualifying" />);
    expect(html).toContain("Grid: qualifying (may differ from the real grid)");
    expect(html).toContain("border-yellow");
    expect(html).toContain("text-yellow");
    expect(count(html, /<svg/g)).toBe(1);
    expect(html).toContain('aria-hidden="true"'); // the icon is decoration; the words carry the meaning
  });

  test("manual and OpenF1 are plain: words only, no yellow, no icon", () => {
    for (const [source, text] of [["manual", "Grid: manual"], ["openf1", "Grid: OpenF1"]] as const) {
      const html = renderToStaticMarkup(<GridSourceTag source={source} />);
      expect(html).toContain(text);
      expect(html).not.toContain("yellow");
      expect(html).not.toContain("<svg");
    }
  });
});

describe("GridNotice", () => {
  const view = gridNotice(
    {
      round: 3,
      effective: { order: ["AAA", "BBB", "CCC"], pit: [], source: "manual" },
      data: { source: "openf1", order: ["BBB", "AAA", "CCC"] },
      override: { updatedAt: "x", valid: true },
      differs: true,
    } satisfies GridInfo,
    null,
  )!;
  const render = (extra: Partial<Parameters<typeof GridNotice>[0]> = {}) =>
    renderToStaticMarkup(
      <GridNotice notice={view} busy={false} error={null} canWrite verdict="open" onUseOpenF1={noop} onKeepMine={noop} {...extra} />,
    );

  test("says it in words, with both buttons", () => {
    const html = render();
    expect(html).toContain(GRID_NOTICE_TEXT);
    expect(html).toMatch(/<button[^>]*>Use OpenF1 grid<\/button>/);
    expect(html).toMatch(/<button[^>]*>Keep mine<\/button>/);
    expect(html).toContain('role="status"');
  });

  test("every button is a plain button and, when writing is allowed, neither is disabled", () => {
    const buttons = render().match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toContain('type="button"');
      expect(b).not.toMatch(DISABLED_ATTR);
    }
  });

  test("read-only: 'Use OpenF1 grid' is disabled and says why; 'Keep mine' still works (it writes nothing)", () => {
    const needsToken = render({ canWrite: false, verdict: "needs-token" });
    expect(buttonLabelled(needsToken, "Use OpenF1 grid")).toMatch(DISABLED_ATTR);
    expect(buttonLabelled(needsToken, "Keep mine")).not.toMatch(DISABLED_ATTR);
    expect(needsToken).toContain("Enter the write token to change the grid.");
    expect(render({ canWrite: false, verdict: "local-only" })).toContain("Writing is only allowed from this computer.");
  });

  test("while it runs: busy, a status line, and both buttons off", () => {
    const html = render({ busy: true });
    expect(html).toContain("Switching to the OpenF1 grid…");
    expect(html).toContain('aria-busy="true"');
    expect(buttonLabelled(html, "Use OpenF1 grid")).toMatch(DISABLED_ATTR);
    expect(buttonLabelled(html, "Keep mine")).toMatch(DISABLED_ATTR);
  });

  test("a failure is an alert in words, not just a color", () => {
    const html = render({ error: "Could not reach the server. Check that it is running." });
    expect(html).toMatch(/role="alert"[^>]*>Could not reach the server\. Check that it is running\.</);
  });
});

describe("the Likely panel with the grid tag and notice", () => {
  const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
  const result = computeOdds(state, undefined, { nSims: 300, seed: 1 });
  const render = (panel: OddsPanelState, extra: { gridTag?: boolean; gridNotice?: boolean } = {}) =>
    renderToStaticMarkup(
      <OddsPanel
        state={state}
        panel={panel}
        hasLocks={false}
        table="wdc"
        onTable={noop}
        formPercent={100}
        onFormPercent={noop}
        gridTag={extra.gridTag ? <GridSourceTag source="qualifying" /> : null}
        gridNotice={extra.gridNotice ? <p>THE NOTICE</p> : null}
      />,
    );
  const withGrid: OddsPanelState = { status: "ready", result: { ...result, gridKnownRound: 17 }, base: null, errorKind: null };
  const noGrid: OddsPanelState = { status: "ready", result, base: null, errorKind: null };

  test("the source tag sits right after 'Grid known: Round N'", () => {
    const html = render(withGrid, { gridTag: true });
    const known = html.indexOf("Grid known: Round 17");
    const tag = html.indexOf("Grid: qualifying");
    expect(known).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(known);
    // the same header row, before the 'as of' line
    expect(tag).toBeLessThan(html.indexOf("as of Round"));
  });

  test("without a known grid there is no source tag next to nothing", () => {
    expect(render(noGrid, { gridTag: true })).not.toContain("Grid: qualifying");
  });

  test("the notice is under the heading and before the Drivers/Teams switch", () => {
    const html = render(withGrid, { gridNotice: true });
    expect(html.indexOf("THE NOTICE")).toBeGreaterThan(html.indexOf("Model estimate"));
    expect(html.indexOf("THE NOTICE")).toBeLessThan(html.indexOf('aria-label="Which title"'));
  });

  test("nothing changes when no grid is passed", () => {
    const html = render(withGrid);
    expect(html).toContain("Grid known: Round 17");
    expect(html).not.toContain("Grid:");
    expect(html).not.toContain("THE NOTICE");
  });
});
