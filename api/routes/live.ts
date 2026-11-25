/**
 * Stateless & in-memory Live "As It Stands" WDC/WCC routes (`api/routes/live.ts`).
 *
 * Uses the existing pure FIA engine (`computeDriverStandings`, `computeConstructorStandings`,
 * `driverStatus`, `teamStatus`) with zero writes to `f1gstats.sqlite` or `to-the-flag.sqlite`.
 */
import { Elysia } from "elysia";
import { zoneSize, type DistanceTier, type SessionKind } from "../../engine/points";
import { activeDrivers, parseSessionKey, remainingSessions, sessionKey } from "../../engine/sessions";
import { computeConstructorStandings, computeDriverStandings } from "../../engine/standings";
import { driverStatus, type TitleStatus } from "../../engine/status";
import { teamStatus } from "../../engine/teamStatus";
import type { Scenario, SeasonState, SessionKey, SessionLock } from "../../engine/types";
import { writeGuard, type GuardOptions } from "../guard";
import type { SeasonLoader } from "../seasonLoader";

const VALID_TIERS = new Set<DistanceTier>(["full", "ge50", "ge25", "lt25"]);

export interface LiveComputeInput {
  round?: number;
  kind?: SessionKind;
  tier?: DistanceTier;
  fixed?: Record<string, number | "out">;
  provisional?: boolean;
  lap?: number | null;
  totalLaps?: number | null;
  sessionName?: string | null;
}

export interface LiveWdcRow {
  rank: number;
  baseRank: number;
  deltaRank: number;
  driver: string;
  name: string;
  team: string;
  teamName: string;
  points: number;
  basePoints: number;
  deltaPoints: number;
  status: TitleStatus;
  gapToLeader: number;
  pointsToClinch: number | null;
}

export interface LiveWccRow {
  rank: number;
  baseRank: number;
  deltaRank: number;
  team: string;
  name: string;
  points: number;
  basePoints: number;
  deltaPoints: number;
  status: TitleStatus;
  gapToLeader: number;
  pointsToClinch: number | null;
}

export interface LiveTitleSummary {
  leader: string | null;
  leaderPoints: number;
  second: string | null;
  secondPoints: number;
  gap: number;
  leaderStatus: TitleStatus | null;
  pointsToClinch: number | null;
  clinchedBy: string | null;
  wccLeader: string | null;
  wccLeaderName: string | null;
  wccGap: number;
  wccClinchedBy: string | null;
}

export interface LiveComputeResult {
  season: number;
  asOfRound: number;
  sessionKey: SessionKey | null;
  round: number | null;
  kind: SessionKind | null;
  tier: DistanceTier;
  liveApplied: boolean;
  provisional: boolean;
  lap: number | null;
  totalLaps: number | null;
  sessionName: string | null;
  updatedAt: string;
  wdc: LiveWdcRow[];
  wcc: LiveWccRow[];
  titleSummary: LiveTitleSummary;
  scenario: Scenario;
}

export interface LiveStateEnvelope {
  active: boolean;
  updatedAt: string | null;
  snapshot: LiveComputeResult | null;
}

function resolveTargetSession(
  state: SeasonState,
  requestedRound?: number,
  requestedKind?: SessionKind,
): { key: SessionKey; round: number; kind: SessionKind } | null {
  const open = remainingSessions(state);
  if (open.length === 0) return null;

  if (requestedRound !== undefined && Number.isInteger(requestedRound)) {
    const kind: SessionKind = requestedKind === "sprint" ? "sprint" : "race";
    const key = sessionKey(requestedRound, kind);
    if (open.includes(key)) {
      return { key, round: requestedRound, kind };
    }
  }

  if (requestedKind === "sprint" || requestedKind === "race") {
    const match = open.find((k) => parseSessionKey(k).kind === requestedKind);
    if (match) {
      const parsed = parseSessionKey(match);
      return { key: match, round: parsed.round, kind: parsed.kind };
    }
  }

  const first = open[0];
  if (!first) return null;
  const parsed = parseSessionKey(first);
  return { key: first, round: parsed.round, kind: parsed.kind };
}

function sanitizeFixedPositions(
  state: SeasonState,
  kind: SessionKind,
  rawFixed: Record<string, number | "out"> | undefined,
): Record<string, number | "out"> {
  if (!rawFixed || typeof rawFixed !== "object") return {};
  const active = new Set(activeDrivers(state));
  const maxPos = zoneSize(kind);
  const usedPositions = new Set<number>();
  const clean: Record<string, number | "out"> = {};

  for (const [rawCode, val] of Object.entries(rawFixed)) {
    const code = rawCode.trim().toUpperCase();
    if (!active.has(code)) continue;
    if (val === "out") {
      clean[code] = "out";
      continue;
    }
    const pos = Number(val);
    if (Number.isInteger(pos) && pos >= 1 && pos <= maxPos && !usedPositions.has(pos)) {
      usedPositions.add(pos);
      clean[code] = pos;
    }
  }
  return clean;
}

function latestDriverTeams(state: SeasonState): Map<string, string> {
  const byDriver = new Map<string, { round: number; team: string }>();
  for (const r of state.results) {
    const prev = byDriver.get(r.driver);
    if (!prev || r.round >= prev.round) {
      byDriver.set(r.driver, { round: r.round, team: r.team });
    }
  }
  const out = new Map<string, string>();
  for (const [driver, entry] of byDriver.entries()) {
    out.set(driver, entry.team);
  }
  return out;
}

