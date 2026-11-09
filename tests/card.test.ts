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
    statusText: "Eliminated",
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
  statusText: i === 0 ? "Alive" : "Eliminated",
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
