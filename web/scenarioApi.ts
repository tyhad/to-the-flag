/** Thin client for the scenario endpoints. Same-origin, relative URLs. Never throws: failures come back as plain words. */
import type { Scenario } from "../engine";
import {
  apiErrorMessage,
  parseSavedScenario,
  parseScenarioList,
  type SavedScenario,
} from "./viewModel/scenarios";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

const UNEXPECTED = "The server sent something unexpected. Try again.";

async function call(method: string, url: string, payload?: unknown): Promise<{ status: number | null; ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      ...(payload !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        : {}),
    });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  } catch {
    return { status: null, ok: false, body: null };
  }
}

function fail<T>(r: { status: number | null; body: unknown }): ApiResult<T> {
  return { ok: false, message: apiErrorMessage(r.status, r.body) };
}

export interface ScenarioInput {
  name: string;
  scenario: Scenario;
  contenders: readonly string[];
}

export const scenarioApi = {
  async list(): Promise<ApiResult<SavedScenario[]>> {
    const r = await call("GET", "/api/scenarios");
    if (!r.ok) return fail(r);
    const list = parseScenarioList(r.body);
    return list ? { ok: true, data: list } : { ok: false, message: UNEXPECTED };
  },

  async create(input: ScenarioInput): Promise<ApiResult<SavedScenario>> {
    const r = await call("POST", "/api/scenarios", {
      name: input.name,
      locks: input.scenario.locks,
      contenders: input.contenders,
    });
    if (!r.ok) return fail(r);
    const saved = parseSavedScenario(r.body);
    return saved ? { ok: true, data: saved } : { ok: false, message: UNEXPECTED };
  },

  async update(
    id: string,
    patch: { name?: string; scenario?: Scenario; contenders?: readonly string[] },
  ): Promise<ApiResult<SavedScenario>> {
    const r = await call("PUT", `/api/scenarios/${encodeURIComponent(id)}`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.scenario ? { locks: patch.scenario.locks } : {}),
      ...(patch.contenders ? { contenders: patch.contenders } : {}),
    });
    if (!r.ok) return fail(r);
    const saved = parseSavedScenario(r.body);
    return saved ? { ok: true, data: saved } : { ok: false, message: UNEXPECTED };
  },

  async remove(id: string): Promise<ApiResult<null>> {
    const r = await call("DELETE", `/api/scenarios/${encodeURIComponent(id)}`);
    return r.ok ? { ok: true, data: null } : fail(r);
  },

  async getActive(): Promise<ApiResult<string | null>> {
    const r = await call("GET", "/api/active-scenario");
    if (!r.ok) return fail(r);
    const id = typeof r.body === "object" && r.body !== null ? (r.body as { id?: unknown }).id : undefined;
    return typeof id === "string" || id === null ? { ok: true, data: id } : { ok: false, message: UNEXPECTED };
  },

  async setActive(id: string | null): Promise<ApiResult<string | null>> {
    const r = await call("PUT", "/api/active-scenario", { id });
    if (!r.ok) return fail(r);
    return { ok: true, data: id };
  },
};
