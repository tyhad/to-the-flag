/**
 * web/viewModel/card.ts - Standings card drawing layout generator (pure).
 * Generates drawing commands for canvas rendering without any DOM or Canvas APIs.
 */
import { teamColor } from "../theme/teams";
import { NO_TITLE_TEXT } from "./tower";

export type CardSize = "square" | "wide";

export interface CardRow {
  rank: number;
  driverCode: string;
  driverName?: string;
  constructorId: string;
  currentPoints: number;
  projectedPoints: number;
  deltaPoints: number;
  statusText: string;
  oddsDisplay?: string;
}

export interface CardView {
  season: number;
  asOfRound: number;
  scenarioName: string;
  rows: CardRow[];
  hasOdds?: boolean;
  /**
   * Draw the status column (the same decision as the table's "Title info" choice). Defaults to true; false gives a
   * plain standings card: rank, driver, points and change (and odds, when there are odds).
   */
  showTitleInfo?: boolean;
}

export type DrawCommand =
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      radius?: number;
    }
  | {
      type: "text";
      text: string;
      x: number;
      y: number;
      font: string;
      fill: string;
      align: "left" | "right" | "center";
      baseline: "top" | "middle" | "bottom" | "alphabetic";
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      lineWidth: number;
    };

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

function statusColor(statusText: string): string {
  switch (statusText.toLowerCase()) {
    case "clinched":
      return "var(--color-purple)";
    case "alive":
      return "var(--color-green)";
    case "long shot":
      return "var(--color-yellow)";
    case NO_TITLE_TEXT.toLowerCase():
      // No fill and text-3, like the tag in the table. Red reads as an alarm (DESIGN.md section 9).
      return "var(--color-text-3)";
    default:
      return "var(--color-text-2)";
  }
}

