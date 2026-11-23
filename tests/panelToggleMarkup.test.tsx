/**
 * Left/right side panel toggle buttons in the Header, rendered on the server.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "../web/components/Header";

const health = { status: "ready" as const, season: 2026, asOfRound: 21, dataStatus: "ok" as const };

describe("Header side-panel toggles", () => {
  test("renders both left and right panel toggles with accessible labels and expanded state", () => {
    const html = renderToStaticMarkup(
      <Header
        health={health}
        leftToggle={{ open: true, onToggle: () => {} }}
        rightToggle={{ open: false, onToggle: () => {} }}
      />,
    );
    expect(html).toContain('aria-label="Hide sessions panel"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(">Sessions</span>");
    expect(html).toContain('aria-label="Show analysis panel"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Analysis</span>");
  });
});
