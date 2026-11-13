/**
 * Elysia route handlers for the starting grid of the next race (Phase 8, Step 2).
 *
 *   GET    /api/grid   which grid is in use, what the data file has, and whether a manual grid differs from OpenF1's
 *   PUT    /api/grid   save the manual grid of the next race  { order: [...], pit?: [...] }
 *   DELETE /api/grid   remove it again; the data file's grid is used from then on
 *
 * Reading is open like the other GET routes; PUT and DELETE go through the write guard (token, origin, JSON).
 */
import { Elysia } from "elysia";
import { gridProblems, nextScheduledRound } from "../../engine/grid";
import type { ScenarioDatabase } from "../db";
import { writeGuard, type GuardOptions } from "../guard";
import type { SeasonLoader } from "../seasonLoader";

function isCodeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function createGridRoutes(loader: SeasonLoader, db: ScenarioDatabase, guardOptions?: GuardOptions) {
  return new Elysia()
    .use(writeGuard(guardOptions))
    .get("/api/grid", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      set.headers["cache-control"] = "no-cache";
      return seasonRes.data.grid;
    })

    .put("/api/grid", ({ body, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }

      const input = body as { order?: unknown; pit?: unknown } | null;
      if (!input || typeof input !== "object" || !isCodeList(input.order)) {
        set.status = 422;
        return { errors: ["order must be a list of driver codes."] };
      }
      if (input.pit !== undefined && !isCodeList(input.pit)) {
        set.status = 422;
        return { errors: ["pit must be a list of driver codes."] };
      }
      const order = input.order;
      const pit = input.pit ?? [];

      const { state } = seasonRes.data;
      const round = nextScheduledRound(state);
      if (round === null) {
        set.status = 409;
        return { error: "no_upcoming_round", message: "There is no race left in this season to set a grid for." };
      }

      // The drivers and who is racing do not depend on the grid, so the merged state is fine to check against.
      const problems = gridProblems(state, order, pit);
      if (problems.length > 0) {
        set.status = 422;
        return { errors: problems };
      }

      db.setGridOverride(state.season, round, order, pit);
      const after = loader.getSeason();
      if (!after.ok) {
        set.status = after.statusCode;
        return { error: after.error, message: after.message };
      }
      return after.data.grid;
    })

    .delete("/api/grid", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;
      const round = nextScheduledRound(state);
      // Removing something that is not there is not an error: the result is the same, the data file's grid.
      if (round !== null) db.clearGridOverride(state.season, round);
      const after = loader.getSeason();
      if (!after.ok) {
        set.status = after.statusCode;
        return { error: after.error, message: after.message };
      }
      return after.data.grid;
    });
}
