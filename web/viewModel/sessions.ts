/** Session cards and picker choices for the left rail (DESIGN.md section 6). Pure. */
import {
  activeDrivers,
  computeDriverStandings,
  parseSessionKey,
  remainingSessions,
  zoneSize,
  type Scenario,
  type SeasonState,
  type SessionKey,
  type SessionKind,
} from "../../engine";

export interface SlotView {
  /** 1-based finishing position. */
  position: number;
  driver: string | null;
}

export interface SessionCardView {
  key: SessionKey;
  round: number;
  kind: SessionKind;
  /** "Round 17 · Singapore · Sprint" */
  title: string;
  locked: boolean;
  /** P1 to P10 for a race, P1 to P8 for a sprint. */
  slots: SlotView[];
  /** Drivers marked out, in table order. */
  out: string[];
}

export interface DriverChoice {
  code: string;
  name: string;
}

/** "Round 17 · Singapore · Sprint". A placeholder name like "Round 4" is not repeated. */
export function sessionTitle(round: number, name: string, kind: SessionKind): string {
  const place = name.replace(/\s+Grand Prix$/i, "").trim();
  const kindLabel = kind === "race" ? "Race" : "Sprint";
  const hasPlace = place !== "" && !/^Round \d+$/i.test(place);
  return hasPlace ? `Round ${round} · ${place} · ${kindLabel}` : `Round ${round} · ${kindLabel}`;
}

/** Driver codes in table order (real results only), for stable lists. */
function tableOrder(state: SeasonState): Map<string, number> {
  return new Map(computeDriverStandings(state).map((row, i) => [row.id, i]));
}

/** One card per remaining session, in calendar order. */
export function buildSessionCards(state: SeasonState, scenario: Scenario): SessionCardView[] {
  const names = new Map(state.rounds.map((r) => [r.round, r.name]));
  const order = tableOrder(state);
  return remainingSessions(state).map((key) => {
    const { round, kind } = parseSessionKey(key);
    const lock = scenario.locks[key];
    const fixed = lock?.fixed ?? {};
    const entries = Object.entries(fixed);
    const slots: SlotView[] = Array.from({ length: zoneSize(kind) }, (_, i) => ({
      position: i + 1,
      driver: entries.find(([, p]) => p === i + 1)?.[0] ?? null,
    }));
    const out = entries
      .filter(([, p]) => p === "out")
      .map(([d]) => d)
      .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
    return {
      key,
      round,
      kind,
      title: sessionTitle(round, names.get(round) ?? "", kind),
      locked: lock !== undefined,
      slots,
      out,
    };
  });
}

/**
 * Drivers offered in a position slot: the assignable ones (every active driver when `assignable` is null),
 * plus anyone already placed in this session so their choice stays visible. Table order.
 */
export function pickerChoices(
  state: SeasonState,
  assignable: readonly string[] | null,
  card: SessionCardView,
): DriverChoice[] {
  const active = new Set(activeDrivers(state));
  const wanted = new Set<string>(assignable === null ? active : assignable.filter((d) => active.has(d)));
  for (const slot of card.slots) if (slot.driver) wanted.add(slot.driver);
  return choices(state, (code) => wanted.has(code));
}

/** Drivers who can still be marked out in this session: every active driver not already out. */
export function outChoices(state: SeasonState, card: SessionCardView): DriverChoice[] {
  const active = new Set(activeDrivers(state));
  const out = new Set(card.out);
  return choices(state, (code) => active.has(code) && !out.has(code));
}

function choices(state: SeasonState, keep: (code: string) => boolean): DriverChoice[] {
  const order = tableOrder(state);
  return state.drivers
    .filter((d) => keep(d.code))
    .sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999))
    .map((d) => ({ code: d.code, name: d.name }));
}
