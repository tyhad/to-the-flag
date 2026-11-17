/** Phase 10, Step 6: every link and image path in README.md and docs/*.md points at a file that exists. */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = join(import.meta.dir, "..");
const docs = ["README.md", "THIRD_PARTY.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

/** Links and images of a Markdown text, outside code fences and inline code. [target, line] */
export function localTargets(markdown: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = [];
  let inFence = false;
  markdown.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) found.push({ target: m[1]!, line: i + 1 });
    for (const m of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) found.push({ target: m[1]!, line: i + 1 });
  });
  return found.filter(({ target }) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target) || /^file:/i.test(target));
}

describe("the scanner", () => {
  test("finds links and images, and skips web addresses, anchors, code and mail", () => {
    const text = [
      "[a](docs/A.md) ![b](docs/img/b.png) [c](https://x.dev) [d](#top) [e](mailto:x@y.z)",
      "`[f](nope.md)`",
      "```",
      "[g](nope.md)",
      "```",
      '<img src="docs/img/h.png" alt="h">',
      "[i](docs/I.md#section)",
    ].join("\n");
    expect(localTargets(text).map((t) => t.target).sort()).toEqual(
      ["docs/A.md", "docs/I.md#section", "docs/img/b.png", "docs/img/h.png"].sort(),
    );
  });
});

describe("links and images in the documents", () => {
  test("there are documents to scan, and links in them", () => {
    expect(docs.length).toBeGreaterThan(10);
    const total = docs.reduce((n, f) => n + localTargets(readFileSync(join(root, f), "utf8")).length, 0);
    expect(total).toBeGreaterThan(3);
  });

  for (const file of docs) {
    test(file, () => {
      const missing = localTargets(readFileSync(join(root, file), "utf8")).filter(({ target }) => {
        const path = decodeURIComponent(target.split("#")[0]!.split("?")[0]!);
        if (path === "") return false;
        const resolved = path.startsWith("/") ? join(root, path) : normalize(join(root, dirname(file), path));
        return !existsSync(resolved);
      });
      expect(missing.map((m) => `${file}:${m.line} -> ${m.target}`)).toEqual([]);
    });
  }
});

describe("screenshots in docs/img", () => {
  const dir = join(root, "docs", "img");
  const images = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)) : [];

  test("each is under 300 KB", () => {
    for (const image of images) expect(statSync(join(dir, image)).size, image).toBeLessThan(300 * 1024);
  });

  test("none is an unreferenced leftover: the README uses every one", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    for (const image of images) expect(readme, image).toContain(`docs/img/${image}`);
  });
});
