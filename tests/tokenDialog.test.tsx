import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TokenDialog } from "../web/components/TokenDialog";
import { ScenarioStrip } from "../web/components/ScenarioStrip";
import type { SeasonState } from "../engine/types";
import { initialWorkspace } from "../web/viewModel/workspace";
import type { AccessInfo } from "../web/useAccess";
import type { ScenarioStore } from "../web/useScenarioStore";
import type { Strip } from "../web/useStrip";

const state = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "season-2026-r16.json"), "utf8")) as SeasonState;
const noop = () => {};

function makeMockAccess(overrides?: Partial<AccessInfo>): AccessInfo {
  return {
    verdict: "open",
    writeRequiresToken: false,
    canWrite: true,
    dialogOpen: false,
    openDialog: noop,
    closeDialog: noop,
    submitToken: async () => ({ ok: true }),
    clear: noop,
    ...overrides,
  };
}

function makeMockStore(overrides?: Partial<ScenarioStore>): ScenarioStore {
  return {
    status: "ready",
    loadMessage: null,
    scenarios: [],
    activeId: null,
    busy: false,
    create: async () => ({ ok: true as const, data: {} as any }),
    update: async () => ({ ok: true as const, data: {} as any }),
    remove: async () => ({ ok: true as const, data: null }),
    setActive: async () => ({ ok: true as const, data: null }),
    ...overrides,
  };
}

function makeMockStrip(overrides?: Partial<Strip>): Strip {
  return {
    selectedId: null,
    banner: null,
    compare: { open: false, left: "base", right: "sandbox" },
    manualLink: null,
    selectChip: noop,
    saveNew: async () => null,
    saveChanges: async () => {},
    rename: async () => null,
    removeSelected: async () => {},
    copyLink: async () => {},
    toggleOverlay: async () => {},
    toggleCompare: noop,
    setCompareSide: noop,
    dismissBanner: noop,
    ...overrides,
  };
}

describe("TokenDialog markup", () => {
  test("returns null when open is false", () => {
    const html = renderToStaticMarkup(
      <TokenDialog open={false} onClose={noop} onSubmit={async () => ({ ok: true })} />
    );
    expect(html).toBe("");
  });

  test("renders dialog, inputs, and accessible labels when open", () => {
    const html = renderToStaticMarkup(
      <TokenDialog open={true} onClose={noop} onSubmit={async () => ({ ok: true })} />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="token-dialog-title"');
    expect(html).toContain("Enter write token");
    expect(html).toContain("Remember on this device");
    expect(html).toContain('type="password"');
    expect(html).toContain("Save token");
    expect(html).toContain("Cancel");
  });
});

describe("ScenarioStrip read-only state and write controls", () => {
  test("shows read-only notice and Enter token button when token is needed", () => {
    const access = makeMockAccess({
      verdict: "needs-token",
      writeRequiresToken: true,
      canWrite: false,
    });
    const workspace = initialWorkspace(state);
    const store = makeMockStore();
    const strip = makeMockStrip();

    const html = renderToStaticMarkup(
      <ScenarioStrip
        state={state}
        workspace={workspace}
        store={store}
        strip={strip}
        access={access}
      />
    );

    expect(html).toContain("Read-only. Enter the write token to save or share scenarios.");
    expect(html).toContain(">Enter token</button>");
  });

  test("disables write buttons and shows explanation in title when canWrite is false", () => {
    const access = makeMockAccess({
      verdict: "needs-token",
      writeRequiresToken: true,
      canWrite: false,
    });
    // Set a lock so + New / Save would normally be enabled
    const workspace = {
      ...initialWorkspace(state),
      scenario: { locks: { "17:race": { fixed: { NOR: 1 } } } },
    };
    const store = makeMockStore();
    const strip = makeMockStrip();

    const html = renderToStaticMarkup(
      <ScenarioStrip
        state={state}
        workspace={workspace}
        store={store}
        strip={strip}
        access={access}
      />
    );

    // + New button disabled
    expect(html).toMatch(/data-focus-id="new"[^>]*disabled=""/);
    expect(html).toContain('title="Enter the write token to save or edit scenarios."');
    // Save as new scenario button disabled
    expect(html).toMatch(/data-focus-id="save-new"[^>]*disabled=""/);
    // Show on overlay button aria-disabled
    expect(html).toContain('aria-disabled="true"');
  });

  test("enables write buttons when canWrite is true", () => {
    const access = makeMockAccess({
      verdict: "open",
      canWrite: true,
    });
    const workspace = {
      ...initialWorkspace(state),
      scenario: { locks: { "17:race": { fixed: { NOR: 1 } } } },
    };
    const store = makeMockStore();
    const strip = makeMockStrip();

    const html = renderToStaticMarkup(
      <ScenarioStrip
        state={state}
        workspace={workspace}
        store={store}
        strip={strip}
        access={access}
      />
    );

    expect(html).not.toContain("Read-only. Enter the write token to save or share scenarios.");
    // + New button is not disabled when locked
    expect(html).not.toMatch(/data-focus-id="new"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-focus-id="save-new"[^>]*disabled=""/);
  });
});