export function buildCard(view: CardView, size: CardSize): DrawCommand[] {
  const isWide = size === "wide";
  const width = isWide ? 1920 : 1080;
  const height = 1080;
  const maxRows = 12;
  const rows = view.rows.slice(0, maxRows);
  const showStatus = view.showTitleInfo !== false;

  const commands: DrawCommand[] = [];

  // 1. Full canvas background
  commands.push({
    type: "rect",
    x: 0,
    y: 0,
    width,
    height,
    fill: "var(--color-s0)",
  });

  // 2. Main card container panel
  const margin = isWide ? 48 : 36;
  const cardWidth = width - margin * 2;
  const cardHeight = height - margin * 2;
  commands.push({
    type: "rect",
    x: margin,
    y: margin,
    width: cardWidth,
    height: cardHeight,
    fill: "var(--color-s1)",
    radius: 12,
  });

  // 3. Header
  const leftX = margin + 32;
  const rightX = margin + cardWidth - 32;

  // Title
  commands.push({
    type: "text",
    text: "To the Flag",
    x: leftX,
    y: isWide ? 110 : 88,
    font: isWide ? "700 48px var(--font-display)" : "700 38px var(--font-display)",
    fill: "var(--color-text)",
    align: "left",
    baseline: "middle",
  });

  // Subtitle
  commands.push({
    type: "text",
    text: `Season ${view.season} · as of Round ${view.asOfRound}`,
    x: leftX,
    y: isWide ? 155 : 124,
    font: isWide ? "500 20px var(--font-ui)" : "500 18px var(--font-ui)",
    fill: "var(--color-text-2)",
    align: "left",
    baseline: "middle",
  });

  // Scenario Name
  const maxScenarioChars = isWide ? 60 : 38;
  commands.push({
    type: "text",
    text: truncate(view.scenarioName, maxScenarioChars),
    x: leftX,
    y: isWide ? 190 : 156,
    font: isWide ? "600 22px var(--font-display)" : "600 20px var(--font-display)",
    fill: "var(--color-text-3)",
    align: "left",
    baseline: "middle",
  });

  // Model estimate label
  if (view.hasOdds) {
    commands.push({
      type: "text",
      text: "Model estimate",
      x: rightX,
      y: isWide ? 110 : 88,
      font: isWide ? "600 20px var(--font-display)" : "600 16px var(--font-display)",
      fill: "var(--color-accent-text)",
      align: "right",
      baseline: "middle",
    });
  }

  // Divider
  const dividerY = isWide ? 216 : 180;
  commands.push({
    type: "line",
    x1: leftX,
    y1: dividerY,
    x2: rightX,
    y2: dividerY,
    stroke: "var(--color-line)",
    lineWidth: 1,
  });

  // 4. Column X positions
  const colRank = leftX + (isWide ? 20 : 16);
  const colDriver = leftX + (isWide ? 100 : 70);
  const colPoints = isWide ? 1120 : 640;
  const colDelta = isWide ? 1280 : 730;
  const colStatus = isWide ? 1420 : 790;
  const colOdds = rightX;

  // Table column headers
  const headerY = isWide ? 250 : 210;
  const headerFont = "600 14px var(--font-ui)";
  const headerColor = "var(--color-text-3)";

  commands.push({
    type: "text",
    text: "#",
    x: colRank,
    y: headerY,
    font: headerFont,
    fill: headerColor,
    align: "right",
    baseline: "middle",
  });

  commands.push({
    type: "text",
    text: "DRIVER",
    x: colDriver,
    y: headerY,
    font: headerFont,
    fill: headerColor,
    align: "left",
    baseline: "middle",
  });

  commands.push({
    type: "text",
    text: "POINTS",
    x: colPoints,
    y: headerY,
    font: headerFont,
    fill: headerColor,
    align: "right",
    baseline: "middle",
  });

  commands.push({
    type: "text",
    text: "+/-",
    x: colDelta,
    y: headerY,
    font: headerFont,
    fill: headerColor,
    align: "right",
    baseline: "middle",
  });

  if (showStatus) {
    commands.push({
      type: "text",
      text: "STATUS",
      x: colStatus,
      y: headerY,
      font: headerFont,
      fill: headerColor,
      align: "left",
      baseline: "middle",
    });
  }

  if (view.hasOdds) {
    commands.push({
      type: "text",
      text: "ODDS",
      x: colOdds,
      y: headerY,
      font: headerFont,
      fill: headerColor,
      align: "right",
      baseline: "middle",
    });
  }

  // 5. Table rows
  const rowStartY = isWide ? 276 : 234;
  const rowHeight = isWide ? 58 : 58;

  rows.forEach((row, idx) => {
    const rowY = rowStartY + idx * rowHeight;
    const centerY = rowY + 28;

    // Alternate row background
    if (idx % 2 === 1) {
      commands.push({
        type: "rect",
        x: leftX - 12,
        y: rowY + 2,
        width: cardWidth - 40,
        height: rowHeight - 6,
        fill: "var(--color-s2)",
        radius: 6,
      });
    }

    // Rank (right aligned)
    commands.push({
      type: "text",
      text: String(row.rank),
      x: colRank,
      y: centerY,
      font: "600 20px var(--font-display)",
      fill: "var(--color-text-3)",
      align: "right",
      baseline: "middle",
    });

    // Team color strip
    const stripX = colDriver - 16;
    commands.push({
      type: "rect",
      x: stripX,
      y: rowY + 13,
      width: 4,
      height: 30,
      fill: teamColor(row.constructorId),
      radius: 2,
    });

    // Driver code and truncated name
    const maxDriverChars = isWide ? 30 : 16;
    const driverLabel = row.driverName
      ? `${row.driverCode} · ${truncate(row.driverName, maxDriverChars)}`
      : row.driverCode;

    commands.push({
      type: "text",
      text: driverLabel,
      x: colDriver,
      y: centerY,
      font: "600 20px var(--font-display)",
      fill: "var(--color-text)",
      align: "left",
      baseline: "middle",
    });

    // Points current -> projected (right aligned)
    commands.push({
      type: "text",
      text: `${row.currentPoints} → ${row.projectedPoints}`,
      x: colPoints,
      y: centerY,
      font: "600 20px var(--font-display)",
      fill: "var(--color-text)",
      align: "right",
      baseline: "middle",
    });

    // Delta points (right aligned)
    const deltaStr =
      row.deltaPoints > 0 ? `+${row.deltaPoints}` : row.deltaPoints < 0 ? `${row.deltaPoints}` : "—";
    const deltaColor =
      row.deltaPoints > 0
        ? "var(--color-green)"
        : row.deltaPoints < 0
          ? "var(--color-red)"
          : "var(--color-text-3)";

    commands.push({
      type: "text",
      text: deltaStr,
      x: colDelta,
      y: centerY,
      font: "600 18px var(--font-display)",
      fill: deltaColor,
      align: "right",
      baseline: "middle",
    });

    // Status (only with the title info)
    if (showStatus) {
      commands.push({
        type: "text",
        text: row.statusText,
        x: colStatus,
        y: centerY,
        font: "600 16px var(--font-ui)",
        fill: statusColor(row.statusText),
        align: "left",
        baseline: "middle",
      });
    }

    // Odds (right aligned)
    if (view.hasOdds) {
      commands.push({
        type: "text",
        text: row.oddsDisplay ?? "—",
        x: colOdds,
        y: centerY,
        font: "700 22px var(--font-display)",
        fill: "var(--color-text)",
        align: "right",
        baseline: "middle",
      });
    }
  });

  return commands;
}