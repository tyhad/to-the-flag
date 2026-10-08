/** Phase 1 "done" rule 3: nothing under engine/ touches the database, the file system, the network or the DOM. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ENGINE_DIR = join(import.meta.dir, "..", "engine");
const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts"));

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("engine/ is pure", () => {
  test("there are engine files to check", () => {
    expect(files).toContain("index.ts");
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of files) {
    const code = stripComments(readFileSync(join(ENGINE_DIR, file), "utf8"));

    test(`${file} imports only other engine files`, () => {
      const specifiers = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specifiers) expect(spec).toMatch(/^\.\/[\w-]+$/);
      expect(code).not.toMatch(/\brequire\s*\(/);
    });

    test(`${file} uses no runtime, DOM, network, clock or randomness`, () => {
      expect(code).not.toMatch(/\b(process|Bun|document|window|localStorage|fetch|console)\b/);
      expect(code).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    });
  }
});
