/**
 * web/viewModel/card.ts - Standings card drawing layout generator (pure).
 * Generates drawing commands for canvas rendering without any DOM or Canvas APIs.
 */
import { teamColor } from "../theme/teams";
import type { TowerTab } from "./tower";
import { NO_TITLE_TEXT } from "./tower";

export type CardSize = "square" | "wide";
export type CardRowsChoice = "10" | "12" | "all";

export interface CardPositionRange {
  from: number;
  to: number;
}

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
  bestText?: string;
}

export interface CardView {
  season: number;
  asOfRound: number;
  scenarioName: string;
  rows: CardRow[];
  hasOdds?: boolean;
  /**
   * Draw the status column and best column (the same decision as the table's "Title info" choice).
   * Defaults to true; false gives a plain standings card: rank, driver, points and change (and odds).
   */
  showTitleInfo?: boolean;
  tab?: TowerTab;
  rowLimit?: CardRowsChoice;
  positionRange?: CardPositionRange;
  isSimulation?: boolean;
  simulationRound?: number;
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

/**
 * Formats driver name for the standings card to at most 2 words:
 * The word before the surname (first letter capitalized, rest lowercase),
 * and the surname/main name in UPPERCASE.
 * e.g. "Andrea Kimi Antonelli" -> "Kimi ANTONELLI"
 *      "Max Verstappen" -> "Max VERSTAPPEN"
 *      "Verstappen" -> "VERSTAPPEN"
 */
export function formatCardDriverName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.toUpperCase();

  const surname = parts[parts.length - 1]!.toUpperCase();
  const given = parts[parts.length - 2]!;
  const formattedGiven = given.charAt(0).toUpperCase() + given.slice(1).toLowerCase();

  return `${formattedGiven} ${surname}`;
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
  const isWcc = view.tab === "wcc";
  const width = isWide ? 1920 : 1080;
  const height = 1080;

  let rows = view.rows;
  if (view.positionRange) {
    const from = Math.max(1, view.positionRange.from);
    const to = Math.max(from, view.positionRange.to);
    rows = rows.filter((r) => r.rank >= from && r.rank <= to);
  } else {
    const rowLimit = view.rowLimit ?? "12";
    const maxRows = rowLimit === "10" ? 10 : rowLimit === "all" ? rows.length : 12;
    rows = rows.slice(0, maxRows);
  }
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

  // Title: Line 1 - Formula 1
  commands.push({
    type: "text",
    text: "Formula 1",
    x: leftX,
    y: isWide ? 90 : 72,
    font: isWide ? "700 44px var(--font-display)" : "700 34px var(--font-display)",
    fill: "var(--color-text)",
    align: "left",
    baseline: "middle",
  });

  // Title: Line 2 - Season ... · Round ...
  commands.push({
    type: "text",
    text: `Season ${view.season} · Round ${view.asOfRound}`,
    x: leftX,
    y: isWide ? 128 : 102,
    font: isWide ? "500 18px var(--font-ui)" : "500 15px var(--font-ui)",
    fill: "var(--color-text-2)",
    align: "left",
    baseline: "middle",
  });

  // Title: Line 3 - Championship Standings
  const standingsTitle = isWcc
    ? "World Constructors' Championship Standings"
    : "World Drivers' Championship Standings";
  commands.push({
    type: "text",
    text: standingsTitle,
    x: leftX,
    y: isWide ? 158 : 128,
    font: isWide ? "700 24px var(--font-display)" : "700 19px var(--font-display)",
    fill: "var(--color-text)",
    align: "left",
    baseline: "middle",
  });

  // Title: Line 4 - Simulation / Scenario if active
  const isSim = Boolean(view.isSimulation || view.simulationRound);
  const hasCustomScenario = Boolean(view.scenarioName && view.scenarioName !== "Base");
  if (isSim || hasCustomScenario) {
    const simText = isSim
      ? `Simulation to Round ${view.simulationRound ?? view.asOfRound}${hasCustomScenario ? ` · ${truncate(view.scenarioName, isWide ? 50 : 35)}` : ""}`
      : truncate(view.scenarioName, isWide ? 60 : 40);
    commands.push({
      type: "text",
      text: simText,
      x: leftX,
      y: isWide ? 186 : 152,
      font: isWide ? "600 18px var(--font-display)" : "600 15px var(--font-display)",
      fill: "var(--color-yellow)",
      align: "left",
      baseline: "middle",
    });
  }

  // Model estimate label
  if (view.hasOdds) {
    commands.push({
      type: "text",
      text: "Model estimate",
      x: rightX,
      y: isWide ? 90 : 72,
      font: isWide ? "600 20px var(--font-display)" : "600 16px var(--font-display)",
      fill: "var(--color-accent-text)",
      align: "right",
      baseline: "middle",
    });
  }

