/**
 * Elysia route handlers for scenarios and active scenario management.
 */
import { Elysia } from "elysia";
import { InvalidScenarioError } from "../../engine/scenario";
import type { ScenarioDatabase } from "../db";
import type { SeasonLoader } from "../seasonLoader";

export function createScenarioRoutes(loader: SeasonLoader, db: ScenarioDatabase) {
  return new Elysia()
    .get("/api/scenarios", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      return db.getScenarios(seasonRes.data.state);
    })

    .post("/api/scenarios", async ({ body, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }

      const input = body as any;
      if (!input || typeof input !== "object" || typeof input.name !== "string" || input.name.trim() === "") {
        set.status = 422;
        return { errors: ["Scenario name is required"] };
      }
      if (!input.locks || typeof input.locks !== "object") {
        set.status = 422;
        return { errors: ["Scenario locks must be an object"] };
      }

      try {
        const created = db.createScenario(
          {
            id: input.id,
            name: input.name.trim(),
            season: input.season,
            asOfRound: input.asOfRound,
            locks: input.locks,
            contenders: input.contenders,
          },
          seasonRes.data.state,
        );
        set.status = 201;
        return created;
      } catch (err) {
        if (err instanceof InvalidScenarioError) {
          set.status = 422;
          return { errors: [err.message] };
        }
        throw err;
      }
    })

    .get("/api/scenarios/:id", ({ params, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const scenario = db.getScenarioById(params.id, seasonRes.data.state);
      if (!scenario) {
        set.status = 404;
        return { error: "not_found", message: "Scenario not found" };
      }
      return scenario;
    })

    .put("/api/scenarios/:id", async ({ params, body, set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }

      const input = body as any;
      if (!input || typeof input !== "object") {
        set.status = 422;
        return { errors: ["Invalid request body"] };
      }

      try {
        const updated = db.updateScenario(
          params.id,
          {
            name: typeof input.name === "string" ? input.name.trim() : undefined,
            locks: input.locks,
            contenders: input.contenders,
          },
          seasonRes.data.state,
        );
        if (!updated) {
          set.status = 404;
          return { error: "not_found", message: "Scenario not found" };
        }
        return updated;
      } catch (err) {
        if (err instanceof InvalidScenarioError) {
          set.status = 422;
          return { errors: [err.message] };
        }
        throw err;
      }
    })

    .delete("/api/scenarios/:id", ({ params, set }) => {
      const deleted = db.deleteScenario(params.id);
      if (!deleted) {
        set.status = 404;
        return { error: "not_found", message: "Scenario not found" };
      }
      return { ok: true };
    })

    .get("/api/active-scenario", () => {
      const id = db.getActiveScenarioId();
      return { id };
    })

    .put("/api/active-scenario", async ({ body, set }) => {
      const input = body as any;
      const id = input && typeof input.id === "string" ? input.id.trim() : null;
      if (id !== null) {
        const seasonRes = loader.getSeason();
        const state = seasonRes.ok ? seasonRes.data.state : undefined;
        const exists = state ? db.getScenarioById(id, state) : null;
        if (!exists) {
          set.status = 404;
          return { error: "not_found", message: "Scenario not found" };
        }
      }

      db.setActiveScenarioId(id);
      return { id };
    });
}