export function computeLiveAsItStands(
  state: SeasonState,
  input: LiveComputeInput = {},
  nowIso = new Date().toISOString(),
): LiveComputeResult {
  const tier: DistanceTier = input.tier && VALID_TIERS.has(input.tier) ? input.tier : "full";
  const target = resolveTargetSession(state, input.round, input.kind);

  let scenario: Scenario = { locks: {} };
  let liveApplied = false;

  if (target) {
    const fixed = sanitizeFixedPositions(state, target.kind, input.fixed);
    if (Object.keys(fixed).length > 0) {
      const lock: SessionLock = target.kind === "race" ? { fixed, tier } : { fixed };
      scenario = { locks: { [target.key]: lock } };
      liveApplied = true;
    }
  }

  const effectiveScenario = liveApplied ? scenario : undefined;
  const driverTable = computeDriverStandings(state, effectiveScenario);
  const teamTable = computeConstructorStandings(state, effectiveScenario);
  const dStatuses = driverStatus(state, effectiveScenario);
  const tStatuses = teamStatus(state, effectiveScenario);

  const dStatusByCode = new Map(dStatuses.map((s) => [s.driver, s]));
  const tStatusById = new Map(tStatuses.map((s) => [s.team, s]));
  const driverNames = new Map(state.drivers.map((d) => [d.code, d.name]));
  const teamNames = new Map(state.teams.map((t) => [t.id, t.name]));
  const driverTeams = latestDriverTeams(state);

  const wdc: LiveWdcRow[] = driverTable.map((row) => {
    const teamId = driverTeams.get(row.id) ?? "";
    const st = dStatusByCode.get(row.id);
    return {
      rank: row.rank,
      baseRank: row.baseRank,
      deltaRank: row.baseRank - row.rank,
      driver: row.id,
      name: driverNames.get(row.id) ?? row.id,
      team: teamId,
      teamName: teamNames.get(teamId) ?? teamId,
      points: row.points,
      basePoints: row.basePoints,
      deltaPoints: row.delta,
      status: st?.status ?? "alive",
      gapToLeader: st?.gapToLeader ?? 0,
      pointsToClinch: st?.pointsToClinch ?? null,
    };
  });

  const wcc: LiveWccRow[] = teamTable.map((row) => {
    const st = tStatusById.get(row.id);
    return {
      rank: row.rank,
      baseRank: row.baseRank,
      deltaRank: row.baseRank - row.rank,
      team: row.id,
      name: teamNames.get(row.id) ?? row.id,
      points: row.points,
      basePoints: row.basePoints,
      deltaPoints: row.delta,
      status: st?.status ?? "alive",
      gapToLeader: st?.gapToLeader ?? 0,
      pointsToClinch: st?.pointsToClinch ?? null,
    };
  });

  const p1 = wdc[0] ?? null;
  const p2 = wdc[1] ?? null;
  const wcc1 = wcc[0] ?? null;
  const wcc2 = wcc[1] ?? null;
  const clinchedDriver = wdc.find((r) => r.status === "clinched")?.driver ?? null;
  const clinchedTeam = wcc.find((r) => r.status === "clinched")?.name ?? null;

  return {
    season: state.season,
    asOfRound: state.asOfRound,
    sessionKey: target?.key ?? null,
    round: target?.round ?? null,
    kind: target?.kind ?? null,
    tier,
    liveApplied,
    provisional: Boolean(input.provisional),
    lap: typeof input.lap === "number" && Number.isFinite(input.lap) ? input.lap : null,
    totalLaps: typeof input.totalLaps === "number" && Number.isFinite(input.totalLaps) ? input.totalLaps : null,
    sessionName: typeof input.sessionName === "string" && input.sessionName.trim() ? input.sessionName.trim() : null,
    updatedAt: nowIso,
    wdc,
    wcc,
    titleSummary: {
      leader: p1?.driver ?? null,
      leaderPoints: p1?.points ?? 0,
      second: p2?.driver ?? null,
      secondPoints: p2?.points ?? 0,
      gap: p1 && p2 ? p1.points - p2.points : 0,
      leaderStatus: p1?.status ?? null,
      pointsToClinch: p1?.pointsToClinch ?? null,
      clinchedBy: clinchedDriver,
      wccLeader: wcc1?.team ?? null,
      wccLeaderName: wcc1?.name ?? null,
      wccGap: wcc1 && wcc2 ? wcc1.points - wcc2.points : 0,
      wccClinchedBy: clinchedTeam,
    },
    scenario,
  };
}

export function createLiveRoutes(loader: SeasonLoader, guardOptions?: GuardOptions) {
  let activeState: LiveStateEnvelope = {
    active: false,
    updatedAt: null,
    snapshot: null,
  };

  return new Elysia({ prefix: "/api/live" })
    .use(writeGuard(guardOptions))
    .get("/state", ({ set }) => {
      set.headers["cache-control"] = "no-cache";
      return activeState;
    })
    .post("/compute", ({ body, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const input = (body && typeof body === "object" ? body : {}) as LiveComputeInput;
      return computeLiveAsItStands(seasonRes.data.state, input);
    })
    .post("/state", ({ body, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const input = (body && typeof body === "object" ? body : {}) as LiveComputeInput;
      const snapshot = computeLiveAsItStands(seasonRes.data.state, input);
      activeState = {
        active: true,
        updatedAt: snapshot.updatedAt,
        snapshot,
      };
      set.headers["cache-control"] = "no-cache";
      return snapshot;
    })
    .delete("/state", ({ set }) => {
      activeState = {
        active: false,
        updatedAt: null,
        snapshot: null,
      };
      set.headers["cache-control"] = "no-cache";
      return { ok: true, active: false };
    });
}
