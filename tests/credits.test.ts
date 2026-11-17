/** Phase 10, Step 5 (D55, D56): credits, notices and licenses cannot drift from the code. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNOFFICIAL_NOTICE } from "../web/viewModel/credits";

const root = join(import.meta.dir, "..");
// Line endings are not content: a Windows checkout (autocrlf) or a package installed with CRLF must give the same text.
const read = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };

describe("THIRD_PARTY.md", () => {
  const text = read("THIRD_PARTY.md");

  test("every runtime dependency is listed, with the version range and the license it really has", () => {
    const names = Object.keys(pkg.dependencies);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const installed = JSON.parse(read(join("node_modules", name, "package.json"))) as { license?: string };
      const row = text.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, `${name} is missing from THIRD_PARTY.md`).toBeDefined();
      expect(row).toContain(`\`${pkg.dependencies[name]}\``);
      expect(installed.license).toBeTruthy();
      expect(row, `${name}: license differs from the installed package`).toContain(`| ${installed.license} |`);
    }
  });

  test("the Barlow fonts carry the copyright notice and the full SIL Open Font License 1.1", () => {
    expect(text).toContain("Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toContain("PREAMBLE");
    expect(text).toContain("PERMISSION & CONDITIONS");
    expect(text).toContain("TERMINATION");
    expect(text).toContain("DISCLAIMER");
  });

  test("the font license text is the one installed with the fonts", () => {
    const installed = read("node_modules/@fontsource/barlow/LICENSE").split("\n").slice(8).join("\n").trim();
    expect(text).toContain(installed);
  });
});

describe("README", () => {
  const readme = read("README.md");

  test("says there is no license, once", () => {
    expect(readme).toContain("No license is granted. The source is public for reference; all rights are reserved.");
    expect(existsSync(join(root, "LICENSE"))).toBe(false);
    expect(existsSync(join(root, "LICENSE.md"))).toBe(false);
    expect(JSON.parse(read("package.json")).license).toBeUndefined();
  });

  test("has the Data and credits section with the three sources, the not-affiliated line and the links", () => {
    expect(readme).toContain("## Data and credits");
    expect(readme).toContain(UNOFFICIAL_NOTICE);
    expect(readme).toContain("F1, FORMULA 1 and related marks belong to their owners.");
    expect(readme).toContain("Jolpica F1 API (api.jolpi.ca), the community successor to the Ergast API: schedules, results and standings.");
    expect(readme).toContain("FastF1, a Python library: session data.");
    expect(readme).toContain("OpenF1: starting-grid information.");
    expect(readme).toContain("Check each source's terms before reusing its data.");
    expect(readme).toContain("(docs/DATA_TERMS.md)");
    expect(readme).toContain("(THIRD_PARTY.md)");
  });
});

describe("the credits line in the page", () => {
  test("is the first two sentences of the README section", () => {
    const section = read("README.md").split("## Data and credits")[1]!.trim().split("\n\n")[0]!;
    // sentence one ends at "project.", sentence two at "any team." ("Formula One Licensing B.V." has dots inside)
    expect(section.startsWith(`${UNOFFICIAL_NOTICE} `)).toBe(true);
    expect(UNOFFICIAL_NOTICE.match(/\. (?=[A-Z])/g)).toHaveLength(1);
  });
});

describe("docs/DATA_TERMS.md", () => {
  const text = read("docs/DATA_TERMS.md");
  const rows = text.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Source") && !line.startsWith("|---"));

  test("has one row per source, each with a link to its terms or documentation", () => {
    expect(rows).toHaveLength(3);
    for (const [needle, host] of [
      ["Jolpica", "https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md"],
      ["FastF1", "https://docs.fastf1.dev"],
      ["OpenF1", "https://openf1.org/docs"],
    ] as const) {
      const row = rows.find((r) => r.startsWith(`| ${needle}`));
      expect(row, `${needle} row`).toBeDefined();
      expect(row).toContain(host);
    }
  });

  test("every row has the six columns", () => {
    for (const row of rows) expect(row.split(" | ").length).toBeGreaterThanOrEqual(6);
  });
});
