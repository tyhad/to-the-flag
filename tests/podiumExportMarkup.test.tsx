/**
 * The Podium picture block of the Race tab, rendered on the server. Choosing drivers and pressing the button need a
 * browser; these checks cover what the HTML promises.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeasonState } from "../engine";
import { PodiumExport } from "../web/components/PodiumExport";
import { makeState } from "./helpers";

const six = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const base: SeasonState = makeState({
  rounds: 5,
  sprints: [4],
  completed: 3,
  teams: { red: ["AAA", "BBB"], blue: ["CCC", "DDD"], green: ["EEE", "FFF"] },
  results: { "1:race": six, "2:race": six, "3:race": six, "4:sprint": six },
});
const season: SeasonState = { ...base, rounds: base.rounds.map((r) => ({ ...r, name: `Grand Prix ${r.round}` })) };

const render = (state: SeasonState = season) => renderToStaticMarkup(<PodiumExport state={state} />);

describe("PodiumExport", () => {
  test("a heading, the mode and one picker per place", () => {
    const html = render();
    expect(html).toContain('aria-label="Export a podium picture"');
    expect(html).toContain(">Podium picture</h3>");
    expect(html).toContain('aria-label="Podium picture mode"');
    for (const option of ["Prediction", "Race result"]) expect(html).toContain(`>${option}</option>`);
    for (const label of ["P1 driver", "P2 driver", "P3 driver"]) expect(html).toContain(`aria-label="${label}"`);
  });

  test("starts empty, so the picture cannot be exported yet", () => {
    const html = render();
    for (const place of ["P1", "P2", "P3"]) expect(html).toContain(`<option value="" selected="">${place}</option>`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export picture<\/button>/);
  });

  test("says which race the prediction is for, and that it is a sprint weekend", () => {
    expect(render()).toContain("Grand Prix 4 · Round 4 · Sprint weekend");
  });

  test("a finished season has no prediction to export, and says so", () => {
    const html = render({ ...season, asOfRound: 5 });
    expect(html).toContain("The season is complete.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export picture<\/button>/);
  });
});
