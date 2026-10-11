/**
 * DESIGN.md guard (Phase 2 Step 4): files under web/ must use tokens only.
 * - No raw hex colors, except in web/styles/theme.css and web/theme/teams.ts.
 * - No box-shadow except the clinched glow token (`--shadow-clinched` / `shadow-clinched`).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_DIR = join(import.meta.dir, "..", "web");

/** Files allowed to hold raw hex values (paths relative to web/, with forward slashes). */
const HEX_ALLOWED = new Set(["styles/theme.css", "theme/teams.ts"]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const BOX_SHADOW_DECLARATION = /(?:box-shadow|boxShadow)\s*[:=]\s*([^;}\n]*)/g;
// Tailwind shadow and ring utilities (ring is built on box-shadow). `shadow-clinched` and `shadow-none` are allowed.
const SHADOW_UTILITY = /(?<![\w-])(?:[\w-]+:)*(?:inset-shadow|drop-shadow|shadow|ring)(?:-(?!clinched(?![\w-])|none(?![\w-]))[\w[\]./%#-]+)/g;

export function findHexColors(source: string): string[] {
  return source.match(HEX) ?? [];
}

export function findBadShadows(source: string): string[] {
  const problems: string[] = [];
  for (const match of source.matchAll(BOX_SHADOW_DECLARATION)) {
    const value = (match[1] ?? "").trim().replace(/["'`,]+$/g, "").trim();
    const ok = value === "none" || value === "" || /var\(--shadow-clinched\)/.test(value);
    if (!ok) problems.push(match[0].trim());
  }
  problems.push(...(source.match(SHADOW_UTILITY) ?? []));
  return problems;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const TEXT_EXTENSIONS = /\.(?:tsx?|css|html|svg|json|md)$/;
const files = listFiles(WEB_DIR).filter((f) => TEXT_EXTENSIONS.test(f));
const rel = (file: string) => relative(WEB_DIR, file).split("\\").join("/");

describe("design tokens: scanner self-test", () => {
  test("finds raw hex colors of every valid length", () => {
    expect(findHexColors('color: #fff; background: #1e2124; x: #11223344; y: "#abcd"')).toEqual([
      "#fff",
      "#1e2124",
      "#11223344",
      "#abcd",
    ]);
  });

  test("ignores anchors and ids that are not colors", () => {
    expect(findHexColors('<a href="#standings">x</a> <a href="#s=abc">y</a> id="#main"')).toEqual([]);
  });

  test("allows only the clinched glow token and none for box-shadow", () => {
    expect(findBadShadows("box-shadow: var(--shadow-clinched);")).toEqual([]);
    expect(findBadShadows("box-shadow: none;")).toEqual([]);
    expect(findBadShadows("className=\"shadow-clinched\"")).toEqual([]);
    expect(findBadShadows("box-shadow: 0 1px 2px var(--color-line);")).toHaveLength(1);
    expect(findBadShadows("style={{ boxShadow: '0 0 4px var(--color-line)' }}")).toHaveLength(1);
  });

  test("flags Tailwind shadow and ring utilities", () => {
    expect(findBadShadows('className="shadow-md"')).toHaveLength(1);
    expect(findBadShadows('className="hover:shadow-lg"')).toHaveLength(1);
    expect(findBadShadows('className="ring-2 ring-accent"')).toHaveLength(2);
    expect(findBadShadows('className="drop-shadow-sm"')).toHaveLength(1);
    expect(findBadShadows('className="shadow-none"')).toEqual([]);
  });
});

describe("design tokens: web/ files", () => {
  test("there are web files to check", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.map(rel)).toContain("styles/theme.css");
  });

  for (const file of files) {
    const name = rel(file);
    const source = readFileSync(file, "utf8");

    if (!HEX_ALLOWED.has(name)) {
      test(`${name} has no raw hex color`, () => {
        expect(findHexColors(source)).toEqual([]);
      });
    }

    test(`${name} has no box-shadow other than the clinched glow`, () => {
      expect(findBadShadows(source)).toEqual([]);
    });
  }
});
