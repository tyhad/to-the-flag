/**
 * Dev server: build the web UI, serve it with the API, and rebuild when files under web/ change.
 * Run with `bun run dev` (`bun --watch` restarts this process when api/ or config files change).
 * Reload the browser tab after a rebuild.
 */
import { watch } from "node:fs";
import { config } from "../config";
import { WEB_DIR, buildWeb } from "./build";

// Build before importing the server: the server only serves dist/ if it exists at startup.
await buildWeb();
const { app } = await import("../api/server");

let timer: ReturnType<typeof setTimeout> | undefined;
let building = false;
let again = false;

async function rebuild(): Promise<void> {
  if (building) {
    again = true;
    return;
  }
  building = true;
  try {
    await buildWeb();
    console.log("Rebuilt web UI. Reload the page.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    building = false;
    if (again) {
      again = false;
      void rebuild();
    }
  }
}

watch(WEB_DIR, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 100);
});

app.listen({ port: config.port, hostname: config.host }, (server) => {
  console.log(`Server listening at http://${server.hostname}:${server.port}`);
});
