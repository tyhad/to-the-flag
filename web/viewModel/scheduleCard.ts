/**
 * The race weekend schedule card (1080×1080 PNG): shows each session of the current ("now") or next ("next")
 * race weekend in both circuit local time ("Track time") and WIB ("WIB time", Asia/Jakarta).
 * Pure: data in, drawing commands out, no DOM and no canvas.
 */
import { nextScheduledRound, type SeasonState, type WeekendSession } from "../../engine";
import { buildCreditCommand, type DrawCommand } from "./card";
import type { Rect } from "./podiumCard";

export type ScheduleTarget = "now" | "next";

export interface ScheduleCardRow {
  sessionType: string;
  trackTime: string;
  myTime: string;
  isMain: boolean;
}

export interface ScheduleCardView {
  season: number;
  round: number;
  raceName: string;
  circuitName: string;
  hasSprint: boolean;
  trackZoneLabel: string;
  myZoneLabel: string;
  rows: ScheduleCardRow[];
}

export interface ScheduleCardLayout {
  width: number;
  height: number;
  panel: Rect;
  header: { text: string; x: number; y: number; font: string; fill: string }[];
  mode: { text: string; x: number; y: number; font: string; fill: string };
  columns: { label: string; x: number; y: number; align: "left" | "right" }[];
  rows: (Rect & ScheduleCardRow)[];
  creditY: number;
}

