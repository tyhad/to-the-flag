/**
 * Phase 3 Step 8: the worker file the build produces really answers requests on its own.
 * Bun runs it as a Worker, the same way a browser would load dist/oddsWorker.js.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeOdds, type SeasonState } from "../engine";
import { buildWeb } from "../scripts/build";
import type { OddsRequest, OddsResponse } from "../web/viewModel/oddsRequests";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
let out = "";
let workerPath = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "ttf-worker-"));
  await buildWeb({ clean: true, minify: true, outdir: out });
  workerPath = join(out, "oddsWorker.js");
}, 30_000);

afterAll(() => {
  try {
    rmSync(out, { recursive: true, force: true });
  } catch {
    // ignore: files can stay locked on Windows
  }
});

/** Sends the requests to one fresh worker and collects the answers, in the order they arrive. */
function ask(requests: OddsRequest[]): Promise<OddsResponse[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    const answers: OddsResponse[] = [];
    worker.onmessage = (event: MessageEvent<OddsResponse>) => {
      answers.push(event.data);
      if (answers.length === requests.length) {
        worker.terminate();
        resolve(answers);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(String(event.message)));
    };
    for (const r of requests) worker.postMessage(r);
  });
}

describe("the built odds worker", () => {
  test("the build writes the worker next to the page", () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  test("it answers a request with the same odds as the engine", async () => {
    const [answer] = await ask([{ id: 1, state, params: { nSims: 400, seed: 3 } }]);
    expect(answer).toMatchObject({ id: 1 });
    expect("result" in answer!).toBe(true);
    expect((answer as Extract<OddsResponse, { result: unknown }>).result).toEqual(computeOdds(state, undefined, { nSims: 400, seed: 3 }));
  }, 15_000);

  test("it answers several requests, each with its own id", async () => {
    const answers = await ask([
      { id: 10, state, params: { nSims: 200, seed: 1 } },
      { id: 11, state, params: { nSims: 300, seed: 1 } },
    ]);
    expect(answers.map((a) => a.id).sort()).toEqual([10, 11]);
  }, 15_000);

  test("a bad scenario comes back as an error answer, and the worker keeps working", async () => {
    const answers = await ask([
      { id: 1, state, scenario: { locks: { "1:race": { fixed: { NOR: 1 } } } }, params: { nSims: 100 } },
      { id: 2, state, params: { nSims: 100, seed: 1 } },
    ]);
    const byId = new Map(answers.map((a) => [a.id, a]));
    expect(byId.get(1)).toMatchObject({ kind: "invalid_scenario" });
    expect("result" in byId.get(2)!).toBe(true);
  }, 15_000);
});
