/** Export and import in the web layer (Phase 10, Step 3, D58): the words, the API client and the strip's buttons. */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeasonState } from "../engine/types";
import { ScenarioStrip } from "../web/components/ScenarioStrip";
import { scenarioApi } from "../web/scenarioApi";
import type { AccessInfo } from "../web/useAccess";
import type { ScenarioStore } from "../web/useScenarioStore";
import type { Strip } from "../web/useStrip";
import {
  describeImport,
  exportDisabledReason,
  importErrorMessage,
  importFileProblem,
  MAX_IMPORT_BYTES,
  parseImportSummary,
} from "../web/viewModel/scenarioFile";
import { initialWorkspace } from "../web/viewModel/workspace";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const noop = () => {};

const access = (over: Partial<AccessInfo> = {}): AccessInfo => ({
  verdict: "open",
  writeRequiresToken: false,
  canWrite: true,
  dialogOpen: false,
  openDialog: noop,
  closeDialog: noop,
  submitToken: async () => ({ ok: true }),
  clear: noop,
  ...over,
});
const store = (over: Partial<ScenarioStore> = {}): ScenarioStore => ({
  status: "ready",
  loadMessage: null,
  scenarios: [],
  activeId: null,
  busy: false,
  create: async () => ({ ok: true, data: {} as never }),
  update: async () => ({ ok: true, data: {} as never }),
  remove: async () => ({ ok: true, data: null }),
  setActive: async () => ({ ok: true, data: null }),
  importFile: async () => ({ ok: true, data: { imported: 0, skipped: 0, skippedItems: [], renamed: [] } }),
  ...over,
});
const strip = (): Strip =>
  ({
    selectedId: null,
    banner: null,
    compare: { open: false, left: "base", right: "base" },
    manualLink: null,
    selectChip: noop,
    toggleCompare: noop,
    setCompareSide: noop,
    copyLink: async () => {},
    toggleOverlay: async () => {},
    saveNew: async () => null,
    rename: async () => null,
    saveChanges: async () => {},
    removeSelected: async () => {},
    dismissBanner: noop,
  }) as unknown as Strip;
const saved = { id: "a", name: "One", season: 2026, asOfRound: 16, locks: {}, valid: true, stale: false, createdAt: "", updatedAt: "" };
const render = (a: AccessInfo, s: ScenarioStore) =>
  renderToStaticMarkup(<ScenarioStrip state={state} workspace={initialWorkspace(state)} store={s} strip={strip()} access={a} />);

describe("words", () => {
  test("Imported N, skipped M", () => {
    const report = describeImport({ imported: 3, skipped: 0, skippedItems: [], renamed: [] });
    expect(report).toEqual({ headline: "Imported 3, skipped 0.", details: [], tone: "info" });
  });

  test("each skipped scenario says who and why; a rename says both names", () => {
    const report = describeImport({
      imported: 1,
      skipped: 2,
      skippedItems: [
        { index: 2, name: "Old", reason: "It is for season 2025, and this app is on season 2026." },
        { index: 3, name: "", reason: "It has no name." },
      ],
      renamed: [{ from: "One", to: "One (2)" }],
    });
    expect(report.headline).toBe("Imported 1, skipped 2.");
    expect(report.tone).toBe("warn");
    expect(report.details).toEqual([
      '"Old" was skipped. It is for season 2025, and this app is on season 2026.',
      "Scenario 3 was skipped. It has no name.",
      '"One" is already saved, so the new one is called "One (2)".',
    ]);
  });

  test("a long list is cut with a count", () => {
    const skippedItems = Array.from({ length: 20 }, (_, i) => ({ index: i + 1, name: `S${i}`, reason: "No." }));
    const report = describeImport({ imported: 0, skipped: 20, skippedItems, renamed: [] });
    expect(report.details).toHaveLength(9);
    expect(report.details[8]).toBe("And 12 more.");
  });

  test("nothing imported is a warning, never a success", () => {
    expect(describeImport({ imported: 0, skipped: 0, skippedItems: [], renamed: [] }).tone).toBe("warn");
  });

  test("the answer of the server is read, and anything else is not", () => {
    expect(parseImportSummary({ imported: 1, skipped: 0, skippedItems: [], renamed: [], scenarios: [] })).toEqual({
      imported: 1,
      skipped: 0,
      skippedItems: [],
      renamed: [],
    });
    for (const bad of [null, [], "x", {}, { imported: "1", skipped: 0 }]) expect(parseImportSummary(bad)).toBeNull();
    expect(parseImportSummary({ imported: 0, skipped: 1, skippedItems: [1, null, { reason: 5 }, { reason: "r" }] })?.skippedItems).toEqual([
      { index: 0, name: "", reason: "r" },
    ]);
  });

  test("errors: no server, too large, a message from the server, and a bare status", () => {
    expect(importErrorMessage(null, null)).toContain("Could not reach the server");
    expect(importErrorMessage(413, null)).toContain("1 MB");
    expect(importErrorMessage(422, { error: "wrong_format", message: "This is not a To the Flag scenario file." })).toBe(
      "This is not a To the Flag scenario file.",
    );
    expect(importErrorMessage(500, {})).toBe("The server returned an error (500). Try again.");
  });

  test("a big file is stopped before it is read", () => {
    expect(importFileProblem({ size: MAX_IMPORT_BYTES })).toBeNull();
    expect(importFileProblem({ size: MAX_IMPORT_BYTES + 1 })).toContain("1 MB");
  });

  test("export says why it is off", () => {
    expect(exportDisabledReason(0)).toContain("No saved scenarios");
    expect(exportDisabledReason(1)).toBeNull();
  });
});

