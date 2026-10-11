/**
 * Phase 2 Step 10: the app is local-first. A fresh build must not point at any outside host:
 * no CDN links, no remote fonts, no absolute-URL requests in the code.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb } from "../scripts/build";

let out = "";
const files = (ext: string) => readdirSync(out).filter((f) => f.endsWith(ext));
const read = (f: string) => readFileSync(join(out, f), "utf8");

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "ttf-offline-"));
  await buildWeb({ clean: true, minify: true, outdir: out });
}, 30_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("build output has no outside references", () => {
  test("the build produced a page, a script and a stylesheet", () => {
    expect(files(".html")).toContain("index.html");
    expect(files(".js").length).toBeGreaterThan(0);
    expect(files(".css").length).toBeGreaterThan(0);
  });

  test("the page loads only its own files: no http(s) or protocol-relative src/href", () => {
    const html = read("index.html");
    const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).not.toMatch(/^(?:https?:)?\/\//);
  });

  test("the stylesheet imports nothing remote and every font is embedded", () => {
    for (const file of files(".css")) {
      const css = read(file);
      expect(css).not.toMatch(/@import\s+(?:url\()?["']?(?:https?:)?\/\//);
      const urls = [...css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/g)].map((m) => m[1] ?? "");
      for (const url of urls) expect(url).not.toMatch(/^(?:https?:)?\/\//);
      // The fonts are bundled, so the font faces point at embedded data.
      const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]);
      expect(faces.length).toBeGreaterThanOrEqual(5);
      for (const face of faces) expect(face).toMatch(/url\(\s*["']?data:font\/woff2/);
    }
  });

  test("the code makes no request to an absolute URL", () => {
    for (const file of files(".js")) {
      const js = read(file);
      expect(js).not.toMatch(/\bfetch\(\s*["'`]https?:/);
      expect(js).not.toMatch(/\.open\(\s*["'][A-Z]+["']\s*,\s*["'`]https?:/);
      expect(js).not.toMatch(/\bnew\s+(?:WebSocket|EventSource)\(\s*["'`](?:https?|wss?):/);
      expect(js).not.toMatch(/\bimport\(\s*["'`]https?:/);
      expect(js).not.toMatch(/\bimportScripts\(/);
    }
  });

  test("the source never builds a request to a hard-coded host", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : /\.(?:tsx?|html|css)$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    for (const file of walk(join(import.meta.dir, "..", "web"))) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/\bfetch\(\s*["'`]https?:/);
      expect(text).not.toMatch(/<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//);
    }
  });
});
