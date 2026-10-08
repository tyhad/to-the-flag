/**
 * To the Flag API server.
 * Elysia backend serving season data, health status, scenarios, and overlay feeds.
 */
import { existsSync } from "node:fs";
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { config } from "../config";
import { SeasonLoader } from "./seasonLoader";

export interface ServerOptions {
  dbPath?: string;
  loader?: SeasonLoader;
}

export function createApp(options?: ServerOptions) {
  const dbPath = options?.dbPath ?? config.f1gstatsDb;
  const loader = options?.loader ?? new SeasonLoader(dbPath);

  const app = new Elysia();

  if (existsSync("dist")) {
    app.use(staticPlugin({ assets: "dist", prefix: "" }));
  }

  app.get("/api/health", ({ set }) => {
    const result = loader.getSeason();
    if (!result.ok) {
      set.status = result.statusCode;
      return { error: result.error, message: result.message };
    }
    const { state, schemaVersion } = result.data;
    return {
      ok: true,
      season: state.season,
      asOfRound: state.asOfRound,
      dataStatus: state.health.status,
      checkedAt: state.health.checkedAt,
      schemaVersion,
    };
  });

  app.get("/api/season", ({ request, set }) => {
    const result = loader.getSeason();
    if (!result.ok) {
      set.status = result.statusCode;
      return { error: result.error, message: result.message };
    }
    const { state, etag } = result.data;

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
      set.status = 304;
      set.headers["etag"] = etag;
      return;
    }

    set.headers["etag"] = etag;
    return state;
  });

  return app;
}

export const app = createApp();

if (import.meta.main) {
  app.listen({ port: config.port, hostname: config.host }, (server) => {
    console.log(`Server listening at http://${server.hostname}:${server.port}`);
  });
}
