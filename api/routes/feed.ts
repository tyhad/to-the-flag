/**
 * Elysia routes for flat JSON overlay feed (/api/feed/*).
 * Served to LiveOverlay Studio or streaming tools.
 */
import { Elysia } from "elysia";
import { computeDriverStandings, computeConstructorStandings } from "../../engine/standings";
import { driverStatus } from "../../engine/status";
import { solveWdc } from "../../engine/solver";
import type { ScenarioDatabase } from "../db";
import type { SeasonLoader } from "../seasonLoader";

function flattenTopN(prefix: string, items: any[], n = 10): Record<string, any> {
  const result: Record<string, any> = {};
  for (let i = 1; i <= n; i++) {
    const item = items[i - 1];
    if (item && typeof item === "object") {
      for (const [key, val] of Object.entries(item)) {
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean" || val === null) {
          result[`top${i}_${prefix}${key}`] = val;
        }
      }
    } else {
      result[`top${i}_${prefix}driver`] = "";
      result[`top${i}_${prefix}team`] = "";
      result[`top${i}_${prefix}name`] = "";
      result[`top${i}_${prefix}points`] = 0;
      result[`top${i}_${prefix}rank`] = i;
    }
  }
  return result;
}

function computeEtag(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

export function createFeedRoutes(loader: SeasonLoader, db: ScenarioDatabase) {
  return new Elysia({ prefix: "/api/feed" })
    .onBeforeHandle(({ set }) => {
      set.headers["cache-control"] = "no-cache";
    })

    .get("/standings", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;
      const rawRows = computeDriverStandings(state);
      const driverMap = new Map(state.drivers.map((d) => [d.code, d.name]));

      const rows = rawRows.map((r) => ({
        rank: r.rank,
        driver: r.id,
        id: r.id,
        name: driverMap.get(r.id) ?? r.id,
        points: r.points,
        basePoints: r.basePoints,
        deltaPoints: r.delta,
        baseRank: r.baseRank,
        deltaRank: r.baseRank - r.rank,
      }));

      const baseMeta = {
        updated_at: state.health.checkedAt,
        as_of_round: state.asOfRound,
        data_status: state.health.status,
        season: state.season,
      };

      const flattened = flattenTopN("", rows, 10);
      const payload = {
        ...baseMeta,
        rows,
        ...flattened,
      };

      const jsonStr = JSON.stringify(payload);
      set.headers["etag"] = computeEtag(jsonStr);
      return payload;
    })

    .get("/status", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;
      const rawRows = driverStatus(state);
      const driverMap = new Map(state.drivers.map((d) => [d.code, d.name]));

      const rows = rawRows.map((r) => ({
        driver: r.driver,
        name: driverMap.get(r.driver) ?? r.driver,
        status: r.status,
        points: r.points,
        maxPossible: r.maxPossible,
        gapToLeader: r.gapToLeader,
        pointsToClinch: r.pointsToClinch,
      }));

      const baseMeta = {
        updated_at: state.health.checkedAt,
        as_of_round: state.asOfRound,
        data_status: state.health.status,
        season: state.season,
      };

      const flattened = flattenTopN("", rows, 10);
      const payload = {
        ...baseMeta,
        rows,
        ...flattened,
      };

      const jsonStr = JSON.stringify(payload);
      set.headers["etag"] = computeEtag(jsonStr);
      return payload;
    })

    .get("/path/:driver", ({ params, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;

      const code = params.driver.toUpperCase();
      const driverInfo = state.drivers.find((d) => d.code.toUpperCase() === code);

      if (!driverInfo || !driverInfo.active) {
        set.status = 404;
        return { error: "not_found", message: `Driver "${params.driver}" not found or not active` };
      }

      const pathResult = solveWdc(state, driverInfo.code);

      const payload = {
        updated_at: state.health.checkedAt,
        as_of_round: state.asOfRound,
        data_status: state.health.status,
        season: state.season,
        ...pathResult,
      };

      const jsonStr = JSON.stringify(payload);
      set.headers["etag"] = computeEtag(jsonStr);
      return payload;
    })

    .get("/odds", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;

      const payload = {
        updated_at: state.health.checkedAt,
        as_of_round: state.asOfRound,
        data_status: state.health.status,
        season: state.season,
        available: false,
      };

      const jsonStr = JSON.stringify(payload);
      set.headers["etag"] = computeEtag(jsonStr);
      return payload;
    })

    .get("/active-scenario", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;

      const activeId = db.getActiveScenarioId();
      const storedScenario = activeId ? db.getScenarioById(activeId, state) : null;

      const scenarioMeta = storedScenario ? { id: storedScenario.id, name: storedScenario.name } : null;
      const scenarioLocks = storedScenario?.locks;

      const scenarioArg = scenarioLocks ? { locks: scenarioLocks } : undefined;

      const driverMap = new Map(state.drivers.map((d) => [d.code, d.name]));
      const teamMap = new Map(state.teams.map((t) => [t.id, t.name]));

      const rawWdc = computeDriverStandings(state, scenarioArg);
      const wdc = rawWdc.map((r) => ({
        rank: r.rank,
        driver: r.id,
        id: r.id,
        name: driverMap.get(r.id) ?? r.id,
        points: r.points,
        basePoints: r.basePoints,
        deltaPoints: r.delta,
        baseRank: r.baseRank,
        deltaRank: r.baseRank - r.rank,
      }));

      const rawWcc = computeConstructorStandings(state, scenarioArg);
      const wcc = rawWcc.map((r) => ({
        rank: r.rank,
        team: r.id,
        id: r.id,
        name: teamMap.get(r.id) ?? r.id,
        points: r.points,
        basePoints: r.basePoints,
        deltaPoints: r.delta,
        baseRank: r.baseRank,
        deltaRank: r.baseRank - r.rank,
      }));

      const flattenedWdc = flattenTopN("wdc_", wdc, 10);
      const flattenedWcc = flattenTopN("wcc_", wcc, 10);
      const flattenedDirect = flattenTopN("", wdc, 10);

      const payload = {
        updated_at: state.health.checkedAt,
        as_of_round: state.asOfRound,
        data_status: state.health.status,
        season: state.season,
        scenario: scenarioMeta,
        wdc,
        wcc,
        ...flattenedDirect,
        ...flattenedWdc,
        ...flattenedWcc,
      };

      const jsonStr = JSON.stringify(payload);
      set.headers["etag"] = computeEtag(jsonStr);
      return payload;
    });
}
