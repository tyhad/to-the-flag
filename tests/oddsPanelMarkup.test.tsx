/**
 * Phase 3 Step 11: the structure of the "Likely?" panel that keyboard and screen-reader users rely on.
 * The panel is rendered to HTML on the server, so these checks run without a browser. (The same structure was also
 * checked in a real browser with axe-core: 0 violations in every state.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOdds, type SeasonState } from "../engine";
import { OddsPanel } from "../web/components/OddsPanel";
import type { OddsPanelState, OddsTable } from "../web/viewModel/odds";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const result = computeOdds(state, undefined, { nSims: 300, seed: 1 });
const noop = () => {};

function render(panel: OddsPanelState, extra: { table?: OddsTable; formPercent?: number; hasLocks?: boolean } = {}): string {
  return renderToStaticMarkup(
    <OddsPanel
      state={state}
      panel={panel}
      hasLocks={extra.hasLocks ?? false}
      table={extra.table ?? "wdc"}
      onTable={noop}
      formPercent={extra.formPercent ?? 100}
      onFormPercent={noop}
    />,
  );
}
const ready: OddsPanelState = { status: "ready", result, base: null, errorKind: null };
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("the Likely panel markup", () => {
  const html = render(ready);

  test("says what it is: one level-2 heading, 'Model estimate', and the round it is as of", () => {
    expect(count(html, /<h2[ >]/g)).toBe(1);
    expect(html).toContain("Model estimate");
    expect(html).toContain("as of Round 16");
  });

  test("the Drivers/Teams switch is a labelled group of two toggle buttons, one pressed", () => {
    expect(html).toMatch(/role="group" aria-label="Which title"/);
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
    expect(count(html, /aria-pressed="false"/g)).toBe(1);
  });

  test("every button is a plain button, so it never submits anything", () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b).toContain('type="button"');
  });

  test("the slider has a visible label, its range and steps, and a spoken value", () => {
    expect(html).toMatch(/<label for="odds-form-weight"[^>]*>How much this season&#x27;s form counts<\/label>/);
    const input = html.match(/<input[^>]*id="odds-form-weight"[^>]*>/)![0];
    expect(input).toContain('type="range"');
    expect(input).toContain('min="0"');
    expect(input).toContain('max="100"');
    expect(input).toContain('step="10"');
    expect(input).toContain('aria-valuetext="100%, this season&#x27;s form"');
    expect(render(ready, { formPercent: 0 })).toContain('aria-valuetext="0%, all drivers equal"');
    expect(render(ready, { formPercent: 40 })).toContain('aria-valuetext="40%"');
  });

  test("'How this works' is a native disclosure, which the keyboard opens with Enter or Space", () => {
    expect(html).toMatch(/<details[^>]*><summary[^>]*>How this works<\/summary>/);
  });

  test("the bars are a labelled list; the track is decoration, the value is text a screen reader can say", () => {
    expect(html).toContain('<ul aria-label="Chance to win the drivers&#x27; title"');
    const tracks = count(html, /<div aria-hidden="true" class="h-2 w-full/g);
    const rows = count(html, /<li class="flex flex-col gap-1">/g);
    expect(rows).toBeGreaterThan(0);
    expect(tracks).toBe(rows);
    expect(count(html, /chance to win the title, model estimate/g)).toBe(rows);
  });

  test("nothing is shown as busy, failed or empty when the odds are ready", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain("Updating");
    expect(html).not.toContain("Calculating the odds");
  });

  test("focus is never removed and no tab order is forced", () => {
    expect(html).not.toMatch(/outline-none|outline-0/);
    expect(html).not.toMatch(/tabindex="[1-9]/i);
  });
});

describe("the Likely panel in each state", () => {
  test("recalculating: busy, announced politely, and the previous numbers stay, dimmed", () => {
    const html = render({ status: "calculating", result, base: null, errorKind: null });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<p role="status"[^>]*>Updating…<\/p>/);
    expect(html).toContain("opacity-60");
    expect(html).toContain("ANT");
  });

  test("nothing yet: a status message and no list", () => {
    const html = render({ status: "calculating", result: null, base: null, errorKind: null });
    expect(html).toMatch(/<p role="status"[^>]*>Calculating the odds…<\/p>/);
    expect(html).not.toContain("<ul");
    expect(html).toContain("Model estimate"); // even now it says what it is
  });

  test("an error is an alert in plain words, and the last numbers stay, dimmed", () => {
    const html = render({ status: "error", result, base: null, errorKind: "invalid_scenario" });
    expect(html).toMatch(/<div role="alert"/);
    expect(html).toContain("The locks do not fit the season data");
    expect(html).toContain("Reset the scenario");
    expect(html).toContain("opacity-60");
  });

  test("an error with nothing to show still explains itself", () => {
    const html = render({ status: "error", result: null, base: null, errorKind: "failed" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The odds could not be calculated");
    expect(html).not.toContain("Calculating the odds");
  });

  test("low confidence is said in words next to the tag", () => {
    const html = render({ status: "ready", result: { ...result, lowConfidence: true }, base: null, errorKind: null });
    expect(html).toContain("Low confidence");
    expect(html).toContain("Fewer than 5 rounds are complete");
  });

  test("the grid tag shows only when the real grid was used, and names the round", () => {
    const used = render({ status: "ready", result: { ...result, gridKnownRound: 17 }, base: null, errorKind: null });
    expect(used).toContain("Grid known: Round 17");
    expect(render(ready)).not.toContain("Grid known");
  });

  test("a what-if is said in words", () => {
    expect(render(ready, { formPercent: 50 })).toContain("What-if: form weight 50%.");
    expect(render(ready)).not.toContain("What-if");
  });

  test("with locks, every change is an arrow and a number, and says the same in words", () => {
    const html = render({ status: "ready", result, base: result, errorKind: null }, { hasLocks: true });
    expect(html).toMatch(/aria-hidden="true">(●|▲ \d+ pp|▼ \d+ pp)<\/span><span class="sr-only">(No clear change|Up|Down)/);
  });

  test("long team names are cut short, with the full name on hover", () => {
    const html = render(ready, { table: "wcc" });
    expect(html).toMatch(/<span class="type-title truncate text-text" title="Mercedes">Mercedes<\/span>/);
  });
});

describe("source rules for every component", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(tsx?|css)$/.test(name) ? [path] : [];
    });
  }
  const files = sources(join(import.meta.dir, "..", "web"));

  test("no component removes the focus outline", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\boutline-none\b|\boutline-0\b|outline:\s*none/);
    }
  });

  test("no component forces a tab order", () => {
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/tabIndex=\{[1-9]/);
    }
  });

  /** The opening tags of every <button in the text. A `>` inside `{...}` (an arrow function) does not end the tag. */
  function buttonTags(text: string): string[] {
    const tags: string[] = [];
    for (const m of text.matchAll(/<button\b/g)) {
      let depth = 0;
      let i = m.index! + m[0].length;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      tags.push(text.slice(m.index!, i + 1));
    }
    return tags;
  }

  test("every button in a component says its type", () => {
    let total = 0;
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      for (const tag of buttonTags(readFileSync(f, "utf8"))) {
        total++;
        expect(tag, f).toMatch(/\btype=/);
      }
    }
    expect(total).toBeGreaterThan(10); // the scan really found the buttons
  });
});
