import { describe, expect, test } from "bun:test";
import { buildCard, type CardView, type DrawCommand } from "../web/viewModel/card";

const mockRows = [
  {
    rank: 1,
    driverCode: "VER",
    driverName: "Max Verstappen",
    constructorId: "red_bull",
    currentPoints: 412,
    projectedPoints: 437,
    deltaPoints: 25,
    statusText: "Clinched",
    oddsDisplay: ">99%",
  },
  {
    rank: 2,
    driverCode: "NOR",
    driverName: "Lando Norris",
    constructorId: "mclaren",
    currentPoints: 398,
    projectedPoints: 410,
    deltaPoints: 12,
    statusText: "Alive",
    oddsDisplay: "<1%",
  },
  {
    rank: 3,
    driverCode: "ALB",
    driverName: "Alexander Albon Ansusinha The Longest Name In The Pit Lane",
    constructorId: "williams",
    currentPoints: 70,
    projectedPoints: 70,
    deltaPoints: 0,
    statusText: "✕ No title",
    oddsDisplay: "—",
  },
];

// Generate 25 rows to test row count limiting
const manyRows = Array.from({ length: 25 }, (_, i) => ({
  rank: i + 1,
  driverCode: `D${i + 1}`,
  driverName: `Driver Name ${i + 1}`,
  constructorId: "ferrari",
  currentPoints: 100 - i,
  projectedPoints: 110 - i,
  deltaPoints: 10,
  statusText: i === 0 ? "Alive" : "✕ No title",
  oddsDisplay: i === 0 ? "50%" : "<1%",
}));

const baseView: CardView = {
  season: 2026,
  asOfRound: 16,
  scenarioName: "Norris Win All Remaining Sessions",
  rows: mockRows,
  hasOdds: true,
};

function verifyBounds(commands: DrawCommand[], maxWidth: number, maxHeight: number) {
  for (const cmd of commands) {
    if (cmd.type === "rect") {
      expect(cmd.x).toBeGreaterThanOrEqual(0);
      expect(cmd.y).toBeGreaterThanOrEqual(0);
      expect(cmd.x + cmd.width).toBeLessThanOrEqual(maxWidth);
      expect(cmd.y + cmd.height).toBeLessThanOrEqual(maxHeight);
    } else if (cmd.type === "line") {
      expect(cmd.x1).toBeGreaterThanOrEqual(0);
      expect(cmd.x1).toBeLessThanOrEqual(maxWidth);
      expect(cmd.x2).toBeGreaterThanOrEqual(0);
      expect(cmd.x2).toBeLessThanOrEqual(maxWidth);
      expect(cmd.y1).toBeGreaterThanOrEqual(0);
      expect(cmd.y1).toBeLessThanOrEqual(maxHeight);
      expect(cmd.y2).toBeGreaterThanOrEqual(0);
      expect(cmd.y2).toBeLessThanOrEqual(maxHeight);
    } else if (cmd.type === "text") {
      expect(cmd.x).toBeGreaterThanOrEqual(0);
      expect(cmd.x).toBeLessThanOrEqual(maxWidth);
      expect(cmd.y).toBeGreaterThanOrEqual(0);
      expect(cmd.y).toBeLessThanOrEqual(maxHeight);
    }
  }
}