// ponytail: static circuit->IANA map covers the F1 calendar; move to F1GStats if new venues appear mid-season.
const CIRCUIT_TIMEZONES: readonly [pattern: string, zone: string][] = [
  ["bahrain", "Asia/Bahrain"],
  ["sakhir", "Asia/Bahrain"],
  ["jeddah", "Asia/Riyadh"],
  ["saudi", "Asia/Riyadh"],
  ["albert park", "Australia/Melbourne"],
  ["melbourne", "Australia/Melbourne"],
  ["australian", "Australia/Melbourne"],
  ["suzuka", "Asia/Tokyo"],
  ["japanese", "Asia/Tokyo"],
  ["shanghai", "Asia/Shanghai"],
  ["chinese", "Asia/Shanghai"],
  ["miami", "America/New_York"],
  ["imola", "Europe/Rome"],
  ["enzo e dino ferrari", "Europe/Rome"],
  ["emilia", "Europe/Rome"],
  ["monza", "Europe/Rome"],
  ["italian", "Europe/Rome"],
  ["monaco", "Europe/Monaco"],
  ["villeneuve", "America/Toronto"],
  ["montreal", "America/Toronto"],
  ["canadian", "America/Toronto"],
  ["catalunya", "Europe/Madrid"],
  ["barcelona", "Europe/Madrid"],
  ["madring", "Europe/Madrid"],
  ["madrid", "Europe/Madrid"],
  ["spanish", "Europe/Madrid"],
  ["red bull ring", "Europe/Vienna"],
  ["spielberg", "Europe/Vienna"],
  ["austrian", "Europe/Vienna"],
  ["silverstone", "Europe/London"],
  ["british", "Europe/London"],
  ["hungaroring", "Europe/Budapest"],
  ["hungarian", "Europe/Budapest"],
  ["spa", "Europe/Brussels"],
  ["francorchamps", "Europe/Brussels"],
  ["belgian", "Europe/Brussels"],
  ["zandvoort", "Europe/Amsterdam"],
  ["dutch", "Europe/Amsterdam"],
  ["baku", "Asia/Baku"],
  ["azerbaijan", "Asia/Baku"],
  ["marina bay", "Asia/Singapore"],
  ["singapore", "Asia/Singapore"],
  ["americas", "America/Chicago"],
  ["austin", "America/Chicago"],
  ["united states", "America/Chicago"],
  ["hermanos rodriguez", "America/Mexico_City"],
  ["mexico", "America/Mexico_City"],
  ["carlos pace", "America/Sao_Paulo"],
  ["interlagos", "America/Sao_Paulo"],
  ["sao paulo", "America/Sao_Paulo"],
  ["paulo", "America/Sao_Paulo"],
  ["brazil", "America/Sao_Paulo"],
  ["las vegas", "America/Los_Angeles"],
  ["lusail", "Asia/Qatar"],
  ["qatar", "Asia/Qatar"],
  ["yas marina", "Asia/Dubai"],
  ["abu dhabi", "Asia/Dubai"],
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Resolves an IANA timezone from a circuit or race name, falling back to "UTC" if unknown. */
export function resolveCircuitTimeZone(circuitName: string, raceName = ""): string {
  const haystack = `${normalize(circuitName)} ${normalize(raceName)}`;
  for (const [pattern, zone] of CIRCUIT_TIMEZONES) {
    if (haystack.includes(pattern)) return zone;
  }
  return "UTC";
}

function formatZoneShort(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

function formatSessionSlot(utcIso: string, timeZone: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return utcIso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("weekday")} ${get("day")} ${get("month")} · ${hour}:${get("minute")}`;
}

/** Default selector value: "now" when the data has a current weekend, otherwise "next". */
export function defaultScheduleTarget(state: SeasonState): ScheduleTarget {
  return state.weekendSessions?.some((s) => s.relation === "now") ? "now" : "next";
}

/** Sessions for the chosen target ("now" or "next"), sorted chronologically. */
export function scheduleSessionsFor(state: SeasonState, target: ScheduleTarget): WeekendSession[] {
  const all = state.weekendSessions ?? [];
  let matches = all.filter((s) => s.relation === target);
  if (matches.length === 0 && target === "next") {
    const next = nextScheduledRound(state);
    if (next !== null) matches = all.filter((s) => s.round === next && s.relation === null);
  }
  return [...matches].sort((a, b) => Date.parse(a.startTimeUtc) - Date.parse(b.startTimeUtc));
}

/** Status line shown under the controls. */
export function scheduleRaceLine(state: SeasonState, target: ScheduleTarget): string {
  const sessions = scheduleSessionsFor(state, target);
  if (sessions.length === 0) {
    if (nextScheduledRound(state) === null && target === "next") return "The season is complete.";
    return target === "now" ? "No current race weekend in the data." : "No next race weekend in the data.";
  }
  const first = sessions[0]!;
  const roundInfo = state.rounds.find((r) => r.round === first.round);
  const sprint = roundInfo?.hasSprint ? " · Sprint weekend" : "";
  return `${first.raceName || roundInfo?.name || `Round ${first.round}`} · Round ${first.round}${sprint}`;
}

/** Assembles the card data, or null when there are no sessions for the selected target. */
export function buildScheduleView(
  state: SeasonState,
  target: ScheduleTarget,
  userTimeZone?: string,
): ScheduleCardView | null {
  const sessions = scheduleSessionsFor(state, target);
  if (sessions.length === 0) return null;

  const first = sessions[0]!;
  const roundInfo = state.rounds.find((r) => r.round === first.round);
  const raceName = first.raceName || roundInfo?.name || `Round ${first.round}`;
  const circuitName = first.circuitName;
  const trackZone = resolveCircuitTimeZone(circuitName, raceName);
  const myZone = userTimeZone ?? "Asia/Jakarta";
  const refDate = new Date(first.startTimeUtc);
  const validRef = Number.isNaN(refDate.getTime()) ? new Date() : refDate;

  return {
    season: state.season,
    round: first.round,
    raceName,
    circuitName,
    hasSprint: roundInfo?.hasSprint ?? sessions.some((s) => s.sessionType.toLowerCase().includes("sprint")),
    trackZoneLabel: formatZoneShort(validRef, trackZone),
    myZoneLabel: formatZoneShort(validRef, myZone),
    rows: sessions.map((s) => ({
      sessionType: s.sessionType,
      trackTime: formatSessionSlot(s.startTimeUtc, trackZone),
      myTime: formatSessionSlot(s.startTimeUtc, myZone),
      isMain: s.sessionType === "Race" || s.sessionType === "Sprint",
    })),
  };
}

/** `schedule-2026-r21.png`. */
export function scheduleFilename(view: ScheduleCardView): string {
  return `schedule-${view.season}-r${view.round}.png`;
}

const MARGIN = 36;
const WIDTH = 1080;
const HEIGHT = 1080;

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}

/** Pure 1080×1080 layout used by both drawing and bounds tests. */
export function layoutScheduleCard(view: ScheduleCardView): ScheduleCardLayout {
  const panel: Rect = { x: MARGIN, y: MARGIN, w: WIDTH - MARGIN * 2, h: HEIGHT - MARGIN * 2 };
  const leftX = MARGIN + 32;
  const rightX = MARGIN + panel.w - 32;
  const creditY = HEIGHT - MARGIN - 12;

  const lines: { text: string; font: string; fill: string; step: number }[] = [
    { text: "Formula 1", font: "700 34px var(--font-display)", fill: "var(--color-text)", step: 40 },
    { text: `Season ${view.season} · Round ${view.round}`, font: "600 26px var(--font-display)", fill: "var(--color-text)", step: 32 },
    { text: truncate(view.raceName, 44), font: "500 20px var(--font-ui)", fill: "var(--color-text-2)", step: 28 },
  ];
  if (view.circuitName && view.circuitName !== view.raceName) {
    lines.push({ text: truncate(view.circuitName, 48), font: "500 17px var(--font-ui)", fill: "var(--color-text-3)", step: 26 });
  }
  if (view.hasSprint) {
    lines.push({ text: "Sprint weekend", font: "600 17px var(--font-ui)", fill: "var(--color-text-2)", step: 26 });
  }

  let y = MARGIN + 36;
  const header = lines.map((line) => {
    const placed = { text: line.text, x: leftX, y, font: line.font, fill: line.fill };
    y += line.step;
    return placed;
  });

  const colHeaderY = y + 18;
  const rowsTop = colHeaderY + 28;
  const rowsBottom = creditY - 32;
  const gap = 14;
  const count = Math.max(1, view.rows.length);
  const maxRowH = 104;
  const rowH = Math.min(maxRowH, Math.floor((rowsBottom - rowsTop - gap * (count - 1)) / count));
  const rowW = rightX - leftX;
  const trackX = leftX + Math.round(rowW * 0.62);
  const myX = rightX - 24;

  const rows = view.rows.map((r, i) => ({
    ...r,
    x: leftX,
    y: rowsTop + i * (rowH + gap),
    w: rowW,
    h: rowH,
  }));

  return {
    width: WIDTH,
    height: HEIGHT,
    panel,
    header,
    mode: {
      text: "Weekend schedule",
      x: rightX,
      y: MARGIN + 36,
      font: "600 17px var(--font-ui)",
      fill: "var(--color-text-2)",
    },
    columns: [
      { label: "Session", x: leftX + 24, y: colHeaderY, align: "left" },
      { label: `Track time (${view.trackZoneLabel})`, x: trackX, y: colHeaderY, align: "right" },
      { label: "WIB time", x: myX, y: colHeaderY, align: "right" },
    ],
    rows,
    creditY,
  };
}

/** The weekend schedule card (1080×1080) as drawing commands. */
export function buildScheduleCard(view: ScheduleCardView): DrawCommand[] {
  const layout = layoutScheduleCard(view);
  const commands: DrawCommand[] = [
    { type: "rect", x: 0, y: 0, width: layout.width, height: layout.height, fill: "var(--color-s0)" },
    { type: "rect", x: layout.panel.x, y: layout.panel.y, width: layout.panel.w, height: layout.panel.h, fill: "var(--color-s1)", radius: 12 },
  ];

  for (const line of layout.header) {
    commands.push({ type: "text", text: line.text, x: line.x, y: line.y, font: line.font, fill: line.fill, align: "left", baseline: "middle" });
  }
  commands.push({
    type: "text",
    text: layout.mode.text,
    x: layout.mode.x,
    y: layout.mode.y,
    font: layout.mode.font,
    fill: layout.mode.fill,
    align: "right",
    baseline: "middle",
  });

  for (const col of layout.columns) {
    commands.push({
      type: "text",
      text: col.label,
      x: col.x,
      y: col.y,
      font: "600 15px var(--font-ui)",
      fill: "var(--color-text-3)",
      align: col.align,
      baseline: "middle",
    });
  }

  const trackX = layout.columns[1]!.x;
  const myX = layout.columns[2]!.x;
  for (const row of layout.rows) {
    const midY = row.y + Math.round(row.h / 2);
    commands.push({ type: "rect", x: row.x, y: row.y, width: row.w, height: row.h, fill: "var(--color-s0)", radius: 10 });
    if (row.isMain) {
      commands.push({ type: "rect", x: row.x, y: row.y + 12, width: 4, height: row.h - 24, fill: "var(--color-text)", radius: 2 });
    }
    commands.push(
      {
        type: "text",
        text: truncate(row.sessionType, 22),
        x: row.x + 24,
        y: midY,
        font: "700 26px var(--font-display)",
        fill: row.isMain ? "var(--color-text)" : "var(--color-text-2)",
        align: "left",
        baseline: "middle",
      },
      {
        type: "text",
        text: row.trackTime,
        x: trackX,
        y: midY,
        font: "600 22px var(--font-display)",
        fill: "var(--color-text-2)",
        align: "right",
        baseline: "middle",
      },
      {
        type: "text",
        text: row.myTime,
        x: myX,
        y: midY,
        font: "700 22px var(--font-display)",
        fill: "var(--color-text)",
        align: "right",
        baseline: "middle",
      },
    );
  }

  commands.push(buildCreditCommand(layout.width / 2, layout.creditY));
  return commands;
}
