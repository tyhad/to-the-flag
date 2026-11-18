/**
 * Elysia route handlers for scenarios and active scenario management.
 */
import { Elysia } from "elysia";
import { InvalidScenarioError } from "../../engine/scenario";
import type { ScenarioDatabase } from "../db";
import type { SeasonLoader } from "../seasonLoader";
import { writeGuard, type GuardOptions } from "../guard";
import { buildScenarioFile, exportFileName, MAX_FILE_BYTES, parseScenarioFile } from "../scenarioFile";

/** The body as text, read in pieces and abandoned as soon as it is larger than `max` bytes. Null when too large. */
async function readTextCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createScenarioRoutes(
  loader: SeasonLoader,
  db: ScenarioDatabase,
  guardOptions?: GuardOptions,
) {
  return new Elysia()
    .use(writeGuard(guardOptions))
    .get("/api/scenarios", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      return db.getScenarios(seasonRes.data.state);
    })

    // Registered before "/api/scenarios/:id" so "export" is never read as an id. A read route: no token needed.
    .get("/api/scenarios/export", ({ set }) => {
      const seasonRes = loader.getSeason();
      if (!seasonRes.ok) {
        set.status = seasonRes.statusCode;
        return { error: seasonRes.error, message: seasonRes.message };
      }
      const { state } = seasonRes.data;
      set.headers["content-disposition"] = `attachment; filename="${exportFileName(state)}"`;
      return buildScenarioFile(db.getScenarios(state), state);
    })

    .post(
      "/api/scenarios/import",
      async ({ request, set }) => {
        const seasonRes = loader.getSeason();
        if (!seasonRes.ok) {
          set.status = seasonRes.statusCode;
          return { error: seasonRes.error, message: seasonRes.message };
        }
        const { state } = seasonRes.data;

        const text = await readTextCapped(request, MAX_FILE_BYTES);
        if (text === null) {
          set.status = 413;
          return { error: "too_large", message: "The file is larger than 1 MB." };
        }
        const parsed = parseScenarioFile(text, state, db.getScenarios(state).map((s) => s.name));
        if (!parsed.ok) {
          set.status = 422;
          return { error: parsed.code, message: parsed.message };
        }

        // Ids are made here, never read from the file. A scenario that fails at the last check is skipped, not fatal.
        const imported = [];
        const skipped = [...parsed.skipped];
        for (const item of parsed.accepted) {
          try {
            imported.push(
              db.createScenario(
                { name: item.name, season: item.season, asOfRound: item.asOfRound, locks: item.locks, contenders: item.contenders },
                state,
              ),
            );
          } catch (err) {
            if (!(err instanceof InvalidScenarioError)) throw err;
            skipped.push({ index: 0, name: item.name, reason: `${err.message}.` });
          }
        }
        return {
          imported: imported.length,
          skipped: skipped.length,
          scenarios: imported,
          skippedItems: skipped,
          renamed: parsed.accepted.filter((a) => a.requestedName).map((a) => ({ from: a.requestedName, to: a.name })),
        };
      },
      { parse: "none" },
    )

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
