/**
 * Bundle the web UI into dist/.
 *
 * Bun bundles web/index.html, its TSX and its CSS. The Tailwind v4 plugin compiles theme.css, and the
 * bundler inlines the self-hosted woff2 fonts into the CSS. Nothing is fetched from the network.
 *
 * Usage: `bun run build`. `scripts/dev.ts` calls buildWeb() again on every change under web/.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const ROOT = join(import.meta.dir, "..");
export const WEB_DIR = join(ROOT, "web");
export const DIST_DIR = join(ROOT, "dist");

export interface BuildOptions {
  /** Delete dist/ first, so files from older builds do not pile up. */
  clean?: boolean;
  minify?: boolean;
}

export async function buildWeb({ clean = false, minify = false }: BuildOptions = {}): Promise<void> {
  if (clean) await rm(DIST_DIR, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "index.html")],
    outdir: DIST_DIR,
    plugins: [tailwind],
    target: "browser",
    minify,
    sourcemap: minify ? "none" : "linked",
    define: { "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development") },
    // Stable names for entry files, so a rebuild replaces files instead of adding new ones.
    naming: { entry: "[name].[ext]", chunk: "[name].[ext]", asset: "[name]-[hash].[ext]" },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Web build failed. See the messages above.");
  }
}

if (import.meta.main) {
  const started = performance.now();
  await buildWeb({ clean: true, minify: true });
  console.log(`Built web UI into dist/ in ${Math.round(performance.now() - started)} ms`);
}