describe("web/viewModel/card: standings card layout", () => {
  describe("bounds and positioning", () => {
    test("every command stays inside card for square size (1080x1080)", () => {
      const commands = buildCard(baseView, "square");
      expect(commands.length).toBeGreaterThan(10);
      verifyBounds(commands, 1080, 1080);
    });

    test("every command stays inside card for wide size (1920x1080)", () => {
      const commands = buildCard(baseView, "wide");
      expect(commands.length).toBeGreaterThan(10);
      verifyBounds(commands, 1920, 1080);
    });
  });

  describe("header and labels", () => {
    test("includes title, season, round, and scenario name", () => {
      const commands = buildCard(baseView, "square");
      const texts = commands.filter((c) => c.type === "text").map((c) => (c as any).text);

      expect(texts).toContain("To the Flag");
      expect(texts.some((t) => t.includes("Season 2026") && t.includes("Round 16"))).toBe(true);
      expect(texts.some((t) => t.includes("Norris Win All"))).toBe(true);
    });
  });

  describe("odds display and label", () => {
    test("displays 'Model estimate' and odds values when hasOdds is true", () => {
      const commands = buildCard({ ...baseView, hasOdds: true }, "square");
      const texts = commands.filter((c) => c.type === "text").map((c) => (c as any).text);

      expect(texts.some((t) => t.includes("Model estimate"))).toBe(true);
      expect(texts).toContain(">99%");
      expect(texts).toContain("<1%");
    });

    test("does not display 'Model estimate' when hasOdds is false", () => {
      const commands = buildCard({ ...baseView, hasOdds: false }, "square");
      const texts = commands.filter((c) => c.type === "text").map((c) => (c as any).text);

      expect(texts.some((t) => t.includes("Model estimate"))).toBe(false);
      expect(texts).not.toContain(">99%");
    });
  });

  describe("no-title mark", () => {
    const statusCommands = (view: CardView) =>
      buildCard(view, "square").filter(
        (c): c is Extract<DrawCommand, { type: "text" }> => c.type === "text" && /Clinched|Alive|No title/.test(c.text),
      );

    test("a driver who cannot win the title shows '✕ No title'", () => {
      const texts = statusCommands(baseView).map((c) => c.text);
      expect(texts).toContain("✕ No title");
      expect(texts).not.toContain("Eliminated");
    });

    test("it is drawn in text-3, never in red (DESIGN.md: no-title is not an alarm)", () => {
      const cmd = statusCommands(baseView).find((c) => c.text === "✕ No title");
      expect(cmd?.fill).toBe("var(--color-text-3)");
      expect(cmd?.fill).not.toContain("red");
    });

    test("the other tags keep their colors", () => {
      const fills = Object.fromEntries(statusCommands(baseView).map((c) => [c.text, c.fill]));
      expect(fills["Clinched"]).toBe("var(--color-purple)");
      expect(fills["Alive"]).toBe("var(--color-green)");
    });

    test("nothing on the card is a strike-through (the draw commands have no such command)", () => {
      for (const size of ["square", "wide"] as const) {
        const types = new Set(buildCard(baseView, size).map((c) => c.type));
        expect([...types].sort()).toEqual(["line", "rect", "text"]);
        // the only line is the header divider, which is horizontal and spans the header, not a row
        const lines = buildCard(baseView, size).filter((c) => c.type === "line");
        expect(lines).toHaveLength(1);
      }
    });
  });

  describe("title info hidden (Off, or Auto while nobody is out)", () => {
    const texts = (view: CardView, size: "square" | "wide" = "square") =>
      buildCard(view, size).filter((c): c is Extract<DrawCommand, { type: "text" }> => c.type === "text");
    const hidden: CardView = { ...baseView, showTitleInfo: false };

    test("no STATUS header and no status text on any row", () => {
      for (const size of ["square", "wide"] as const) {
        const all = texts(hidden, size).map((c) => c.text);
        expect(all).not.toContain("STATUS");
        for (const status of ["Clinched", "Alive", "Long shot", "✕ No title"]) expect(all).not.toContain(status);
      }
    });

    test("rank, driver, points and the change column stay", () => {
      for (const size of ["square", "wide"] as const) {
        const all = texts(hidden, size).map((c) => c.text);
        for (const header of ["#", "DRIVER", "POINTS", "+/-"]) expect(all).toContain(header);
        expect(all).toContain("VER · Max Verstappen");
        expect(all).toContain("412 → 437");
        expect(all).toContain("+25");
      }
    });

    test("the odds column stays when there are odds", () => {
      const all = texts({ ...hidden, hasOdds: true }).map((c) => c.text);
      expect(all).toContain("ODDS");
      expect(all).toContain(">99%");
    });

    test("shown by default: a view without the flag draws the status column as before", () => {
      const all = texts(baseView).map((c) => c.text);
      expect(all).toContain("STATUS");
      expect(all).toContain("Clinched");
      expect(texts({ ...baseView, showTitleInfo: true }).map((c) => c.text)).toContain("STATUS");
    });

    test("only the status texts are gone: the same commands otherwise", () => {
      const withInfo = buildCard({ ...baseView, showTitleInfo: true }, "square");
      const without = buildCard(hidden, "square");
      const statusTexts = new Set(["STATUS", "Clinched", "Alive", "Long shot", "✕ No title"]);
      const stripped = withInfo.filter((c) => !(c.type === "text" && statusTexts.has(c.text)));
      expect(without).toEqual(stripped);
    });
  });

  describe("truncation", () => {
    test("truncates long driver names so they do not overflow", () => {
      const commands = buildCard(baseView, "square");
      const texts = commands.filter((c) => c.type === "text").map((c) => (c as any).text);

      const albonText = texts.find((t) => t.includes("ALB"));
      expect(albonText).toBeDefined();
      expect(albonText).toContain("…");
      expect(albonText!.length).toBeLessThan(35);
    });

    test("limits row count when given many drivers", () => {
      const commands = buildCard({ ...baseView, rows: manyRows }, "square");
      // Find row rank texts
      const rankTexts = commands
        .filter((c) => c.type === "text" && (c as any).align === "right")
        .map((c) => (c as any).text);

      // Should have top 10 or 12 rows, not all 25
      expect(rankTexts).toContain("1");
      expect(rankTexts).toContain("10");
      expect(rankTexts).not.toContain("25");
    });
  });

  describe("right-aligned numerals", () => {
    test("points and delta numerals are right-aligned", () => {
      const commands = buildCard(baseView, "square");
      const rightAlignedTexts = commands
        .filter((c) => c.type === "text" && (c as any).align === "right")
        .map((c) => (c as any).text);

      expect(rightAlignedTexts.some((t) => t.includes("412 → 437"))).toBe(true);
      expect(rightAlignedTexts.some((t) => t.includes("+25"))).toBe(true);
    });
  });

  describe("security: no secrets in card commands", () => {
    test("does not leak tokens, localhost, or file paths", () => {
      const commands = buildCard(baseView, "wide");
      for (const cmd of commands) {
        if (cmd.type === "text") {
          expect(cmd.text).not.toContain("token");
          expect(cmd.text).not.toContain("127.0.0.1");
          expect(cmd.text).not.toContain("localhost");
          expect(cmd.text).not.toContain("/api/");
          expect(cmd.text).not.toContain(".sqlite");
        }
      }
    });
  });
});