  // Divider
  const hasSub = isSim || hasCustomScenario;
  const dividerY = isWide ? (hasSub ? 210 : 182) : (hasSub ? 172 : 148);
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
  const colPoints = isWide ? 1320 : 675;
  const colDelta = isWide ? 1410 : 740;
  const colBest = isWide ? 1480 : 785;
  const colStatus = isWide ? 1560 : 835;
  const colOdds = rightX;

  // Table column headers
  const headerY = dividerY + (isWide ? 28 : 24);
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
    text: isWcc ? "CONSTRUCTOR" : "DRIVER",
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
      text: "BEST",
      x: colBest,
      y: headerY,
      font: headerFont,
      fill: headerColor,
      align: "center",
      baseline: "middle",
    });

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

  // 5. Credit text at bottom center
  const creditY = height - margin - 12;
  commands.push({
    type: "text",
    text: "to the flag by Tyhad | F1 Watchalong",
    x: width / 2,
    y: creditY,
    font: "500 14px var(--font-ui)",
    fill: "var(--color-text-3)",
    align: "center",
    baseline: "middle",
  });

  // 6. Dynamic Table rows
  const tableTopY = headerY + (isWide ? 24 : 20);
  const availHeight = creditY - 18 - tableTopY;
  const idealRowHeight = Math.floor(availHeight / Math.max(1, rows.length));
  const rowHeight = Math.max(28, Math.min(100, idealRowHeight));
  const tableHeight = rows.length * rowHeight;
  const extraVertical = Math.max(0, availHeight - tableHeight);
  const rowStartY = tableTopY + Math.min(80, Math.floor(extraVertical * 0.35));

  const rowFontSize = Math.max(13, Math.min(36, Math.round(rowHeight * 0.38)));
  const deltaFontSize = Math.max(12, Math.min(30, Math.round(rowHeight * 0.34)));
  const statusFontSize = Math.max(11, Math.min(22, Math.round(rowHeight * 0.28)));
  const oddsFontSize = Math.max(14, Math.min(36, Math.round(rowHeight * 0.40)));
  const stripHeight = Math.max(14, Math.min(50, Math.round(rowHeight * 0.55)));
  const stripWidth = rowHeight >= 70 ? 6 : 4;
  const centerYOffset = Math.floor(rowHeight / 2);
  const stripYOffset = Math.floor((rowHeight - stripHeight) / 2);

  const rowFont = `600 ${rowFontSize}px var(--font-display)`;
  const deltaFont = `600 ${deltaFontSize}px var(--font-display)`;
  const statusFont = `600 ${statusFontSize}px var(--font-ui)`;
  const oddsFont = `700 ${oddsFontSize}px var(--font-display)`;

  rows.forEach((row, idx) => {
    const rowY = rowStartY + idx * rowHeight;
    const centerY = rowY + centerYOffset;

    // Alternate row background
    if (idx % 2 === 1) {
      commands.push({
        type: "rect",
        x: leftX - 12,
        y: rowY + 2,
        width: cardWidth - 40,
        height: rowHeight - 4,
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
      font: rowFont,
      fill: "var(--color-text-3)",
      align: "right",
      baseline: "middle",
    });

    // Team color strip
    const stripX = colDriver - 16;
    commands.push({
      type: "rect",
      x: stripX,
      y: rowY + stripYOffset,
      width: stripWidth,
      height: stripHeight,
      fill: teamColor(row.constructorId),
      radius: 2,
    });

    // Driver code / name or constructor name
    let driverLabel: string;
    if (isWcc) {
      const maxChars = isWide ? 40 : 22;
      driverLabel = truncate(row.driverName ?? row.driverCode, maxChars);
    } else {
      const maxChars = isWide ? 30 : 20;
      const formattedName = row.driverName ? formatCardDriverName(row.driverName) : undefined;
      driverLabel = formattedName
        ? `${row.driverCode} · ${truncate(formattedName, maxChars)}`
        : row.driverCode;
    }

    commands.push({
      type: "text",
      text: driverLabel,
      x: colDriver,
      y: centerY,
      font: rowFont,
      fill: "var(--color-text)",
      align: "left",
      baseline: "middle",
    });

    // Points current -> projected (right aligned)
    // When unchanged, show only projected points
    const pointsText =
      row.currentPoints !== row.projectedPoints
        ? `${row.currentPoints} → ${row.projectedPoints}`
        : `${row.projectedPoints}`;

    commands.push({
      type: "text",
      text: pointsText,
      x: colPoints,
      y: centerY,
      font: rowFont,
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
      font: deltaFont,
      fill: deltaColor,
      align: "right",
      baseline: "middle",
    });

    // Best and Status (only with the title info)
    if (showStatus) {
      commands.push({
        type: "text",
        text: row.bestText ?? "—",
        x: colBest,
        y: centerY,
        font: deltaFont,
        fill: "var(--color-text-2)",
        align: "center",
        baseline: "middle",
      });

      commands.push({
        type: "text",
        text: row.statusText,
        x: colStatus,
        y: centerY,
        font: statusFont,
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
        font: oddsFont,
        fill: "var(--color-text)",
        align: "right",
        baseline: "middle",
      });
    }
  });

  return commands;
}