describe("api client", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("sends the file text as it is, as JSON, to the import route", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ imported: 2, skipped: 1, skippedItems: [], renamed: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = '{ "format": "to-the-flag-scenarios",   "version": 1, "scenarios": [] }';
    const r = await scenarioApi.importFile(text);
    expect(r).toEqual({ ok: true, data: { imported: 2, skipped: 1, skippedItems: [], renamed: [] } });
    expect(seen!.url).toBe("/api/scenarios/import");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.body).toBe(text);
    expect((seen!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  test("a refused file comes back in words", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "unsupported_version", message: "This file is version 2; this app reads version 1." }), {
        status: 422,
      })) as unknown as typeof fetch;
    const r = await scenarioApi.importFile("{}");
    expect(r).toEqual({ ok: false, message: "This file is version 2; this app reads version 1." });
  });

  test("no server", async () => {
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const r = await scenarioApi.importFile("{}");
    expect(r.ok).toBe(false);
  });

  test("an answer in the wrong shape is not trusted", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect((await scenarioApi.importFile("{}")).ok).toBe(false);
  });
});

describe("strip buttons", () => {
  test("both buttons are there, with a hidden file picker for JSON", () => {
    const html = render(access(), store({ scenarios: [saved] as never }));
    expect(html).toContain("Export scenarios");
    expect(html).toContain("Import scenarios");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('aria-label="Scenario file to import"');
  });

  test("with nothing saved, Export is disabled and says why; Import still works", () => {
    const html = render(access(), store());
    expect(html).toMatch(/data-focus-id="export-scenarios"[^>]*aria-disabled="true"/);
    expect(html).toContain("No saved scenarios to export yet.");
    expect(html).toMatch(/data-focus-id="import-scenarios"[^>]*aria-disabled="false"/);
  });

  test("with scenarios saved, Export is on", () => {
    const html = render(access(), store({ scenarios: [saved] as never }));
    expect(html).toMatch(/data-focus-id="export-scenarios"[^>]*aria-disabled="false"/);
  });

  test("without write access, Import is off and the title says what to do; Export still works", () => {
    const html = render(
      access({ verdict: "needs-token", writeRequiresToken: true, canWrite: false }),
      store({ scenarios: [saved] as never }),
    );
    expect(html).toMatch(/data-focus-id="import-scenarios"[^>]*aria-disabled="true"/);
    expect(html).toContain("Enter the write token to save or edit scenarios.");
    expect(html).toMatch(/data-focus-id="export-scenarios"[^>]*aria-disabled="false"/);
  });

  test("while a request is running, Import waits", () => {
    expect(render(access(), store({ busy: true }))).toMatch(/data-focus-id="import-scenarios"[^>]*aria-disabled="true"/);
  });

  test("when saved scenarios could not be loaded, Import is off", () => {
    expect(render(access(), store({ status: "error", loadMessage: "x" }))).toMatch(/data-focus-id="import-scenarios"[^>]*aria-disabled="true"/);
  });
});
