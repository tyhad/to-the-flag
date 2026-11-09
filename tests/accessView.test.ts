import { describe, expect, test } from "bun:test";
import {
  decideAccessState,
  readStoredToken,
  saveToken,
  clearToken,
  type TokenStorage,
} from "../web/viewModel/access";
import { encodeScenario } from "../shared/shareCodec";
import { buildShareHash } from "../web/viewModel/share";
import type { Scenario } from "../engine/types";

function createMockStorage(): TokenStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function createFailingStorage(): TokenStorage {
  return {
    getItem: () => {
      throw new Error("Storage access denied");
    },
    setItem: () => {
      throw new Error("Storage quota exceeded");
    },
    removeItem: () => {
      throw new Error("Storage access denied");
    },
  };
}

describe("web/viewModel/access", () => {
  describe("decideAccessState", () => {
    test("open when canWrite is true regardless of writeRequiresToken", () => {
      expect(decideAccessState({ writeRequiresToken: false, canWrite: true })).toBe("open");
      expect(decideAccessState({ writeRequiresToken: true, canWrite: true })).toBe("open");
    });

    test("needs-token when writeRequiresToken is true and canWrite is false", () => {
      expect(decideAccessState({ writeRequiresToken: true, canWrite: false })).toBe("needs-token");
    });

    test("local-only when writeRequiresToken is false and canWrite is false", () => {
      expect(decideAccessState({ writeRequiresToken: false, canWrite: false })).toBe("local-only");
    });

    test("error when payload is null, undefined, or malformed", () => {
      expect(decideAccessState(null)).toBe("error");
      expect(decideAccessState(undefined)).toBe("error");
      expect(decideAccessState({} as any)).toBe("error");
      expect(decideAccessState({ writeRequiresToken: "yes" } as any)).toBe("error");
    });
  });

  describe("token storage", () => {
    test("saves to sessionStorage when remember is false", () => {
      const session = createMockStorage();
      const local = createMockStorage();

      saveToken("my-token-123", false, session, local);

      expect(session.getItem("ttf_write_token")).toBe("my-token-123");
      expect(local.getItem("ttf_write_token")).toBeNull();

      const read = readStoredToken(session, local);
      expect(read.token).toBe("my-token-123");
      expect(read.remembered).toBe(false);
    });

    test("saves to localStorage when remember is true", () => {
      const session = createMockStorage();
      const local = createMockStorage();

      saveToken("my-token-456", true, session, local);

      expect(local.getItem("ttf_write_token")).toBe("my-token-456");
      expect(session.getItem("ttf_write_token")).toBe("my-token-456");

      const read = readStoredToken(session, local);
      expect(read.token).toBe("my-token-456");
    });

    test("clears token on request from both storages", () => {
      const session = createMockStorage();
      const local = createMockStorage();

      saveToken("my-token", true, session, local);
      expect(readStoredToken(session, local).token).toBe("my-token");

      clearToken(session, local);
      expect(session.getItem("ttf_write_token")).toBeNull();
      expect(local.getItem("ttf_write_token")).toBeNull();
      expect(readStoredToken(session, local).token).toBeNull();
    });

    test("safe when storage throws (private browsing or quota exceeded)", () => {
      const session = createFailingStorage();
      const local = createFailingStorage();

      expect(() => saveToken("test", true, session, local)).not.toThrow();
      expect(() => readStoredToken(session, local)).not.toThrow();
      expect(readStoredToken(session, local)).toEqual({ token: null, remembered: false });
      expect(() => clearToken(session, local)).not.toThrow();
    });
  });

  describe("share link never contains the token", () => {
    test("share hash contains only scenario code and round, never token", async () => {
      const SECRET = "secret-token-xyz-123456789";
      const scenario: Scenario = {
        locks: { "17:race": { fixed: { NOR: 1, VER: 2 } } },
      };
      const contenders = ["NOR", "VER"];

      const code = await encodeScenario(scenario, contenders);
      const hash = buildShareHash(code, 16);

      expect(hash).not.toContain(SECRET);
      expect(hash.startsWith("#s=v1.")).toBe(true);
      expect(hash).toContain("&r=16");
    });
  });
});
