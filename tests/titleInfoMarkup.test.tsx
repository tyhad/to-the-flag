/**
 * Phase 7, Step 5: the "Title info" switch, the hook and the table with the info hidden, rendered on the server.
 * (Focus ring, keyboard feel and layout need a real browser; the markup checks cover what the HTML promises.)
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StandingsPanel } from "../web/components/StandingsPanel";
import { TitleInfoSwitch } from "../web/components/TitleInfoSwitch";
import { Tower } from "../web/components/Tower";
import { TOWER_COLUMNS, TOWER_COLUMNS_PLAIN } from "../web/components/TowerRow";
import { useTitleInfo } from "../web/useTitleInfo";
import { TITLE_INFO_STORAGE_KEY, type TitleInfoMode, type TitleInfoStorage } from "../web/viewModel/titleInfo";
import { buildTowerRows } from "../web/viewModel/tower";
import { makeState } from "./helpers";

// AAA 75, BBB 54, CCC 45, DDD 36, EEE 20 (not racing). One race left. CCC and DDD can no longer win.
const state = makeState({
  rounds: 4,
  completed: 3,
  teams: { t: ["AAA", "BBB", "CCC", "DDD", "EEE"] },
  results: {
    "1:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
    "2:race": ["AAA", "BBB", "CCC", "DDD", "EEE"],
    "3:race": ["AAA", "BBB", "CCC", "DDD"],
  },
});
// Early in the season: nobody is out.
const early = makeState({
  rounds: 10,
  completed: 1,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"] },
  results: { "1:race": ["AAA", "BBB", "CCC", "DDD"] },
});

const noop = () => {};

describe("TitleInfoSwitch", () => {
  const render = (mode: TitleInfoMode) => renderToStaticMarkup(<TitleInfoSwitch mode={mode} onChange={noop} />);
  const radios = (html: string) =>
    [...html.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/g)].map((m) => ({
      tag: m[0],
      text: m[1]!.replace(/<[^>]*>/g, ""),
    }));

  test("a visible label 'Title info' and a radio group named by it", () => {
    const html = render("auto");
    expect(html).toMatch(/<span[^>]*id="title-info-label"[^>]*>Title info<\/span>/);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-labelledby="title-info-label"/);
  });

  test("three options in order: Auto, On, Off", () => {
    expect(radios(render("auto")).map((r) => r.text)).toEqual(["Auto", "On", "Off"]);
  });

  test("exactly the selected option is checked and in the tab order", () => {
    for (const [mode, index] of [["auto", 0], ["on", 1], ["off", 2]] as const) {
      const items = radios(render(mode));
      items.forEach((item, i) => {
        expect(item.tag).toContain(`aria-checked="${i === index}"`);
        expect(item.tag).toContain(`tabindex="${i === index ? 0 : -1}"`);
      });
    }
  });

  test("every option explains itself in a tooltip", () => {
    for (const item of radios(render("auto"))) expect(item.tag).toMatch(/title="[^"]{10,}"/);
    expect(render("auto")).toContain("once someone can no longer win the title");
  });

  test("the keyboard focus ring is never removed (DESIGN.md: never remove it)", () => {
    const html = render("on");
    expect(html).not.toMatch(/outline-none|outline-0|focus:outline-none/);
  });

  test("buttons are real buttons, not links or divs", () => {
    expect(radios(render("auto"))[0]!.tag).toMatch(/^<button[^>]*type="button"/);
  });

  test("the selected option uses the same selected look as the tabs: accent border and s2 fill", () => {
    const items = radios(render("on"));
    expect(items[1]!.tag).toContain("border-accent");
    expect(items[1]!.tag).toContain("bg-s2");
    expect(items[0]!.tag).not.toContain("bg-s2");
  });
});

describe("useTitleInfo", () => {
  function Probe({ storage }: { storage?: TitleInfoStorage }) {
    const [mode] = useTitleInfo(storage);
    return <span data-mode={mode}>{mode}</span>;
  }
  const modeOf = (storage?: TitleInfoStorage) => renderToStaticMarkup(<Probe storage={storage} />);

  test("the default is auto (no storage in this environment)", () => {
    expect(modeOf()).toContain('data-mode="auto"');
  });

  test("starts from the remembered choice", () => {
    const storage: TitleInfoStorage = {
      getItem: (key) => (key === TITLE_INFO_STORAGE_KEY ? "off" : null),
      setItem: () => {},
    };
    expect(modeOf(storage)).toContain('data-mode="off"');
  });

  test("storage that throws gives the default", () => {
    const storage: TitleInfoStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(modeOf(storage)).toContain('data-mode="auto"');
  });
});

describe("Tower with the title info hidden", () => {
  const rows = buildTowerRows(state, undefined, "wdc");
  const html = renderToStaticMarkup(<Tower rows={rows} label="Drivers' championship" showTitleInfo={false} />);

  test("no status tag and no Best column, header or hint", () => {
    for (const text of ["No title", "Alive", "Clinched", "Long shot", "not racing", "Best", "P1<", "P2<", "P5<"]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toContain("Highest place still possible");
    expect(html).not.toContain("<svg");
  });

  test("rank, team strip, driver, points and change are still there", () => {
    expect(html).toContain("Position </span>1");
    expect(html).toContain("Position </span>5");
    for (const code of ["AAA", "BBB", "CCC", "DDD", "EEE"]) expect(html).toContain(`>${code}<`);
    expect(html).toContain("75");
    expect(html).toContain("36");
    expect((html.match(/<li /g) ?? []).length).toBe(rows.length);
    expect(html).toMatch(/style="[^"]*background[^"]*"|bg-/); // the team strip
  });

  test("an out-of-title row is a plain row; a driver who is not racing is still dimmed", () => {
    expect(html).toMatch(/class="type-title truncate text-text"/);
    expect(html).toMatch(/class="type-title truncate text-text-3"/);
  });

  test("rows use the four-column template, not the six-column one", () => {
    expect(html).toContain(TOWER_COLUMNS_PLAIN);
    expect(html).not.toContain(TOWER_COLUMNS);
    expect(TOWER_COLUMNS_PLAIN.replace(/^grid-cols-\[|\]$/g, "").split("_")).toHaveLength(4);
  });

  test("nothing is struck through", () => {
    expect(html).not.toContain("line-through");
  });

  test("shown by default: Tower without the prop still draws everything (nothing else changed)", () => {
    const shown = renderToStaticMarkup(<Tower rows={rows} label="Drivers' championship" />);
    expect(shown).toContain(">No title<");
    expect(shown).toContain(">Best<");
    expect(shown).toContain(TOWER_COLUMNS);
  });
});

describe("StandingsPanel and the switch", () => {
  const panel = (opts: {
    mode: TitleInfoMode;
    state?: typeof state;
    compare?: Parameters<typeof StandingsPanel>[0]["compare"];
  }) =>
    renderToStaticMarkup(
      <StandingsPanel
        season={{ status: "ready", state: opts.state ?? state }}
        compare={opts.compare}
        titleInfo={{ mode: opts.mode, onChange: noop }}
      />,
    );

  test("the switch sits above the table", () => {
    const html = panel({ mode: "auto" });
    expect(html).toContain('role="radiogroup"');
    expect(html.indexOf('role="radiogroup"')).toBeLessThan(html.indexOf("<ol"));
  });

  test("On: tags and Best are drawn", () => {
    const html = panel({ mode: "on", state: early });
    expect(html).toContain(">Best<");
    expect(html).toContain(">Alive<");
  });

  test("Off: a plain table, even when drivers are out", () => {
    const html = panel({ mode: "off" });
    expect(html).not.toContain(">Best<");
    expect(html).not.toContain("No title");
    expect(html).toContain("Position </span>1");
  });

  test("Auto with someone out: drawn", () => {
    const html = panel({ mode: "auto" });
    expect(html).toContain(">Best<");
    expect(html).toContain(">No title<");
  });

  test("Auto with nobody out: a plain table", () => {
    const html = panel({ mode: "auto", state: early });
    expect(html).not.toContain(">Best<");
    expect(html).not.toContain(">Alive<");
    expect(html).toContain("Position </span>1");
  });

  test("the choice shows as selected in the switch", () => {
    expect(panel({ mode: "off" })).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Off</);
  });

  test("compare mode has no tower, so no switch", () => {
    const html = panel({ mode: "on", compare: { ok: false, message: "Choose two scenarios." } });
    expect(html).not.toContain('role="radiogroup"');
  });

  test("without a titleInfo prop (nothing to control) the panel still renders and shows the default, auto", () => {
    const html = renderToStaticMarkup(<StandingsPanel season={{ status: "ready", state }} />);
    expect(html).toContain(">No title<");
    expect(html).not.toContain('role="radiogroup"');
  });
});
