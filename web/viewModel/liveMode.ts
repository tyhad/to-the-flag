/**
 * Pure Live Mode view-model (`web/viewModel/liveMode.ts`).
 *
 * Parses `GET /api/live/state` responses from `to-the-flag` (fed in-memory by `theDirector`),
 * computes the header toggle label & tone, and overlays the live scenario onto the workspace
 * without mutating or discarding the user's manual scenario.
 *
 * Pure: no DOM, no fetch, no React.
 */
import type { Scenario, SessionKey, SessionLock } from "../../engine";
import type { Workspace } from "./workspace";

export type LiveToggleTone = "off" | "waiting" | "active" | "error";

export interface LiveModeFeed {
  active: boolean;
  updatedAt: string | null;
  round: number | null;
  kind: "race" | "sprint" | null;
  liveApplied: boolean;
  provisional: boolean;
  lap: number | null;
  totalLaps: number | null;
  sessionName: string | null;
  scenario: Scenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScenario(raw: unknown): Scenario {
  if (!isRecord(raw) || !isRecord(raw.locks)) {
    return { locks: {} };
  }
  const locks: Record<SessionKey, SessionLock> = {};
  for (const [key, val] of Object.entries(raw.locks)) {
    if (!isRecord(val) || !isRecord(val.fixed)) continue;
    const fixed: Record<string, number | "out"> = {};
    for (const [driver, pos] of Object.entries(val.fixed)) {
      if (pos === "out") {
        fixed[driver] = "out";
      } else if (typeof pos === "number" && Number.isInteger(pos) && pos >= 1) {
        fixed[driver] = pos;
      }
    }
    const tier =
      val.tier === "full" || val.tier === "ge50" || val.tier === "ge25" || val.tier === "lt25"
        ? val.tier
        : undefined;
    locks[key as SessionKey] = tier ? { fixed, tier } : { fixed };
  }
  return { locks };
}

/** Parse a `GET /api/live/state` response into a `LiveModeFeed`, or `null` if invalid/failed. */
export function parseLiveStateResponse(httpOk: boolean, body: unknown): LiveModeFeed | null {
  if (!httpOk || !isRecord(body)) return null;
  if (typeof body.active !== "boolean") return null;

  if (!body.active || !isRecord(body.snapshot)) {
    return {
      active: false,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
      round: null,
      kind: null,
      liveApplied: false,
      provisional: false,
      lap: null,
      totalLaps: null,
      sessionName: null,
      scenario: { locks: {} },
    };
  }

  const snap = body.snapshot;
  const kind = snap.kind === "race" || snap.kind === "sprint" ? snap.kind : null;

  return {
    active: true,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    round: typeof snap.round === "number" && Number.isFinite(snap.round) ? snap.round : null,
    kind,
    liveApplied: Boolean(snap.liveApplied),
    provisional: Boolean(snap.provisional),
    lap: typeof snap.lap === "number" && Number.isFinite(snap.lap) ? snap.lap : null,
    totalLaps: typeof snap.totalLaps === "number" && Number.isFinite(snap.totalLaps) ? snap.totalLaps : null,
    sessionName: typeof snap.sessionName === "string" && snap.sessionName.trim() ? snap.sessionName.trim() : null,
    scenario: parseScenario(snap.scenario),
  };
}

export function liveToggleTone(enabled: boolean, feed: LiveModeFeed | null, error: boolean): LiveToggleTone {
  if (!enabled) return "off";
  if (error) return "error";
  if (feed && feed.active) return "active";
  return "waiting";
}

export function liveToggleLabel(enabled: boolean, feed: LiveModeFeed | null, error: boolean): string {
  if (!enabled) return "Live";
  if (error) return "Live · Offline";
  if (!feed || !feed.active) return "Live · Waiting";

  const parts: string[] = ["Live"];
  if (feed.provisional) {
    parts.push("Provisional");
  } else if (!feed.liveApplied) {
    parts.push("Baseline");
  } else {
    if (feed.round !== null) parts.push(`R${feed.round}`);
    if (feed.lap !== null && feed.lap > 0) {
      parts.push(feed.totalLaps && feed.totalLaps > 0 ? `Lap ${feed.lap}/${feed.totalLaps}` : `Lap ${feed.lap}`);
    } else if (feed.kind === "sprint") {
      parts.push("Sprint");
    }
  }
  return parts.join(" · ");
}

/**
 * Returns the workspace with the live scenario overlaid when Live Mode is active and receiving live positions.
 * Never mutates the user's manual `workspace`.
 */
export function effectiveWorkspaceForLive(
  workspace: Workspace,
  enabled: boolean,
  feed: LiveModeFeed | null,
): Workspace {
  if (!enabled || !feed || !feed.active) return workspace;
  if (!feed.liveApplied) return workspace;
  if (Object.keys(feed.scenario.locks).length === 0) return workspace;
  return {
    ...workspace,
    scenario: feed.scenario,
  };
}
